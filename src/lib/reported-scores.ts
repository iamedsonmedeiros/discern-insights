// src/lib/reported-scores.ts
//
// The single answer to "which number do we report for this page?", shared by the
// queue, the result card, the DOCX export and the scientific article.
//
// Numbers come from the panel consensus whenever one exists; the narrative
// (summary, observations, recommendations, justifications) can't be averaged, so
// it stays the primary model's text, attributed to that model by name.
//
// Pure functions, no I/O — safe on client and server.

import { DISCERN_ITEMS } from "@/lib/consensus";
import type { AnalysisItem } from "@/lib/types";

export type ReportedScores = {
  /** "consensus" when the panel mean is reported; "single" for one model or a manual analysis. */
  source: "consensus" | "single";
  /** Models whose scores went into the numbers. Empty when unknown (legacy items). */
  models: string[];
  domainAverages: {
    confiabilidade: number;
    qualidade_tratamento: number;
    score_geral: number;
  };
  /** Per-item score: the panel mean under consensus, the model's own score otherwise. Null when the item was not rated. */
  scores: Record<string, number | null>;
  /** Model that wrote `discernResult`'s text, or null when it can't be told. */
  narrativeModel: string | null;
};

/** The subset of an item the score logic reads, so trimmed copies (article payload) work too. */
export type ScoredItem = Pick<AnalysisItem, "consensus" | "modelId"> & {
  discernResult?: Pick<NonNullable<AnalysisItem["discernResult"]>, "scores" | "domainAverages">;
};

export const shortModelName = (id: string) => id.split("/").pop() ?? id;

/**
 * `discern_result` doesn't record which model produced it, but its 16 scores are
 * one column of the consensus matrix — match them to recover the author.
 */
export function identifyNarrativeModel(item: ScoredItem): string | null {
  const scores = item.discernResult?.scores as Record<string, number | null> | undefined;
  if (!scores) return null;

  const consensus = item.consensus;
  if (!consensus) return item.modelId ?? null;

  return (
    consensus.models.find((model) =>
      DISCERN_ITEMS.every((key) => (consensus.perItem[key]?.values[model] ?? null) === (scores[key] ?? null))
    ) ?? null
  );
}

export function getReportedScores(item: ScoredItem): ReportedScores | null {
  const consensus = item.consensus;

  if (consensus) {
    return {
      source: "consensus",
      models: consensus.models,
      domainAverages: consensus.domainAverages,
      scores: Object.fromEntries(DISCERN_ITEMS.map((key) => [key, consensus.perItem[key].mean])),
      narrativeModel: identifyNarrativeModel(item),
    };
  }

  const result = item.discernResult;
  if (!result) return null;

  return {
    source: "single",
    models: item.modelId ? [item.modelId] : [],
    domainAverages: result.domainAverages,
    scores: result.scores as Record<string, number | null>,
    narrativeModel: item.modelId ?? null,
  };
}
