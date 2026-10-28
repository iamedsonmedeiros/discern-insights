// src/ai/discern-schema.ts
//
// The canonical, provider-agnostic definition of a DISCERN evaluation.
//
// Every model in the panel MUST receive this exact prompt and be constrained by
// this exact schema — that is what makes the multi-model comparison "blind" and
// the scores comparable. Nothing provider-specific belongs in this file.
//
// The questions, hints and rating scale come from `@/lib/discern-items`; this
// file only shapes them into a schema and a prompt.

import { z } from "zod";
import {
  DISCERN_INSTRUMENT,
  DISCERN_TERMS,
  INSTRUMENT_VERSION,
  RATING_SCALE,
  SECTION_TITLES,
  type DiscernSection,
} from "@/lib/discern-items";

const ITEM_KEYS = DISCERN_INSTRUMENT.map((item) => item.key);

const questionOf = (item: (typeof DISCERN_INSTRUMENT)[number]) => `Q${item.number}. ${item.question.en}`;

// Question 2 is left unanswered when Question 1 is No (Handbook, Part 3).
const scoreField = (item: (typeof DISCERN_INSTRUMENT)[number], relaxed: boolean) => {
  const number = (relaxed ? z.number() : z.number().min(1).max(5)).describe(questionOf(item));
  return item.key === "item02" ? number.nullable() : number;
};

export const discernScoresSchema = z.object(
  Object.fromEntries(DISCERN_INSTRUMENT.map((item) => [item.key, scoreField(item, false)])) as Record<
    string,
    z.ZodType<number | null>
  >
);

export const discernJustificationsSchema = z.object(
  Object.fromEntries(
    DISCERN_INSTRUMENT.map((item) => [
      item.key,
      z.string().describe(`Justification for the score on ${questionOf(item)}`),
    ])
  ) as Record<string, z.ZodString>
);

const domainAveragesSchema = z
  .object({
    confiabilidade: z.number().describe("Mean of questions 1-8 (reliability)."),
    qualidade_tratamento: z.number().describe("Mean of questions 9-15 (quality of information on treatment choices)."),
    score_geral: z.number().describe("Question 16 (overall rating)."),
  })
  .describe("Average scores for the DISCERN domains.");

/**
 * A complete DISCERN evaluation as stored. `domainAverages` and
 * `instrumentVersion` are filled in by `normalizeDiscernOutput`, never by the model.
 */
export const DiscernOutputSchema = z.object({
  scores: discernScoresSchema.describe("Scores for each of the 16 DISCERN questions."),
  justifications: discernJustificationsSchema.describe("Justification for each score, citing the text."),
  domainAverages: domainAveragesSchema,
  resumo: z.string().describe("Executive summary of the DISCERN analysis."),
  observacoes: z.string().describe("Observations regarding authorship, sources, and conflicts."),
  recommmendacoes: z.string().describe("Recommendations for improving the information."),
  fonte: z.string().describe("Source of the DISCERN analysis."),
  rawReportMarkdown: z.string().describe("Complete DISCERN report in Markdown format."),
  instrumentVersion: z.string().optional(),
});

export type DiscernOutput = z.infer<typeof DiscernOutputSchema>;

/**
 * A version of the score schema WITHOUT numeric min/max constraints. Some
 * providers (Anthropic via OpenRouter) reject `minimum`/`maximum` on number
 * types in structured-output JSON schema. The 1–5 range is stated in the prompt
 * and re-imposed after the fact by `normalizeDiscernOutput`.
 */
const relaxedScoresSchema = z.object(
  Object.fromEntries(
    DISCERN_INSTRUMENT.map((item) => [
      item.key,
      scoreField(item, true).describe(
        item.key === "item02"
          ? `${questionOf(item)} Score from 1 to 5, or null when Question 1 is No.`
          : `${questionOf(item)} Score from 1 to 5.`
      ),
    ])
  ) as Record<string, z.ZodType<number | null>>
);

/**
 * What the model is asked to produce. Domain averages are arithmetic, so the code
 * computes them; the version is metadata. Neither is left to the model.
 */
export const DiscernRequestSchema = DiscernOutputSchema.omit({
  domainAverages: true,
  instrumentVersion: true,
}).extend({
  scores: relaxedScoresSchema,
});

const mean = (values: number[]) =>
  values.length === 0 ? 0 : Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100;

/**
 * Coerces a raw model response into a valid DiscernOutput: rounds each score and
 * clamps it into [1, 5], applies the handbook's two scoring rules (Question 2 is
 * not answered when Question 1 is No; Question 5 cannot rate high when Question 4
 * is No), computes the domain averages from the answered scores, stamps the
 * instrument version, then validates against the strict schema.
 */
export function normalizeDiscernOutput(raw: z.infer<typeof DiscernRequestSchema>): DiscernOutput {
  const scores = raw.scores as unknown as Record<string, number | null>;
  const clamped: Record<string, number | null> = {};
  for (const key of ITEM_KEYS) {
    const value = scores[key];
    if (value === null || value === undefined) {
      clamped[key] = null;
      continue;
    }
    const numeric = Number(value);
    clamped[key] = Number.isFinite(numeric) ? Math.min(5, Math.max(1, Math.round(numeric))) : null;
  }

  // Every question except 2 must be rated. A missing score is treated as 1.
  for (const key of ITEM_KEYS) {
    if (key !== "item02" && clamped[key] === null) clamped[key] = 1;
  }

  // Handbook, Part 3: when the aims are not stated, Question 2 is irrelevant.
  if (clamped.item01 === 1) clamped.item02 = null;
  else if (clamped.item02 === null) clamped.item02 = 1;

  // Handbook, Part 3: a publication rated 1 on Question 4 cannot rate high on Question 5.
  if (clamped.item04 === 1 && typeof clamped.item05 === "number" && clamped.item05 >= 4) {
    clamped.item05 = 3;
  }

  const answered = (section: DiscernSection) =>
    DISCERN_INSTRUMENT.filter((item) => item.section === section)
      .map((item) => clamped[item.key])
      .filter((value): value is number => typeof value === "number");

  return DiscernOutputSchema.parse({
    ...raw,
    scores: clamped,
    domainAverages: {
      confiabilidade: mean(answered("reliability")),
      qualidade_tratamento: mean(answered("treatment")),
      score_geral: clamped.item16 as number,
    },
    instrumentVersion: INSTRUMENT_VERSION,
  });
}

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

function instrumentText(): string {
  const sections: DiscernSection[] = ["reliability", "treatment", "overall"];
  return sections
    .map((section) => {
      const questions = DISCERN_INSTRUMENT.filter((item) => item.section === section)
        .map((item) => `${questionOf(item)}\n   Hint: ${item.hint}`)
        .join("\n");
      return `${SECTION_TITLES[section]}\n${questions}`;
    })
    .join("\n\n");
}

/**
 * The single prompt every evaluator in the panel receives. Kept byte-identical
 * across providers on purpose — any divergence here invalidates the comparison.
 */
export function buildDiscernPrompt(input: { text: string; language: string }): string {
  return `You are a rigorous evaluator applying the DISCERN instrument (Charnock et al., 1999; University of Oxford) to a written publication about health and treatment choices. Apply the instrument exactly as specified below. The hints guide the rating; they are not hard and fast rules, and judgement still applies.

TERMS
${DISCERN_TERMS}

RATING SCALE
${RATING_SCALE}
Question 16 uses its own anchors, given in its hint.

RULES
- Rate every question from 1 to 5, using the hints and the rating notes. Base every rating only on the text provided; do not assume content that is not there.
- If Question 1 is rated 1 (No), Question 2 is irrelevant and must not be answered: set item02 to null and write in its justification that it was not rated because the aims are not clear. If Question 1 is partial (2 to 4), judge what expectations the aims raised and rate Question 2 against those.
- Section 2 rates the treatment or treatments described in the publication. Apart from Question 14, it is not about every treatment that exists. Questions 9 to 11 concern the active treatments, including self-care. No-treatment options are rated in Question 12.
- Question 4: a 5 requires both hints (a reference beside the claim, and a way to check that source). Fulfilment of only one hint is a partial rating. Further reading and useful addresses belong to Question 7 and are not sources of evidence here. A high rating does not mean the information is accurate.
- Question 5: a 5 requires the dates of the main sources of evidence, which is the first hint. Only the date of the publication itself is a partial rating. A publication rated 1 on Question 4 cannot be rated 4 or 5 on Question 5.
- Question 16 is an intuitive summary of the answers to questions 1 to 15. Rate it 5 when the publication rated 4 or above on the majority of questions, 3 when the high and low ratings are similar in number or most ratings are in the middle, and 1 when it rated 2 or below on the majority.
- If the publication does not discuss treatment choices, rate the Section 2 questions 1 where the criterion is not met at all and explain why. Do not leave a question null to avoid a criterion that is simply unmet.
- Each justification must cite or paraphrase the specific passages of the text that support the rating.
- Keys item01 to item16 in the output correspond to questions 1 to 16, in order.
- Write all free text (justifications, summary, observations, recommendations, report) in this language: ${input.language}.

THE DISCERN INSTRUMENT
${instrumentText()}

TEXT TO EVALUATE
${input.text}
`;
}
