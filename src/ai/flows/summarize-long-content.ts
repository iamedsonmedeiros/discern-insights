'use server';

/**
 * @fileOverview Summarizes long text content from websites.
 *
 * - summarizeLongContent - A function that summarizes long text content.
 * - SummarizeLongContentInput - The input type for the summarizeLongContent function.
 * - SummarizeLongContentOutput - The return type for the summarizeLongContent function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SummarizeLongContentInputSchema = z.object({
  text: z.string().describe('The long text content to summarize.'),
  language: z.string().describe('The language for the summary (e.g., "pt-BR" or "en").'),
});
export type SummarizeLongContentInput = z.infer<typeof SummarizeLongContentInputSchema>;

const SummarizeLongContentOutputSchema = z.object({
  summary: z.string().describe('The summarized text content.'),
  usage: z.object({
    inputTokens: z.number().describe('Number of input tokens used.'),
    outputTokens: z.number().describe('Number of output tokens used.'),
  }).optional().describe('Token usage for this summary.'),
});
export type SummarizeLongContentOutput = z.infer<typeof SummarizeLongContentOutputSchema>;

export async function summarizeLongContent(input: SummarizeLongContentInput): Promise<SummarizeLongContentOutput> {
  return summarizeLongContentFlow(input);
}

const prompt = ai.definePrompt({
  name: 'summarizeLongContentPrompt',
  input: {schema: SummarizeLongContentInputSchema},
  output: {schema: SummarizeLongContentOutputSchema},
  prompt: `You are an expert summarizer, skilled at condensing long text into a concise and informative summary.

  Please summarize the following text, focusing on the key information related to treatment options, risks, and sources. The summary should be in the specified language: {{{language}}}.

  Text: {{{text}}}`,
});

const summarizeLongContentFlow = ai.defineFlow(
  {
    name: 'summarizeLongContentFlow',
    inputSchema: SummarizeLongContentInputSchema,
    outputSchema: SummarizeLongContentOutputSchema,
  },
  async input => {
    const {output, usage} = await prompt(input);
    return {
      ...output!,
      usage: {
        inputTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
      }
    };
  }
);
