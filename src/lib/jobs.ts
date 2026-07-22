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
