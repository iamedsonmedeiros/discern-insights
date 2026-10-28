"use client";

import { useCallback } from "react";
import { Copy, FileText, Info, Award, ListChecks, Star, Bot, AlertCircle, Edit, Users, AlertTriangle } from "lucide-react";
import { ConsensusView } from "@/components/app/consensus-view";
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
import { getReportedScores, shortModelName } from "@/lib/reported-scores";
import { isCurrentInstrument } from "@/lib/discern-items";
import { useI18n } from "@/components/i18n/use-i18n";
import type { TranslationKey } from "@/components/i18n/translations";

type ResultCardProps = {
  activeItem: AnalysisItem | null;
  isLoading: boolean;
  onManualAnalysisClick: (itemId: string) => void;
};


const ScoreStar = ({ score }: { score: number | null }) => {
    const { t } = useI18n();
    if (score == null) return <span className="text-sm text-muted-foreground">{t('results.notRated')}</span>;
    return (
    <div className="flex">
        {[1,2,3,4,5].map(s => (
            <Star key={s} className={cn("h-5 w-5", s <= score ? "text-yellow-400 fill-yellow-400" : "text-gray-300")} />
        ))}
    </div>
    );
};


export function ResultCard({ activeItem, isLoading, onManualAnalysisClick }: ResultCardProps) {
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

  const isAnalyzableError = ["scraping_error", "analysis_error", "unavailable_offline"].includes(activeItem.status);

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
          {isAnalyzableError && (
             <Button onClick={() => onManualAnalysisClick(activeItem.id)} className="mt-4 w-full">
                <Edit className="mr-2 h-4 w-4" />
                {t('manualAnalysis.button')}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const { discernResult, meta } = activeItem;
  if (!discernResult) return null;

  const { scores, justifications } = discernResult;
  const reported = getReportedScores(activeItem)!;
  const { domainAverages } = reported;
  const narrativeNote = reported.narrativeModel
    ? t('results.narrativeBy', { model: shortModelName(reported.narrativeModel) })
    : t('results.narrativePrimary');

  const hasConsensus = !!activeItem.consensus;
  const divergentSet = new Set(activeItem.divergentItems ?? []);

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
        {activeItem.divergenceFlag && (
          <Badge
            variant="outline"
            className="mt-2 w-fit gap-1 border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('consensus.headerBadge').replace('{count}', String(activeItem.divergentItems?.length ?? 0))}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {!isCurrentInstrument(discernResult) && (
          <Alert className="mb-4 border-amber-500 text-amber-800 dark:text-amber-300 [&>svg]:text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('results.legacy.title')}</AlertTitle>
            <AlertDescription>{t('results.legacy.description')}</AlertDescription>
          </Alert>
        )}
        <Tabs defaultValue={hasConsensus && activeItem.divergenceFlag ? "consensus" : "summary"}>
          <TabsList className={cn("grid w-full", hasConsensus ? "grid-cols-5" : "grid-cols-4")}>
            <TabsTrigger value="summary"><Award className="mr-2 h-4 w-4"/>{t('results.tabs.summary')}</TabsTrigger>
            <TabsTrigger value="items"><ListChecks className="mr-2 h-4 w-4"/>{t('results.tabs.items')}</TabsTrigger>
            {hasConsensus && (
              <TabsTrigger value="consensus" className="relative">
                <Users className="mr-2 h-4 w-4"/>{t('results.tabs.consensus')}
                {activeItem.divergenceFlag && (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" />
                )}
              </TabsTrigger>
            )}
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
            {hasConsensus && (
              <p className="text-xs text-muted-foreground">
                {t('results.summary.panelMean', {
                  count: reported.models.length,
                  models: reported.models.map(shortModelName).join(", "),
                })}{" "}
                {narrativeNote}
              </p>
            )}
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
             {hasConsensus && <p className="mb-2 text-xs text-muted-foreground">{narrativeNote}</p>}
             <Accordion type="single" collapsible className="w-full">
                {Object.entries(scores).sort(([a], [b]) => a.localeCompare(b)).map(([key, score]) => (
                    <AccordionItem value={key} key={key}>
                        <AccordionTrigger>
                            <div className="flex justify-between items-center w-full pr-4">
                                <span className="flex items-center gap-2 text-left">
                                    {t(discernQuestions[key]) || key}
                                    {divergentSet.has(key) && (
                                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                                    )}
                                </span>
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

          {hasConsensus && (
            <TabsContent value="consensus" className="mt-4">
              <ConsensusView item={activeItem} questions={discernQuestions} />
            </TabsContent>
          )}

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
