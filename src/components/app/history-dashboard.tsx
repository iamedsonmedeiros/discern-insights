"use client";

import { useEffect, useState } from "react";
import { fetchAnalysisJobs, deleteAnalysisJob } from "@/app/actions";
import type { AnalysisJob } from "@/lib/types";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, Eye, Server, Layers, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { jobCode } from "@/lib/job-code";

interface HistoryDashboardProps {
  onViewJob: (jobId: string) => void;
}

export function HistoryDashboard({ onViewJob }: HistoryDashboardProps) {
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const loadJobs = async () => {
      setIsLoading(true);
      const data = await fetchAnalysisJobs();
      setJobs(data);
      setIsLoading(false);
    };
    loadJobs();
  }, []);

  const handleDelete = async (jobId: string) => {
    if (!confirm("Tem certeza que deseja apagar este histórico? Os dados serão perdidos.")) return;
    
    setIsDeleting(jobId);
    try {
      await deleteAnalysisJob(jobId);
      setJobs(prev => prev.filter(job => job.id !== jobId));
      toast({ title: "Histórico removido com sucesso." });
    } catch (e) {
      toast({ title: "Erro ao apagar histórico", variant: "destructive" });
    } finally {
      setIsDeleting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col h-64 items-center justify-center text-center space-y-3 bg-white rounded-lg border border-slate-200">
        <div className="bg-slate-100 p-3 rounded-full">
          <Layers className="h-6 w-6 text-slate-400" />
        </div>
        <div>
          <p className="text-lg font-medium text-slate-900">Nenhum histórico encontrado</p>
          <p className="text-sm text-slate-500">As sessões gravadas em segundo plano aparecerão aqui.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 font-sans max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Histórico de Processamentos</h2>
          <p className="text-sm text-muted-foreground">Analise as extrações e relatórios executados no servidor.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {jobs.map((job) => {
          const totalProcessed = job.completed_urls + job.failed_urls;
          const progressPercent = job.total_urls > 0 ? Math.round((totalProcessed / job.total_urls) * 100) : 0;
          const statusColors: any = {
            done: "text-green-600 bg-green-50",
            processing: "text-blue-600 bg-blue-50 animate-pulse",
            failed: "text-red-600 bg-red-50",
            pending: "text-amber-600 bg-amber-50"
          };
          const statusLabels: any = {
            done: "Concluído",
            processing: "Processando",
            failed: "Falhou",
            pending: "Pendente"
          };
          
          return (
            <Card key={job.id} className="hover:shadow-md transition-all">
              <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-start justify-between space-y-0">
                <div className="space-y-1">
                  <CardTitle className="text-base line-clamp-1">
                    {job.keyword || "Sem Nome"}
                  </CardTitle>
                  <button
                    type="button"
                    className="font-mono text-xs text-slate-500 hover:text-slate-800"
                    onClick={() => {
                      void navigator.clipboard.writeText(jobCode(job.id));
                      toast({ title: "Código copiado." });
                    }}
                  >
                    {jobCode(job.id)}
                  </button>
                  <CardDescription className="text-xs flex items-center">
                    <Calendar className="mr-1 h-3 w-3" />
                    {format(new Date(job.created_at), "dd 'de' MMM, yyyy HH:mm", { locale: ptBR })}
                  </CardDescription>
                </div>
                <div className={`px-2 py-1 text-[10px] font-bold rounded-md uppercase tracking-wider ${statusColors[job.status] || "text-slate-600 bg-slate-100"}`}>
                  {statusLabels[job.status] || job.status}
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="space-y-1">
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Progresso</span>
                    <span className="font-medium">{totalProcessed} de {job.total_urls} URLs</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button 
                    variant="default" 
                    className="w-full h-8 text-xs" 
                    onClick={() => onViewJob(job.id)}
                  >
                    <Eye className="mr-2 h-3 w-3" /> Exibir Resultados
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className="h-8 w-8 shrink-0 text-red-500 hover:text-red-600 border-red-200 hover:border-red-300 hover:bg-red-50"
                    onClick={() => handleDelete(job.id)}
                    disabled={isDeleting === job.id}
                  >
                    {isDeleting === job.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
