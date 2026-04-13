
"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { FileUp, Link as LinkIcon, Loader2, Play, Pause, SkipForward, FileText, BookMarked, Bell, Square, Edit, LogOut, Send, CheckCircle2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { processUrl, generateArticleAction, analyzeTextDirectly, fetchAnalysisItems, upsertAnalysisItem, clearAnalysisQueue, saveImportedUrls, resetAnalysisQueue, resetProcessingStatus } from "@/app/actions";
import { logout } from "../../app/(auth)/actions";
import { exportCsv, exportJson, exportDocx, extractUrlsFromString, saveDocxFromContent, exportScoreSheetCsv } from "@/lib/utils";
import type { AnalysisItem, PerformDiscernAnalysisOutput } from "@/lib/types";
import { supabase } from "@/lib/supabase";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AnalysisQueue } from "@/components/app/analysis-queue";
import { ResultCard } from "@/components/app/result-card";
import { useI18n } from "@/components/i18n/use-i18n";

const CONCURRENCY_LIMIT = 10;

interface DiscernAnalyzerPageProps {
  initialJobId?: string;
  onClearJobId?: () => void;
}

export function DiscernAnalyzerPage({ initialJobId, onClearJobId }: DiscernAnalyzerPageProps = {}) {
  const { t, setLocale, locale } = useI18n();
  const [items, setItems] = useState<AnalysisItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [isGeneratingArticle, setIsGeneratingArticle] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isManualAnalysisOpen, setIsManualAnalysisOpen] = useState(false);
  const [manualAnalysisTargetId, setManualAnalysisTargetId] = useState<string | null>(null);
  const [manualAnalysisText, setManualAnalysisText] = useState("");
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const itemsRef = useRef<AnalysisItem[]>([]);
  const [notificationPermission, setNotificationPermission] = useState("default");
  const [pasteContent, setPasteContent] = useState("");
  const [keyword, setKeyword] = useState("");
  const { toast } = useToast();
  const isProcessingRef = useRef(false);
  const isAutoModeRef = useRef(isAutoMode);

  // Background job state
  const [isSendingToBackground, setIsSendingToBackground] = useState(false);
  const [backgroundJobId, setBackgroundJobId] = useState<string | null>(null);
  const [backgroundJobStatus, setBackgroundJobStatus] = useState<string | null>(null);
  const [backgroundProgress, setBackgroundProgress] = useState<{ completed: number; failed: number; total: number } | null>(null);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
    isAutoModeRef.current = isAutoMode;
    itemsRef.current = items;
  }, [isProcessing, isAutoMode, items]);

  useEffect(() => {
    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
    // Load initial data from Supabase and check for active background jobs
    const loadData = async () => {
      const fetchParams = initialJobId ? { jobId: initialJobId } : { onlyUnassigned: true };
      let activeJobsMatch: any = [];
      let activeJobError = null;

      // Only query active general jobs if NOT viewing a specific history job
      if (!initialJobId) {
        const { data, error } = await supabase.from("analysis_jobs").select("*").eq("status", "processing").order("created_at", { ascending: false }).limit(1);
        activeJobsMatch = data;
        activeJobError = error;
      }

      const savedItems = await fetchAnalysisItems(fetchParams);

      if (savedItems.length >= 0) {
        setItems(savedItems);
      }

      if (activeJobsMatch && activeJobsMatch.length > 0) {
        const job = activeJobsMatch[0];
        setBackgroundJobId(job.id);
        setBackgroundJobStatus(job.status);
        setBackgroundProgress({
          completed: job.completed_urls,
          failed: job.failed_urls,
          total: job.total_urls,
        });
      } else if (initialJobId) {
         // If viewing a history component, we should load job info just manually as read-only.
         // Realtime logic exists below for updates if it gets updated.
         setBackgroundJobId(initialJobId);
      }
    };
    loadData();
  }, [t, initialJobId]);

  // Supabase Realtime: subscribe to background job progress
  useEffect(() => {
    if (!backgroundJobId) return;

    const supabaseClient = supabase;
    const jobChannel = supabaseClient
      .channel(`job-${backgroundJobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "analysis_jobs",
          filter: `id=eq.${backgroundJobId}`,
        },
        (payload: { new: any }) => {
          const job = payload.new;
          setBackgroundJobStatus(job.status);
          setBackgroundProgress({
            completed: job.completed_urls,
            failed: job.failed_urls,
            total: job.total_urls,
          });
          if (job.status === "done" || job.status === "failed") {
            // Reload items to show full updated results upon completion
            fetchAnalysisItems().then((updated) => {
              if (updated.length > 0) setItems(updated);
            });
            if (job.status === "done") {
              toast({ title: "✅ Análise concluída!", description: "Verifique seu email para o resumo." });
            }
          }
        }
      )
      .subscribe();

    // Also subscribe to item changes to show real-time progress in the list
    const itemsChannel = supabaseClient
      .channel(`items-${backgroundJobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "analysis_items",
          filter: `job_id=eq.${backgroundJobId}`,
        },
        (payload: { new: any }) => {
          const updatedItem = payload.new;
          setItems((prev) =>
            prev.map((item) =>
              item.id === updatedItem.id
                ? {
                    ...item,
                    status: updatedItem.status,
                    reason: updatedItem.reason,
                    meta: updatedItem.meta,
                    discernResult: updatedItem.discern_result,
                    updatedAt: updatedItem.updated_at,
                  }
                : item
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(jobChannel);
      supabaseClient.removeChannel(itemsChannel);
    };
  }, [backgroundJobId, toast]);

  // Polling fallback: fetch job progress every 3s when a background job is active
  useEffect(() => {
    if (!backgroundJobId || backgroundJobStatus !== 'processing') return;

    const poll = async () => {
      const { data } = await supabase
        .from('analysis_jobs')
        .select('status, completed_urls, failed_urls, total_urls')
        .eq('id', backgroundJobId)
        .single();

      if (!data) return;

      setBackgroundJobStatus(data.status);
      setBackgroundProgress({
        completed: data.completed_urls,
        failed: data.failed_urls,
        total: data.total_urls,
      });

      if (data.status === 'done' || data.status === 'failed') {
        fetchAnalysisItems().then((updated) => {
          if (updated.length > 0) setItems(updated);
        });
        if (data.status === 'done') {
          toast({ title: '✅ Análise concluída!', description: 'Verifique seu email para o resumo.' });
        }
      }
    };

    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [backgroundJobId, backgroundJobStatus, toast]);


  const activeItem = useMemo(
    () => items.find((item) => item.id === activeItemId) || null,
    [items, activeItemId]
  );

  const showCompletionNotification = useCallback(() => {
    if (notificationPermission === "granted") {
      new Notification(t('analysisComplete.title'), {
        body: t('analysisComplete.body', { count: items.length }),
        icon: "/favicon.ico",
      });
    } else {
      toast({ title: t('analysisComplete.title'), description: t('analysisComplete.body', { count: items.length }) });
    }
  }, [notificationPermission, items.length, toast, t]);

  const processNextAvailable = useCallback(async () => {
    if (!isProcessingRef.current) return;

    // Find the next item that is 'pending'
    const nextItem = itemsRef.current.find(item => item.status === 'pending');

    if (!nextItem) {
      // Check if all items are done (not pending and not processing)
      const stillProcessing = itemsRef.current.some(item => item.status === 'processing');
      if (!stillProcessing) {
        setIsProcessing(false);
        showCompletionNotification();
      }
      return;
    }

    // Mark as processing immediately in state and DB
    setItems((prev) =>
      prev.map((item) =>
        item.id === nextItem.id
          ? { ...item, status: "processing", updatedAt: new Date().toISOString() }
          : item
      )
    );
    
    await upsertAnalysisItem({
      id: nextItem.id,
      status: "processing",
      url: nextItem.url,
      index: nextItem.index
    });

    try {
      const result = await processUrl(nextItem.url, locale);
      const updatedItem = { ...nextItem, ...result, status: result.status, updatedAt: new Date().toISOString() };
      
      setItems((prev) =>
        prev.map((item) =>
          item.id === nextItem.id ? updatedItem : item
        )
      );
      await upsertAnalysisItem(updatedItem);
    } catch (error) {
      console.error(`Error processing ${nextItem.url}:`, error);
      const errorItem = { ...nextItem, status: 'analysis_error' as const, reason: String(error), updatedAt: new Date().toISOString() };
      setItems((prev) =>
        prev.map((item) =>
          item.id === nextItem.id ? errorItem : item
        )
      );
      await upsertAnalysisItem(errorItem);
    }

    // Continue to next if still processing and auto mode is on
    if (isProcessingRef.current && isAutoModeRef.current) {
      processNextAvailable();
    }
  }, [showCompletionNotification, locale]);


  useEffect(() => {
    // This effect is only for when items change in a way that might trigger more workers
    // but the start button handles the initial burst.
  }, [items]);

  const handlePasteImport = async () => {
    const urls = extractUrlsFromString(pasteContent);
    await importUrls(urls);
    setPasteContent(""); // Clear the textarea after import
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const urls = extractUrlsFromString(content);
      await importUrls(urls);
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset file input
  };

  const importUrls = async (urls: string[]) => {
    const MAX_ITEMS = 200;
    let newUrls = [...urls];

    if (newUrls.length === 0) {
      return;
    }

    const availableSlots = MAX_ITEMS - items.length;

    if (availableSlots <= 0) {
      toast({
        title: t('importLimit.title'),
        description: t('importLimit.description'),
        variant: "destructive",
      });
      return;
    }

    let importedCount = newUrls.length;
    let partialImport = false;

    if (newUrls.length > availableSlots) {
      newUrls = newUrls.slice(0, availableSlots);
      importedCount = availableSlots;
      partialImport = true;
    }

    const newItems: AnalysisItem[] = newUrls.map((url, index) => ({
      id: uuidv4(),
      index: items.length + index + 1,
      url,
      status: "pending",
      updatedAt: new Date().toISOString(),
    }));

    setItems((prev) => [...prev, ...newItems]);

    setIsImporting(true);
    try {
      await saveImportedUrls(newItems.map(item => ({ id: item.id, url: item.url, index: item.index })));

      if (partialImport) {
        toast({
          title: t('importLimit.title'),
          description: t('importLimit.partial', { count: importedCount }),
        });
      } else {
        toast({ title: t('importSuccess.title', { count: importedCount }), description: t('importSuccess.description') });
      }
    } catch (e) {
      toast({
        title: "Erro ao salvar no banco",
        description: "As URLs foram carregadas na tela, mas houve um erro ao sincronizar com o servidor.",
        variant: "destructive"
      });
      console.error(e);
    } finally {
      setIsImporting(false);
    }
  };

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) {
      toast({ title: t('notifications.notSupported'), variant: "destructive" });
      return "denied";
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") {
      toast({ title: t('notifications.activatedTitle'), description: t('notifications.activatedBody') });
    }
    return permission;
  }

  const handleStartProcessing = async () => {
    if (items.length === 0) {
      toast({ title: t('queue.emptyTitle'), description: t('queue.emptyDescription') });
      return;
    }

    if (notificationPermission === 'default') {
      const permission = await requestNotificationPermission();
      if (permission !== 'granted') {
        toast({ title: t('notifications.permissionNeededTitle'), description: t('notifications.permissionNeededBody'), variant: "destructive" });
      }
    }

    setIsProcessing(true);
    isProcessingRef.current = true; // Update ref immediately

    if (isAutoMode) {
      // Start multiple workers
      for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        // Delay each worker slightly to avoid hitting rate limits instantly
        setTimeout(() => {
          processNextAvailable();
        }, i * 200);
      }
    } else {
      processNextAvailable();
    }
  };

  const handlePauseProcessing = () => {
    setIsProcessing(false);
  };

  const handleStopProcessing = async () => {
    setIsProcessing(false);
    setActiveItemId(null);

    // UI Update: only revert 'processing' back to 'pending'
    setItems((prev) =>
      prev.map((item) =>
        item.status === "processing" ? { ...item, status: "pending" as const } : item
      )
    );

    try {
      // Single bulk update instead of a loop
      await resetProcessingStatus();
    } catch (e) {
      console.error("Failed to reset processing status in DB:", e);
    }
  };

  const handleSendToBackground = async () => {
    const pendingItems = items.filter(i => i.status === 'pending');
    if (pendingItems.length === 0) {
      toast({ title: "Nenhuma URL pendente", description: "Importe URLs antes de enviar para processamento.", variant: "destructive" });
      return;
    }
    setIsSendingToBackground(true);
    setBackgroundJobId(null);
    setBackgroundJobStatus(null);
    setBackgroundProgress(null);
    try {
      const res = await fetch('/api/jobs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: locale, keyword }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || 'Erro ao criar job');
      }
      const { jobId, totalUrls } = await res.json();
      setBackgroundJobId(jobId);
      setBackgroundJobStatus('processing');
      setBackgroundProgress({ completed: 0, failed: 0, total: totalUrls });
      toast({ title: "🚀 Enviado!", description: `${totalUrls} URLs em processamento. Você pode fechar o navegador.` });
    } catch (error) {
      toast({ title: "Erro ao enviar", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setIsSendingToBackground(false);
    }
  };

  const handleClearAll = async () => {
    if (confirm(t('queue.clearConfirm'))) {
      await clearAnalysisQueue();
      setItems([]);
      setActiveItemId(null);
    }
  };


  const handleNext = () => {
    processNextAvailable();
  };

  const handleOpenManualAnalysis = (itemId: string) => {
    setManualAnalysisTargetId(itemId);
    setIsManualAnalysisOpen(true);
  };

  const handleManualAnalysisSubmit = async () => {
    if (!manualAnalysisTargetId || !manualAnalysisText) return;

    setIsSubmittingManual(true);
    try {
      const result = await analyzeTextDirectly(manualAnalysisText, locale);
      const updatedItem = { ...items.find(i => i.id === manualAnalysisTargetId)!, status: 'completed' as const, discernResult: result, reason: 'Manually analyzed', updatedAt: new Date().toISOString() };

      setItems(prev => prev.map(item => item.id === manualAnalysisTargetId
        ? updatedItem
        : item
      ));
      await upsertAnalysisItem(updatedItem);
      toast({ title: t('manualAnalysis.successTitle'), description: t('manualAnalysis.successBody') });
      setIsManualAnalysisOpen(false);
      setManualAnalysisText("");
      setManualAnalysisTargetId(null);
    } catch (error) {
      toast({
        title: t('manualAnalysis.errorTitle'),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    } finally {
      setIsSubmittingManual(false);
    }
  };


  const processedItems = useMemo(() => items.filter(item => item.status !== 'pending' && item.status !== 'processing'), [items]);
  const completedItems = useMemo(() => items.filter(item => item.status === 'completed' && item.discernResult), [items]);

  const handleGenerateArticle = async () => {
    if (completedItems.length === 0) {
      toast({ title: t('article.noResultsTitle'), description: t('article.noResultsDescription') });
      return;
    }
    setIsGeneratingArticle(true);
    toast({ title: t('article.generatingTitle'), description: t('article.generatingDescription') });
    try {
      const result = await generateArticleAction({ items: completedItems });
      if (result.articleContent) {
        saveDocxFromContent(result.articleContent, 'coloproctology_article');
        toast({ title: t('article.generatedTitle'), description: t('article.generatedDescription') });
      } else {
        throw new Error(t('article.emptyError'));
      }
    } catch (error) {
      toast({ title: t('article.errorTitle'), description: error instanceof Error ? error.message : t('article.unknownError'), variant: "destructive" });
    } finally {
      setIsGeneratingArticle(false);
    }
  };

  const getStartButtonText = () => {
    const hasCompleted = items.some(i => i.status === 'completed');
    if (hasCompleted && !isProcessing) return t('controls.continue');
    return t('controls.start');
  }

  return (
    <div className="flex flex-col font-sans">
      <main className="flex-grow container mx-auto p-4 pt-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 flex flex-col gap-8">
            <Card>
              <CardHeader>
                <CardTitle>{t('import.title')}</CardTitle>
                <CardDescription>{t('import.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="paste">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="paste"><LinkIcon className="mr-2 h-4 w-4" /> {t('import.paste')}</TabsTrigger>
                    <TabsTrigger value="upload"><FileUp className="mr-2 h-4 w-4" /> {t('import.upload')}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="paste" className="mt-4">
                    <Textarea
                      value={pasteContent}
                      onChange={(e) => setPasteContent(e.target.value)}
                      name="urls"
                      placeholder={t('import.placeholder')}
                      rows={6}
                      data-testid="import-textarea"
                    />
                    <Button
                      type="button"
                      onClick={handlePasteImport}
                      className="mt-4 w-full"
                      data-testid="import-button"
                      disabled={isImporting || !pasteContent}
                    >
                      {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {t('import.button')}
                    </Button>
                  </TabsContent>
                  <TabsContent value="upload" className="mt-4">
                    <Input id="csv-upload" type="file" accept=".csv,.txt" onChange={handleFileImport} />
                    <p className="text-xs text-muted-foreground mt-2">{t('import.csvHint')}</p>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('controls.title')}</CardTitle>
                <CardDescription>{t('controls.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {initialJobId && (
                  <div className="flex items-center justify-between bg-blue-50 p-3 rounded-lg border border-blue-100 mb-4">
                    <div className="text-sm text-blue-800">
                      Visualizando sessão do histórico.
                    </div>
                    {onClearJobId && (
                      <Button variant="ghost" size="sm" onClick={onClearJobId} className="h-6 x-2 text-xs">
                        Voltar à Fila Atual
                      </Button>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-mode" className="flex flex-col space-y-1">
                    <span>{t('controls.autoMode')}</span>
                    <span className="font-normal leading-snug text-muted-foreground">
                      {t('controls.autoModeDescription')}
                    </span>
                  </Label>
                  <Switch id="auto-mode" checked={isAutoMode} onCheckedChange={setIsAutoMode} data-testid="auto-mode-switch" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={isProcessing ? handlePauseProcessing : handleStartProcessing} disabled={items.length === 0} data-testid="start-pause-button">
                    {isProcessing ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                    {isProcessing ? t('controls.pause') : getStartButtonText()}
                  </Button>
                  <Button onClick={handleStopProcessing} disabled={!isProcessing && !items.some(i => i.status === 'processing')} variant="destructive" data-testid="stop-button">
                    <Square className="mr-2 h-4 w-4" /> {t('controls.stop')}
                  </Button>
                  <div className="col-span-2 flex gap-2">
                    <Button onClick={handleNext} disabled={(isProcessing && isAutoMode) || items.length === 0 || !items.some(i => i.status === 'pending')} className="flex-1" data-testid="next-button">
                      <SkipForward className="mr-2 h-4 w-4" /> {t('controls.next')}
                    </Button>
                    <Button onClick={handleClearAll} variant="outline" disabled={items.length === 0} className="flex-1" data-testid="clear-all-button">
                      {t('controls.clearAll')}
                    </Button>
                  </div>
                </div>

                <div className="border-t pt-4 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Processar em segundo plano</p>
                    <p className="text-xs text-muted-foreground">Envie para o servidor e feche o navegador. Você receberá um email ao terminar.</p>
                  </div>
                  {!initialJobId && (
                    <Input
                      placeholder="Nome da Sessão (Ex: Câncer 2024)"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      className="text-sm border-slate-200"
                    />
                  )}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleSendToBackground}
                    disabled={isSendingToBackground || backgroundJobStatus === 'processing' || !items.some(i => i.status === 'pending')}
                    data-testid="background-process-button"
                  >
                    {isSendingToBackground
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : backgroundJobStatus === 'done'
                        ? <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                        : <Send className="mr-2 h-4 w-4" />}
                    {isSendingToBackground
                      ? "Enviando..."
                      : backgroundJobStatus === 'processing'
                        ? "Processando no servidor..."
                        : backgroundJobStatus === 'done'
                          ? "Concluído!"
                          : "Enviar para servidor"}
                  </Button>
                  {backgroundProgress && backgroundJobStatus === 'processing' && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{backgroundProgress.completed + backgroundProgress.failed} de {backgroundProgress.total} processadas</span>
                        <span>{Math.round(((backgroundProgress.completed + backgroundProgress.failed) / backgroundProgress.total) * 100)}%</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all duration-500"
                          style={{ width: `${Math.round(((backgroundProgress.completed + backgroundProgress.failed) / backgroundProgress.total) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('export.title')}</CardTitle>
                <CardDescription>{t('export.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full" onClick={() => exportCsv(processedItems, 'discern_analysis_results')} disabled={processedItems.length === 0}>{t('export.csv')}</Button>
                <Button variant="outline" className="w-full" onClick={() => exportJson(processedItems, 'discern_analysis_results')} disabled={processedItems.length === 0}>{t('export.json')}</Button>
                <Button variant="outline" className="w-full" onClick={() => exportDocx(processedItems, 'discern_analysis_results')} disabled={processedItems.length === 0}>
                  <FileText className="mr-2 h-4 w-4" />
                  {t('export.docx')}
                </Button>
                <Button variant="outline" className="w-full" onClick={() => exportScoreSheetCsv(processedItems, 'discern_scores_matrix')} disabled={processedItems.length === 0}>
                  {t('export.scores') || 'Planilha de Scores (Matriz)'}
                </Button>
                <Button variant="default" className="w-full" onClick={handleGenerateArticle} disabled={completedItems.length === 0 || isGeneratingArticle}>
                  {isGeneratingArticle ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <BookMarked className="mr-2 h-4 w-4" />
                  )}
                  {isGeneratingArticle ? t('article.generating') : t('article.create')}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 flex flex-col gap-8">
            <AnalysisQueue items={items} activeItemId={activeItemId} onRowClick={setActiveItemId} />
            <ResultCard
              activeItem={activeItem}
              isLoading={isProcessing && activeItem?.status === 'processing'}
              onManualAnalysisClick={handleOpenManualAnalysis}
            />
          </div>
        </div>
      </main>

      <Dialog open={isManualAnalysisOpen} onOpenChange={setIsManualAnalysisOpen}>
        <DialogContent className="sm:max-w-[625px]">
          <DialogHeader>
            <DialogTitle>{t('manualAnalysis.title')}</DialogTitle>
            <DialogDescription>
              {t('manualAnalysis.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Textarea
              placeholder={t('manualAnalysis.placeholder')}
              rows={15}
              value={manualAnalysisText}
              onChange={(e) => setManualAnalysisText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={handleManualAnalysisSubmit}
              disabled={!manualAnalysisText || isSubmittingManual}
            >
              {isSubmittingManual && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('manualAnalysis.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

