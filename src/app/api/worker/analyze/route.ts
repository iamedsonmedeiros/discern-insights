import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

import { createAdminClient } from "@/lib/supabase-admin";
import { analyzeWithEvaluator, type ModelRun } from "@/lib/content";
import { persistModelResults } from "@/lib/model-results";
import { copyScoreToLaterPositions, recordItemOutcome } from "@/lib/jobs";
import { computeConsensus, type ModelScores } from "@/lib/consensus";
import { createEvaluator, estimateCost, getPanel } from "@/ai/evaluators";
import type { PerformDiscernAnalysisOutput } from "@/lib/types";

// Stage 2 of the fan-out: ONE model evaluates ONE already-extracted snapshot.
// Scoping each invocation to a single model keeps it well inside the 60s budget
// and means a failing provider costs us that evaluator, not the whole item.
export const maxDuration = 60;

/**
 * Called by whichever model worker finishes last. Reads every model's verdict,
 * computes the consensus, and closes the item.
 *
 * The write is a compare-and-swap on `status`: if two workers race to finalize,
 * Postgres picks exactly one winner, and only that winner bumps the job counter.
 * This is also what makes a QStash redelivery harmless.
 */
async function finalizeItem(
  jobId: string,
  itemId: string,
  modelsTotal: number,
  jobModels: string[] | null
) {
  const supabase = createAdminClient();

  const { data: rows } = await supabase
    .from("analysis_model_results")
    .select("model_id, status, scores, result")
    .eq("item_id", itemId);

  const succeeded = (rows ?? []).filter((row) => row.status === "done" && row.scores);

  // Panel order decides whose narrative is shown; fall back to any model that
  // did succeed if the primary one didn't.
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
    .eq("status", "processing") // <- only one worker can win this
    .select("id")
    .maybeSingle();

  if (!claimed) {
    return { finalized: false as const };
  }

  await recordItemOutcome(jobId, isCompleted);
  await copyScoreToLaterPositions(itemId);

  return {
    finalized: true as const,
    isCompleted,
    modelsSucceeded: succeeded.length,
    modelsTotal,
    divergentItems: consensus?.divergentItems ?? [],
  };
}

async function handler(request: NextRequest) {
  let jobId: string | undefined;
  let itemId: string | undefined;
  let modelId: string | undefined;

  try {
    const body = await request.json();
    jobId = body.jobId;
    itemId = body.itemId;
    modelId = body.modelId;

    if (!jobId || !itemId || !modelId) {
      return NextResponse.json(
        { error: "Missing jobId, itemId or modelId" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data: job } = await supabase
      .from("analysis_jobs")
      .select("language, models")
      .eq("id", jobId)
      .single();

    const { data: item } = await supabase
      .from("analysis_items")
      .select("id, content_snapshot, content_hash, models_total, status")
      .eq("id", itemId)
      .single();

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    if (!item.content_snapshot || !item.content_hash) {
      // The extract stage owns the snapshot; without it there is nothing to read.
      return NextResponse.json(
        { error: "Item has no content snapshot" },
        { status: 409 }
      );
    }

    const modelsTotal = item.models_total ?? 1;
    const language = job?.language || "pt-BR";
    const evaluator = createEvaluator(modelId);

    // --- Evaluate. A model failure is recorded, never thrown. ---
    const startedAt = Date.now();
    let run: ModelRun;

    try {
      const result = await analyzeWithEvaluator({
        text: item.content_snapshot,
        hash: item.content_hash,
        language,
        evaluator,
      });

      run = {
        evaluatorId: evaluator.id,
        provider: evaluator.provider,
        status: "done",
        discernResult: result.discernResult,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: estimateCost(evaluator.id, {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        }),
        latencyMs: Date.now() - startedAt,
      };
    } catch (e) {
      console.error(`Model ${modelId} failed on item ${itemId}:`, e);
      run = {
        evaluatorId: evaluator.id,
        provider: evaluator.provider,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        latencyMs: Date.now() - startedAt,
      };
    }

    await persistModelResults(itemId, [run]);

    // --- Am I the last model to report? ---
    // Counting rows is naturally idempotent thanks to UNIQUE(item_id, model_id):
    // a redelivered message overwrites its own row instead of inflating a counter.
    const { count } = await supabase
      .from("analysis_model_results")
      .select("*", { count: "exact", head: true })
      .eq("item_id", itemId);

    if ((count ?? 0) >= modelsTotal) {
      const outcome = await finalizeItem(jobId, itemId, modelsTotal, job?.models ?? null);
      return NextResponse.json({ itemId, modelId, status: run.status, ...outcome });
    }

    return NextResponse.json({
      itemId,
      modelId,
      status: run.status,
      reported: count,
      modelsTotal,
    });
  } catch (error) {
    console.error("Analyze worker error:", jobId, itemId, modelId, error);
    return NextResponse.json({ error: "Worker failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const devBypass = request.headers.get("x-dev-bypass");
  if (devBypass === "1" && !process.env.QSTASH_TOKEN) {
    return handler(request);
  }
  return verifySignatureAppRouter(handler)(request);
}
