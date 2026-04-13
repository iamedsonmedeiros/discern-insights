import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { createAdminClient } from "@/lib/supabase-admin";
import { sendCompletionEmail } from "@/lib/email";
import { processUrl } from "@/app/actions";

// Vercel Hobby: max 60 seconds per serverless function
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

    // 1. Fetch the job
    const { data: job, error: jobError } = await supabase
      .from("analysis_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      console.error("Job not found:", jobId, jobError);
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // 2. Idempotency guard: claim item only if still pending (compare-and-swap)
    const { data: item } = await supabase
      .from("analysis_items")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("status", "pending")
      .select("id, url, index")
      .single();

    if (!item) {
      // Already claimed or processed — safe to skip (QStash retry or duplicate)
      return NextResponse.json({ status: "skipped", reason: "already_claimed" });
    }

    // 3. Process the URL
    const result = await processUrl(item.url, job.language || "pt-BR", true);

    // 4. Update item with result
    await supabase
      .from("analysis_items")
      .update({
        status: result.status,
        reason: result.reason ?? null,
        meta: result.meta ?? null,
        discern_result: result.discernResult ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    // 5. Atomic counter increment via RPC
    const isCompleted = result.status === "completed";
    const rpcName = isCompleted ? "increment_completed" : "increment_failed";
    const { data: counters, error: rpcError } = await supabase.rpc(rpcName, { p_job_id: jobId });

    if (rpcError) {
      console.error("RPC counter error:", rpcError);
      return NextResponse.json({ error: "Counter update failed" }, { status: 500 });
    }

    // 6. Check if this worker is the last one (job completion detection)
    const { completed_urls, failed_urls, total_urls } = counters[0];
    const processedSoFar = completed_urls + failed_urls;

    if (processedSoFar >= total_urls) {
      // This is the last worker — finalize job
      await supabase
        .from("analysis_jobs")
        .update({ status: "done", updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("status", "processing"); // guard: only if still processing

      // Send completion email (non-fatal)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
      try {
        await sendCompletionEmail(job.user_email, {
          totalUrls: total_urls,
          completedUrls: completed_urls,
          failedUrls: failed_urls,
          appUrl,
        });
      } catch (emailError) {
        console.error("Failed to send completion email:", emailError);
      }

      return NextResponse.json({
        jobId,
        itemId: item.id,
        status: "done",
        totalUrls: total_urls,
        completedUrls: completed_urls,
        failedUrls: failed_urls,
      });
    }

    return NextResponse.json({
      jobId,
      itemId: item.id,
      status: "processed",
      processedSoFar,
      totalUrls: total_urls,
    });
  } catch (error) {
    console.error("Worker error for job:", jobId, "item:", itemId, error);

    if (jobId && itemId) {
      try {
        const supabase = createAdminClient();

        // Mark only this item as failed
        await supabase
          .from("analysis_items")
          .update({
            status: "analysis_error",
            reason: error instanceof Error ? error.message : String(error),
            updated_at: new Date().toISOString(),
          })
          .eq("id", itemId);

        // Atomic increment of failed counter + check completion
        const { data: counters } = await supabase.rpc("increment_failed", { p_job_id: jobId });

        if (counters && counters[0]) {
          const { completed_urls, failed_urls, total_urls } = counters[0];
          if (completed_urls + failed_urls >= total_urls) {
            const { data: job } = await supabase
              .from("analysis_jobs")
              .select("user_email")
              .eq("id", jobId)
              .single();

            await supabase
              .from("analysis_jobs")
              .update({ status: "done", updated_at: new Date().toISOString() })
              .eq("id", jobId)
              .eq("status", "processing");

            if (job?.user_email) {
              const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
              await sendCompletionEmail(job.user_email, {
                totalUrls: total_urls,
                completedUrls: completed_urls,
                failedUrls: failed_urls,
                appUrl,
              }).catch((e) => console.error("Failed to send completion email:", e));
            }
          }
        }
      } catch (e) {
        console.error("Failed to handle worker error gracefully:", e);
      }
    }

    return NextResponse.json({ error: "Worker failed" }, { status: 500 });
  }
}

// Verify QStash signature in production, bypass in local dev
export async function POST(request: NextRequest) {
  const devBypass = request.headers.get("x-dev-bypass");
  if (devBypass === "1" && !process.env.QSTASH_TOKEN) {
    return handler(request);
  }
  return verifySignatureAppRouter(handler)(request);
}
