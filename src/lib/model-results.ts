// src/lib/model-results.ts
//
// Persistence for per-model DISCERN verdicts (Phase 1). Kept out of the server
// actions module so the worker — and tests — can record results without pulling
// in the request-scoped Supabase client.

import "server-only";

import { createAdminClient } from "@/lib/supabase-admin";
import type { ModelRun } from "@/lib/content";

/**
 * Records each model's verdict on an item, keyed by (item_id, model_id) so a
 * QStash redelivery updates the row instead of duplicating it.
 *
 * Best-effort: the panel already ran and cost real money, so a bookkeeping
 * failure is logged but must not fail the analysis.
 */
export async function persistModelResults(itemId: string, runs: ModelRun[]): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("analysis_model_results").upsert(
      runs.map((run) => ({
        item_id: itemId,
        provider: run.provider,
        model_id: run.evaluatorId,
        status: run.status,
        scores: run.discernResult?.scores ?? null,
        justifications: run.discernResult?.justifications ?? null,
        domain_averages: run.discernResult?.domainAverages ?? null,
        // The full payload too: the finalizer needs a narrative (resumo,
        // recomendações, markdown) to put on the item, and it may have to take
        // it from a non-primary model if the primary one failed.
        result: run.discernResult ?? null,
        input_tokens: run.inputTokens,
        output_tokens: run.outputTokens,
        cost: run.cost,
        latency_ms: run.latencyMs,
        error: run.error ?? null,
      })),
      { onConflict: "item_id,model_id" }
    );

    if (error) {
      console.error("Failed to persist model results:", error);
    }
  } catch (e) {
    console.error("Failed to persist model results:", e);
  }
}
