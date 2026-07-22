import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

import { createAdminClient } from "@/lib/supabase-admin";
import { extractContent, prepareTextForAnalysis, computeContentHash } from "@/lib/content";
import { recordItemOutcome } from "@/lib/jobs";
import { publish } from "@/lib/queue";
import { getPanel } from "@/ai/evaluators";

// Stage 1 of the fan-out: scrape the URL exactly once, freeze the text every
// model will read, then dispatch one analysis message per model.
export const maxDuration = 60;

async function handler(request: NextRequest) {
  let jobId: string | undefined;
  let itemId: string | undefined;

  try {
    const body = await request.json();
    jobId = body.jobId;
    itemId = body.itemId;

    if (!jobId || !itemId) {
      return NextResponse.json({ error: "Missing jobId or itemId" }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: job } = await supabase
      .from("analysis_jobs")
      .select("id, language, models")
      .eq("id", jobId)
      .single();

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Claim the item only if still pending (compare-and-swap). A QStash
    // redelivery finds it already claimed and exits without re-scraping.
    const { data: item } = await supabase
      .from("analysis_items")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("status", "pending")
      .select("id, url")
      .single();

    if (!item) {
      return NextResponse.json({ status: "skipped", reason: "already_claimed" });
    }

    const language = job.language || "pt-BR";
    const extraction = await extractContent(item.url);

    // --- Dead end: not eligible, offline, or unscrapable. Close the item now. ---
    if (!extraction.ok) {
      await supabase
        .from("analysis_items")
        .update({
          status: extraction.status,
          reason: extraction.reason,
          meta: extraction.meta,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      await recordItemOutcome(jobId, false);

      return NextResponse.json({ status: extraction.status, itemId: item.id });
    }

    // Summarization (only for very long pages) happens HERE, once — never inside
    // the per-model workers. Every model must read identical bytes, so what we
    // freeze is the text as the models will actually see it.
    const prepared = await prepareTextForAnalysis(extraction.text, language);
    const contentHash =
      prepared.text === extraction.text
        ? extraction.hash
        : computeContentHash(prepared.text);

    // The panel is whatever the job was created with (getPanel falls back to the
    // configured default when the job predates panel selection).
    const panel = getPanel(job.models ?? undefined);

    await supabase
      .from("analysis_items")
      .update({
        meta: extraction.meta,
        content_snapshot: prepared.text,
        content_hash: contentHash,
        extraction_method: extraction.extractionMethod,
        models_total: panel.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    // --- Stage 2 fan-out: one worker per model, all reading the same snapshot ---
    await publish(
      panel.map((evaluator) => ({
        path: "/api/worker/analyze",
        body: { jobId, itemId: item.id, modelId: evaluator.id },
      }))
    );

    return NextResponse.json({
      status: "extracted",
      itemId: item.id,
      contentHash,
      chars: prepared.text.length,
      models: panel.map((e) => e.id),
    });
  } catch (error) {
    console.error("Extract worker error for job:", jobId, "item:", itemId, error);

    if (jobId && itemId) {
      try {
        const supabase = createAdminClient();
        await supabase
          .from("analysis_items")
          .update({
            status: "scraping_error",
            reason: error instanceof Error ? error.message : String(error),
            updated_at: new Date().toISOString(),
          })
          .eq("id", itemId);

        await recordItemOutcome(jobId, false);
      } catch (e) {
        console.error("Failed to handle extract error gracefully:", e);
      }
    }

    // Reported as handled: the item is already marked failed and counted, so a
    // QStash retry would only double-count.
    return NextResponse.json({ status: "failed" });
  }
}

export async function POST(request: NextRequest) {
  const devBypass = request.headers.get("x-dev-bypass");
  if (devBypass === "1" && !process.env.QSTASH_TOKEN) {
    return handler(request);
  }
  return verifySignatureAppRouter(handler)(request);
}
