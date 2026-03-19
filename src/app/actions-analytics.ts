"use server";

import { createClient } from "@/lib/supabase-server";

export type StatsData = {
    total_analyses: number;
    average_score: number;
    completed_count: number;
    error_count: number;
    total_cost: number;
    model_info: { id: string; name: string };
    top_domains: { domain: string; count: number; avg_score: number }[];
    daily_trend: { date: string; count: number; avg_score: number }[];
};

export async function fetchStats(
    isGlobal: boolean = false, 
    filters?: { startDate?: string; endDate?: string; userId?: string }
): Promise<StatsData | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return null;

    // Check if user is admin if global stats are requested
    if (isGlobal) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (profile?.role !== 'admin') {
            throw new Error("Unauthorized: Global stats are only available for admins.");
        }
    }

    let query = supabase.from('analysis_items').select('*');
    
    // Apply Filters
    if (filters?.userId) {
        query = query.eq('user_id', filters.userId);
    } else if (!isGlobal) {
        query = query.eq('user_id', user.id);
    }

    if (filters?.startDate) {
        query = query.gte('updated_at', filters.startDate);
    }
    if (filters?.endDate) {
        query = query.lte('updated_at', filters.endDate);
    }

    const { data, error } = await query;

    if (error || !data) {
        console.error('Error fetching stats:', error);
        return null;
    }

    const completedItems = data.filter(item => item.status === 'completed' && item.discern_result);
    const errorItems = data.filter(item => ['analysis_error', 'scraping_error', 'unavailable_offline'].includes(item.status));

    // Calculate Average Score and Total Cost
    const totalScore = completedItems.reduce((acc, item) => acc + (item.discern_result.domainAverages.score_geral || 0), 0);
    const averageScore = completedItems.length > 0 ? totalScore / completedItems.length : 0;
    const totalCost = data.reduce((acc, item) => acc + (item.total_cost || 0), 0);

    // Process Top Domains
    const domainMap: Record<string, { count: number; totalScore: number }> = {};
    completedItems.forEach(item => {
        try {
            const url = new URL(item.url);
            const domain = url.hostname.replace('www.', '');
            if (!domainMap[domain]) domainMap[domain] = { count: 0, totalScore: 0 };
            domainMap[domain].count++;
            domainMap[domain].totalScore += (item.discern_result.domainAverages.score_geral || 0);
        } catch (e) { /* ignore invalid urls */ }
    });

    const topDomains = Object.entries(domainMap)
        .map(([domain, data]) => ({
            domain,
            count: data.count,
            avg_score: data.totalScore / data.count
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    // Process Daily Trend (Last 7 days)
    const today = new Date();
    const trendMap: Record<string, { count: number; totalScore: number }> = {};

    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        trendMap[dateStr] = { count: 0, totalScore: 0 };
    }

    completedItems.forEach(item => {
        const dateStr = new Date(item.updated_at).toISOString().split('T')[0];
        if (trendMap[dateStr]) {
            trendMap[dateStr].count++;
            trendMap[dateStr].totalScore += (item.discern_result.domainAverages.score_geral || 0);
        }
    });

    const dailyTrend = Object.entries(trendMap).map(([date, data]) => ({
        date,
        count: data.count,
        avg_score: data.count > 0 ? data.totalScore / data.count : 0
    }));

    return {
        total_analyses: data.length,
        average_score: averageScore,
        completed_count: completedItems.length,
        error_count: errorItems.length,
        total_cost: totalCost,
        model_info: { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        top_domains: topDomains,
        daily_trend: dailyTrend
    };
}

export async function fetchUsers() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // Verify admin
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
    
    if (profile?.role !== 'admin') return [];

    const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .order('full_name');

    if (error) {
        console.error('Error fetching users:', error);
        return [];
    }
    return data;
}

export async function getUserRole() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 'user';

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    return profile?.role || 'user';
}
