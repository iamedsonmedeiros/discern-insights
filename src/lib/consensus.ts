// src/lib/consensus.ts
//
// Phase 2: turns N independent model verdicts on the same snapshot into a single
// consensus score, and flags the items where the models genuinely disagree.
//
// Pure functions, no I/O — this is the part that has to be right, so it is kept
// trivially testable.

export const DISCERN_ITEMS: readonly string[] = Array.from(
  { length: 16 },
  (_, i) => `item${String(i + 1).padStart(2, "0")}`
);

/**
 * Models are said to disagree when their spread on an item exceeds one point.
 * "More than 1" is strict: scores of 3 and 4 agree; 2 and 4 do not.
 */
export const DIVERGENCE_THRESHOLD = 1;

/** Consensus needs at least two opinions; below that there is nothing to average. */
export const MIN_MODELS_FOR_CONSENSUS = 2;

export type ItemStat = {
  mean: number;
  min: number;
  max: number;
  range: number;
  /** Population standard deviation across the models. */
  sd: number;
  /** Each model's raw score, so the UI can show who said what. */
  values: Record<string, number>;
};

export type Consensus = {
  /** Models whose scores went into this consensus. */
  models: string[];
  perItem: Record<string, ItemStat>;
  domainAverages: {
    confiabilidade: number;
    qualidade_tratamento: number;
    score_geral: number;
  };
  /** Items where max - min > 1. These are what the user must review by hand. */
  divergentItems: string[];
  divergenceFlag: boolean;
};

export type ModelScores = {
  modelId: string;
  scores: Record<string, number>;
};

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Builds the consensus from every model that successfully scored the snapshot.
 * Returns null when fewer than two models produced scores — a single opinion is
 * not a consensus, and pretending otherwise would hide the fact that the panel
 * was incomplete.
 */
export function computeConsensus(results: ModelScores[]): Consensus | null {
  const usable = results.filter(
    (r) => r.scores && DISCERN_ITEMS.every((item) => typeof r.scores[item] === "number")
  );

  if (usable.length < MIN_MODELS_FOR_CONSENSUS) return null;

  const perItem: Record<string, ItemStat> = {};
  const divergentItems: string[] = [];

  for (const item of DISCERN_ITEMS) {
    const values: Record<string, number> = {};
    for (const result of usable) {
      values[result.modelId] = result.scores[item];
    }

    const nums = Object.values(values);
    const avg = mean(nums);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const range = max - min;
    const variance = mean(nums.map((v) => (v - avg) ** 2));

    perItem[item] = {
      mean: round(avg),
      min,
      max,
      range,
      sd: round(Math.sqrt(variance)),
      values,
    };

    if (range > DIVERGENCE_THRESHOLD) divergentItems.push(item);
  }

  // Domain averages are computed from the CONSENSUS means, not by averaging each
  // model's own domain averages — otherwise a model that failed on one item
  // would skew a whole domain.
  const meanOf = (items: readonly string[]) => round(mean(items.map((i) => perItem[i].mean)));

  return {
    models: usable.map((r) => r.modelId),
    perItem,
    domainAverages: {
      confiabilidade: meanOf(DISCERN_ITEMS.slice(0, 8)), // items 1-8
      qualidade_tratamento: meanOf(DISCERN_ITEMS.slice(8, 15)), // items 9-15
      score_geral: perItem.item16.mean, // item 16
    },
    divergentItems,
    divergenceFlag: divergentItems.length > 0,
  };
}
