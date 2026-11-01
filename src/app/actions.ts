"use server";

import { createScientificArticle } from "@/ai/flows/create-scientific-article";
import type { ArticleItem } from "@/lib/article-data";
import type { DiscernLocale } from "@/lib/discern-items";
import { parseSearchRows, type SearchImport } from "@/lib/search-import";
import type { AnalysisItem, AnalysisStatus, AnalysisJob } from "@/lib/types";
import { createClient } from "@/lib/supabase-server";
import { extractContent, runPanel, prepareTextForAnalysis, computeContentHash } from "@/lib/content";
import { persistModelResults } from "@/lib/model-results";
import { computeConsensus } from "@/lib/consensus";
import { getPanel, getAvailableModels, estimateCost, GEMINI_EVALUATOR_ID } from "@/ai/evaluators";
import { createAdminClient } from "@/lib/supabase-admin";
import { publish } from "@/lib/queue";
// Reverted pdf-parse

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
      jobId: item.job_id,
      consensus: item.consensus,
      divergenceFlag: item.divergence_flag,
      divergentItems: item.divergent_items,
      panelIncomplete: item.panel_incomplete,
      modelsTotal: item.models_total,
    }));
  } catch (e) {
    console.error("fetchAnalysisItems failed:", e);
    return [];
  }
}

/** The models the user may pick for a job's panel (config- and key-gated). */
export async function fetchAvailableModels(): Promise<{ id: string; displayName: string }[]> {
  return getAvailableModels();
}

export type ModelResultRow = {
  modelId: string;
  provider: string;
  status: "done" | "failed";
  scores: Record<string, number> | null;
  justifications: Record<string, string> | null;
  cost: number;
  latencyMs: number | null;
  error: string | null;
};

/**
 * Per-model verdicts for one item — the raw material behind the consensus, so
 * the UI can show each model's score and justification side by side. Loaded on
 * demand (not with every item) because the justifications are bulky.
 *
 * RLS on analysis_model_results already scopes rows to items the user owns; the
 * explicit ownership check here is defense in depth.
 */
export async function fetchModelResults(itemId: string): Promise<ModelResultRow[]> {
  try {
    const { supabase, user } = await getAuthenticatedUser();

    const { data: item } = await supabase
      .from("analysis_items")
      .select("id")
      .eq("id", itemId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!item) return [];

    const { data, error } = await supabase
      .from("analysis_model_results")
      .select("model_id, provider, status, scores, justifications, cost, latency_ms, error")
      .eq("item_id", itemId);

    if (error) {
      console.error("Error fetching model results:", error);
      return [];
    }

    return (data || []).map((row) => ({
      modelId: row.model_id,
      provider: row.provider,
      status: row.status as "done" | "failed",
      scores: row.scores as Record<string, number> | null,
      justifications: row.justifications as Record<string, string> | null,
      cost: Number(row.cost) || 0,
      latencyMs: row.latency_ms,
      error: row.error,
    }));
  } catch (e) {
    console.error("fetchModelResults failed:", e);
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
  if (item.contentSnapshot !== undefined) dataToUpsert.content_snapshot = item.contentSnapshot;
  if (item.contentHash !== undefined) dataToUpsert.content_hash = item.contentHash;
  if (item.extractionMethod !== undefined) dataToUpsert.extraction_method = item.extractionMethod;
  if (item.consensus !== undefined) dataToUpsert.consensus = item.consensus;
  if (item.divergenceFlag !== undefined) dataToUpsert.divergence_flag = item.divergenceFlag;
  if (item.divergentItems !== undefined) dataToUpsert.divergent_items = item.divergentItems;
  if (item.panelIncomplete !== undefined) dataToUpsert.panel_incomplete = item.panelIncomplete;
  if (item.modelsTotal !== undefined) dataToUpsert.models_total = item.modelsTotal;

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
    .eq('user_id', user.id)
    .is('job_id', null); // SOMENTE itens que não pertencem a um job (histórico)

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

export type ProcessUrlResult = Pick<
  AnalysisItem,
  | "status"
  | "reason"
  | "meta"
  | "discernResult"
  | "modelId"
  | "inputTokens"
  | "outputTokens"
  | "totalCost"
  | "contentSnapshot"
  | "contentHash"
  | "extractionMethod"
  | "consensus"
  | "divergenceFlag"
  | "divergentItems"
  | "panelIncomplete"
  | "modelsTotal"
>;

/**
 * Orchestrates the two-stage pipeline: extract an immutable content snapshot,
 * then have the whole model panel evaluate it blind.
 *
 * With `DISCERN_MODELS` unset the panel is a single model, so this behaves
 * exactly like the original single-model pipeline. The primary (first) model's
 * verdict is what lands on the item; every model's verdict is also recorded in
 * `analysis_model_results` for the consensus step (Phase 2).
 */
export async function processUrl(
  url: string,
  language: string = 'pt-BR',
  skipAuth: boolean = false,
  itemId?: string,
  modelIds?: string[]
): Promise<ProcessUrlResult> {
  // Ensure user is authenticated before processing, unless skipped (for workers)
  if (!skipAuth) {
    await getAuthenticatedUser();
  }

  // --- Stage 1: extraction (snapshot) ---
  const extraction = await extractContent(url);

  if (!extraction.ok) {
    return {
      status: extraction.status,
      reason: extraction.reason,
      meta: extraction.meta,
    };
  }

  const snapshot = {
    contentSnapshot: extraction.text,
    contentHash: extraction.hash,
    extractionMethod: extraction.extractionMethod,
  };

  // --- Stage 2: the panel evaluates the snapshot ---
  const allowed = getAvailableModels().map((model) => model.id);
  const requested = (modelIds ?? []).filter((id) => allowed.includes(id));
  const { runs, prepInputTokens, prepOutputTokens } = await runPanel({
    text: extraction.text,
    hash: extraction.hash,
    language,
    evaluators: getPanel(requested),
  });

  if (itemId) {
    await persistModelResults(itemId, runs);
  }

  const primary = runs[0];

  if (primary.status !== "done" || !primary.discernResult) {
    return {
      status: "analysis_error",
      reason: primary.error ?? "Unknown error during analysis.",
      meta: extraction.meta,
      ...snapshot,
    };
  }

  // Item-level totals cover the whole panel: with one model configured this is
  // identical to before, and with several it reports what was actually spent.
  const inputTokens =
    prepInputTokens + runs.reduce((sum, run) => sum + run.inputTokens, 0);
  const outputTokens =
    prepOutputTokens + runs.reduce((sum, run) => sum + run.outputTokens, 0);
  const totalCost =
    estimateCost(GEMINI_EVALUATOR_ID, {
      inputTokens: prepInputTokens,
      outputTokens: prepOutputTokens,
    }) + runs.reduce((sum, run) => sum + run.cost, 0);

  const succeeded = runs.filter((run) => run.status === "done" && run.discernResult);
  const consensus = computeConsensus(
    succeeded.map((run) => ({
      modelId: run.evaluatorId,
      scores: run.discernResult!.scores as unknown as Record<string, number | null>,
    }))
  );

  return {
    status: "completed",
    meta: extraction.meta,
    discernResult: primary.discernResult,
    modelId: primary.evaluatorId,
    inputTokens,
    outputTokens,
    totalCost,
    consensus: consensus ?? undefined,
    divergenceFlag: consensus?.divergenceFlag ?? false,
    divergentItems: consensus?.divergentItems,
    panelIncomplete: succeeded.length < runs.length,
    modelsTotal: runs.length,
    ...snapshot,
  };
}

/**
 * Scores pasted text with the same models the user enabled for the automatic
 * panel. The text is frozen as the snapshot and each model runs in its own
 * worker, exactly like a URL that was extracted. Returns once the workers are
 * queued; the item moves to `processing` and finishes via the usual job path.
 */
export async function startManualAnalysis(params: {
  itemId: string;
  text: string;
  language?: string;
  modelIds?: string[];
}): Promise<{ jobId: string; models: string[] }> {
  const { supabase, user } = await getAuthenticatedUser();

  const text = params.text.trim();
  if (!text) throw new Error("Cole o texto do artigo antes de analisar.");

  const { data: owned, error: ownedError } = await supabase
    .from("analysis_items")
    .select("id")
    .eq("id", params.itemId)
    .eq("user_id", user.id)
    .single();

  if (ownedError || !owned) throw new Error("Item não encontrado.");

  const allowed = getAvailableModels().map((model) => model.id);
  const requested = (params.modelIds ?? []).filter((id) => allowed.includes(id));
  const panel = getPanel(requested.length > 0 ? requested : allowed);
  if (panel.length === 0) throw new Error("Nenhum modelo disponível para a análise.");

  const language = params.language || "pt-BR";
  const prepared = await prepareTextForAnalysis(text, language);
  const modelIds = panel.map((evaluator) => evaluator.id);

  const { data: job, error: jobError } = await supabase
    .from("analysis_jobs")
    .insert({
      user_id: user.id,
      user_email: user.email,
      total_urls: 1,
      completed_urls: 0,
      failed_urls: 0,
      status: "processing",
      language,
      keyword: "Análise manual",
      models: modelIds,
    })
    .select()
    .single();

  if (jobError || !job) throw new Error("Não foi possível iniciar a análise manual.");

  const admin = createAdminClient();
  const { error: clearError } = await admin
    .from("analysis_model_results")
    .delete()
    .eq("item_id", params.itemId);
  if (clearError) throw new Error("Não foi possível limpar a avaliação anterior deste item.");

  const { error: updateError } = await supabase
    .from("analysis_items")
    .update({
      status: "processing",
      reason: null,
      job_id: job.id,
      content_snapshot: prepared.text,
      content_hash: computeContentHash(prepared.text),
      models_total: panel.length,
      discern_result: null,
      consensus: null,
      divergence_flag: false,
      divergent_items: null,
      panel_incomplete: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.itemId)
    .eq("user_id", user.id);

  if (updateError) throw new Error(updateError.message);

  await publish(
    panel.map((evaluator) => ({
      path: "/api/worker/analyze",
      body: { jobId: job.id, itemId: params.itemId, modelId: evaluator.id },
    }))
  );

  return { jobId: job.id, models: modelIds };
}


/** Reads the Chrome collector workbook and returns the organic addresses plus the counts. */
export async function parseSearchWorkbook(fileBase64: string): Promise<(SearchImport & { urls: string[] }) | null> {
  await getAuthenticatedUser();
  const XLSX = await import("xlsx");
  const book = XLSX.read(Buffer.from(fileBase64, "base64"), { type: "buffer" });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return null;
  const rows = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) as unknown[][])
    .map((row) => (Array.isArray(row) ? row : []).map((cell) => (cell == null ? "" : String(cell))));
  return parseSearchRows(rows);
}

export async function generateArticleAction({
  items,
  topic,
  locale,
  search,
}: {
  items: ArticleItem[];
  topic: string;
  locale: DiscernLocale;
  search?: SearchImport[];
}) {
  // Ensure user is authenticated
  await getAuthenticatedUser();

  try {
    const result = await createScientificArticle({ items, topic, locale, search });
    return result;
  } catch (error) {
    console.error("Article generation failed:", error);
    throw new Error("The AI failed to generate the article.");
  }
}
