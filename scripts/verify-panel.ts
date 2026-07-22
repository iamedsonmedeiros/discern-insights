/**
 * Verifies that every model in a panel honors the canonical DISCERN schema when
 * given the same content snapshot. Run this before adding a model to the panel —
 * a provider that can't produce schema-valid structured output is unusable, and
 * this is the cheapest way to find out.
 *
 *   npx tsx --env-file=.env.local --conditions=react-server scripts/verify-panel.ts [url]
 */

import { DiscernOutputSchema } from "@/ai/discern-schema";
import { getPanel } from "@/ai/evaluators";
import { extractContent, runPanel } from "@/lib/content";

const URL_TO_TEST = process.argv[2] ?? "https://www.nhs.uk/conditions/haemorrhoids/";

// Override the configured panel: we want to probe every candidate model, not
// just the two currently enabled.
process.env.DISCERN_MODELS = [
  "googleai/gemini-2.5-flash",
  "google/gemini-3.5-flash",
  "openai/gpt-5.6-luna",
  "anthropic/claude-sonnet-5",
  "x-ai/grok-4.5",
].join(",");

const ITEMS = Array.from({ length: 16 }, (_, i) => `item${String(i + 1).padStart(2, "0")}`);

async function main() {
  console.log(`\nExtracting: ${URL_TO_TEST}`);
  const extraction = await extractContent(URL_TO_TEST);

  if (!extraction.ok) {
    console.error(`Extraction failed: ${extraction.status} — ${extraction.reason}`);
    process.exit(1);
  }

  console.log(
    `Snapshot: ${extraction.text.length} chars via ${extraction.extractionMethod}, ` +
      `hash ${extraction.hash.slice(0, 12)}…`
  );

  const evaluators = getPanel();
  console.log(`\nPanel (${evaluators.length}): ${evaluators.map((e) => e.id).join(", ")}\n`);

  const { runs } = await runPanel({
    text: extraction.text,
    hash: extraction.hash,
    language: "pt-BR",
    evaluators,
  });

  // --- Per-model outcome + schema validation ---
  console.log("MODEL                            STATUS  SCHEMA   LAT     TOK(in/out)   COST");
  console.log("-".repeat(88));

  for (const run of runs) {
    if (run.status !== "done" || !run.discernResult) {
      console.log(
        `${run.evaluatorId.padEnd(32)} FAILED  —        ${String(run.latencyMs).padStart(5)}ms` +
          `                 ${(run.error ?? "").slice(0, 60)}`
      );
      continue;
    }

    const parsed = DiscernOutputSchema.safeParse(run.discernResult);
    const schema = parsed.success
      ? "valid  "
      : `INVALID(${parsed.error.issues.length})`;

    console.log(
      `${run.evaluatorId.padEnd(32)} done    ${schema} ${String(run.latencyMs).padStart(5)}ms  ` +
        `${String(run.inputTokens).padStart(6)}/${String(run.outputTokens).padEnd(5)} ` +
        `$${run.cost.toFixed(5)}`
    );

    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 3)) {
        console.log(`    ↳ ${issue.path.join(".")}: ${issue.message}`);
      }
    }
  }

  // --- Score matrix + a preview of the Phase 2 divergence rule ---
  const ok = runs.filter((r) => r.status === "done" && r.discernResult);
  if (ok.length < 2) {
    console.log("\nFewer than 2 models succeeded — no comparison possible.");
    return;
  }

  console.log(`\n\nSCORE MATRIX (blind — each model saw the same snapshot)\n`);
  const header = ["ITEM ", ...ok.map((r) => r.evaluatorId.split("/")[1].slice(0, 9).padStart(10))];
  console.log(header.join(" ") + "   MEAN  RANGE");
  console.log("-".repeat(header.join(" ").length + 15));

  let divergent = 0;
  for (const item of ITEMS) {
    const values = ok.map((r) => (r.discernResult!.scores as Record<string, number>)[item]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const range = Math.max(...values) - Math.min(...values);
    if (range > 1) divergent++;

    console.log(
      `${item} ` +
        values.map((v) => String(v).padStart(10)).join(" ") +
        `   ${mean.toFixed(2)}  ${range}${range > 1 ? "  <-- DIVERGE" : ""}`
    );
  }

  console.log(
    `\n${divergent}/16 items diverge by more than 1 point ` +
      `(the Phase 2 alert rule) across ${ok.length} models.`
  );
  console.log(`Total panel cost for this page: $${runs.reduce((s, r) => s + r.cost, 0).toFixed(5)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
