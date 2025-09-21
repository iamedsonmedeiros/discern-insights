"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { FileUp, Link as LinkIcon, Loader2, Play, Pause, SkipForward, FileText } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { processUrl } from "@/app/actions";
import { exportCsv, exportJson, exportDocx, parseCsv } from "@/lib/utils";
import type { AnalysisItem } from "@/lib/types";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AnalysisQueue } from "@/components/app/analysis-queue";
import { ResultCard } from "@/components/app/result-card";

export function DiscernAnalyzerPage() {
  const [items, setItems] = useState<AnalysisItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const { toast } = useToast();
  const isProcessingRef = useRef(isProcessing);
  const isAutoModeRef = useRef(isAutoMode);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
    isAutoModeRef.current = isAutoMode;
  }, [isProcessing, isAutoMode]);
  
  const activeItem = useMemo(
    () => items.find((item) => item.id === activeItemId) || null,
    [items, activeItemId]
  );

  const processSingleItem = useCallback(async (index: number) => {
    if (index >= items.length) {
      setIsProcessing(false);
      toast({ title: "Análise concluída", description: "Todos os sites da fila foram processados." });
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

    const result = await processUrl(itemToProcess.url);

    setItems((prev) =>
      prev.map((item) =>
        item.id === itemToProcess.id
          ? { ...item, ...result, updatedAt: new Date().toISOString() }
          : item
      )
    );
  }, [items, toast]);


  useEffect(() => {
    const lastItem = items[currentIndex];
    if (isProcessingRef.current && isAutoModeRef.current && lastItem && lastItem.status !== 'processing' && lastItem.status !== 'pending') {
      const nextIndex = currentIndex + 1;
      if (nextIndex < items.length) {
        processSingleItem(nextIndex);
      } else {
        setIsProcessing(false);
        toast({ title: "Análise concluída", description: "Todos os sites da fila foram processados." });
      }
    }
  }, [items, currentIndex, processSingleItem, toast]);

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
        title: "Limite excedido",
        description: "É possível importar no máximo 200 URLs por vez.",
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
    toast({ title: `${newItems.length} URLs importadas`, description: "A fila de análise foi atualizada." });
  };
  
  const handleStartProcessing = () => {
    if (items.length === 0) {
      toast({ title: "Fila vazia", description: "Importe URLs para iniciar a análise."});
      return;
    }
    setIsProcessing(true);
    processSingleItem(currentIndex);
  };

  const handleNext = () => {
    if (currentIndex + 1 < items.length) {
      processSingleItem(currentIndex + 1);
    } else {
      toast({ title: "Fim da fila", description: "Não há mais itens para processar." });
    }
  };

  const completedItems = useMemo(() => items.filter(item => item.status !== 'pending' && item.status !== 'processing' && item.discernResult), [items]);
  
  return (
    <div className="flex flex-col min-h-screen font-sans">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto flex items-center justify-between p-4">
          <div>
            <h1 className="text-2xl font-bold text-primary">DISCERN Insights</h1>
            <p className="text-muted-foreground">Analise a qualidade de informações de saúde com IA.</p>
          </div>
        </div>
      </header>

      <main className="flex-grow container mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 flex flex-col gap-8">
            <Card>
              <CardHeader>
                <CardTitle>1. Importar URLs</CardTitle>
                <CardDescription>Cole uma lista de URLs ou envie um arquivo CSV.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="paste">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="paste"><LinkIcon className="mr-2 h-4 w-4"/> Colar</TabsTrigger>
                    <TabsTrigger value="upload"><FileUp className="mr-2 h-4 w-4"/> Enviar</TabsTrigger>
                  </TabsList>
                  <TabsContent value="paste" className="mt-4">
                    <form onSubmit={handleTextareaImport}>
                      <Textarea name="urls" placeholder="https://exemplo.com/artigo1&#10;https://outroexemplo.net/info" rows={6} />
                      <Button type="submit" className="mt-4 w-full">Importar URLs</Button>
                    </form>
                  </TabsContent>
                  <TabsContent value="upload" className="mt-4">
                    <Input id="csv-upload" type="file" accept=".csv" onChange={handleFileImport} />
                    <p className="text-xs text-muted-foreground mt-2">O arquivo CSV deve conter uma coluna chamada &quot;url&quot;.</p>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card>
                <CardHeader>
                  <CardTitle>2. Controlar Análise</CardTitle>
                  <CardDescription>Inicie, pause e controle o fluxo de processamento.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="auto-mode" className="flex flex-col space-y-1">
                        <span>Modo Automático</span>
                        <span className="font-normal leading-snug text-muted-foreground">
                          Processa todos os sites em sequência.
                        </span>
                      </Label>
                      <Switch id="auto-mode" checked={isAutoMode} onCheckedChange={setIsAutoMode} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {isProcessing ? (
                        <Button variant="outline" onClick={() => setIsProcessing(false)}><Pause className="mr-2 h-4 w-4"/> Pausar</Button>
                      ) : (
                        <Button onClick={handleStartProcessing} disabled={items.length === 0}>
                          {items.some(i => i.status !== 'pending') ? <Play className="mr-2 h-4 w-4"/> : <Play className="mr-2 h-4 w-4"/>}
                          {currentIndex > 0 ? 'Continuar' : 'Iniciar'}
                        </Button>
                      )}
                      <Button onClick={handleNext} disabled={isProcessing && isAutoMode || items.length === 0 || currentIndex >= items.length - 1}>
                        <SkipForward className="mr-2 h-4 w-4"/> Próximo
                      </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                  <CardTitle>3. Exportar Resultados</CardTitle>
                  <CardDescription>Baixe os dados da análise em formato CSV, JSON ou DOCX.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <Button variant="outline" className="w-full" onClick={() => exportCsv(completedItems, 'discern_analysis_results')} disabled={completedItems.length === 0}>Exportar CSV</Button>
                    <Button variant="outline" className="w-full" onClick={() => exportJson(completedItems, 'discern_analysis_results')} disabled={completedItems.length === 0}>Exportar JSON</Button>
                    <Button variant="outline" className="w-full" onClick={() => exportDocx(completedItems, 'discern_analysis_results')} disabled={completedItems.length === 0}>
                      <FileText className="mr-2 h-4 w-4"/>
                      Exportar DOCX
                    </Button>
                </CardContent>
            </Card>

          </div>

          <div className="lg:col-span-2 flex flex-col gap-8">
            <AnalysisQueue items={items} activeItemId={activeItemId} onRowClick={setActiveItemId} />
            <ResultCard activeItem={activeItem} isLoading={isProcessing && activeItem?.status === 'processing'} />
          </div>
        </div>
      </main>
    </div>
  );
}
