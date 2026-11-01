// src/lib/jobs.ts
//
// Job progress bookkeeping, shared by the extract and analyze workers.
//
// Counters stay per-URL (not per URL x model): an item bumps the job exactly
// once, whether it died during extraction or was finalized by the last model
// worker. That keeps the existing realtime progress bar correct without change.

import "server-only";

import { createAdminClient } from "@/lib/supabase-admin";
import { sendCompletionEmail } from "@/lib/email";

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
}
