
"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { FileUp, Link as LinkIcon, Loader2, Play, Pause, SkipForward, FileText, BookMarked, Bell, Square, Edit, LogOut, Send, CheckCircle2, Users2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { processUrl, generateArticleAction, startManualAnalysis, fetchAnalysisItems, upsertAnalysisItem, clearAnalysisQueue, saveImportedUrls, resetAnalysisQueue, resetProcessingStatus, fetchAvailableModels, fetchModelResults, parseSearchWorkbook, fetchActiveJob, fetchJobProgress } from "@/app/actions";
import { logout } from "../../app/(auth)/actions";
import { toArticleItem } from "@/lib/article-data";
import { clearSearchImports, loadSearchImports, parseSearchCsv, rememberSearchImport, type SearchImport } from "@/lib/search-import";
import { exportCsv, exportJson, exportDocx, extractUrlsFromString, saveDocxFromContent, exportScoreSheetCsv, exportConsensusCsv, cn } from "@/lib/utils";
import { ReliabilityCard } from "@/components/app/reliability-card";
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
  const { t, locale } = useI18n();
  const [items, setItems] = useState<AnalysisItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [isGeneratingArticle, setIsGeneratingArticle] = useState(false);
  const [isArticleDialogOpen, setIsArticleDialogOpen] = useState(false);
  const [articleTopic, setArticleTopic] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isManualAnalysisOpen, setIsManualAnalysisOpen] = useState(false);
  const [manualAnalysisTargetId, setManualAnalysisTargetId] = useState<string | null>(null);
  const [manualAnalysisText, setManualAnalysisText] = useState("");
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const itemsRef = useRef<AnalysisItem[]>([]);
  const manualPollRef = useRef<number | null>(null);
  const [notificationPermission, setNotificationPermission] = useState("default");
  const [pasteContent, setPasteContent] = useState("");
  const [searchImports, setSearchImports] = useState<SearchImport[]>([]);
  const [keyword, setKeyword] = useState("");
  const { toast } = useToast();
  const isProcessingRef = useRef(false);
  const isAutoModeRef = useRef(isAutoMode);

  // Model panel selection. Empty selection = full panel.
  const [availableModels, setAvailableModels] = useState<{ id: string; displayName: string }[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const selectedModelsRef = useRef<string[]>([]);

  // Background job state
  const [isSendingToBackground, setIsSendingToBackground] = useState(false);
  const [backgroundJobId, setBackgroundJobId] = useState<string | null>(null);
  const [backgroundJobStatus, setBackgroundJobStatus] = useState<string | null>(null);
  const [backgroundProgress, setBackgroundProgress] = useState<{ completed: number; failed: number; total: number } | null>(null);

  useEffect(() => {
    setSearchImports(loadSearchImports());
  }, []);

  useEffect(() => {
    fetchAvailableModels()
      .then((models) => {
        setAvailableModels(models);
        setSelectedModels(models.map((m) => m.id)); // default: all on
      })
      .catch((e) => console.error("Failed to load available models:", e));
  }, []);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
    isAutoModeRef.current = isAutoMode;
    itemsRef.current = items;
    selectedModelsRef.current = selectedModels;
  }, [isProcessing, isAutoMode, items, selectedModels]);

  useEffect(() => {
    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
    // Load initial data from Supabase and check for active background jobs
    const loadData = async () => {
      if (initialJobId) {
        const savedItems = await fetchAnalysisItems({ jobId: initialJobId });
        if (savedItems.length >= 0) setItems(savedItems);
        const job = await fetchJobProgress(initialJobId);
        setBackgroundJobId(initialJobId);
        if (job) {
          setBackgroundJobStatus(job.status);
          setBackgroundProgress({ completed: job.completed, failed: job.failed, total: job.total });
        }
        return;
      }

      const job = await fetchActiveJob();
      if (job) {
        setBackgroundJobId(job.id);
        setBackgroundJobStatus(job.status);
        setBackgroundProgress({ completed: job.completed, failed: job.failed, total: job.total });
        const savedItems = await fetchAnalysisItems({ jobId: job.id });
        if (savedItems.length >= 0) setItems(savedItems);
        return;
      }

      const savedItems = await fetchAnalysisItems({ onlyUnassigned: true });
      if (savedItems.length >= 0) setItems(savedItems);
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
                    consensus: updatedItem.consensus,
                    divergenceFlag: updatedItem.divergence_flag,
                    divergentItems: updatedItem.divergent_items,
                    panelIncomplete: updatedItem.panel_incomplete,
                    modelsTotal: updatedItem.models_total,
                    modelId: updatedItem.model_id,
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

    let cancelled = false;
    const poll = async () => {
      const data = await fetchJobProgress(backgroundJobId);
      if (!data || cancelled) return;

      setBackgroundJobStatus(data.status);
      setBackgroundProgress({
        completed: data.completed,
        failed: data.failed,
        total: data.total,
      });

      if (data.status === 'done' || data.status === 'failed') {
        const updated = await fetchAnalysisItems({ jobId: backgroundJobId });
        if (!cancelled && updated.length > 0) setItems(updated);
        if (data.status === 'done') {
          toast({ title: '✅ Análise concluída!', description: 'Verifique seu email para o resumo.' });
        }
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [backgroundJobId, backgroundJobStatus, toast]);

  useEffect(() => () => {
    if (manualPollRef.current != null) window.clearInterval(manualPollRef.current);
  }, []);


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
    const ordered = [...itemsRef.current].sort((a, b) => a.index - b.index);
    const nextItem = ordered.find(item => item.status === 'pending');

    if (!nextItem) {
      // Check if all items are done (not pending and not processing)
      const stillProcessing = itemsRef.current.some(item => item.status === 'processing');
      if (!stillProcessing) {
        setIsProcessing(false);
        showCompletionNotification();
      }
      return;
    }

    const source = ordered.find(
      (item) =>
        item.url === nextItem.url &&
        item.index < nextItem.index &&
        item.status !== "pending" &&
        item.status !== "processing"
    );
    if (source) {
      const copied = {
        ...nextItem,
        status: source.status,
        reason: source.reason,
        discernResult: source.discernResult,
        consensus: source.consensus,
        divergenceFlag: source.divergenceFlag,
        divergentItems: source.divergentItems,
        panelIncomplete: source.panelIncomplete,
        modelsTotal: source.modelsTotal,
        contentSnapshot: source.contentSnapshot,
        contentHash: source.contentHash,
        extractionMethod: source.extractionMethod,
        modelId: source.modelId,
        meta: { ...source.meta, ...nextItem.meta, sameScoreAs: source.id },
        updatedAt: new Date().toISOString(),
      };
      setItems((prev) => prev.map((item) => (item.id === nextItem.id ? copied : item)));
      itemsRef.current = itemsRef.current.map((item) => (item.id === nextItem.id ? copied : item));
      await upsertAnalysisItem(copied);
      if (isProcessingRef.current && isAutoModeRef.current) processNextAvailable();
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
      const result = await processUrl(nextItem.url, locale, false, nextItem.id, selectedModelsRef.current);
      const updatedItem = {
        ...nextItem,
        ...result,
        meta: { ...nextItem.meta, ...result.meta },
        status: result.status,
        updatedAt: new Date().toISOString(),
      };
      
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
    const parsed = parseSearchCsv(pasteContent);
    if (parsed) await importSpreadsheet(parsed);
    else await importRows(extractUrlsFromString(pasteContent).map((url) => ({ url })));
    setPasteContent(""); // Clear the textarea after import
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      if (file.name.toLowerCase().endsWith(".xlsx")) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const parsed = await parseSearchWorkbook(btoa(binary));
        if (!parsed) {
          toast({ title: t("import.sheetUnrecognized"), variant: "destructive" });
          return;
        }
        await importSpreadsheet(parsed);
        return;
      }
      const text = await file.text();
      const parsed = parseSearchCsv(text);
      if (parsed) {
        await importSpreadsheet(parsed);
        return;
      }
      await importRows(extractUrlsFromString(text).map((url) => ({ url })));
    } catch (error) {
      toast({ title: t("import.sheetUnrecognized"), description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const importRows = async (
    rows: { url: string; index?: number; meta?: AnalysisItem["meta"] }[],
    options?: { silent?: boolean }
  ) => {
    const MAX_ITEMS = 200;

    if (rows.length === 0) {
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

    let entering = rows;
    let importedCount = rows.length;
    let partialImport = false;

    if (rows.length > availableSlots) {
      entering = rows.slice(0, availableSlots);
      importedCount = availableSlots;
      partialImport = true;
    }

    const newItems: AnalysisItem[] = entering.map((row, index) => ({
      id: uuidv4(),
      index: row.index ?? items.length + index + 1,
      url: row.url,
      meta: row.meta,
      status: "pending",
      updatedAt: new Date().toISOString(),
    }));

    setItems((prev) => [...prev, ...newItems]);

    setIsImporting(true);
    try {
      await saveImportedUrls(newItems.map(item => ({ id: item.id, url: item.url, index: item.index, meta: item.meta })));

      if (partialImport) {
        toast({
          title: t('importLimit.title'),
          description: t('importLimit.partial', { count: importedCount }),
        });
      } else if (!options?.silent) {
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

  const importSpreadsheet = async (parsed: SearchImport & { hits: { url: string; page: number | null; position: number | null; positionOnPage: number | null }[] }) => {
    const { hits, ...summary } = parsed;
    const known = new Set(items.map((item) => `${item.url}#${item.meta?.searchPosition ?? item.index}`));
    const fresh = hits.filter((hit) => !known.has(`${hit.url}#${hit.position ?? "x"}`));
    if (fresh.length > 0) {
      const start = items.length;
      await importRows(fresh.map((hit, i) => ({
        url: hit.url,
        index: hit.position ?? start + i + 1,
        meta: {
          ...(hit.page != null ? { searchPage: hit.page } : {}),
          ...(hit.position != null ? { searchPosition: hit.position } : {}),
          ...(hit.positionOnPage != null ? { searchPositionOnPage: hit.positionOnPage } : {}),
        },
      })), { silent: true });
      setSearchImports(rememberSearchImport(summary));
    }
    const leftOut = summary.rows - summary.organicRows;
    toast({
      title: fresh.length > 0 ? t("import.sheetTitle") : t("import.sheetEmpty"),
      description: t("import.sheetBody", { rows: summary.rows, queued: Math.min(fresh.length, Math.max(0, 200 - items.length)), unique: summary.uniqueOrganic, leftOut }),
    });
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
        body: JSON.stringify({ language: locale, keyword, models: selectedModels }),
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
      clearSearchImports();
      setSearchImports([]);
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

    const itemId = manualAnalysisTargetId;
    setIsSubmittingManual(true);
    try {
      const started = await startManualAnalysis({
        itemId,
        text: manualAnalysisText,
        language: locale,
        modelIds: selectedModels,
      });
      const names = started.models.map((id) => availableModels.find((m) => m.id === id)?.displayName ?? id);

      setItems((prev) => prev.map((item) => item.id === itemId
        ? {
            ...item,
            status: "processing" as const,
            reason: undefined,
            jobId: started.jobId,
            discernResult: undefined,
            consensus: undefined,
            divergenceFlag: undefined,
            divergentItems: undefined,
            panelIncomplete: undefined,
            modelsTotal: started.models.length,
            updatedAt: new Date().toISOString(),
          }
        : item
      ));

      // A batch already on screen keeps its progress bar. This item is polled on its own.
      if (!backgroundJobId || backgroundJobStatus !== "processing") {
        setBackgroundJobId(started.jobId);
        setBackgroundJobStatus("processing");
        setBackgroundProgress({ completed: 0, failed: 0, total: 1 });
      } else if (manualPollRef.current == null) {
        manualPollRef.current = window.setInterval(async () => {
          const updated = await fetchAnalysisItems();
          const mine = updated.find((item) => item.id === itemId);
          if (!mine || mine.status === "processing") return;
          if (manualPollRef.current != null) window.clearInterval(manualPollRef.current);
          manualPollRef.current = null;
          setItems(updated);
          toast({
            title: mine.status === "completed" ? t("manualAnalysis.successTitle") : t("manualAnalysis.errorTitle"),
            description: mine.reason || t("manualAnalysis.successBody"),
            variant: mine.status === "completed" ? "default" : "destructive",
          });
        }, 3000);
      }

      toast({ title: t("manualAnalysis.queuedTitle"), description: t("manualAnalysis.queuedBody", { models: names.join(", ") }) });
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

  const handleOpenArticleDialog = () => {
    if (completedItems.length === 0) {
      toast({ title: t('article.noResultsTitle'), description: t('article.noResultsDescription') });
      return;
    }
    if (!articleTopic.trim()) setArticleTopic(keyword.trim() || searchImports.find((entry) => entry.term)?.term || "");
    setIsArticleDialogOpen(true);
  };

  const handleGenerateArticle = async () => {
    const topic = articleTopic.trim();
    if (!topic) return;
    setIsArticleDialogOpen(false);
    setIsGeneratingArticle(true);
    toast({ title: t('article.generatingTitle'), description: t('article.generatingDescription') });
    try {
      // Excluded items go too: the article opens with the sample flow.
      const result = await generateArticleAction({
        items: processedItems.map(toArticleItem),
        topic,
        locale,
        search: searchImports.length > 0 ? searchImports : undefined,
      });
      if (result.articleContent) {
        const slug = topic
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        saveDocxFromContent(result.articleContent, `${slug || 'discern'}_${t('article.filenameSuffix')}`);
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
                    <Input id="csv-upload" type="file" accept=".csv,.txt,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFileImport} />
                    <p className="text-xs text-muted-foreground mt-2">{t('import.csvHint')}</p>
                    {searchImports.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-2">{t('import.sheetNote', {
                        rows: searchImports.reduce((sum, entry) => sum + entry.rows, 0),
                        unique: searchImports.reduce((sum, entry) => sum + entry.uniqueOrganic, 0),
                        leftOut: searchImports.reduce((sum, entry) => sum + entry.rows - entry.organicRows, 0),
                      })}</p>
                    )}
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
                  {availableModels.length > 1 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('controls.panelLabel')} ({selectedModels.length}/{availableModels.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {availableModels.map((m) => {
                          const checked = selectedModels.includes(m.id);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() =>
                                setSelectedModels((prev) =>
                                  checked ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                                )
                              }
                              className={cn(
                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                checked
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-slate-200 text-muted-foreground hover:bg-muted"
                              )}
                              data-testid={`model-toggle-${m.id}`}
                            >
                              {m.displayName}
                            </button>
                          );
                        })}
                      </div>
                      {selectedModels.length === 0 && (
                        <p className="text-xs text-amber-600">{t('controls.panelEmptyHint')}</p>
                      )}
                    </div>
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

            <ReliabilityCard items={processedItems} />

            <Card>
              <CardHeader>
                <CardTitle>{t('export.title')}</CardTitle>
                <CardDescription>{t('export.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full" onClick={() => exportCsv(processedItems, 'discern_analysis_results')} disabled={processedItems.length === 0}>{t('export.csv')}</Button>
                <Button variant="outline" className="w-full" onClick={() => exportJson(processedItems, 'discern_analysis_results')} disabled={processedItems.length === 0}>{t('export.json')}</Button>
                <Button variant="outline" className="w-full" onClick={() => exportDocx(processedItems, 'discern_analysis_results', fetchModelResults)} disabled={processedItems.length === 0}>
                  <FileText className="mr-2 h-4 w-4" />
                  {t('export.docx')}
                </Button>
                <Button variant="outline" className="w-full" onClick={() => exportScoreSheetCsv(processedItems, 'discern_scores_matrix')} disabled={processedItems.length === 0}>
                  {t('export.scores') || 'Planilha de Scores (Matriz)'}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => exportConsensusCsv(processedItems, 'discern_consensus_long')}
                  disabled={!processedItems.some(i => i.consensus)}
                >
                  <Users2 className="mr-2 h-4 w-4" />
                  {t('export.consensusCsv')}
                </Button>
                <Button variant="default" className="w-full" onClick={handleOpenArticleDialog} disabled={completedItems.length === 0 || isGeneratingArticle}>
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
              {selectedModels.length > 0
                ? ` ${selectedModels.map((id) => availableModels.find((m) => m.id === id)?.displayName ?? id).join(", ")}.`
                : ""}
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

      <Dialog open={isArticleDialogOpen} onOpenChange={setIsArticleDialogOpen}>
        <DialogContent className="sm:max-w-[525px]">
          <DialogHeader>
            <DialogTitle>{t('article.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('article.dialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="article-topic">{t('article.topicLabel')}</Label>
            <Input
              id="article-topic"
              placeholder={t('article.topicPlaceholder')}
              value={articleTopic}
              onChange={(e) => setArticleTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleGenerateArticle();
              }}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleGenerateArticle} disabled={!articleTopic.trim() || isGeneratingArticle}>
              <BookMarked className="mr-2 h-4 w-4" />
              {t('article.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

