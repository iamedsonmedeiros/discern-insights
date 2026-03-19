"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, Cell, PieChart, Pie
} from "recharts";
import { fetchStats, fetchUsers, type StatsData } from "@/app/actions-analytics";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, ShieldCheck, AlertTriangle, Activity, Calendar as CalendarIcon, User, Cpu, DollarSign } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface StatsDashboardProps {
    isAdmin: boolean;
}

export function StatsDashboard({ isAdmin }: StatsDashboardProps) {
    const [data, setData] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<"user" | "global">(isAdmin ? "global" : "user");
    
    // Filters
    const [dateRange, setDateRange] = useState<string>("all");
    const [customStartDate, setCustomStartDate] = useState<Date | undefined>(undefined);
    const [customEndDate, setCustomEndDate] = useState<Date | undefined>(undefined);
    const [selectedUserId, setSelectedUserId] = useState<string>("all");
    const [users, setUsers] = useState<{ id: string, email: string, full_name?: string }[]>([]);

    useEffect(() => {
        if (isAdmin && view === "global") {
            fetchUsers().then(setUsers);
        }
    }, [isAdmin, view]);

    useEffect(() => {
        async function loadStats() {
            setLoading(true);
            
            let startDate: string | undefined;
            let endDate: string | undefined;

            if (dateRange === "7d") {
                startDate = subDays(new Date(), 7).toISOString();
            } else if (dateRange === "15d") {
                startDate = subDays(new Date(), 15).toISOString();
            } else if (dateRange === "30d") {
                startDate = subDays(new Date(), 30).toISOString();
            } else if (dateRange === "month") {
                startDate = startOfMonth(new Date()).toISOString();
                endDate = endOfMonth(new Date()).toISOString();
            } else if (dateRange === "custom") {
                startDate = customStartDate?.toISOString();
                endDate = customEndDate?.toISOString();
            }

            const stats = await fetchStats(view === "global", {
                startDate,
                endDate,
                userId: selectedUserId === "all" ? undefined : selectedUserId
            });
            setData(stats);
            setLoading(false);
        }
        loadStats();
    }, [view, dateRange, customStartDate, customEndDate, selectedUserId]);

    if (!data && !loading) return <div>Sem dados disponíveis.</div>;

    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard Analítico</h2>
                    <p className="text-slate-500">Insights sobre a qualidade das informações de saúde.</p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                    {isAdmin && (
                        <Tabs value={view} onValueChange={(v) => {
                            setView(v as "user" | "global");
                            setSelectedUserId("all");
                        }} className="w-[240px]">
                            <TabsList className="grid w-full grid-cols-2 rounded-xl bg-slate-100 p-1">
                                <TabsTrigger value="user" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Pessoal</TabsTrigger>
                                <TabsTrigger value="global" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Global (Admin)</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    )}
                </div>
            </div>

            {/* Filter Bar */}
            <Card className="border-none shadow-sm bg-white/40 backdrop-blur p-4">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                        <CalendarIcon className="h-4 w-4 text-slate-500" />
                        <Select value={dateRange} onValueChange={setDateRange}>
                            <SelectTrigger className="w-[180px] bg-white">
                                <SelectValue placeholder="Período" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todo o período</SelectItem>
                                <SelectItem value="month">Este mês</SelectItem>
                                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                                <SelectItem value="15d">Últimos 15 dias</SelectItem>
                                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                                <SelectItem value="custom">Personalizado...</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {dateRange === 'custom' && (
                        <div className="flex items-center gap-2 animate-in slide-in-from-left-2 duration-300">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal bg-white", !customStartDate && "text-muted-foreground")}>
                                        {customStartDate ? format(customStartDate, "dd/MM/yyyy") : <span>Início</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar mode="single" selected={customStartDate} onSelect={setCustomStartDate} initialFocus locale={ptBR} />
                                </PopoverContent>
                            </Popover>
                            <span className="text-slate-400">até</span>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal bg-white", !customEndDate && "text-muted-foreground")}>
                                        {customEndDate ? format(customEndDate, "dd/MM/yyyy") : <span>Fim</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar mode="single" selected={customEndDate} onSelect={setCustomEndDate} initialFocus locale={ptBR} />
                                </PopoverContent>
                            </Popover>
                        </div>
                    )}

                    {view === "global" && (
                        <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-slate-500" />
                            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                                <SelectTrigger className="w-[220px] bg-white">
                                    <SelectValue placeholder="Filtrar por usuário" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos os usuários</SelectItem>
                                    {users.map(u => (
                                        <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {loading && <Loader2 className="h-4 w-4 animate-spin text-blue-500 ml-auto" />}
                </div>
            </Card>

            <div className={cn("space-y-8", loading && "opacity-50 pointer-events-none transition-opacity")}>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <Card className="border-none shadow-sm bg-white/50 backdrop-blur">
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                            <CardTitle className="text-sm font-medium text-slate-600">Média DISCERN</CardTitle>
                            <ShieldCheck className="h-4 w-4 text-blue-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-slate-900">{data?.average_score.toFixed(1)} / 5.0</div>
                            <p className="text-xs text-slate-500 mt-1">Nível de confiabilidade geral</p>
                        </CardContent>
                    </Card>
                    <Card className="border-none shadow-sm bg-white/50 backdrop-blur">
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                            <CardTitle className="text-sm font-medium text-slate-600">Total Análises</CardTitle>
                            <Activity className="h-4 w-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-slate-900">{data?.total_analyses}</div>
                            <p className="text-xs text-slate-500 mt-1">{data?.completed_count} concluídas com sucesso</p>
                        </CardContent>
                    </Card>
                    <Card className="border-none shadow-sm bg-white/50 backdrop-blur">
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                            <CardTitle className="text-sm font-medium text-slate-600">Custos (USD)</CardTitle>
                            <DollarSign className="h-4 w-4 text-amber-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-slate-900">${data?.total_cost.toFixed(4)}</div>
                            <p className="text-xs text-slate-500 mt-1">Token usage total no período</p>
                        </CardContent>
                    </Card>
                    <Card className="border-none shadow-sm bg-white/50 backdrop-blur">
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                            <CardTitle className="text-sm font-medium text-slate-600">Sites Fidedignos</CardTitle>
                            <TrendingUp className="h-4 w-4 text-blue-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-slate-900">{data?.top_domains.filter(d => d.avg_score >= 4).length}</div>
                            <p className="text-xs text-slate-500 mt-1">Domínios com nota &gt; 4.0</p>
                        </CardContent>
                    </Card>
                </div>

                <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-7">
                    <Card className="lg:col-span-4 border-none shadow-sm bg-white/50 backdrop-blur">
                        <CardHeader>
                            <CardTitle className="text-lg font-semibold tracking-tight">Tendência de Qualidade</CardTitle>
                            <CardDescription>Média de pontuação DISCERN no período selecionado.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[350px] pl-2">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={data?.daily_trend}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis
                                        dataKey="date"
                                        stroke="#94a3b8"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(str) => new Date(str).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                    />
                                    <YAxis
                                        stroke="#94a3b8"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                        domain={[0, 5]}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'white', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                        itemStyle={{ color: '#0f172a', fontWeight: 'bold' }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="avg_score"
                                        stroke="#3b82f6"
                                        strokeWidth={3}
                                        dot={{ r: 4, fill: '#3b82f6' }}
                                        activeDot={{ r: 6, strokeWidth: 0 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card className="lg:col-span-3 border-none shadow-sm bg-white/50 backdrop-blur">
                        <CardHeader>
                            <CardTitle className="text-lg font-semibold tracking-tight">Top Domínios Analisados</CardTitle>
                            <CardDescription>Volume de artigos por site.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[350px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data?.top_domains} layout="vertical">
                                    <XAxis type="number" hide />
                                    <YAxis
                                        dataKey="domain"
                                        type="category"
                                        stroke="#64748b"
                                        fontSize={11}
                                        tickLine={false}
                                        axisLine={false}
                                        width={100}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#f1f5f9' }}
                                        contentStyle={{ backgroundColor: 'white', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                                        {data?.top_domains.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <Card className="border-none shadow-sm bg-white/50 backdrop-blur">
                        <CardHeader className="flex flex-row items-center gap-2">
                            <Cpu className="h-5 w-5 text-blue-500" />
                            <CardTitle className="text-lg font-semibold tracking-tight">Modelo LLM Atual</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-4">
                                <div className="bg-blue-100 p-3 rounded-xl text-blue-700">
                                    <Cpu className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="text-xl font-bold text-slate-900">{data?.model_info.name}</div>
                                    <p className="text-sm text-slate-500">Versão: {data?.model_info.id}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-none shadow-sm bg-white/50 backdrop-blur">
                        <CardHeader className="flex flex-row items-center gap-2">
                            <DollarSign className="h-5 w-5 text-emerald-500" />
                            <CardTitle className="text-lg font-semibold tracking-tight">Projeção de Custos</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-4">
                                <div className="bg-emerald-100 p-3 rounded-xl text-emerald-700">
                                    <TrendingUp className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="text-xl font-bold text-slate-900">
                                        {(data && data.total_analyses > 0) 
                                            ? `$${(data.total_cost / data.total_analyses).toFixed(4)} / análise`
                                            : '--'}
                                    </div>
                                    <p className="text-sm text-slate-500">Custo médio por URL processada</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
