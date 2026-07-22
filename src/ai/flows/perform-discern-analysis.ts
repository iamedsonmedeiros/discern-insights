// src/ai/flows/perform-discern-analysis.ts
'use server';

/**
 * @fileOverview Performs DISCERN analysis on website content using Gemini (Genkit).
 *
 * This is the native Google evaluator. The prompt and output schema are NOT
 * defined here — they come from `@/ai/discern-schema`, shared with every other
 * model in the panel so the evaluation stays blind and comparable.
 *
 * - performDiscernAnalysis - Analyzes website content using the DISCERN framework.
 * - PerformDiscernAnalysisInput - The input type for the performDiscernAnalysis function.
 * - PerformDiscernAnalysisOutput - The return type for the performDiscernAnalysis function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {
  DiscernOutputSchema,
  buildDiscernPrompt,
  type DiscernOutput,
  type TokenUsage,
} from '@/ai/discern-schema';

const PerformDiscernAnalysisInputSchema = z.object({
  text: z.string().describe('The text content extracted from the website to be analyzed.'),
  language: z.string().describe('The language of the analysis output (e.g., "pt-BR" or "en").'),
  model: z
    .string()
    .optional()
    .describe('Genkit model id, e.g. "googleai/gemini-2.5-flash". Defaults to the configured model.'),
});
export type PerformDiscernAnalysisInput = z.infer<typeof PerformDiscernAnalysisInputSchema>;

/**
 * The model output plus real token usage read from the API response.
 * (`usage` is metadata, so it is not part of the schema the model must fill in.)
 */
export type PerformDiscernAnalysisOutput = DiscernOutput & { usage: TokenUsage };

// Gemini-specific tuning. Temperature 0 keeps the panel as deterministic as the
// providers allow, so divergence between models reflects judgment, not sampling.
const GEMINI_CONFIG = {
  temperature: 0,
  safetySettings: [
    {category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH'},
    {category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE'},
    {category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE'},
    {category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE'},
  ],
} as const;

export async function performDiscernAnalysis(
  input: PerformDiscernAnalysisInput
): Promise<PerformDiscernAnalysisOutput> {
  return performDiscernAnalysisFlow(input);
}

const performDiscernAnalysisFlow = ai.defineFlow(
  {
    name: 'performDiscernAnalysisFlow',
    inputSchema: PerformDiscernAnalysisInputSchema,
  },
  async (input): Promise<PerformDiscernAnalysisOutput> => {
    const {output, usage} = await ai.generate({
      ...(input.model ? {model: input.model} : {}),
      prompt: buildDiscernPrompt(input),
      output: {schema: DiscernOutputSchema},
      config: GEMINI_CONFIG,
    });

    if (!output) {
      throw new Error(`Model ${input.model ?? 'default'} returned no structured output.`);
    }

    return {
      ...output,
      usage: {
        inputTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
      },
    };
  }
);
