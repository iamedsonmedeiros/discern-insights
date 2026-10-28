// src/lib/article-data.ts
//
// Turns a batch of analysis items into the data block the article writer reads.
// Every number the manuscript reports is computed here, not by the LLM: the
// sample flow, the aggregate means and SDs, and the inter-rater reliability.
// The model only writes prose around them.
//
// Pure functions, no I/O.

import { DISCERN_ITEMS } from "@/lib/consensus";
import { discernLabel, INSTRUMENT_VERSION, isCurrentInstrument } from "@/lib/discern-items";
import { buildIccMatrix, computeIcc } from "@/lib/reliability";
import { getReportedScores, shortModelName } from "@/lib/reported-scores";
import type { AnalysisItem, AnalysisStatus, Consensus } from "@/lib/types";

/** Fields the article needs; the client strips everything else to keep the payload small. */
export type ArticleItem = Pick<
  AnalysisItem,
  "url" | "status" | "meta" | "modelId" | "consensus" | "divergentItems" | "panelIncomplete" | "modelsTotal"
> & {
  discernResult?: Pick<
    NonNullable<AnalysisItem["discernResult"]>,
    "scores" | "domainAverages" | "resumo" | "observacoes" | "recommmendacoes" | "instrumentVersion"
  >;
};

export function toArticleItem(item: AnalysisItem): ArticleItem {
  const result = item.discernResult;
  return {
    url: item.url,
    status: item.status,
    meta: item.meta ? { title: item.meta.title } : undefined,
    modelId: item.modelId,
    consensus: item.consensus,
    divergentItems: item.divergentItems,
    panelIncomplete: item.panelIncomplete,
    modelsTotal: item.modelsTotal,
    discernResult: result
      ? {
          scores: result.scores,
          domainAverages: result.domainAverages,
          resumo: result.resumo,
          observacoes: result.observacoes,
          recommmendacoes: result.recommmendacoes,
          instrumentVersion: result.instrumentVersion,
        }
      : undefined,
  };
}

const SAMPLE_FLOW: [AnalysisStatus, string][] = [
  ["completed", "Included and analyzed"],
  ["not_eligible_social", "Excluded: social media post"],
  ["not_eligible_video", "Excluded: video platform or video-only page"],
  ["not_eligible_pdf", "Excluded: PDF file"],
  ["scraping_error", "Excluded: access blocked or no extractable text"],
  ["unavailable_offline", "Excluded: page unavailable (HTTP error)"],
  ["analysis_error", "Excluded: every model in the panel failed"],
];

const question = (key: string) => discernLabel(key, "en");

const fmt = (n: number) => n.toFixed(2);

function meanSd(values: number[]): string {
  if (values.length === 0) return "n/a";
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return `${fmt(mean)} (n=1)`;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return `${fmt(mean)} ± ${fmt(Math.sqrt(variance))} (n=${values.length})`;
}

function reliabilitySection(consensuses: Consensus[]): string[] {
  if (consensuses.length === 0) return ["- ICC: not applicable (no multi-model consensus in this batch)."];

  // Same rule as the on-screen reliability card: only models present in every analysis.
  const models = consensuses[0].models.filter((m) => consensuses.every((c) => c.models.includes(m)));
  const icc = models.length >= 2 ? computeIcc(buildIccMatrix(consensuses, models)) : null;
  if (!icc) return ["- ICC: not computed (insufficient complete data)."];

  return [
    `- ICC(2,1), single model: ${icc.icc1.toFixed(3)}`,
    `- ICC(2,k), panel mean of ${icc.raters} models: ${icc.iccK.toFixed(3)} (${icc.interpretation}, Koo & Li 2016)`,
    `- Observations (website x DISCERN item): ${icc.subjects}; models: ${models.map(shortModelName).join(", ")}`,
  ];
}

export function formatArticleData(items: ArticleItem[]): string {
  const completed = items.filter((item) => item.status === "completed" && item.discernResult);
  // Older analyses used a non-official item set; their scores answer different questions.
  const included = completed.filter((item) => isCurrentInstrument(item.discernResult));
  const legacy = completed.length - included.length;
  const reported = included.map((item) => ({ item, scores: getReportedScores(item)! }));
  const consensuses = included.map((item) => item.consensus).filter((c): c is Consensus => !!c);

  const panelModels = Array.from(new Set(consensuses.flatMap((c) => c.models))).map(shortModelName);
  const singleModel = reported.filter((r) => r.scores.source === "single").length;
  const incomplete = included.filter((item) => item.panelIncomplete).length;
  const divergentPairs = included.reduce((sum, item) => sum + (item.divergentItems?.length ?? 0), 0);
  const divergentSites = included.filter((item) => (item.divergentItems?.length ?? 0) > 0).length;

  const lines: string[] = [];

  lines.push("## Sample flow", `- URLs screened: ${items.length}`);
  for (const [status, label] of SAMPLE_FLOW) {
    const count = status === "completed" ? included.length : items.filter((item) => item.status === status).length;
    lines.push(`- ${label}: ${count}`);
  }
  if (legacy > 0) {
    lines.push(`- Excluded: analyzed with a previous, non-official version of the item set: ${legacy}`);
  }

  lines.push(
    "",
    "## Evaluation panel",
    `- Instrument: the 16 official DISCERN questions with their rating hints and scale (Charnock et al., 1999); version ${INSTRUMENT_VERSION}`,
    panelModels.length > 0
      ? `- Blinded panel of ${panelModels.length} models: ${panelModels.join(", ")}`
      : "- Single-model evaluation (no multi-model panel in this batch)",
    `- Websites scored by panel consensus: ${consensuses.length}; by a single model: ${singleModel}`,
    `- Websites with an incomplete panel (a model failed): ${incomplete}`,
    `- Divergent ratings (models differed by more than 1 point): ${divergentPairs} item ratings across ${divergentSites} websites`,
    ...reliabilitySection(consensuses),
  );

  lines.push(
    "",
    "## Aggregate statistics across included websites (computed by the system; report these values, do not recompute)",
    `- Overall quality, item 16: ${meanSd(reported.map((r) => r.scores.domainAverages.score_geral))}`,
    `- Reliability, items 1-8: ${meanSd(reported.map((r) => r.scores.domainAverages.confiabilidade))}`,
    `- Quality of treatment information, items 9-15: ${meanSd(reported.map((r) => r.scores.domainAverages.qualidade_tratamento))}`,
    "- Per item (mean ± SD):",
    ...DISCERN_ITEMS.map((key) => `  - ${question(key)}: ${meanSd(reported.map((r) => r.scores.scores[key]).filter((v): v is number => typeof v === "number"))}`),
  );

  lines.push("", "## Per-website data");
  for (const { item, scores } of reported) {
    const consensus = item.consensus;
    const result = item.discernResult!;
    const itemScores = DISCERN_ITEMS.map((key) => {
      const stat = consensus?.perItem[key];
      const value = stat ? stat.mean : scores.scores[key];
      return stat ? `${key}: ${value ?? "not rated"} (range ${stat.range})` : `${key}: ${value ?? "not rated"}`;
    }).join(", ");
    const author = scores.narrativeModel ? shortModelName(scores.narrativeModel) : "primary model";

    lines.push(
      "",
      `### ${item.meta?.title || item.url}`,
      `- URL: ${item.url}`,
      `- Scores: ${scores.source === "consensus" ? `mean of ${scores.models.length} models` : "single model"}${item.panelIncomplete ? ` (incomplete panel: ${scores.models.length} of ${item.modelsTotal ?? "?"} models)` : ""}`,
      `- Overall (item 16): ${fmt(scores.domainAverages.score_geral)}; Reliability: ${fmt(scores.domainAverages.confiabilidade)}; Treatment quality: ${fmt(scores.domainAverages.qualidade_tratamento)}`,
      `- Item scores: ${itemScores}`,
      `- Divergent items: ${item.divergentItems?.length ? item.divergentItems.join(", ") : "none"}`,
      `- Narrative below written by: ${author}`,
      `- Executive summary: ${result.resumo}`,
      `- Observations: ${result.observacoes}`,
      `- Recommendations: ${result.recommmendacoes}`,
    );
  }

  return lines.join("\n");
}
