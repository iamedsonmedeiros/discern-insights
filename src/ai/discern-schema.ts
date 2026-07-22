// src/ai/discern-schema.ts
//
// The canonical, provider-agnostic definition of a DISCERN evaluation.
//
// Every model in the panel MUST receive this exact prompt and be constrained by
// this exact schema — that is what makes the multi-model comparison "blind" and
// the scores comparable. Nothing provider-specific belongs in this file.

import { z } from "zod";

export const discernScoresSchema = z.object({
  item01: z.number().min(1).max(5).describe('Are the aims clear?'),
  item02: z.number().min(1).max(5).describe('Does it achieve its aims?'),
  item03: z.number().min(1).max(5).describe('Is it relevant?'),
  item04: z.number().min(1).max(5).describe('Is it clear what sources of information were used to compile the publication (other than the author or producer)?'),
  item05: z.number().min(1).max(5).describe('Is it clear when the information used or reported in the publication was produced?'),
  item06: z.number().min(1).max(5).describe('Is it balanced and unbiased?'),
  item07: z.number().min(1).max(5).describe('Does it provide details of additional sources of support and information?'),
  item08: z.number().min(1).max(5).describe('Does it refer to areas of uncertainty?'),
  item09: z.number().min(1).max(5).describe('Does it describe how each treatment works?'),
  item10: z.number().min(1).max(5).describe('Does it describe the risks of each treatment?'),
  item11: z.number().min(1).max(5).describe('Does it describe what would happen without treatment?'),
  item12: z.number().min(1).max(5).describe('Does it describe how the treatments affect overall quality of life?'),
  item13: z.number().min(1).max(5).describe('Is it clear that there may be a choice of treatments?'),
  item14: z.number().min(1).max(5).describe('Does it provide support for shared decision-making?'),
  item15: z.number().min(1).max(5).describe('Is it clear that there may be a choice of treatments? (This seems to be a duplicate of 13, but is in the DISCERN list)'),
  item16: z.number().min(1).max(5).describe('Overall quality rating'),
});

export const discernJustificationsSchema = z.object({
  item01: z.string().describe('Justification for score on: Are the aims clear?'),
  item02: z.string().describe('Justification for score on: Does it achieve its aims?'),
  item03: z.string().describe('Justification for score on: Is it relevant?'),
  item04: z.string().describe('Justification for score on: Is it clear what sources of information were used?'),
  item05: z.string().describe('Justification for score on: Is it clear when the information used was produced?'),
  item06: z.string().describe('Justification for score on: Is it balanced and unbiased?'),
  item07: z.string().describe('Justification for score on: Does it provide details of additional sources?'),
  item08: z.string().describe('Justification for score on: Does it refer to areas of uncertainty?'),
  item09: z.string().describe('Justification for score on: Does it describe how each treatment works?'),
  item10: z.string().describe('Justification for score on: Does it describe the risks of each treatment?'),
  item11: z.string().describe('Justification for score on: Does it describe what would happen without treatment?'),
  item12: z.string().describe('Justification for score on: Does it describe how the treatments affect overall quality of life?'),
  item13: z.string().describe('Justification for score on: Is it clear that there may be a choice of treatments?'),
  item14: z.string().describe('Justification for score on: Does it provide support for shared decision-making?'),
  item15: z.string().describe('Justification for score on: Is it clear that there may be a choice of treatments? (This seems to be a duplicate of 13, but is in the DISCERN list)'),
  item16: z.string().describe('Justification for score on: Overall quality rating'),
});

/**
 * What the model is asked to produce. Deliberately excludes `usage` — token
 * counts are API response metadata, not something the model should hallucinate.
 */
export const DiscernOutputSchema = z.object({
  scores: discernScoresSchema.describe('Scores for each of the 16 DISCERN items.'),
  justifications: discernJustificationsSchema.describe('Justifications for each score assigned to the DISCERN items.'),
  domainAverages: z
    .object({
      confiabilidade: z.number().describe('Average score for the reliability domain (items 1-8).'),
      qualidade_tratamento: z
        .number()
        .describe('Average score for the treatment quality domain (items 9-15).'),
      score_geral: z.number().describe('Overall DISCERN score (item 16).'),
    })
    .describe('Average scores for the DISCERN domains.'),
  resumo: z.string().describe('Executive summary of the DISCERN analysis.'),
  observacoes: z.string().describe('Observations regarding authorship, sources, and conflicts.'),
  recommmendacoes: z.string().describe('Recommendations for improving the information.'),
  fonte: z.string().describe('Source of the DISCERN analysis.'),
  rawReportMarkdown: z.string().describe('Complete DISCERN report in Markdown format.'),
});

export type DiscernOutput = z.infer<typeof DiscernOutputSchema>;

const ITEM_KEYS = Array.from(
  { length: 16 },
  (_, i) => `item${String(i + 1).padStart(2, "0")}`
);

/**
 * A version of the score schema WITHOUT numeric min/max constraints. Some
 * providers (Anthropic via OpenRouter) reject `minimum`/`maximum` on number
 * types in structured-output JSON schema. The 1–5 range is instead stated in
 * each field description and re-imposed after the fact by `normalizeDiscernOutput`.
 */
const relaxedScoresSchema = z.object(
  Object.fromEntries(
    ITEM_KEYS.map((key) => [
      key,
      z.number().describe(
        (discernScoresSchema.shape as Record<string, z.ZodNumber>)[key].description ??
          "DISCERN score from 1 to 5."
      ),
    ])
  ) as Record<string, z.ZodNumber>
);

/**
 * The output schema used for the actual model request. Identical to
 * `DiscernOutputSchema` except the scores carry no numeric constraints, so every
 * provider accepts it. Responses are validated/clamped back to the strict schema.
 */
export const DiscernRequestSchema = DiscernOutputSchema.extend({
  scores: relaxedScoresSchema,
});

/**
 * Coerces a raw model response into a valid DiscernOutput: rounds each score and
 * clamps it into [1, 5], then validates against the strict schema. This is the
 * safety net for models that ignore the range, over- or under-shoot, or emit a
 * float where an integer was expected.
 */
export function normalizeDiscernOutput(
  raw: z.infer<typeof DiscernRequestSchema>
): DiscernOutput {
  const scores = raw.scores as unknown as Record<string, number>;
  const clamped: Record<string, number> = {};
  for (const key of ITEM_KEYS) {
    const value = Number(scores[key]);
    clamped[key] = Number.isFinite(value) ? Math.min(5, Math.max(1, Math.round(value))) : 1;
  }
  return DiscernOutputSchema.parse({ ...raw, scores: clamped });
}

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

/**
 * The single prompt every evaluator in the panel receives. Kept byte-identical
 * across providers on purpose — any divergence here invalidates the comparison.
 */
export function buildDiscernPrompt(input: { text: string; language: string }): string {
  return `You are a rigorous DISCERN (University of Oxford) evaluator for the quality of health information.
	• Use a 1–5 scale per item.
	• Items 1–8: reliability.
	• Items 9–15: quality of treatment options.
	• Item 16: overall quality.
	• Evaluate only text content.
	• If the text does not discuss treatment options, explain this and assign low scores to the corresponding items.
	• Always respond in the language specified: ${input.language}.

  Analyze the following text:
  ${input.text}
`;
}
