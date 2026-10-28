/**
 * Unit tests for the consensus math — pure functions, no network, no cost.
 *
 *   npx tsx scripts/test-consensus.ts
 */

import { normalizeDiscernOutput } from "@/ai/discern-schema";
import { computeConsensus, DISCERN_ITEMS, type ModelScores } from "@/lib/consensus";
import { INSTRUMENT_VERSION } from "@/lib/discern-items";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A model that scores every DISCERN item the same, except where overridden. */
function model(modelId: string, base: number, overrides: Record<string, number | null> = {}): ModelScores {
  const scores: Record<string, number | null> = {};
  for (const item of DISCERN_ITEMS) scores[item] = base;
  return { modelId, scores: { ...scores, ...overrides } };
}

console.log("\nDivergence rule (range > 1 is a disagreement):");
{
  // item04: 2 vs 4 -> range 2 -> diverges.
  // item06: 3 vs 4 -> range 1 -> agrees (the rule is strictly MORE than 1).
  const c = computeConsensus([
    model("a", 5, { item04: 2, item06: 3 }),
    model("b", 5, { item04: 4, item06: 4 }),
  ])!;

  check("flags a 2-point spread", c.divergentItems.includes("item04"));
  check("does NOT flag a 1-point spread", !c.divergentItems.includes("item06"), "3 vs 4 must count as agreement");
  check("divergenceFlag is set", c.divergenceFlag);
  check("mean of 2 and 4 is 3", c.perItem.item04.mean === 3, `got ${c.perItem.item04.mean}`);
  check("range is reported", c.perItem.item04.range === 2);
  check("each model's raw score is kept", c.perItem.item04.values.a === 2 && c.perItem.item04.values.b === 4);
}

console.log("\nUnanimous panel:");
{
  const c = computeConsensus([model("a", 4), model("b", 4), model("c", 4)])!;
  check("no divergent items", c.divergentItems.length === 0);
  check("divergenceFlag is false", !c.divergenceFlag);
  check("sd is zero", c.perItem.item01.sd === 0);
  check("lists all 3 models", c.models.length === 3);
}

console.log("\nMinimum panel size:");
{
  check("a single model yields no consensus", computeConsensus([model("a", 4)]) === null);
  check("zero models yields no consensus", computeConsensus([]) === null);
  check("two models do yield a consensus", computeConsensus([model("a", 4), model("b", 5)]) !== null);
}

console.log("\nIncomplete/malformed input:");
{
  const broken: ModelScores = { modelId: "broken", scores: { item01: 3 } }; // missing 15 items
  const c = computeConsensus([model("a", 4), model("b", 4), broken]);
  check("a model with missing items is excluded", c !== null && !c.models.includes("broken"));
  check("the remaining models still form a consensus", c?.models.length === 2);
}

console.log("\nDomain averages come from the consensus means:");
{
  // Reliability = items 1-8, treatment = items 9-15, overall = item 16.
  const a = model("a", 2, { item16: 5 });
  const b = model("b", 4, { item16: 5 });
  const c = computeConsensus([a, b])!;

  check("reliability domain averages the item means", c.domainAverages.confiabilidade === 3, `got ${c.domainAverages.confiabilidade}`);
  check("treatment domain averages the item means", c.domainAverages.qualidade_tratamento === 3, `got ${c.domainAverages.qualidade_tratamento}`);
  check("overall score is item16's mean", c.domainAverages.score_geral === 5, `got ${c.domainAverages.score_geral}`);
}

console.log("\nQuestion 2 left unrated:");
{
  const c = computeConsensus([
    model("a", 3, { item02: null }),
    model("b", 3, { item02: null }),
  ])!;
  check("an unrated item has no mean", c.perItem.item02.mean === null);
  check("an unrated item is not divergent", !c.divergentItems.includes("item02"));
  check("reliability excludes the unrated item", c.domainAverages.confiabilidade === 3, `got ${c.domainAverages.confiabilidade}`);
}

console.log("\nMixed rated and unrated Question 2:");
{
  const c = computeConsensus([
    model("a", 4, { item01: 1, item02: null }),
    model("b", 4, { item01: 3, item02: 2 }),
  ])!;
  check("the mean uses only the model that rated it", c.perItem.item02.mean === 2, `got ${c.perItem.item02.mean}`);
  check("one rating cannot diverge", !c.divergentItems.includes("item02"));
}

console.log("\nHandbook scoring rules:");
{
  const scores = Object.fromEntries(DISCERN_ITEMS.map((key) => [key, 5]));
  scores.item01 = 1;
  scores.item04 = 1;
  scores.item05 = 5;
  const justifications = Object.fromEntries(DISCERN_ITEMS.map((key) => [key, "x"]));
  const out = normalizeDiscernOutput({
    scores,
    justifications,
    resumo: "r",
    observacoes: "o",
    recommmendacoes: "c",
    fonte: "f",
    rawReportMarkdown: "m",
  });
  check("Question 2 is not rated when Question 1 is No", out.scores.item02 === null);
  check("Question 5 is capped when Question 4 is No", out.scores.item04 === 1 && out.scores.item05 === 3, `item05=${out.scores.item05}`);
  // items 1,3,4,5,6,7,8 = 1, 5, 1, 3, 5, 5, 5. Question 2 is excluded. 25/7 = 3.57
  check("reliability excludes the unrated question", out.domainAverages.confiabilidade === 3.57, `got ${out.domainAverages.confiabilidade}`);
  check("stamps the current instrument version", out.instrumentVersion === INSTRUMENT_VERSION);
}

console.log(
  failures === 0
    ? "\nAll consensus tests passed.\n"
    : `\n${failures} test(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
