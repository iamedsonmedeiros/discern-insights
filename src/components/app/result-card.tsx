"use client";

import { useCallback } from "react";
import { Copy, FileText, Info, Award, ListChecks, Star, Bot, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import type { AnalysisItem } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/use-i18n";
import type { TranslationKey } from "@/components/i18n/translations";

type ResultCardProps = {
  activeItem: AnalysisItem | null;
  isLoading: boolean;
};


const ScoreStar = ({ score }: { score: number }) => (
    <div className="flex">
        {[1,2,3,4,5].map(s => (
            <Star key={s} className={cn("h-5 w-5", s <= score ? "text-yellow-400 fill-yellow-400" : "text-gray-300")} />
        ))}
    </div>
);


export function ResultCard({ activeItem, isLoading }: ResultCardProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const handleCopy = useCallback(() => {
    if (activeItem?.discernResult?.rawReportMarkdown) {
      navigator.clipboard.writeText(activeItem.discernResult.rawReportMarkdown);
      toast({ title: t('results.copiedTitle'), description: t('results.copiedBody') });
    }
  }, [activeItem, toast, t]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('results.analyzingTitle')}</CardTitle>
          <CardDescription className="truncate">{activeItem?.url}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-64 gap-4">
            <Bot className="h-16 w-16 text-primary animate-pulse" />
            <p className="text-muted-foreground">{t('results.analyzingBody')}</p>
            <Progress value={50} className="w-full animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!activeItem) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('results.noSiteSelectedTitle')}</CardTitle>
          <CardDescription>{t('results.noSiteSelectedBody')}</CardDescription>
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
          <CardTitle>{t('results.analysisNotCompleteTitle')}</CardTitle>
          <CardDescription className="truncate">{activeItem.url}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t('status.title')}: {t(`status.${activeItem.status}` as TranslationKey)}</AlertTitle>
            <AlertDescription>{activeItem.reason || t('results.analysisErrorReason')}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const { discernResult, meta } = activeItem;
  if (!discernResult) return null;
  
  const { domainAverages, scores, justifications } = discernResult;

  const discernQuestions: Record<string, TranslationKey> = {
    'item01': 'discern.q1', 'item02': 'discern.q2', 'item03': 'discern.q3',
    'item04': 'discern.q4', 'item05': 'discern.q5', 'item06': 'discern.q6',
    'item07': 'discern.q7', 'item08': 'discern.q8', 'item09': 'discern.q9',
    'item10': 'discern.q10', 'item11': 'discern.q11', 'item12': 'discern.q12',
    'item13': 'discern.q13', 'item14': 'discern.q14', 'item15': 'discern.q15',
    'item16': 'discern.q16'
  };
  

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
            <div>
                <CardTitle>{meta?.title || t('results.reportTitle')}</CardTitle>
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
            <TabsTrigger value="summary"><Award className="mr-2 h-4 w-4"/>{t('results.tabs.summary')}</TabsTrigger>
            <TabsTrigger value="items"><ListChecks className="mr-2 h-4 w-4"/>{t('results.tabs.items')}</TabsTrigger>
            <TabsTrigger value="recommendations"><FileText className="mr-2 h-4 w-4"/>{t('results.tabs.recommendations')}</TabsTrigger>
            <TabsTrigger value="metadata"><Info className="mr-2 h-4 w-4"/>{t('results.tabs.metadata')}</TabsTrigger>
          </TabsList>
          
          <TabsContent value="summary" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <Card>
                    <CardHeader>
                        <CardTitle>{domainAverages.confiabilidade.toFixed(2)}</CardTitle>
                        <CardDescription>{t('results.summary.reliability')}</CardDescription>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>{domainAverages.qualidade_tratamento.toFixed(2)}</CardTitle>
                        <CardDescription>{t('results.summary.quality')}</CardDescription>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>{domainAverages.score_geral.toFixed(2)}</CardTitle>
                        <CardDescription>{t('results.summary.overallScore')}</CardDescription>
                    </CardHeader>
                </Card>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>{t('results.summary.executiveSummary')}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground prose dark:prose-invert">
                    <p>{discernResult.resumo}</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>{t('results.summary.observations')}</CardTitle>
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
                                <span>{t(discernQuestions[key]) || key}</span>
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
                <CardHeader><CardTitle>{t('results.recommendations.title')}</CardTitle></CardHeader>
                <CardContent className="prose dark:prose-invert text-muted-foreground">
                    <p>{discernResult.recommmendacoes}</p>
                </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="metadata" className="mt-4">
            <ul className="space-y-2 text-sm">
                <li className="flex justify-between"><strong>{t('results.metadata.httpStatus')}:</strong> <Badge>{meta?.httpStatus}</Badge></li>
                <li className="flex justify-between"><strong>{t('results.metadata.contentSize')}:</strong> <Badge variant="outline">{meta?.size ? `${(meta.size / 1024).toFixed(2)} KB` : 'N/A'}</Badge></li>
                <li className="flex justify-between"><strong>{t('results.metadata.analysisDate')}:</strong> <Badge variant="outline">{new Date(activeItem.updatedAt).toLocaleString()}</Badge></li>
                <li className="flex justify-between"><strong>{t('results.metadata.analysisSource')}:</strong> <Badge variant="secondary">{discernResult.fonte}</Badge></li>
            </ul>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
