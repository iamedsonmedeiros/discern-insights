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

const discernItemsSchema = z.object({
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

const discernJustificationsSchema = z.object({
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


const PerformDiscernAnalysisOutputSchema = z.object({
  scores: discernItemsSchema.describe('Scores for each of the 16 DISCERN items.'),
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
