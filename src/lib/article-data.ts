// src/lib/article-data.ts
//
// Turns a batch of analysis items into the data block the article writer reads.
// Every number the manuscript reports is computed here, not by the LLM: the
// sample flow, the aggregate means and SDs, and the inter-rater reliability.
// The model only writes prose around them.
//
// Pure functions, no I/O.

import { DISCERN_ITEMS } from "@/lib/consensus";
import { discernLabel, INSTRUMENT_VERSION, isCurrentInstrument, type DiscernLocale } from "@/lib/discern-items";
import { buildIccMatrix, computeIcc } from "@/lib/reliability";
import { getReportedScores, shortModelName, type ReportedScores } from "@/lib/reported-scores";
import type { AnalysisItem, AnalysisStatus, Consensus } from "@/lib/types";

/** Fields the article needs; the client strips everything else to keep the payload small. */
export type ArticleItem = Pick<
  AnalysisItem,
  "url" | "status" | "meta" | "modelId" | "consensus" | "divergentItems" | "panelIncomplete" | "modelsTotal" | "updatedAt"
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
    updatedAt: item.updatedAt,
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

const fmt = (n: number) => n.toFixed(2);

type Stat = { mean: number; sd: number | null; n: number };

function stat(values: number[]): Stat | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, sd: null, n: 1 };
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, sd: Math.sqrt(variance), n: values.length };
}

function meanSd(values: number[]): string {
  const s = stat(values);
  if (!s) return "n/a";
  return s.sd === null ? `${fmt(s.mean)} (n=1)` : `${fmt(s.mean)} ± ${fmt(s.sd)} (n=${s.n})`;
}

type Reported = { item: ArticleItem; scores: ReportedScores };

/** Completed items scored with the current instrument, with the scores the article reports. */
function includedItems(items: ArticleItem[]): { included: Reported[]; legacy: number } {
  const completed = items.filter((item) => item.status === "completed" && item.discernResult);
  // Older analyses used a non-official item set; their scores answer different questions.
  const current = completed.filter((item) => isCurrentInstrument(item.discernResult));
  return {
    included: current.map((item) => ({ item, scores: getReportedScores(item)! })),
    legacy: completed.length - current.length,
  };
}

const itemValues = (included: Reported[], key: string) =>
  included.map((r) => r.scores.scores[key]).filter((v): v is number => typeof v === "number");

/** "October 2026", or "October 2026 to November 2026", from when the included items were analyzed. */
function studyPeriod(included: Reported[], locale: DiscernLocale): string {
  const times = included
    .map((r) => Date.parse(r.item.updatedAt))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (times.length === 0) return "unknown";
  const month = (t: number) => new Date(t).toLocaleDateString(locale, { month: "long", year: "numeric" });
  const first = month(times[0]);
  const last = month(times[times.length - 1]);
  if (first === last) return first;
  return locale === "pt-BR" ? `${first} a ${last}` : `${first} to ${last}`;
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

/**
 * The data block the article writer reads. Question labels follow `locale`
 * (the validated Brazilian Portuguese wording for "pt-BR"), so the manuscript
 * quotes the instrument in the language it is written in.
 */
export function formatArticleData(items: ArticleItem[], locale: DiscernLocale = "en"): string {
  const { included: reported, legacy } = includedItems(items);
  const included = reported.map((r) => r.item);
  const consensuses = included.map((item) => item.consensus).filter((c): c is Consensus => !!c);
  const question = (key: string) => discernLabel(key, locale);

  const panelModels = Array.from(new Set(consensuses.flatMap((c) => c.models))).map(shortModelName);
  const singleModel = reported.filter((r) => r.scores.source === "single").length;
  const incomplete = included.filter((item) => item.panelIncomplete).length;
  const divergentPairs = included.reduce((sum, item) => sum + (item.divergentItems?.length ?? 0), 0);
  const divergentSites = included.filter((item) => (item.divergentItems?.length ?? 0) > 0).length;

  const lines: string[] = [];

  lines.push(
    "## Study period",
    `- Websites analyzed in: ${studyPeriod(reported, locale)}`,
    "",
    "## Sample flow",
    `- URLs screened: ${items.length}`,
  );
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
    ...DISCERN_ITEMS.map((key) => `  - ${question(key)}: ${meanSd(itemValues(reported, key))}`),
  );

  if (reported.length >= 2) {
    const name = (r: Reported) => r.item.meta?.title || r.item.url;
    const domains: [string, (r: Reported) => number][] = [
      ["Overall quality (item 16)", (r) => r.scores.domainAverages.score_geral],
      ["Reliability (items 1-8)", (r) => r.scores.domainAverages.confiabilidade],
      ["Quality of treatment information (items 9-15)", (r) => r.scores.domainAverages.qualidade_tratamento],
    ];
    lines.push("", "## Websites ranked by domain, highest to lowest (computed by the system; use this to name the best and worst sites)");
    for (const [label, value] of domains) {
      const ranked = [...reported].sort((a, b) => value(b) - value(a));
      lines.push(`- ${label}: ${ranked.map((r) => `${name(r)} (${fmt(value(r))})`).join("; ")}`);
    }
  }

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

const TABLE_TEXT = {
  en: {
    caption: (n: number) =>
      `Table 1. DISCERN scores across the ${n} included websites. Each website contributes its panel mean (or the single model's score when no panel was available); values are the mean ± standard deviation across websites.`,
    header: ["DISCERN question", "Mean ± SD", "n"],
    reliability: "Reliability (questions 1-8)",
    treatment: "Quality of information on treatment choices (questions 9-15)",
    note: "n: websites with a rating; question 2 is left unrated when question 1 is rated No.",
  },
  "pt-BR": {
    caption: (n: number) =>
      `Tabela 1. Pontuações DISCERN dos ${n} sites incluídos. Cada site entra com a média do painel (ou a nota do modelo único, quando não houve painel); os valores são a média ± desvio padrão entre os sites.`,
    header: ["Questão DISCERN", "Média ± DP", "n"],
    reliability: "Confiabilidade (questões 1-8)",
    treatment: "Qualidade da informação sobre as opções de tratamento (questões 9-15)",
    note: "n: sites com nota; a questão 2 fica sem nota quando a questão 1 é avaliada como Não.",
  },
} as const;

/**
 * Table 1 of the manuscript as a Markdown table, built from the same numbers as
 * the data block so the model never has to copy them. Empty when nothing was included.
 */
export function buildScoresTable(items: ArticleItem[], locale: DiscernLocale = "en"): string {
  const { included } = includedItems(items);
  if (included.length === 0) return "";

  const text = TABLE_TEXT[locale];
  const number = (n: number) => (locale === "pt-BR" ? fmt(n).replace(".", ",") : fmt(n));
  const cell = (s: Stat | null) =>
    !s ? "—" : s.sd === null ? number(s.mean) : `${number(s.mean)} ± ${number(s.sd)}`;
  const row = (label: string, values: number[]) => {
    const s = stat(values);
    return `| ${label} | ${cell(s)} | ${s?.n ?? 0} |`;
  };

  return [
    text.caption(included.length),
    "",
    `| ${text.header.join(" | ")} |`,
    "| --- | --- | --- |",
    ...DISCERN_ITEMS.map((key) => row(discernLabel(key, locale), itemValues(included, key))),
    row(text.reliability, included.map((r) => r.scores.domainAverages.confiabilidade)),
    row(text.treatment, included.map((r) => r.scores.domainAverages.qualidade_tratamento)),
    "",
    text.note,
  ].join("\n");
}
