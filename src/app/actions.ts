"use server";

import { performDiscernAnalysis } from "@/ai/flows/perform-discern-analysis";
import { summarizeLongContent } from "@/ai/flows/summarize-long-content";
import { createScientificArticle } from "@/ai/flows/create-scientific-article";
import type { AnalysisItem, AnalysisStatus, PerformDiscernAnalysisOutput, AnalysisJob } from "@/lib/types";
import { createClient } from "@/lib/supabase-server";
import { redis, normalizeUrlForCache, isRedisConfigured } from "@/lib/redis";
// Reverted pdf-parse
const MODEL_ID = 'googleai/gemini-2.5-flash';
const COST_PER_1M_INPUT = 0.075;
const COST_PER_1M_OUTPUT = 0.30;

// --- Helper to get authenticated user ---
async function getAuthenticatedUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error("Unauthorized: Please log in to perform this action.");
  }
  return { supabase, user };
}

// --- Database Operations ---

export async function fetchAnalysisItems(options?: { jobId?: string, onlyUnassigned?: boolean }): Promise<AnalysisItem[]> {
  try {
    const { supabase, user } = await getAuthenticatedUser();

    let query = supabase
      .from('analysis_items')
      .select('*')
      .eq('user_id', user.id)
      .order('index', { ascending: true });

    if (options?.jobId) {
      query = query.eq('job_id', options.jobId);
    } else if (options?.onlyUnassigned) {
      query = query.is('job_id', null);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching items from Supabase:', error);
      return [];
    }

    return (data || []).map(item => ({
      id: item.id,
      url: item.url,
      index: item.index,
      status: item.status as AnalysisStatus,
      reason: item.reason,
      meta: item.meta,
      discernResult: item.discern_result,
      updatedAt: item.updated_at,
      jobId: item.job_id
    }));
  } catch (e) {
    console.error("fetchAnalysisItems failed:", e);
    return [];
  }
}

export async function fetchAnalysisJobs(): Promise<AnalysisJob[]> {
  try {
    const { supabase, user } = await getAuthenticatedUser();

    const { data, error } = await supabase
      .from('analysis_jobs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching jobs:', error);
      return [];
    }

    return data as AnalysisJob[];
  } catch (e) {
    console.error("fetchAnalysisJobs failed:", e);
    return [];
  }
}

export async function deleteAnalysisJob(jobId: string) {
  const { supabase, user } = await getAuthenticatedUser();
  
  // Items with job_id cascade or need deleting? The items will still exist.
  // We can just delete the items first or let it cascade. 
  await supabase.from('analysis_items').delete().eq('job_id', jobId).eq('user_id', user.id);
  
  const { error } = await supabase
    .from('analysis_jobs')
    .delete()
    .eq('id', jobId)
    .eq('user_id', user.id);

  if (error) {
    console.error('Error deleting job:', error);
    throw error;
  }
}

export async function upsertAnalysisItem(item: Partial<AnalysisItem>) {
  const { supabase, user } = await getAuthenticatedUser();

  const dataToUpsert: any = {
    id: item.id,
    user_id: user.id,
    model_id: item.modelId,
    input_tokens: item.inputTokens,
    output_tokens: item.outputTokens,
    total_cost: item.totalCost,
    updated_at: new Date().toISOString()
  };

  // Only include defined fields to avoid setting required columns to null
  if (item.url !== undefined) dataToUpsert.url = item.url;
  if (item.index !== undefined) dataToUpsert.index = item.index;
  if (item.status !== undefined) dataToUpsert.status = item.status;
  if (item.reason !== undefined) dataToUpsert.reason = item.reason;
  if (item.meta !== undefined) dataToUpsert.meta = item.meta;
  if (item.discernResult !== undefined) dataToUpsert.discern_result = item.discernResult;

  const { data, error } = await supabase
    .from('analysis_items')
    .upsert(dataToUpsert)
    .select();

  if (error) {
    console.error('Error upserting item in Supabase:', error);
    throw error;
  }
  return data;
}

export async function clearAnalysisQueue() {
  const { supabase, user } = await getAuthenticatedUser();

  const { error } = await supabase
    .from('analysis_items')
    .delete()
    .eq('user_id', user.id); // Only delete items belonging to this user

  if (error) {
    console.error('Error clearing queue in Supabase:', error);
    throw error;
  }
}

export async function resetAnalysisQueue() {
  const { supabase, user } = await getAuthenticatedUser();

  const { error } = await supabase
    .from('analysis_items')
    .update({
      status: 'pending',
      reason: null,
      discern_result: null,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', user.id);

  if (error) {
    console.error('Error resetting queue in Supabase:', error);
    throw error;
  }
}

export async function resetProcessingStatus() {
  const { supabase, user } = await getAuthenticatedUser();

  const { error } = await supabase
    .from('analysis_items')
    .update({
      status: 'pending',
      updated_at: new Date().toISOString()
    })
    .eq('user_id', user.id)
    .eq('status', 'processing');

  if (error) {
    console.error('Error resetting processing status in Supabase:', error);
    throw error;
  }
}

export async function saveImportedUrls(items: { id: string, url: string, index: number }[]) {
  const { supabase, user } = await getAuthenticatedUser();

  const itemsToInsert = items.map(item => ({
    id: item.id,
    url: item.url,
    index: item.index,
    status: 'pending',
    user_id: user.id,
    updated_at: new Date().toISOString()
  }));

  const { data, error } = await supabase
    .from('analysis_items')
    .insert(itemsToInsert)
    .select();

  if (error) {
    console.error('Error inserting URLs in Supabase:', error);
    throw error;
  }
  return data;
}

// --- Content Processing & Analysis ---

function htmlToText(html: string): string {
  // If content looks like Jina AI Markdown (starts with title or URL)
  // We can do some minor cleaning but mostly Markdown is good for the AI.
  if (html.includes('Markdown Content:') || html.startsWith('# ') || html.includes('---')) {
    // Just remove some Jina specific headers if they exist
    return html.replace(/^(Title: .*?\n|URL Source: .*?\n|Markdown Content:.*?\n)/gm, "").trim();
  }

  // Remove script, style, and head elements
  let cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  cleanHtml = cleanHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  cleanHtml = cleanHtml.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");

  // Convert block-level elements to newlines
  cleanHtml = cleanHtml.replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n");

  // Remove all remaining HTML tags
  cleanHtml = cleanHtml.replace(/<[^>]+>/g, " ");

  // Replace multiple newlines/spaces with a single one
  cleanHtml = cleanHtml.replace(/(\s*\n\s*)+/g, "\n");
  cleanHtml = cleanHtml.replace(/[ \t]+/g, " ");

  // Decode HTML entities
  cleanHtml = cleanHtml.replace(/&nbsp;/g, " ");
  cleanHtml = cleanHtml.replace(/&amp;/g, "&");
  cleanHtml = cleanHtml.replace(/&lt;/g, "<");
  cleanHtml = cleanHtml.replace(/&gt;/g, ">");
  cleanHtml = cleanHtml.replace(/&quot;/g, '"');
  cleanHtml = cleanHtml.replace(/&#39;/g, "'");

  return cleanHtml.trim();
}

export async function processUrl(
  url: string,
  language: string = 'pt-BR',
  skipAuth: boolean = false
): Promise<Pick<AnalysisItem, "status" | "reason" | "meta" | "discernResult">> {
  // Ensure user is authenticated before processing, unless skipped (for workers)
  if (!skipAuth) {
    await getAuthenticatedUser();
  }

  let status: AnalysisStatus = "processing";
  let reason: string | undefined;
  let meta: AnalysisItem["meta"] = {};
  let discernResult: AnalysisItem["discernResult"] | undefined;
  const MIN_TEXT_LENGTH_FOR_VIDEO_PAGES = 1500;

  // --- 1. Cache Check ---
  const normalizedUrl = normalizeUrlForCache(url);
  const cacheKey = `analysis:${normalizedUrl}`;

  if (isRedisConfigured()) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log(`Cache hit for ${url}`);
        // If it's cached, it must be the full result or a special state
        return cached as any; 
      }
    } catch (e) {
      console.warn("Redis read failed, continuing without cache:", e);
    }
  }

  // Immediately check for direct YouTube/Vimeo/Instagram/TikTok URLs
  if (/youtube\.com|youtu\.be|vimeo\.com|instagram\.com\/reel\/|tiktok\.com/.test(url)) {
    return {
      status: "not_eligible_video",
      reason: "DISCERN does not analyze videos",
      meta,
    };
  }

  // Immediately check for direct PDF URLs by extension
  if (url.toLowerCase().endsWith('.pdf')) {
    return {
      status: "not_eligible_pdf",
      reason: "O DISCERN não analisa PDFs. Esta URL aponta diretamente para um arquivo PDF.",
      meta,
    };
  }


  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // Try Jina AI first for robust extraction (JS-heavy sites, clean markdown)
    let html = "";
    try {
      const jinaUrl = `https://r.jina.ai/${url}`;
      const jinaResponse = await fetch(jinaUrl, {
        headers: { "X-Return-Format": "markdown" },
        signal: AbortSignal.timeout(15000),
      });

      if (jinaResponse.ok) {
        html = await jinaResponse.text();
        console.log(`Successfully scraped using Jina AI: ${url}`);
      }
    } catch (jinaError) {
      console.warn(`Jina AI scraping failed for ${url}, falling back to native fetch.`, jinaError);
    }

    // Fallback to native fetch if Jina fails or returned empty
    if (!html) {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "max-age=0",
          "DNT": "1",
          "Upgrade-Insecure-Requests": "1"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });

      meta.httpStatus = response.status;

      if (!response.ok) {
        return {
          status: "unavailable_offline",
          reason: `HTTP Error: ${response.status} ${response.statusText}`,
          meta,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/pdf")) {
        return {
          status: "not_eligible_pdf",
          reason: "O DISCERN não analisa PDFs. Esta URL aponta diretamente para um arquivo PDF.",
          meta,
        };
      } else {
        html = await response.text();

      }
    }

    // Check for security verification pages (e.g. Cloudflare, generic protection) - AFTER all scraping attempts
    const isSecurityPage = /verify you are human|estabelecendo uma conexão segura|verifique se você é humano|bot verification|security check|request id/i.test(html);
    if (isSecurityPage && html.length < 10000) {
      return {
        status: "scraping_error",
        reason: "A página retornou uma verificação de segurança (Bot Protection). Faça a análise manual dessa página.",
        meta,
      };
    }
    meta.size = html.length;

    if (!meta.title) {
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      meta.title = titleMatch ? titleMatch[1] : "No title";
    }

    let textContent = htmlToText(html);

    const hasVideoEmbed = html.includes('<video') || /youtube\.com\/embed|vimeo\.com\/player/.test(html);
    if (hasVideoEmbed && textContent.length < MIN_TEXT_LENGTH_FOR_VIDEO_PAGES) {
      return {
        status: "not_eligible_video",
        reason: "Content is primarily video with insufficient text.",
        meta,
      };
    }

    if (!textContent) {
      return {
        status: "scraping_error",
        reason: "Could not extract text content from the page.",
        meta,
      };
    }

    if (textContent.length > 30000) {
      try {
        const summaryResult = await summarizeLongContent({ text: textContent, language });
        textContent = summaryResult.summary;
        totalInputTokens += summaryResult.usage?.inputTokens || 0;
        totalOutputTokens += summaryResult.usage?.outputTokens || 0;
      } catch (e) {
        console.error("Summarization failed:", e);
        // Continue with truncated content if summarization fails
        textContent = textContent.substring(0, 30000);
      }
    }

    try {
      discernResult = await performDiscernAnalysis({ text: textContent, language });
      totalInputTokens += discernResult.usage?.inputTokens || 0;
      totalOutputTokens += discernResult.usage?.outputTokens || 0;
      status = "completed";
    } catch (e) {
      console.error("DISCERN analysis failed:", e);
      status = "analysis_error";
      reason =
        e instanceof Error ? e.message : "Unknown error during analysis.";
    }
  } catch (error) {
    status = "scraping_error";
    if (error instanceof Error) {
      if (error.name === "TimeoutError" || error.name === 'AbortError') {
        reason = "The request timed out after 25 seconds.";
      } else {
        reason = `Extraction failed: ${error.message}`;
      }
    } else {
      reason = "An unknown extraction error occurred.";
    }
  }

  const inputCost = (totalInputTokens / 1000000) * COST_PER_1M_INPUT;
  const outputCost = (totalOutputTokens / 1000000) * COST_PER_1M_OUTPUT;
  const totalCost = inputCost + outputCost;

  const finalResult = { 
    status, 
    reason, 
    meta, 
    discernResult,
    modelId: MODEL_ID,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalCost: totalCost
  };

  // --- 4. Cache Save ---
  if (status === "completed" && isRedisConfigured()) {
    try {
      // Cache the result for 7 days (604800 seconds)
      await redis.set(cacheKey, finalResult, { ex: 604800 });
      console.log(`Saved result to cache for ${url}`);
    } catch (e) {
      console.warn("Redis write failed:", e);
    }
  }

  return finalResult;
}

export async function analyzeTextDirectly(
  text: string,
  language: string = 'pt-BR'
): Promise<PerformDiscernAnalysisOutput> {
  // Ensure user is authenticated
  await getAuthenticatedUser();

  let textContent = text;
  if (textContent.length > 30000) {
    try {
      const summaryResult = await summarizeLongContent({ text: textContent, language });
      textContent = summaryResult.summary;
    } catch (e) {
      console.error("Summarization failed during manual analysis:", e);
      textContent = textContent.substring(0, 30000);
    }
  }

  try {
    const discernResult = await performDiscernAnalysis({ text: textContent, language });
    return discernResult;
  } catch (e) {
    console.error("DISCERN analysis failed during manual analysis:", e);
    const message = e instanceof Error ? e.message : "Unknown error during analysis.";
    throw new Error(message);
  }
}


export async function generateArticleAction({ items }: { items: AnalysisItem[] }) {
  // Ensure user is authenticated
  await getAuthenticatedUser();

  try {
    const result = await createScientificArticle({ items });
    return result;
  } catch (error) {
    console.error("Article generation failed:", error);
    throw new Error("The AI failed to generate the article.");
  }
}
