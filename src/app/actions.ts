"use server";

import { createScientificArticle } from "@/ai/flows/create-scientific-article";
import type { ArticleItem } from "@/lib/article-data";
import type { DiscernLocale } from "@/lib/discern-items";
import { parseSearchRows, type SearchHit, type SearchImport } from "@/lib/search-import";
import type { AnalysisItem, AnalysisStatus, AnalysisJob } from "@/lib/types";
import { createClient } from "@/lib/supabase-server";
import { extractContent, runPanel, prepareTextForAnalysis, computeContentHash, pageSourceToText } from "@/lib/content";
import { persistModelResults } from "@/lib/model-results";
import { computeConsensus } from "@/lib/consensus";
import { getPanel, getAvailableModels, estimateCost, GEMINI_EVALUATOR_ID } from "@/ai/evaluators";
import { createAdminClient } from "@/lib/supabase-admin";
import { RECONCILE_DELAY_SECONDS } from "@/lib/jobs";
import { MIN_TEXT_LENGTH } from "@/lib/eligibility";
import { publish } from "@/lib/queue";
import { pageKey } from "@/lib/url-key";
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
      modelId: item.model_id,
    }));
  } catch (e) {
    console.error("fetchAnalysisItems failed:", e);
    return [];
  }
}

export type JobProgress = {
  id: string;
  status: string;
  completed: number;
  failed: number;
  total: number;
  keyword?: string;
  models?: string[];
  createdAt?: string;
};

function toJobProgress(row: {
  id: string;
  status: string;
  completed_urls: number | null;
  failed_urls: number | null;
  total_urls: number | null;
  keyword?: string | null;
  models?: string[] | null;
  created_at?: string | null;
}): JobProgress {
  return {
    id: row.id,
    status: row.status,
    completed: row.completed_urls ?? 0,
    failed: row.failed_urls ?? 0,
    total: row.total_urls ?? 0,
    keyword: row.keyword ?? undefined,
    models: row.models ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}

/** Latest job still running for the signed-in user. The browser client has no session, so this read goes through the server. */
export async function fetchActiveJob(): Promise<JobProgress | null> {
  try {
    const { supabase, user } = await getAuthenticatedUser();
    const { data, error } = await supabase
      .from("analysis_jobs")
      .select("id, status, completed_urls, failed_urls, total_urls, keyword, models, created_at")
      .eq("user_id", user.id)
      .eq("status", "processing")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return toJobProgress(data);
  } catch (e) {
    console.error("fetchActiveJob failed:", e);
    return null;
  }
}

/** Counters for one job. Used by the progress bar, which cannot read analysis_jobs from the browser. */
export async function fetchJobProgress(jobId: string): Promise<JobProgress | null> {
  try {
    const { supabase, user } = await getAuthenticatedUser();
    const { data, error } = await supabase
      .from("analysis_jobs")
      .select("id, status, completed_urls, failed_urls, total_urls, keyword, models, created_at")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) return null;
    return toJobProgress(data);
  } catch (e) {
    console.error("fetchJobProgress failed:", e);
    return null;
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

export async function saveImportedUrls(items: { id: string, url: string, index: number, meta?: AnalysisItem["meta"] }[]) {
  const { supabase, user } = await getAuthenticatedUser();

  const itemsToInsert = items.map(item => ({
    id: item.id,
    url: item.url,
    index: item.index,
    status: 'pending',
    user_id: user.id,
    updated_at: new Date().toISOString(),
    ...(item.meta ? { meta: item.meta } : {}),
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
 * Scores text the user supplied for one queue row, with the same panel as an
 * extracted URL. The row stays on its job. A page that already counted (a
 * scrape failure, for example) is not counted a second time.
 */
export async function startManualAnalysis(params: {
  itemId: string;
  source: "text" | "html" | "pdf";
  text?: string;
  language?: string;
  modelIds?: string[];
}): Promise<{ jobId: string; models: string[] } | { error: string }> {
  try {
    return await queueManualAnalysis(params);
  } catch (error) {
    console.error("Manual analysis failed:", error);
    const message = error instanceof Error ? error.message : "Não foi possível iniciar a análise manual.";
    return { error: message };
  }
}

async function queueManualAnalysis(params: {
  itemId: string;
  source: "text" | "html" | "pdf";
  text?: string;
  language?: string;
  modelIds?: string[];
}): Promise<{ jobId: string; models: string[] }> {
  const { supabase, user } = await getAuthenticatedUser();

  const { data: owned, error: ownedError } = await supabase
    .from("analysis_items")
    .select("id, job_id, status, meta")
    .eq("id", params.itemId)
    .eq("user_id", user.id)
    .single();

  if (ownedError || !owned) throw new Error("Item não encontrado.");

  let text = "";
  if (params.source === "pdf") {
    text = params.text?.trim() ?? "";
    if (!text) throw new Error("Anexe um PDF antes de analisar.");
    if (text.length < MIN_TEXT_LENGTH) {
      throw new Error(`O PDF tem texto insuficiente (${text.length} caracteres). Salve a página como PDF com o texto selecionável, não como imagem.`);
    }
  } else if (params.source === "html") {
    const raw = params.text?.trim() ?? "";
    if (!raw) throw new Error("Cole o código-fonte da página antes de analisar.");
    text = pageSourceToText(raw);
    if (text.length < MIN_TEXT_LENGTH) {
      throw new Error(`Depois de tirar o código, sobraram ${text.length} caracteres. Cole o código-fonte completo da página.`);
    }
  } else {
    text = params.text?.trim() ?? "";
    if (!text) throw new Error("Cole o texto do artigo antes de analisar.");
    if (text.length < MIN_TEXT_LENGTH) {
      throw new Error(`O texto tem ${text.length} caracteres. Cole o artigo completo.`);
    }
  }

  const allowed = getAvailableModels().map((model) => model.id);
  const requested = (params.modelIds ?? []).filter((id) => allowed.includes(id));
  const panel = getPanel(requested.length > 0 ? requested : allowed);
  if (panel.length === 0) throw new Error("Nenhum modelo disponível para a análise.");

  const language = params.language || "pt-BR";
  const prepared = await prepareTextForAnalysis(text, language);
  const modelIds = panel.map((evaluator) => evaluator.id);

  let jobId = owned.job_id as string | null;
  if (!jobId) {
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
    jobId = job.id;
  }

  const admin = createAdminClient();
  const { error: clearError } = await admin
    .from("analysis_model_results")
    .delete()
    .eq("item_id", params.itemId);
  if (clearError) throw new Error("Não foi possível limpar a avaliação anterior deste item.");

  const priorStatus = owned.status as string;
  const meta = {
    ...((owned.meta as Record<string, unknown> | null) ?? {}),
    priorStatus,
    manualSource: params.source,
  };

  const { error: updateError } = await supabase
    .from("analysis_items")
    .update({
      status: "processing",
      reason: null,
      job_id: jobId,
      content_snapshot: prepared.text,
      content_hash: computeContentHash(prepared.text),
      models_total: panel.length,
      discern_result: null,
      consensus: null,
      divergence_flag: false,
      divergent_items: null,
      panel_incomplete: false,
      meta,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.itemId)
    .eq("user_id", user.id);

  if (updateError) throw new Error(updateError.message);
  if (!jobId) throw new Error("Não foi possível iniciar a análise manual.");

  await publish([
    ...panel.map((evaluator) => ({
      path: "/api/worker/analyze",
      body: { jobId, itemId: params.itemId, modelId: evaluator.id },
    })),
    {
      path: "/api/worker/reconcile",
      body: { jobId, itemId: params.itemId },
      delaySeconds: RECONCILE_DELAY_SECONDS,
    },
  ]);

  return { jobId, models: modelIds };
}


/**
 * Adds models to a finished batch. Pages that already have text are scored by the
 * new models only; the scores already stored stay. Consensus appears when a page
 * has two models.
 */
export async function expandJobPanel(
  jobId: string,
  modelIds: string[]
): Promise<{ queued: number; models: string[] } | { error: string }> {
  try {
    const { supabase, user } = await getAuthenticatedUser();
    const allowed = new Set(getAvailableModels().map((model) => model.id));
    const requested = modelIds.filter((id) => allowed.has(id));
    if (requested.length === 0) return { error: "Escolha ao menos um modelo." };

    const { data: job } = await supabase
      .from("analysis_jobs")
      .select("id, models, status")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!job) return { error: "Histórico não encontrado." };
    if (job.status === "processing") return { error: "Este histórico ainda está em processamento." };

    const current = (job.models as string[] | null) ?? [];
    const panel = Array.from(new Set([...current, ...requested]));
    const added = panel.filter((id) => !current.includes(id));
    if (added.length === 0) return { error: "Estes modelos já fazem parte desta análise." };

    const admin = createAdminClient();
    const { data: items, error: itemsError } = await admin
      .from("analysis_items")
      .select("id, url, index, status, content_snapshot, meta")
      .eq("job_id", jobId)
      .eq("user_id", user.id);
    if (itemsError) return { error: itemsError.message };

    const firstByUrl = new Map<string, NonNullable<typeof items>[number]>();
    for (const item of [...(items ?? [])].sort((a, b) => a.index - b.index)) {
      const meta = item.meta as { sameScoreAs?: string } | null;
      if (item.status !== "completed" || !item.content_snapshot || meta?.sameScoreAs) continue;
      const key = pageKey(item.url);
      if (!firstByUrl.has(key)) firstByUrl.set(key, item);
    }
    const targets = [...firstByUrl.values()];

    const present = new Map<string, Set<string>>();
    const targetIds = targets.map((item) => item.id);
    for (let i = 0; i < targetIds.length; i += 80) {
      const { data: rows, error } = await admin
        .from("analysis_model_results")
        .select("item_id, model_id")
        .in("item_id", targetIds.slice(i, i + 80));
      if (error) return { error: error.message };
      for (const row of rows ?? []) {
        const set = present.get(row.item_id) ?? new Set<string>();
        set.add(row.model_id);
        present.set(row.item_id, set);
      }
    }

    const messages: { path: string; body: Record<string, unknown>; delaySeconds?: number }[] = [];
    let queued = 0;
    for (const item of targets) {
      const missing = panel.filter((id) => !present.get(item.id)?.has(id));
      if (missing.length === 0) continue;
      const meta = { ...((item.meta as Record<string, unknown> | null) ?? {}), priorStatus: item.status };
      const { data: claimed, error } = await admin
        .from("analysis_items")
        .update({
          status: "processing",
          models_total: panel.length,
          meta,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id)
        .eq("status", "completed")
        .select("id")
        .maybeSingle();
      if (error || !claimed) continue;
      queued += 1;
      for (const modelId of missing) {
        messages.push({ path: "/api/worker/analyze", body: { jobId, itemId: item.id, modelId } });
      }
      messages.push({
        path: "/api/worker/reconcile",
        body: { jobId, itemId: item.id },
        delaySeconds: RECONCILE_DELAY_SECONDS,
      });
    }

    const { error: jobError } = await admin
      .from("analysis_jobs")
      .update({
        models: panel,
        status: queued > 0 ? "processing" : job.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (jobError) return { error: jobError.message };

    for (let i = 0; i < messages.length; i += 80) {
      await publish(messages.slice(i, i + 80));
    }

    return { queued, models: panel };
  } catch (error) {
    console.error("expandJobPanel failed:", error);
    const message = error instanceof Error ? error.message : "Não foi possível incluir os modelos.";
    return { error: message };
  }
}

/** Reads the Chrome collector workbook and returns the organic addresses plus the counts. */
export async function parseSearchWorkbook(fileBase64: string): Promise<(SearchImport & { hits: SearchHit[]; urls: string[] }) | null> {
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
