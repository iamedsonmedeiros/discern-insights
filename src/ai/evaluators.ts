// src/ai/evaluators.ts
//
// The model panel. Every evaluator answers the same prompt under the same
// schema (see `@/ai/discern-schema`); the only thing that varies is which model
// is behind it. Adding a model to the panel is a config change, not a code change.

import "server-only";

import { generateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import {
  DiscernRequestSchema,
  normalizeDiscernOutput,
  buildDiscernPrompt,
  type TokenUsage,
} from "@/ai/discern-schema";
import {
  performDiscernAnalysis,
  type PerformDiscernAnalysisOutput,
} from "@/ai/flows/perform-discern-analysis";

export type DiscernEvaluator = {
  /** Canonical id, stored as `model_id`. Also the per-model cache key. */
  id: string;
  provider: "google" | "openrouter";
  displayName: string;
  evaluate(input: { text: string; language: string }): Promise<PerformDiscernAnalysisOutput>;
};

/** USD per 1M tokens. Used for per-model cost tracking. */
const PRICING: Record<string, { input: number; output: number }> = {
  "googleai/gemini-2.5-flash": { input: 0.075, output: 0.3 },
  "googleai/gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "google/gemini-3.5-flash": { input: 1.5, output: 9 },
  "openai/gpt-5.6-luna": { input: 1, output: 6 },
  "anthropic/claude-sonnet-5": { input: 2, output: 10 },
  "x-ai/grok-4.5": { input: 2, output: 6 },
};

/**
 * Ceiling on completion tokens per evaluation. Without this the SDK reserves the
 * model's full output window (65k+), which inflates the cost estimate providers
 * check against your balance and can get requests rejected outright. A complete
 * DISCERN report (16 scores + 16 justifications + summary + markdown) runs
 * ~3.5k tokens, so this leaves generous headroom.
 */
const MAX_OUTPUT_TOKENS = Number(process.env.DISCERN_MAX_OUTPUT_TOKENS) || 8192;

export function estimateCost(modelId: string, usage: TokenUsage): number {
  const price = PRICING[modelId];
  if (!price) return 0;
  return (
    (usage.inputTokens / 1_000_000) * price.input +
    (usage.outputTokens / 1_000_000) * price.output
  );
}

/** The default primary evaluator: the native Genkit path this app started with. */
export const GEMINI_EVALUATOR_ID = "googleai/gemini-2.5-flash";

/** Any `googleai/*` id goes through Genkit on the Google API key. */
function createGoogleEvaluator(modelId: string): DiscernEvaluator {
  return {
    id: modelId,
    provider: "google",
    displayName: modelId.replace("googleai/", ""),
    evaluate: ({ text, language }) =>
      performDiscernAnalysis({ text, language, model: modelId }),
  };
}

function createOpenRouterEvaluator(modelId: string): DiscernEvaluator {
  return {
    id: modelId,
    provider: "openrouter",
    displayName: modelId,
    async evaluate({ text, language }) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error(
          `OPENROUTER_API_KEY is not set — cannot run evaluator "${modelId}".`
        );
      }

      const openrouter = createOpenRouter({ apiKey });
      const prompt = buildDiscernPrompt({ text, language });

      // Some models occasionally emit structured output that fails schema
      // validation on the first attempt; one retry is cheaper than losing the
      // evaluator from the panel.
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const { object, usage } = await generateObject({
            model: openrouter.chat(modelId),
            schema: DiscernRequestSchema,
            prompt,
            temperature: 0,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          });

          return {
            ...normalizeDiscernOutput(object),
            usage: {
              inputTokens: usage?.inputTokens ?? 0,
              outputTokens: usage?.outputTokens ?? 0,
            },
          };
        } catch (e) {
          lastError = e;
          console.warn(`Evaluator ${modelId} attempt ${attempt} failed:`, e);
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error(`Evaluator ${modelId} failed: ${String(lastError)}`);
    },
  };
}

/** Builds a single evaluator by id — used by the per-model analysis worker. */
export function createEvaluator(id: string): DiscernEvaluator {
  return id.startsWith("googleai/")
    ? createGoogleEvaluator(id)
    : createOpenRouterEvaluator(id);
}

/** Human-facing label for a model id. */
export function displayNameFor(id: string): string {
  return id.startsWith("googleai/") ? id.replace("googleai/", "") : id;
}

/** The model ids configured for this deployment via `DISCERN_MODELS`. */
function getConfiguredModelIds(): string[] {
  const configured = (process.env.DISCERN_MODELS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return configured.length > 0 ? configured : [GEMINI_EVALUATOR_ID];
}

/** Only ids we can actually run right now (OpenRouter ones need a key). */
function usableModelIds(ids: string[]): string[] {
  const usable = ids.filter((id) => {
    if (!id.startsWith("googleai/") && !process.env.OPENROUTER_API_KEY) {
      console.warn(`Skipping evaluator "${id}": OPENROUTER_API_KEY is not set.`);
      return false;
    }
    return true;
  });
  return usable.length > 0 ? usable : [GEMINI_EVALUATOR_ID];
}

/**
 * The models a user is allowed to pick from in the job form — the configured
 * panel, minus any that can't run in this environment.
 */
export function getAvailableModels(): { id: string; displayName: string }[] {
  return usableModelIds(getConfiguredModelIds()).map((id) => ({
    id,
    displayName: displayNameFor(id),
  }));
}

/**
 * Builds evaluators for a specific set of model ids (a job's chosen panel),
 * falling back to the configured default when none are given. Unknown or
 * unusable ids are dropped rather than failing the job.
 *
 * The FIRST entry is the primary evaluator: its result is what the UI shows and
 * what `analysis_items.discern_result` stores when consensus is unavailable.
 */
export function getPanel(modelIds?: string[]): DiscernEvaluator[] {
  const requested = modelIds?.length ? modelIds : getConfiguredModelIds();
  return usableModelIds(requested).map(createEvaluator);
}
