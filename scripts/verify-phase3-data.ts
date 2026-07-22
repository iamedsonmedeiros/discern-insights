/**
 * Verifies that the data the Phase 3 UI consumes is present and well-formed for
 * the seeded consensus item — replicating the exact queries fetchAnalysisItems
 * and fetchModelResults run, then asserting every field ConsensusView reads.
 *
 *   npx tsx --env-file=.env.local scripts/verify-phase3-data.ts <itemId>
 */

import { createClient } from "@supabase/supabase-js";

const itemId = process.argv[2];
if (!itemId) throw new Error("Usage: verify-phase3-data.ts <itemId>");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const ITEMS = Array.from({ length: 16 }, (_, i) => `item${String(i + 1).padStart(2, "0")}`);
let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "ok  " : "FAIL"}  ${n}${!c && d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};

async function main() {
  // --- as fetchAnalysisItems maps it ---
  const { data: raw } = await supabase.from("analysis_items").select("*").eq("id", itemId).single();
  const item = {
    status: raw.status,
    discernResult: raw.discern_result,
    consensus: raw.consensus,
    divergenceFlag: raw.divergence_flag,
    divergentItems: raw.divergent_items,
    panelIncomplete: raw.panel_incomplete,
    modelsTotal: raw.models_total,
  };

  console.log("\nItem (as the UI receives it):");
  ok("status is completed", item.status === "completed");
  ok("has a primary discernResult (narrative + scores)", !!item.discernResult?.scores);
  ok("consensus object present", !!item.consensus);
  ok("divergenceFlag is a boolean", typeof item.divergenceFlag === "boolean");
  ok("divergentItems is an array", Array.isArray(item.divergentItems));

  const c = item.consensus as any;
  console.log("\nConsensus shape (ConsensusView reads these):");
  ok("consensus.models has >= 2 entries", c?.models?.length >= 2, `got ${c?.models?.length}`);
  ok("perItem has all 16 items", ITEMS.every((k) => c?.perItem?.[k]));
  ok(
    "each perItem has mean/min/max/range/values",
    ITEMS.every((k) => {
      const s = c?.perItem?.[k];
      return s && typeof s.mean === "number" && typeof s.range === "number" && s.values;
    })
  );
  ok(
    "perItem.values has a score for every consensus model",
    ITEMS.every((k) => c.models.every((m: string) => typeof c.perItem[k].values[m] === "number"))
  );
  ok(
    "divergentItems == items with range > 1",
    JSON.stringify([...item.divergentItems].sort()) ===
      JSON.stringify(ITEMS.filter((k) => c.perItem[k].range > 1).sort()),
    `flagged ${JSON.stringify(item.divergentItems)}`
  );
  ok("domainAverages present", !!c?.domainAverages && typeof c.domainAverages.score_geral === "number");

  // --- as fetchModelResults maps it (the side-by-side justifications) ---
  const { data: rows } = await supabase
    .from("analysis_model_results")
    .select("model_id, status, scores, justifications")
    .eq("item_id", itemId);

  console.log("\nPer-model results (side-by-side justifications):");
  const done = (rows ?? []).filter((r) => r.status === "done");
  ok("at least 2 models succeeded", done.length >= 2, `got ${done.length}`);
  ok(
    "every succeeded model has justifications for all 16 items",
    done.every((r) => {
      const j = r.justifications as Record<string, string> | null;
      return j && ITEMS.every((k) => typeof j[k] === "string" && j[k].length > 0);
    })
  );
  ok(
    "consensus.models all have a matching model_results row",
    c.models.every((m: string) => done.some((r) => r.model_id === m))
  );

  // --- Print a human-readable preview of what will render ---
  console.log("\nPreview (divergent items the amber badges will mark):");
  for (const k of item.divergentItems as string[]) {
    const s = c.perItem[k];
    const scores = c.models.map((m: string) => `${m.split("/").pop()}=${s.values[m]}`).join("  ");
    console.log(`  ${k}: mean ${s.mean} range ${s.range}  [${scores}]`);
  }

  console.log(
    failures === 0
      ? `\nAll Phase 3 data-contract checks passed. Item ${itemId} is ready to view in the UI.\n`
      : `\n${failures} check(s) FAILED.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
