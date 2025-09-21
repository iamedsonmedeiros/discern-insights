"use client";

import { CheckCircle2, AlertCircle, XCircle, Clock, Loader } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { AnalysisItem, AnalysisStatus } from "@/lib/types";

type AnalysisQueueProps = {
  items: AnalysisItem[];
  activeItemId: string | null;
  onRowClick: (id: string) => void;
};

const statusConfig: Record<
  AnalysisStatus,
  { text: string; icon: React.ReactNode; badgeVariant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { text: "Pendente", icon: <Clock className="h-4 w-4 text-muted-foreground" />, badgeVariant: "outline" },
  processing: { text: "Processando", icon: <Loader className="h-4 w-4 animate-spin text-blue-500" />, badgeVariant: "default" },
  completed: { text: "Concluído", icon: <CheckCircle2 className="h-4 w-4 text-green-500" />, badgeVariant: "secondary" },
  not_eligible_pdf: { text: "PDF", icon: <XCircle className="h-4 w-4 text-yellow-500" />, badgeVariant: "outline" },
  not_eligible_video: { text: "Vídeo", icon: <XCircle className="h-4 w-4 text-yellow-500" />, badgeVariant: "outline" },
  unavailable_offline: { text: "Offline", icon: <AlertCircle className="h-4 w-4 text-red-500" />, badgeVariant: "destructive" },
  scraping_error: { text: "Erro Extração", icon: <AlertCircle className="h-4 w-4 text-red-500" />, badgeVariant: "destructive" },
  analysis_error: { text: "Erro Análise", icon: <AlertCircle className="h-4 w-4 text-red-500" />, badgeVariant: "destructive" },
};

const ScoreBadge = ({ score }: { score: number | undefined }) => {
  if (score === undefined) return <span className="text-muted-foreground">-</span>;
  
  let colorClass = "bg-gray-400";
  if (score >= 4) colorClass = "bg-green-500";
  else if (score >= 2.5) colorClass = "bg-yellow-500";
  else if (score > 0) colorClass = "bg-red-500";
  
  return <Badge className={cn("text-white", colorClass)}>{score.toFixed(1)}</Badge>;
};

export function AnalysisQueue({ items, activeItemId, onRowClick }: AnalysisQueueProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Fila de Processamento</CardTitle>
        <CardDescription>
          {items.length > 0 ? `Mostrando ${items.length} site(s) na fila.` : "Importe URLs para começar."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length > 0 ? (
                items.map((item) => (
                  <TableRow
                    key={item.id}
                    onClick={() => onRowClick(item.id)}
                    className={cn("cursor-pointer", item.id === activeItemId && "bg-accent")}
                  >
                    <TableCell>{item.index}</TableCell>
                    <TableCell className="max-w-[250px] truncate">{item.url}</TableCell>
                    <TableCell>
                      <Badge variant={statusConfig[item.status].badgeVariant} className="flex items-center gap-2">
                        {statusConfig[item.status].icon}
                        <span>{statusConfig[item.status].text}</span>
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                       <ScoreBadge score={item.discernResult?.domainAverages.score_geral} />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    Nenhum site na fila.
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
