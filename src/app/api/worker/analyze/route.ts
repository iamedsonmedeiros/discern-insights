import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { Client } from "@upstash/qstash";
import { createAdminClient } from "@/lib/supabase-admin";
import { sendCompletionEmail } from "@/lib/email";
import { processUrl } from "@/app/actions";

// Vercel Hobby: max 60 seconds per serverless function
export const maxDuration = 60;

// Process 4 URLs in parallel per invocation — safe within 60s budget
// QStash will re-invoke this worker for each subsequent batch
const BATCH_SIZE = 4;

async function handler(request: NextRequest) {
  let jobId: string | undefined;

  try {
    const body = await request.json();
    jobId = body.jobId;
    const startIndex: number = body.startIndex ?? 0;

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
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

    // If this is the first batch, mark job as processing
    if (startIndex === 0) {
      await supabase
        .from("analysis_jobs")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", jobId);
    }

    // 2. Fetch the next batch of pending items for this job
    const { data: items, error: itemsError } = await supabase
      .from("analysis_items")
      .select("id, url, index")
      .eq("job_id", jobId)
      .eq("status", "pending")
      .order("index", { ascending: true })
      .limit(BATCH_SIZE);

    if (itemsError) {
      console.error("Error fetching items:", jobId, itemsError);
      return NextResponse.json({ error: "Failed to fetch items" }, { status: 500 });
    }

    // 3. Process this batch in parallel
    let completedInBatch = 0;
    let failedInBatch = 0;

    if (items && items.length > 0) {
      // Mark all items in this batch as processing
      await supabase
        .from("analysis_items")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .in("id", items.map((i: { id: string }) => i.id));

      const results = await Promise.allSettled(
        items.map(async (item: { id: string; url: string; index: number }) => {
          const result = await processUrl(item.url, job.language || "pt-BR", true);

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

          return result;
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.status === "completed") {
          completedInBatch++;
        } else {
          failedInBatch++;
        }
      }
    }

    // 4. Update cumulative progress on the job
    const { data: updatedJob } = await supabase
      .from("analysis_jobs")
      .update({
        completed_urls: (job.completed_urls || 0) + completedInBatch,
        failed_urls: (job.failed_urls || 0) + failedInBatch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .select()
      .single();

    const currentCompleted = (updatedJob?.completed_urls ?? 0);
    const currentFailed = (updatedJob?.failed_urls ?? 0);
    const processedSoFar = currentCompleted + currentFailed;

    // 5. Check if there are more pending items for this job
    const { count: pendingCount } = await supabase
      .from("analysis_items")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("status", "pending");

    const hasMore = (pendingCount ?? 0) > 0;

    if (hasMore) {
      // 6a. Chain to the next batch via QStash
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
      const workerUrl = `${appUrl}/api/worker/analyze`;

      if (process.env.QSTASH_TOKEN) {
        const qstash = new Client({ token: process.env.QSTASH_TOKEN });
        await qstash.publishJSON({
          url: workerUrl,
          body: { jobId, startIndex: startIndex + BATCH_SIZE },
          timeout: 60,
        });
      } else {
        // Dev fallback: call next batch directly (fire and forget)
        fetch(workerUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-dev-bypass": "1" },
          body: JSON.stringify({ jobId, startIndex: startIndex + BATCH_SIZE }),
        }).catch((e) => console.error("Chained worker call failed:", e));
      }

      return NextResponse.json({
        jobId,
        batchProcessed: items?.length ?? 0,
        processedSoFar,
        totalUrls: job.total_urls,
        status: "chaining_next_batch",
      });
    } else {
      // 6b. All items processed — mark job as done
      await supabase
        .from("analysis_jobs")
        .update({
          status: "done",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      // Send completion email (non-fatal)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
      try {
        await sendCompletionEmail(job.user_email, {
          totalUrls: job.total_urls,
          completedUrls: currentCompleted,
          failedUrls: currentFailed,
          appUrl,
        });
      } catch (emailError) {
        console.error("Failed to send completion email:", emailError);
      }

      return NextResponse.json({
        jobId,
        totalUrls: job.total_urls,
        completedUrls: currentCompleted,
        failedUrls: currentFailed,
        status: "done",
      });
    }
  } catch (error) {
    console.error("Worker error for job:", jobId, error);

    if (jobId) {
      try {
        const supabase = createAdminClient();
        await supabase
          .from("analysis_jobs")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", jobId);
      } catch (e) {
        console.error("Failed to mark job as failed:", e);
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
