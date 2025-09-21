// src/ai/flows/perform-discern-analysis.ts
'use server';

/**
 * @fileOverview Performs DISCERN analysis on website content using AI.
 *
 * - performDiscernAnalysis - A function that analyzes website content using the DISCERN framework.
 * - PerformDiscernAnalysisInput - The input type for the performDiscernAnalysis function.
 * - PerformDiscernAnalysisOutput - The return type for the performDiscernAnalysis function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const PerformDiscernAnalysisInputSchema = z.object({
  text: z.string().describe('The text content extracted from the website to be analyzed.'),
});
export type PerformDiscernAnalysisInput = z.infer<typeof PerformDiscernAnalysisInputSchema>;

const PerformDiscernAnalysisOutputSchema = z.object({
  scores: z.record(z.number().min(1).max(5)).describe('Scores for each of the 16 DISCERN items.'),
  justifications: z
    .record(z.string())
    .describe('Justifications for each score assigned to the DISCERN items.'),
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
export type PerformDiscernAnalysisOutput = z.infer<typeof PerformDiscernAnalysisOutputSchema>;

export async function performDiscernAnalysis(input: PerformDiscernAnalysisInput): Promise<
  PerformDiscernAnalysisOutput
> {
  return performDiscernAnalysisFlow(input);
}

const discernAnalystPrompt = ai.definePrompt({
  name: 'discernAnalystPrompt',
  input: {schema: PerformDiscernAnalysisInputSchema},
  output: {schema: PerformDiscernAnalysisOutputSchema},
  prompt: `Você é um avaliador rigoroso do DISCERN (Universidade de Oxford) para qualidade de informação sobre tratamentos de saúde.
	•	Use escala 1–5 por item.
	•	Itens 1–8: confiabilidade.
	•	Itens 9–15: qualidade das opções de tratamento.
	•	Item 16: qualidade global.
	•	Avalie apenas conteúdo em texto.
	•	Se o texto não tratar de opções de tratamento, explique e atribua notas baixas nos itens correspondentes.
	•	Responda sempre em português do Brasil.

  Analise o seguinte texto:
  {{{text}}}
`,
  config: {
    safetySettings: [
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_ONLY_HIGH',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_LOW_AND_ABOVE',
      },
    ],
  },
});

const performDiscernAnalysisFlow = ai.defineFlow(
  {
    name: 'performDiscernAnalysisFlow',
    inputSchema: PerformDiscernAnalysisInputSchema,
    outputSchema: PerformDiscernAnalysisOutputSchema,
  },
  async input => {
    const {output} = await discernAnalystPrompt(input);
    return output!;
  }
);
