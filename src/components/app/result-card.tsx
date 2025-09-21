"use client";

import { useCallback } from "react";
import { Copy, FileText, Info, Award, ListChecks, Star, Bot } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import type { AnalysisItem } from "@/lib/types";

type ResultCardProps = {
  activeItem: AnalysisItem | null;
  isLoading: boolean;
};

const discernQuestions: Record<string, string> = {
    'item01': '1. Os objetivos são claros?',
    'item02': '2. A publicação atinge seus objetivos?',
    'item03': '3. É relevante?',
    'item04': '4. Cita explicitamente as fontes de evidência?',
    'item05': '5. A data das fontes é clara?',
    'item06': '6. É equilibrada e imparcial?',
    'item07': '7. Aponta áreas de incerteza?',
    'item08': '8. Descreve como o tratamento funciona?',
    'item09': '9. Descreve os riscos do tratamento?',
    'item10': '10. Descreve os efeitos colaterais?',
    'item11': '11. Descreve o que aconteceria sem tratamento?',
    'item12': '12. Discute como o tratamento afeta a qualidade de vida?',
    'item13': '13. Deixa claro que existem outras opções?',
    'item14': '14. Oferece suporte para decisão compartilhada?',
    'item15': '15. Há mais de uma opção de tratamento?',
    'item16': '16. Avaliação geral da qualidade'
};

const ScoreStar = ({ score }: { score: number }) => (
    <div className="flex">
        {[1,2,3,4,5].map(s => (
            <Star key={s} className={cn("h-5 w-5", s <= score ? "text-yellow-400 fill-yellow-400" : "text-gray-300")} />
        ))}
    </div>
);


export function ResultCard({ activeItem, isLoading }: ResultCardProps) {
  const { toast } = useToast();

  const handleCopy = useCallback(() => {
    if (activeItem?.discernResult?.rawReportMarkdown) {
      navigator.clipboard.writeText(activeItem.discernResult.rawReportMarkdown);
      toast({ title: "Copiado!", description: "O relatório foi copiado para a área de transferência." });
    }
  }, [activeItem, toast]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Analisando...</CardTitle>
          <CardDescription className="truncate">{activeItem?.url}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-64 gap-4">
            <Bot className="h-16 w-16 text-primary animate-pulse" />
            <p className="text-muted-foreground">A inteligência artificial está analisando o conteúdo.</p>
            <Progress value={50} className="w-full animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!activeItem) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nenhum Site Selecionado</CardTitle>
          <CardDescription>Selecione um item da fila para ver os detalhes da análise.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-64">
          <Info className="h-16 w-16 text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (activeItem.status !== "completed") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Análise Não Concluída</CardTitle>
          <CardDescription className="truncate">{activeItem.url}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Status: {activeItem.status}</AlertTitle>
            <AlertDescription>{activeItem.reason || "Não foi possível completar a análise."}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const { discernResult, meta } = activeItem;
  if (!discernResult) return null;
  
  const { domainAverages, scores, justifications } = discernResult;

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
            <div>
                <CardTitle>{meta?.title || "Relatório de Análise"}</CardTitle>
                <CardDescription className="truncate">{activeItem.url}</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={handleCopy}>
                <Copy className="h-4 w-4" />
            </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="summary">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="summary"><Award className="mr-2 h-4 w-4"/>Resumo</TabsTrigger>
            <TabsTrigger value="items"><ListChecks className="mr-2 h-4 w-4"/>Itens</TabsTrigger>
            <TabsTrigger value="recommendations"><FileText className="mr-2 h-4 w-4"/>Recomendações</TabsTrigger>
            <TabsTrigger value="metadata"><Info className="mr-2 h-4 w-4"/>Metadados</TabsTrigger>
          </TabsList>
          
          <TabsContent value="summary" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <Card>
                    <CardHeader>
                        <CardTitle>{domainAverages.confiabilidade.toFixed(2)}</CardTitle>
                        <CardDescription>Confiabilidade</CardDescription>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>{domainAverages.qualidade_tratamento.toFixed(2)}</CardTitle>
                        <CardDescription>Qualidade</CardDescription>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>{domainAverages.score_geral.toFixed(2)}</CardTitle>
                        <CardDescription>Score Geral</CardDescription>
                    </CardHeader>
                </Card>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Resumo Executivo</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground prose dark:prose-invert">
                    <p>{discernResult.resumo}</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Observações</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground prose dark:prose-invert">
                   <p>{discernResult.observacoes}</p>
                </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="items" className="mt-4">
             <Accordion type="single" collapsible className="w-full">
                {Object.entries(scores).sort(([a], [b]) => a.localeCompare(b)).map(([key, score]) => (
                    <AccordionItem value={key} key={key}>
                        <AccordionTrigger>
                            <div className="flex justify-between items-center w-full pr-4">
                                <span>{discernQuestions[key] || key}</span>
                                <ScoreStar score={score} />
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="prose dark:prose-invert text-muted-foreground">
                            <p>{justifications[key]}</p>
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>
          </TabsContent>

          <TabsContent value="recommendations" className="mt-4">
            <Card>
                <CardHeader><CardTitle>Recomendações de Melhoria</CardTitle></CardHeader>
                <CardContent className="prose dark:prose-invert text-muted-foreground">
                    <p>{discernResult.recommmendacoes}</p>
                </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="metadata" className="mt-4">
            <ul className="space-y-2 text-sm">
                <li className="flex justify-between"><strong>Status HTTP:</strong> <Badge>{meta?.httpStatus}</Badge></li>
                <li className="flex justify-between"><strong>Tamanho do Conteúdo:</strong> <Badge variant="outline">{meta?.size ? `${(meta.size / 1024).toFixed(2)} KB` : 'N/A'}</Badge></li>
                <li className="flex justify-between"><strong>Análise Concluída em:</strong> <Badge variant="outline">{new Date(activeItem.updatedAt).toLocaleString()}</Badge></li>
                <li className="flex justify-between"><strong>Fonte da Análise:</strong> <Badge variant="secondary">{discernResult.fonte}</Badge></li>
            </ul>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
