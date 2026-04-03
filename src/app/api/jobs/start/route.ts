import { NextRequest, NextResponse } from "next/server";
import { Client } from "@upstash/qstash";
import { createClient } from "@/lib/supabase-server";

// Vercel Hobby: max 30 seconds should be plenty for job creation
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { language = "pt-BR", keyword = "" } = await request.json().catch(() => ({}));

    // 1. Fetch all pending items for this user
    const { data: pendingItems, error: fetchError } = await supabase
      .from("analysis_items")
      .select("id, url, index")
      .eq("user_id", user.id)
      .eq("status", "pending");

    if (fetchError) {
      console.error("Error fetching pending items:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch pending items" },
        { status: 500 }
      );
    }

    if (!pendingItems || pendingItems.length === 0) {
      return NextResponse.json(
        { error: "No pending items to process" },
        { status: 400 }
      );
    }

    // 2. Create a new analysis job record
    const { data: job, error: jobError } = await supabase
      .from("analysis_jobs")
      .insert({
        user_id: user.id,
        user_email: user.email,
        total_urls: pendingItems.length,
        completed_urls: 0,
        failed_urls: 0,
        status: "pending",
        language,
        keyword,
      })
      .select()
      .single();

    if (jobError || !job) {
      console.error("Error creating analysis job:", jobError);
      return NextResponse.json(
        { error: "Failed to create job" },
        { status: 500 }
      );
    }

    // 3. Stamp all pending items with the job_id
    const { error: stampError } = await supabase
      .from("analysis_items")
      .update({ job_id: job.id })
      .eq("user_id", user.id)
      .eq("status", "pending");

    if (stampError) {
      console.error("Error stamping items with job_id:", stampError);
      // Non-fatal — continue
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
    const workerUrl = `${appUrl}/api/worker/analyze`;

    // 4. Publish to QStash (if token is configured), otherwise call worker directly
    if (process.env.QSTASH_TOKEN) {
      const qstash = new Client({ token: process.env.QSTASH_TOKEN });
      await qstash.publishJSON({
        url: workerUrl,
        body: { jobId: job.id },
        // Give the worker 5 minutes to complete
        timeout: 300,
      });
    } else {
      // Development fallback: call worker directly (fire and forget)
      fetch(workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-dev-bypass": "1" },
        body: JSON.stringify({ jobId: job.id }),
      }).catch((e) => console.error("Direct worker call failed:", e));
    }

    return NextResponse.json({ jobId: job.id, totalUrls: pendingItems.length });
  } catch (error) {
    console.error("Error in /api/jobs/start:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
