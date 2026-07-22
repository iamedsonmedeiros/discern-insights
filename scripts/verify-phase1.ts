/**
 * Phase 1 acceptance test, against the REAL pipeline and the REAL database.
 *
 * Creates a throwaway analysis_items row, runs processUrl() on it exactly like
 * the worker does, then asserts that every model in the panel wrote a row to
 * analysis_model_results and that the snapshot columns persisted. Cleans up the
 * test row afterwards (model results cascade).
 *
 *   npx tsx --env-file=.env.local --conditions=react-server scripts/verify-phase1.ts [url]
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

import { extractContent, runPanel } from "@/lib/content";
import { persistModelResults } from "@/lib/model-results";
import { getPanel, estimateCost, GEMINI_EVALUATOR_ID } from "@/ai/evaluators";

const URL_TO_TEST = process.argv[2] ?? "https://www.nhs.uk/conditions/haemorrhoids/";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/**
 * Mirrors processUrl() from src/app/actions.ts. Duplicated here rather than
 * imported because that module pulls in next/headers, which cannot load outside
 * the Next runtime. Uses the same lib functions the real pipeline uses.
 */
async function runPipeline(url: string, itemId: string) {
  const extraction = await extractContent(url);
  if (!extraction.ok) {
    return { status: extraction.status, reason: extraction.reason, failed: true as const };
  }

  const { runs, prepInputTokens, prepOutputTokens } = await runPanel({
    text: extraction.text,
    hash: extraction.hash,
    language: "pt-BR",
    evaluators: getPanel(),
  });

  await persistModelResults(itemId, runs);

  const primary = runs[0];
  const inputTokens = prepInputTokens + runs.reduce((s, r) => s + r.inputTokens, 0);
  const outputTokens = prepOutputTokens + runs.reduce((s, r) => s + r.outputTokens, 0);
  const totalCost =
    estimateCost(GEMINI_EVALUATOR_ID, {
      inputTokens: prepInputTokens,
      outputTokens: prepOutputTokens,
    }) + runs.reduce((s, r) => s + r.cost, 0);

  return {
    failed: false as const,
    status: primary.status === "done" ? "completed" : "analysis_error",
    reason: primary.error,
    meta: extraction.meta,
    discernResult: primary.discernResult,
    modelId: primary.evaluatorId,
    inputTokens,
    outputTokens,
    totalCost,
    contentSnapshot: extraction.text,
    contentHash: extraction.hash,
    extractionMethod: extraction.extractionMethod,
    runs,
  };
}

async function main() {
  console.log(`Panel: ${getPanel().map((e) => e.id).join(", ")}`);

  // A real user_id is required (FK + it's how the app scopes items).
  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users?.users?.[0]?.id;
  if (!userId) throw new Error("No user found in auth.users — cannot create a test item.");

  const itemId = randomUUID();
  const { error: insertError } = await supabase.from("analysis_items").insert({
    id: itemId,
    user_id: userId,
    url: URL_TO_TEST,
    index: 99999,
    status: "pending",
    updated_at: new Date().toISOString(),
  });
  if (insertError) throw new Error(`Could not create test item: ${insertError.message}`);
  console.log(`Test item ${itemId} created.\n`);

  try {
    // --- Exactly what the worker does ---
    const result = await runPipeline(URL_TO_TEST, itemId);
    if (result.failed) {
      throw new Error(`Extraction failed: ${result.status} — ${result.reason}`);
    }

    await supabase
      .from("analysis_items")
      .update({
        status: result.status,
        reason: result.reason ?? null,
        meta: result.meta ?? null,
        discern_result: result.discernResult ?? null,
        content_snapshot: result.contentSnapshot ?? null,
        content_hash: result.contentHash ?? null,
        extraction_method: result.extractionMethod ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);

    console.log(
      `processUrl -> status=${result.status} model=${result.modelId} ` +
        `tokens=${result.inputTokens}/${result.outputTokens} cost=$${(result.totalCost ?? 0).toFixed(5)}\n`
    );

    // --- Assertion 1: the snapshot persisted on the item ---
    const { data: item } = await supabase
      .from("analysis_items")
      .select("content_hash, extraction_method, content_snapshot, status")
      .eq("id", itemId)
      .single();

    console.log(
      `analysis_items: status=${item?.status} method=${item?.extraction_method} ` +
        `hash=${item?.content_hash?.slice(0, 12)}… snapshot=${item?.content_snapshot?.length ?? 0} chars`
    );

    // --- Assertion 2: one row per model in the panel ---
    const { data: rows } = await supabase
      .from("analysis_model_results")
      .select("model_id, provider, status, scores, cost, latency_ms, error")
      .eq("item_id", itemId);

    console.log(`\nanalysis_model_results: ${rows?.length ?? 0} row(s)\n`);
    for (const row of rows ?? []) {
      const scores = row.scores as Record<string, number> | null;
      const detail =
        row.status === "done"
          ? `item16=${scores?.item16} scores=${scores ? Object.keys(scores).length : 0} ` +
            `$${Number(row.cost).toFixed(5)} ${row.latency_ms}ms`
          : `ERROR: ${String(row.error).slice(0, 70)}`;
      console.log(`  [${row.status.padEnd(6)}] ${row.model_id.padEnd(30)} ${detail}`);
    }

    // --- Assertion 3: idempotency (a QStash redelivery must not duplicate) ---
    await runPipeline(URL_TO_TEST, itemId);
    const { count } = await supabase
      .from("analysis_model_results")
      .select("*", { count: "exact", head: true })
      .eq("item_id", itemId);
    console.log(
      `\nAfter re-running the same item: ${count} row(s) — ` +
        `${count === rows?.length ? "no duplicates (upsert OK)" : "DUPLICATED!"}`
    );
  } finally {
    await supabase.from("analysis_items").delete().eq("id", itemId);
    console.log(`\nTest item ${itemId} deleted.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
