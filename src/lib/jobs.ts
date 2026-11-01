// src/lib/jobs.ts
//
// Job progress bookkeeping, shared by the extract and analyze workers.
//
// Counters stay per-URL (not per URL x model): an item bumps the job exactly
// once, whether it died during extraction or was finalized by the last model
// worker. That keeps the existing realtime progress bar correct without change.

import "server-only";

import { getPanel } from "@/ai/evaluators";
import { computeConsensus, type ModelScores } from "@/lib/consensus";
import { sendCompletionEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase-admin";
import type { PerformDiscernAnalysisOutput } from "@/lib/types";

type JobCounters = {
  completed_urls: number;
  failed_urls: number;
  total_urls: number;
};

/**
 * Bumps the job's completed/failed counter for one finished item and, if this
 * was the last item, closes the job and emails the user.
 *
 * Call this exactly once per item. The callers guarantee that by only invoking
 * it from whoever won the compare-and-swap that finalized the item.
 */
export async function recordItemOutcome(
  jobId: string,
  isCompleted: boolean
): Promise<JobCounters | null> {
  const supabase = createAdminClient();

  const rpcName = isCompleted ? "increment_completed" : "increment_failed";
  const { data: counters, error } = await supabase.rpc(rpcName, { p_job_id: jobId });

  if (error || !counters?.[0]) {
    console.error("RPC counter error:", error);
    return null;
  }

  const { completed_urls, failed_urls, total_urls } = counters[0] as JobCounters;

  if (completed_urls + failed_urls < total_urls) {
    return counters[0] as JobCounters;
  }

  // Last item — close the job. The status guard means a redelivery cannot
  // re-close it (and therefore cannot send a second email).
  const { data: closed } = await supabase
    .from("analysis_jobs")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "processing")
    .select("user_email")
    .maybeSingle();

  if (closed?.user_email) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
    await sendCompletionEmail(closed.user_email, {
      totalUrls: total_urls,
      completedUrls: completed_urls,
      failedUrls: failed_urls,
      appUrl,
    }).catch((e) => console.error("Failed to send completion email:", e));
  }

  return counters[0] as JobCounters;
}

/**
 * A later row of the same address is not analyzed again. Once the first position
 * reaches a final status, every still-pending later position receives that score.
 * Each copied row counts as one finished item of its job.
 */
export async function copyScoreToLaterPositions(sourceId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: source } = await supabase.from("analysis_items").select("*").eq("id", sourceId).maybeSingle();
  if (!source || source.status === "pending" || source.status === "processing") return;

  const { data: later } = await supabase
    .from("analysis_items")
    .select("id, meta, job_id")
    .eq("user_id", source.user_id)
    .eq("url", source.url)
    .eq("status", "pending")
    .gt("index", source.index);

  for (const row of later ?? []) {
    const meta = { ...(source.meta ?? {}), ...(row.meta ?? {}), sameScoreAs: source.id };
    const { data: claimed } = await supabase
      .from("analysis_items")
      .update({
        status: source.status,
        reason: source.reason,
        discern_result: source.discern_result,
        consensus: source.consensus,
        divergence_flag: source.divergence_flag,
        divergent_items: source.divergent_items,
        panel_incomplete: source.panel_incomplete,
        models_total: source.models_total,
        content_snapshot: source.content_snapshot,
        content_hash: source.content_hash,
        extraction_method: source.extraction_method,
        model_id: source.model_id,
        meta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (claimed && row.job_id) await recordItemOutcome(row.job_id, source.status === "completed");
  }

  // A rescore of the first position has to reach the rows that already show its score.
  const { data: copies } = await supabase
    .from("analysis_items")
    .select("id, meta, status")
    .eq("user_id", source.user_id)
    .eq("url", source.url)
    .gt("index", source.index);

  for (const row of copies ?? []) {
    const meta = row.meta as { sameScoreAs?: string } | null;
    if (meta?.sameScoreAs !== source.id || row.status === "pending" || row.status === "processing") continue;
    await supabase
      .from("analysis_items")
      .update({
        status: source.status,
        reason: source.reason,
        discern_result: source.discern_result,
        consensus: source.consensus,
        divergence_flag: source.divergence_flag,
        divergent_items: source.divergent_items,
        panel_incomplete: source.panel_incomplete,
        models_total: source.models_total,
        content_snapshot: source.content_snapshot,
        content_hash: source.content_hash,
        extraction_method: source.extraction_method,
        model_id: source.model_id,
        meta: { ...(source.meta ?? {}), ...(row.meta ?? {}), sameScoreAs: source.id },
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }
}

const COUNTED_FAILURE = new Set([
  "not_eligible_pdf",
  "not_eligible_video",
  "not_eligible_social",
  "unavailable_offline",
  "scraping_error",
  "analysis_error",
]);

/** How long a missing model may stay silent before the item closes with the models that did answer. */
export const RECONCILE_DELAY_SECONDS = 240;

const MISSING_MODEL_ERROR =
  "O modelo não respondeu a tempo. A nota ficou com os modelos que concluíram.";

/**
 * Closes an item from the model rows already stored. A manual rescore of a page
 * that already counted as a failure swaps that failure for a success, so the
 * job total does not move twice.
 */
export async function finalizeReportedModels(jobId: string, itemId: string) {
  const supabase = createAdminClient();

  const { data: item } = await supabase
    .from("analysis_items")
    .select("meta, models_total")
    .eq("id", itemId)
    .maybeSingle();
  const { data: job } = await supabase.from("analysis_jobs").select("models").eq("id", jobId).maybeSingle();

  const { data: rows } = await supabase
    .from("analysis_model_results")
    .select("model_id, status, scores, result")
    .eq("item_id", itemId);

  const succeeded = (rows ?? []).filter((row) => row.status === "done" && row.scores);
  const jobModels = (job?.models as string[] | null) ?? null;
  const panelOrder = getPanel(jobModels ?? undefined).map((evaluator) => evaluator.id);
  const primary =
    succeeded
      .slice()
      .sort((a, b) => panelOrder.indexOf(a.model_id) - panelOrder.indexOf(b.model_id))
      .at(0) ?? null;

  const consensus = computeConsensus(
    succeeded.map((row): ModelScores => ({
      modelId: row.model_id,
      scores: row.scores as Record<string, number | null>,
    }))
  );

  const isCompleted = Boolean(primary);
  const modelsTotal = item?.models_total ?? jobModels?.length ?? rows?.length ?? 0;
  const priorStatus = (item?.meta as { priorStatus?: string } | null)?.priorStatus;

  const { data: claimed } = await supabase
    .from("analysis_items")
    .update({
      status: isCompleted ? "completed" : "analysis_error",
      reason: isCompleted ? null : "Every model in the panel failed to analyze this page.",
      discern_result: (primary?.result as PerformDiscernAnalysisOutput) ?? null,
      consensus: consensus ?? null,
      divergence_flag: consensus?.divergenceFlag ?? false,
      divergent_items: consensus?.divergentItems ?? null,
      panel_incomplete: succeeded.length < modelsTotal,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();

  if (!claimed) return { finalized: false as const };

  if (!priorStatus || priorStatus === "pending" || priorStatus === "processing") {
    await recordItemOutcome(jobId, isCompleted);
  } else if (COUNTED_FAILURE.has(priorStatus) && isCompleted) {
    await convertFailureToSuccess(jobId);
  } else if (priorStatus === "completed") {
    await closeJobFromItemStatuses(jobId, false);
  }
  await copyScoreToLaterPositions(itemId);

  return {
    finalized: true as const,
    isCompleted,
    modelsSucceeded: succeeded.length,
    modelsTotal,
    divergentItems: consensus?.divergentItems ?? [],
  };
}

/** A model that never wrote a row is recorded as failed, then the item closes. */
export async function reconcileStalledItem(jobId: string, itemId: string) {
  const supabase = createAdminClient();
  const { data: item } = await supabase
    .from("analysis_items")
    .select("id, status, models_total")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || item.status !== "processing") return { skipped: true as const };

  const { data: job } = await supabase.from("analysis_jobs").select("models").eq("id", jobId).maybeSingle();
  const panel = (job?.models as string[] | null) ?? [];
  const { data: rows } = await supabase.from("analysis_model_results").select("model_id").eq("item_id", itemId);
  const present = new Set((rows ?? []).map((row) => row.model_id));
  const missing = panel.filter((id) => !present.has(id));

  if ((rows?.length ?? 0) === 0) return { skipped: true as const };
  if (missing.length > 0) {
    const { error } = await supabase.from("analysis_model_results").upsert(
      missing.map((id) => ({
        item_id: itemId,
        provider: id.startsWith("googleai/") ? "google" : "openrouter",
        model_id: id,
        status: "failed",
        error: MISSING_MODEL_ERROR,
      })),
      { onConflict: "item_id,model_id" }
    );
    if (error) throw new Error(error.message);
  }

  return finalizeReportedModels(jobId, itemId);
}

/**
 * Sets the job counters from the rows that actually belong to it and closes
 * the job when none are still open. Used when a counted row was moved off the
 * job and the increment total can no longer reach total_urls.
 */
export async function closeJobFromItemStatuses(jobId: string, notify = true): Promise<boolean> {
  const supabase = createAdminClient();
  const { data: items } = await supabase.from("analysis_items").select("status").eq("job_id", jobId);
  if (!items?.length) return false;
  if (items.some((item) => item.status === "pending" || item.status === "processing")) return false;

  const completed = items.filter((item) => item.status === "completed").length;
  const failed = items.length - completed;
  const { data: closed } = await supabase
    .from("analysis_jobs")
    .update({
      status: "done",
      completed_urls: completed,
      failed_urls: failed,
      total_urls: items.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "processing")
    .select("user_email")
    .maybeSingle();

  if (notify && closed?.user_email) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
    await sendCompletionEmail(closed.user_email, {
      totalUrls: items.length,
      completedUrls: completed,
      failedUrls: failed,
      appUrl,
    }).catch((e) => console.error("Failed to send completion email:", e));
  }
  return Boolean(closed);
}

async function convertFailureToSuccess(jobId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: job } = await supabase
    .from("analysis_jobs")
    .select("completed_urls, failed_urls, total_urls, status")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return;

  const failed = Math.max(0, (job.failed_urls ?? 0) - 1);
  const completed = (job.completed_urls ?? 0) + 1;
  await supabase
    .from("analysis_jobs")
    .update({
      completed_urls: completed,
      failed_urls: failed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (job.status !== "processing") return;
  if (completed + failed >= (job.total_urls ?? 0)) {
    const { data: closed } = await supabase
      .from("analysis_jobs")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("status", "processing")
      .select("user_email")
      .maybeSingle();
    if (closed?.user_email) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
      await sendCompletionEmail(closed.user_email, {
        totalUrls: job.total_urls,
        completedUrls: completed,
        failedUrls: failed,
        appUrl,
      }).catch((e) => console.error("Failed to send completion email:", e));
    }
  }
}
