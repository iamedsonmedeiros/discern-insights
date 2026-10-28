// src/lib/content.ts
//
// Phase 0 of the multi-LLM consensus plan: extraction and analysis are split
// into independent stages so a single, immutable content snapshot can later be
// evaluated by several models "blind". Behavior of the current Gemini-only
// pipeline is unchanged.

import "server-only";
import { createHash } from "crypto";

import { summarizeLongContent } from "@/ai/flows/summarize-long-content";
import { estimateCost, getPanel, type DiscernEvaluator } from "@/ai/evaluators";
import { redis, normalizeUrlForCache, isRedisConfigured } from "@/lib/redis";
import { classifyUrl, MIN_TEXT_LENGTH, REJECTION_REASONS } from "@/lib/eligibility";
import { INSTRUMENT_VERSION } from "@/lib/discern-items";
import type { AnalysisItem, AnalysisStatus } from "@/lib/types";

// Texts below this length go straight to the model. Frontier models handle
// ~75k tokens (≈300k chars) trivially, so summarizing earlier only adds a
// lossy, model-specific preprocessing step — which would become a source of
// bias once several models share the same snapshot.
export const SUMMARIZATION_THRESHOLD_CHARS = 300_000;

const CONTENT_CACHE_TTL_SECONDS = 60 * 60 * 48; // 48h: dedup scraping across jobs
const ANALYSIS_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7d: reuse per-model result

const MIN_TEXT_LENGTH_FOR_VIDEO_PAGES = 1500;

// When the target site blocks Jina, Jina still answers HTTP 200 and writes the
// upstream failure into the body, e.g. "Warning: Target URL returned error 403: Forbidden".
const JINA_TARGET_ERROR = /^Warning: Target URL returned error (\d{3})/m;

const BLOCKED_PAGE =
  /verify you are human|estabelecendo uma conexão segura|verifique se você é humano|bot verification|security check|request id|access denied|acesso negado|403 forbidden|you don't have permission to access/i;

/**
 * Rejects text that must never become a snapshot: upstream error pages and
 * pages too short to be an article. Applied to fresh scrapes AND cache hits, so
 * a bad snapshot cached before this check existed is not reused.
 */
function rejectUnusableText(text: string): string | null {
  const targetError = text.match(JINA_TARGET_ERROR);
  if (targetError) {
    return `O site bloqueou a extração (HTTP ${targetError[1]}). Faça a análise manual desta página.`;
  }
  if (text.length < MIN_TEXT_LENGTH) {
    return `Conteúdo extraído insuficiente (${text.length} caracteres). A página provavelmente retornou erro ou bloqueio. Faça a análise manual desta página.`;
  }
  return null;
}

type Meta = NonNullable<AnalysisItem["meta"]>;

export type ExtractionMethod = "jina" | "fetch";

export type ExtractionResult =
  | {
      ok: true;
      text: string;
      hash: string;
      meta: Meta;
      extractionMethod: ExtractionMethod;
    }
  | { ok: false; status: AnalysisStatus; reason: string; meta: Meta };

export type DiscernAnalysisRun = {
  discernResult: AnalysisItem["discernResult"];
  inputTokens: number;
  outputTokens: number;
  /** True when served from cache — no tokens were spent, so cost must be zero. */
  cached?: boolean;
};

export function computeContentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function contentCacheKey(url: string): string {
  return `content:${normalizeUrlForCache(url)}`;
}

// The instrument version is part of the key: a result scored against another
// item set must never be served for the current one.
function analysisCacheKey(modelId: string, hash: string): string {
  return `analysis:${INSTRUMENT_VERSION}:${modelId}:${hash}`;
}

export function htmlToText(html: string): string {
  // If content looks like Jina AI Markdown (starts with title or URL)
  // We can do some minor cleaning but mostly Markdown is good for the AI.
  if (html.includes("Markdown Content:") || html.startsWith("# ") || html.includes("---")) {
    // Just remove some Jina specific headers if they exist
    return html.replace(/^(Title: .*?\n|URL Source: .*?\n|Markdown Content:.*?\n)/gm, "").trim();
  }

  // Remove script, style, and head elements
  let cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  cleanHtml = cleanHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  cleanHtml = cleanHtml.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");

  // Convert block-level elements to newlines
  cleanHtml = cleanHtml.replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n");

  // Remove all remaining HTML tags
  cleanHtml = cleanHtml.replace(/<[^>]+>/g, " ");

  // Replace multiple newlines/spaces with a single one
  cleanHtml = cleanHtml.replace(/(\s*\n\s*)+/g, "\n");
  cleanHtml = cleanHtml.replace(/[ \t]+/g, " ");

  // Decode HTML entities
  cleanHtml = cleanHtml.replace(/&nbsp;/g, " ");
  cleanHtml = cleanHtml.replace(/&amp;/g, "&");
  cleanHtml = cleanHtml.replace(/&lt;/g, "<");
  cleanHtml = cleanHtml.replace(/&gt;/g, ">");
  cleanHtml = cleanHtml.replace(/&quot;/g, '"');
  cleanHtml = cleanHtml.replace(/&#39;/g, "'");

  return cleanHtml.trim();
}

/**
 * Stage 1 — scrape a URL into an immutable text snapshot.
 *
 * Returns either a successful snapshot (text + sha256 hash + meta) or a
 * non-eligible/error status. A successful snapshot is cached in Redis under
 * `content:{url}` for 48h so multiple model workers (and repeat jobs) reuse it
 * without re-scraping.
 */
export async function extractContent(url: string): Promise<ExtractionResult> {
  const meta: Meta = {};

  // Social networks, video platforms and direct PDFs are excluded by URL alone.
  const rejection = classifyUrl(url);
  if (rejection) {
    return { ok: false, status: rejection.status, reason: rejection.reason, meta };
  }

  // --- Content cache check (snapshot reuse) ---
  const cacheKey = contentCacheKey(url);
  if (isRedisConfigured()) {
    try {
      const cached = (await redis.get(cacheKey)) as Extract<ExtractionResult, { ok: true }> | null;
      if (cached && !rejectUnusableText(cached.text)) {
        console.log(`Content cache hit for ${url}`);
        return cached;
      }
      if (cached) {
        console.warn(`Discarding unusable cached snapshot for ${url}`);
        await redis.del(cacheKey);
      }
    } catch (e) {
      console.warn("Redis content read failed, continuing without cache:", e);
    }
  }

  let extractionMethod: ExtractionMethod = "jina";

  try {
    // Try Jina AI first for robust extraction (JS-heavy sites, clean markdown)
    let html = "";
    try {
      const jinaUrl = `https://r.jina.ai/${url}`;
      const jinaResponse = await fetch(jinaUrl, {
        headers: { "X-Return-Format": "markdown" },
        signal: AbortSignal.timeout(15000),
      });

      if (jinaResponse.ok) {
        const body = await jinaResponse.text();
        const targetError = body.match(JINA_TARGET_ERROR);
        if (targetError) {
          console.warn(`Jina got HTTP ${targetError[1]} from ${url}, falling back to native fetch.`);
        } else {
          html = body;
          console.log(`Successfully scraped using Jina AI: ${url}`);
        }
      }
    } catch (jinaError) {
      console.warn(`Jina AI scraping failed for ${url}, falling back to native fetch.`, jinaError);
    }

    // Fallback to native fetch if Jina fails or returned empty
    if (!html) {
      extractionMethod = "fetch";
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "max-age=0",
          DNT: "1",
          "Upgrade-Insecure-Requests": "1",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });

      meta.httpStatus = response.status;

      // The page exists but refuses automated access — not "offline".
      if ([401, 403, 429].includes(response.status)) {
        return {
          ok: false,
          status: "scraping_error",
          reason: `O site bloqueou a extração (HTTP ${response.status}). Faça a análise manual desta página.`,
          meta,
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          status: "unavailable_offline",
          reason: `HTTP Error: ${response.status} ${response.statusText}`,
          meta,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/pdf")) {
        return { ok: false, status: "not_eligible_pdf", reason: REJECTION_REASONS.pdf, meta };
      }

      html = await response.text();
    }

    // Check for security verification pages (e.g. Cloudflare, generic protection)
    const isSecurityPage = BLOCKED_PAGE.test(html);
    if (isSecurityPage && html.length < 10000) {
      return {
        ok: false,
        status: "scraping_error",
        reason:
          "A página retornou uma verificação de segurança (Bot Protection). Faça a análise manual dessa página.",
        meta,
      };
    }
    meta.size = html.length;

    if (!meta.title) {
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      meta.title = titleMatch ? titleMatch[1] : "No title";
    }

    const textContent = htmlToText(html);

    const hasVideoEmbed =
      html.includes("<video") || /youtube\.com\/embed|vimeo\.com\/player/.test(html);
    if (hasVideoEmbed && textContent.length < MIN_TEXT_LENGTH_FOR_VIDEO_PAGES) {
      return {
        ok: false,
        status: "not_eligible_video",
        reason: "Content is primarily video with insufficient text.",
        meta,
      };
    }

    if (!textContent) {
      return {
        ok: false,
        status: "scraping_error",
        reason: "Could not extract text content from the page.",
        meta,
      };
    }

    const unusable = rejectUnusableText(textContent);
    if (unusable) {
      return { ok: false, status: "scraping_error", reason: unusable, meta };
    }

    const result: Extract<ExtractionResult, { ok: true }> = {
      ok: true,
      text: textContent,
      hash: computeContentHash(textContent),
      meta,
      extractionMethod,
    };

    if (isRedisConfigured()) {
      try {
        await redis.set(cacheKey, result, { ex: CONTENT_CACHE_TTL_SECONDS });
      } catch (e) {
        console.warn("Redis content write failed:", e);
      }
    }

    return result;
  } catch (error) {
    let reason: string;
    if (error instanceof Error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        reason = "The request timed out after 25 seconds.";
      } else {
        reason = `Extraction failed: ${error.message}`;
      }
    } else {
      reason = "An unknown extraction error occurred.";
    }
    return { ok: false, status: "scraping_error", reason, meta };
  }
}

/**
 * Result of one model's evaluation of one snapshot.
 */
export type ModelRun = {
  evaluatorId: string;
  provider: string;
  status: "done" | "failed";
  discernResult?: AnalysisItem["discernResult"];
  error?: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  latencyMs: number;
};

/**
 * Summarization runs ONCE per snapshot, before the panel fans out — every model
 * must see the same bytes. (Summarizing per-model would inject the summarizer's
 * bias unevenly and break the blind comparison.)
 */
export async function prepareTextForAnalysis(
  text: string,
  language: string
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  if (text.length <= SUMMARIZATION_THRESHOLD_CHARS) {
    return { text, inputTokens: 0, outputTokens: 0 };
  }

  try {
    const summary = await summarizeLongContent({ text, language });
    return {
      text: summary.summary,
      inputTokens: summary.usage?.inputTokens || 0,
      outputTokens: summary.usage?.outputTokens || 0,
    };
  } catch (e) {
    console.error("Summarization failed:", e);
    // Continue with truncated content if summarization fails
    return {
      text: text.substring(0, SUMMARIZATION_THRESHOLD_CHARS),
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

/**
 * Stage 2 — analyze a prepared snapshot with one model, memoized in Redis under
 * `analysis:{evaluatorId}:{hash}` for 7 days. Keying by content hash (not URL)
 * means the cache self-invalidates when a page changes and is shared across URLs
 * that produce identical text.
 */
export async function analyzeWithEvaluator(params: {
  text: string;
  hash: string;
  language: string;
  evaluator: DiscernEvaluator;
}): Promise<DiscernAnalysisRun> {
  const { text, hash, language, evaluator } = params;
  const cacheKey = analysisCacheKey(evaluator.id, hash);

  if (isRedisConfigured()) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log(`Analysis cache hit for ${evaluator.id}:${hash}`);
        // A cache hit spends nothing, so it must not re-report the tokens of the
        // run that populated it — otherwise repeated analyses inflate job totals
        // and would bill the user for work that never happened. The real usage
        // stays recorded on the original analysis_model_results row.
        return {
          ...(cached as DiscernAnalysisRun),
          inputTokens: 0,
          outputTokens: 0,
          cached: true,
        };
      }
    } catch (e) {
      console.warn("Redis analysis read failed, continuing without cache:", e);
    }
  }

  const discernResult = await evaluator.evaluate({ text, language });
  const run: DiscernAnalysisRun = {
    discernResult,
    inputTokens: discernResult.usage?.inputTokens || 0,
    outputTokens: discernResult.usage?.outputTokens || 0,
  };

  if (isRedisConfigured()) {
    try {
      await redis.set(cacheKey, run, { ex: ANALYSIS_CACHE_TTL_SECONDS });
    } catch (e) {
      console.warn("Redis analysis write failed:", e);
    }
  }

  return run;
}

/**
 * Run the whole panel against one snapshot, in parallel and independently. Each
 * model is isolated: one provider failing (rate limit, bad JSON, outage) costs
 * us that evaluator, not the item.
 *
 * `runs` comes back in panel order — index 0 is the primary evaluator.
 */
export async function runPanel(params: {
  text: string;
  hash: string;
  language: string;
  evaluators: DiscernEvaluator[];
}): Promise<{ runs: ModelRun[]; prepInputTokens: number; prepOutputTokens: number }> {
  const { text, hash, language, evaluators } = params;

  const prepared = await prepareTextForAnalysis(text, language);
  // If the text was summarized, the models see the summary — so the analysis
  // cache must be keyed on what they actually read, not on the raw snapshot.
  const analysisHash =
    prepared.text === text ? hash : computeContentHash(prepared.text);

  const settled = await Promise.allSettled(
    evaluators.map(async (evaluator): Promise<ModelRun> => {
      const startedAt = Date.now();
      try {
        const run = await analyzeWithEvaluator({
          text: prepared.text,
          hash: analysisHash,
          language,
          evaluator,
        });
        return {
          evaluatorId: evaluator.id,
          provider: evaluator.provider,
          status: "done",
          discernResult: run.discernResult,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cost: estimateCost(evaluator.id, {
            inputTokens: run.inputTokens,
            outputTokens: run.outputTokens,
          }),
          latencyMs: Date.now() - startedAt,
        };
      } catch (e) {
        console.error(`Evaluator ${evaluator.id} failed:`, e);
        return {
          evaluatorId: evaluator.id,
          provider: evaluator.provider,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          latencyMs: Date.now() - startedAt,
        };
      }
    })
  );

  // The mapper above never rejects, so every entry is fulfilled; this keeps
  // TypeScript honest without swallowing a genuine bug.
  const runs = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          evaluatorId: evaluators[i].id,
          provider: evaluators[i].provider,
          status: "failed" as const,
          error: String(s.reason),
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          latencyMs: 0,
        }
  );

  return {
    runs,
    prepInputTokens: prepared.inputTokens,
    prepOutputTokens: prepared.outputTokens,
  };
}

/**
 * Analyze raw text (pasted by the user) with the primary evaluator only.
 * No URL, no snapshot, no cache.
 */
export async function runDiscernAnalysis(
  text: string,
  language: string
): Promise<DiscernAnalysisRun> {
  const prepared = await prepareTextForAnalysis(text, language);
  const [primary] = getPanel();

  const discernResult = await primary.evaluate({ text: prepared.text, language });

  return {
    discernResult,
    inputTokens: prepared.inputTokens + (discernResult.usage?.inputTokens || 0),
    outputTokens: prepared.outputTokens + (discernResult.usage?.outputTokens || 0),
  };
}
