"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2, AlertCircle, XCircle, Clock, Loader } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getReportedScores } from "@/lib/reported-scores";
import type { AnalysisItem, AnalysisStatus } from "@/lib/types";
import { useI18n } from "@/components/i18n/use-i18n";
import type { TranslationKey } from "../i18n/translations";


const statusConfig: Record<
  AnalysisStatus,
  { textKey: TranslationKey; icon: React.ReactNode; badgeVariant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { textKey: "status.pending", icon: <Clock className="h-4 w-4 text-muted-foreground" />, badgeVariant: "outline" },
  processing: { textKey: "status.processing", icon: <Loader className="h-4 w-4 animate-spin text-blue-500" />, badgeVariant: "default" },
  completed: { textKey: "status.completed", icon: <CheckCircle2 className="h-4 w-4 text-green-500" />, badgeVariant: "secondary" },
  not_eligible_pdf: { textKey: "status.not_eligible_pdf", icon: <XCircle className="h-4 w-4 text-yellow-500" />, badgeVariant: "outline" },
  not_eligible_video: { textKey: "status.not_eligible_video", icon: <XCircle className="h-4 w-4 text-yellow-500" />, badgeVariant: "outline" },
  not_eligible_social: { textKey: "status.not_eligible_social", icon: <XCircle className="h-4 w-4 text-yellow-500" />, badgeVariant: "outline" },
  unavailable_offline: { textKey: "status.unavailable_offline", icon: <AlertCircle className="h-4 w-4 text-red-500" />, badgeVariant: "destructive" },
  scraping_error: { textKey: "status.scraping_error", icon: <AlertCircle className="h-4 w-4 text-red-500" />, badgeVariant: "destructive" },
  analysis_error: { textKey: "status.analysis_error", icon: <AlertCircle className="h-4 w-4 text-red-500" />, badgeVariant: "destructive" },
};

const ScoreBadge = ({ item, t }: { item: AnalysisItem; t: ReturnType<typeof useI18n>["t"] }) => {
  const reported = getReportedScores(item);
  if (!reported) return <span className="text-muted-foreground">-</span>;

  const score = reported.domainAverages.score_geral;
  let colorClass = "bg-gray-400";
  if (score >= 4) colorClass = "bg-green-500";
  else if (score >= 2.5) colorClass = "bg-yellow-500";
  else if (score > 0) colorClass = "bg-red-500";

  const label =
    reported.source === "consensus"
      ? t("queue.score.consensus", { count: reported.models.length })
      : t("queue.score.single");

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help">
            <Badge className={cn("text-white", colorClass)}>{score.toFixed(1)}</Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/** Excluded or failed items explain themselves on hover; the reason comes from the extraction stage. */
const StatusBadge = ({ item, label }: { item: AnalysisItem; label: string }) => {
  const config = statusConfig[item.status];
  const badge = (
    <Badge variant={config.badgeVariant} className="flex items-center gap-2 w-fit">
      {config.icon}
      <span>{label}</span>
    </Badge>
  );

  if (item.status === "completed" || !item.reason) return badge;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help">{badge}</span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs whitespace-normal">
          {item.reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

interface AnalysisQueueProps {
  items: AnalysisItem[];
  activeItemId: string | null;
  onRowClick: (id: string) => void;
}

export function AnalysisQueue({ items, activeItemId, onRowClick }: AnalysisQueueProps) {
  const { t } = useI18n();
  const activeRowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (activeItemId && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeItemId]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{t('queue.title')}</CardTitle>
        <CardDescription>
          {items.length > 0 ? t('queue.description.showing', { count: items.length }) : t('queue.description.empty')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] border rounded-md p-2 bg-slate-50/30">
          <Table data-testid="analysis-queue-table">
            <TableHeader className="sticky top-0 bg-background z-20">
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>{t('queue.table.url')}</TableHead>
                <TableHead>{t('queue.table.status')}</TableHead>
                <TableHead className="text-right">{t('queue.table.score')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length > 0 ? (
                items.map((item: AnalysisItem) => (
                  <TableRow
                    key={item.id}
                    ref={item.id === activeItemId ? activeRowRef : undefined}
                    onClick={() => onRowClick(item.id)}
                    className={cn("cursor-pointer", item.id === activeItemId && "bg-accent")}
                  >
                    <TableCell>{item.index}</TableCell>
                    <TableCell className="max-w-[250px] truncate">{item.url}</TableCell>
                    <TableCell>
                      <StatusBadge item={item} label={t(statusConfig[item.status].textKey)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ScoreBadge item={item} t={t} />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    {t('queue.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
