"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { FileUp, Link as LinkIcon, Loader2, Play, Pause, SkipForward, FileText, BookMarked, Bell, Square, Edit } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { processUrl, generateArticleAction, analyzeTextDirectly } from "@/app/actions";
import { exportCsv, exportJson, exportDocx, parseCsv, saveDocxFromContent } from "@/lib/utils";
import type { AnalysisItem, PerformDiscernAnalysisOutput } from "@/lib/types";

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

export function DiscernAnalyzerPage() {
  const { t, setLocale, locale } = useI18n();
  const [items, setItems] = useState<AnalysisItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [isGeneratingArticle, setIsGeneratingArticle] = useState(false);
  const [isManualAnalysisOpen, setIsManualAnalysisOpen] = useState(false);
  const [manualAnalysisTargetId, setManualAnalysisTargetId] = useState<string|null>(null);
  const [manualAnalysisText, setManualAnalysisText] = useState("");
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [notificationPermission, setNotificationPermission] = useState("default");
  const { toast } = useToast();
  const isProcessingRef = useRef(false);
  const isAutoModeRef = useRef(isAutoMode);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
    isAutoModeRef.current = isAutoMode;
  }, [isProcessing, isAutoMode]);
  
  useEffect(() => {
    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
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

  const processSingleItem = useCallback(async (index: number) => {
    if (index >= items.length) {
      setIsProcessing(false);
      showCompletionNotification();
      return;
    }

    setCurrentIndex(index);
    const itemToProcess = items[index];
    setActiveItemId(itemToProcess.id);

    setItems((prev) =>
      prev.map((item) =>
        item.id === itemToProcess.id
          ? { ...item, status: "processing", updatedAt: new Date().toISOString() }
          : item
      )
    );

    const result = await processUrl(itemToProcess.url, locale);

    setItems((prev) =>
      prev.map((item) =>
        item.id === itemToProcess.id
          ? { ...item, ...result, updatedAt: new Date().toISOString() }
          : item
      )
    );
  }, [items, showCompletionNotification, locale]);


  useEffect(() => {
    const lastItem = items[currentIndex];
    if (isProcessingRef.current && isAutoModeRef.current && lastItem && lastItem.status !== 'processing' && lastItem.status !== 'pending') {
      const nextIndex = currentIndex + 1;
      if (nextIndex < items.length) {
        processSingleItem(nextIndex);
      } else {
        setIsProcessing(false);
        showCompletionNotification();
      }
    }
  }, [items, currentIndex, processSingleItem, showCompletionNotification]);

  const handleTextareaImport = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const text = formData.get("urls") as string;
    const urls = text.split("\n").map(u => u.trim()).filter(Boolean);
    importUrls(urls);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const urls = parseCsv(content);
      importUrls(urls);
    };
    reader.readAsText(file);
  };

  const importUrls = (urls: string[]) => {
    const uniqueUrls = [...new Set(urls)];
    if (uniqueUrls.length > 200) {
      toast({
        title: t('importLimit.title'),
        description: t('importLimit.description'),
        variant: "destructive",
      });
      return;
    }
    
    const newItems: AnalysisItem[] = uniqueUrls.map((url, index) => ({
      id: uuidv4(),
      index: items.length + index + 1,
      url,
      status: "pending",
      updatedAt: new Date().toISOString(),
    }));

    setItems((prev) => [...prev, ...newItems]);
    toast({ title: t('importSuccess.title', { count: newItems.length }), description: t('importSuccess.description') });
  };

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) {
      toast({ title: t('notifications.notSupported'), variant: "destructive" });
      return "denied";
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") {
      toast({ title: t('notifications.activatedTitle'), description: t('notifications.activatedBody')});
    }
    return permission;
  }
  
  const handleStartProcessing = async () => {
    if (items.length === 0) {
      toast({ title: t('queue.emptyTitle'), description: t('queue.emptyDescription')});
      return;
    }

    if (notificationPermission === 'default') {
       const permission = await requestNotificationPermission();
       if(permission !== 'granted') {
           toast({ title: t('notifications.permissionNeededTitle'), description: t('notifications.permissionNeededBody'), variant: "destructive"});
       }
    }

    setIsProcessing(true);
    processSingleItem(currentIndex);
  };
  
  const handlePauseProcessing = () => {
    setIsProcessing(false);
  };

  const handleStopProcessing = () => {
    setIsProcessing(false);
    setCurrentIndex(0);
    setItems(items.map(item => ({...item, status: 'pending'})));
    setActiveItemId(null);
  };


  const handleNext = () => {
    if (currentIndex + 1 < items.length) {
      processSingleItem(currentIndex + 1);
    } else {
      toast({ title: t('queue.endTitle'), description: t('queue.endDescription') });
    }
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
      setItems(prev => prev.map(item => item.id === manualAnalysisTargetId 
        ? { ...item, status: 'completed', discernResult: result, reason: 'Manually analyzed', updatedAt: new Date().toISOString() } 
        : item
      ));
      toast({ title: t('manualAnalysis.successTitle'), description: t('manualAnalysis.successBody') });
      setIsManualAnalysisOpen(false);
      setManualAnalysisText("");
      setManualAnalysisTargetId(null);
    } catch(error) {
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
       toast({ title: t('article.errorTitle'), description: error instanceof Error ? error.message : t('article.unknownError'), variant: "destructive"});
    } finally {
       setIsGeneratingArticle(false);
    }
  };

  const getStartButtonText = () => {
      if (currentIndex > 0 && !isProcessing) return t('controls.continue');
      return t('controls.start');
  }

  return (
    <>
    <div className="flex flex-col min-h-screen font-sans">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto flex items-center justify-between p-4">
          <div>
            <h1 className="text-2xl font-bold text-primary">DISCERN Insights</h1>
            <p className="text-muted-foreground">{t('app.subtitle')}</p>
          </div>
          <div className="flex items-center gap-4">
            {notificationPermission !== 'granted' && (
              <Button variant="outline" size="sm" onClick={requestNotificationPermission}>
                  <Bell className="mr-2 h-4 w-4" />
                  {t('controls.activateNotifications')}
              </Button>
            )}
             <div className="flex items-center gap-2">
                <Button variant={locale === 'pt-BR' ? 'default' : 'outline'} size="sm" onClick={() => setLocale('pt-BR')}>PT</Button>
                <Button variant={locale === 'en' ? 'default' : 'outline'} size="sm" onClick={() => setLocale('en')}>EN</Button>
             </div>
          </div>
        </div>
      </header>

      <main className="flex-grow container mx-auto p-4">
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
                    <TabsTrigger value="paste"><LinkIcon className="mr-2 h-4 w-4"/> {t('import.paste')}</TabsTrigger>
                    <TabsTrigger value="upload"><FileUp className="mr-2 h-4 w-4"/> {t('import.upload')}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="paste" className="mt-4">
                    <form onSubmit={handleTextareaImport}>
                      <Textarea name="urls" placeholder={t('import.placeholder')} rows={6} />
                      <Button type="submit" className="mt-4 w-full">{t('import.button')}</Button>
                    </form>
                  </TabsContent>
                  <TabsContent value="upload" className="mt-4">
                    <Input id="csv-upload" type="file" accept=".csv" onChange={handleFileImport} />
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
                    <div className="flex items-center justify-between">
                      <Label htmlFor="auto-mode" className="flex flex-col space-y-1">
                        <span>{t('controls.autoMode')}</span>
                        <span className="font-normal leading-snug text-muted-foreground">
                          {t('controls.autoModeDescription')}
                        </span>
                      </Label>
                      <Switch id="auto-mode" checked={isAutoMode} onCheckedChange={setIsAutoMode} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                       <Button onClick={isProcessing ? handlePauseProcessing : handleStartProcessing} disabled={items.length === 0}>
                        {isProcessing ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                        {isProcessing ? t('controls.pause') : getStartButtonText()}
                      </Button>
                      <Button onClick={handleStopProcessing} disabled={!isProcessing && currentIndex === 0} variant="destructive">
                        <Square className="mr-2 h-4 w-4" /> {t('controls.stop')}
                      </Button>
                      <div className="col-span-2">
                        <Button onClick={handleNext} disabled={isProcessing && isAutoMode || items.length === 0 || currentIndex >= items.length - 1} className="w-full">
                          <SkipForward className="mr-2 h-4 w-4"/> {t('controls.next')}
                        </Button>
                      </div>
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
                      <FileText className="mr-2 h-4 w-4"/>
                      {t('export.docx')}
                    </Button>
                    <Button variant="default" className="w-full" onClick={handleGenerateArticle} disabled={completedItems.length === 0 || isGeneratingArticle}>
                      {isGeneratingArticle ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                      ) : (
                        <BookMarked className="mr-2 h-4 w-4"/>
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
    </div>
    
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
    </>
  );
}
