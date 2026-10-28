"use client";

import { useState } from "react";
import { DiscernAnalyzerPage } from "@/components/pages/discern-analyzer-page";
import { StatsDashboard } from "@/components/app/stats-dashboard";
import { HistoryDashboard } from "@/components/app/history-dashboard";
import { EligibilityFooter } from "@/components/app/eligibility-footer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutDashboard, Microscope, Clock } from "lucide-react";

interface DashboardClientProps {
  isAdmin: boolean;
}

export function DashboardClient({ isAdmin }: DashboardClientProps) {
  const [activeTab, setActiveTab] = useState("analyzer");
  const [historyJobId, setHistoryJobId] = useState<string | undefined>(undefined);

  const handleViewJob = (jobId: string) => {
    setHistoryJobId(jobId);
    setActiveTab("analyzer");
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
          <div className="container mx-auto px-4 py-2 flex items-center justify-between">
            <TabsList className="bg-slate-100 p-1 rounded-xl">
              <TabsTrigger value="analyzer" className="rounded-lg px-6 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <Microscope className="mr-2 h-4 w-4" /> Analisador
              </TabsTrigger>
              <TabsTrigger value="history" className="rounded-lg px-6 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <Clock className="mr-2 h-4 w-4" /> Histórico
              </TabsTrigger>
              <TabsTrigger value="stats" className="rounded-lg px-6 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <LayoutDashboard className="mr-2 h-4 w-4" /> Estatísticas
              </TabsTrigger>
            </TabsList>
            {isAdmin && (
              <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-bold border border-blue-100">
                ACESSO ADMIN
              </div>
            )}
          </div>
        </div>

        <TabsContent value="analyzer" className="mt-0">
          <DiscernAnalyzerPage initialJobId={historyJobId} onClearJobId={() => setHistoryJobId(undefined)} />
        </TabsContent>
        <TabsContent value="history" className="mt-0">
          <HistoryDashboard onViewJob={handleViewJob} />
        </TabsContent>
        <TabsContent value="stats" className="mt-0 p-8 container mx-auto">
          <StatsDashboard isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
      <EligibilityFooter />
    </div>
  );
}
