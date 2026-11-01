import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { publish } from "@/lib/queue";
import { getAvailableModels } from "@/ai/evaluators";

// Vercel Hobby: max 30 seconds should be plenty for job creation
export const maxDuration = 30;

// How many workers run in parallel at any given time
const PARALLEL_LIMIT = 5;
// Seconds between each group of parallel workers
const STAGGER_DELAY_SECONDS = 3;

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

    const {
      language = "pt-BR",
      keyword = "",
      models: requestedModels,
    } = await request.json().catch(() => ({}));

    // The panel the user picked, intersected with what this deployment allows —
    // never trust an arbitrary model id from the client. Empty selection falls
    // back to the full available panel.
    const allowed = getAvailableModels().map((m) => m.id);
    const selected = Array.isArray(requestedModels)
      ? allowed.filter((id) => requestedModels.includes(id))
      : allowed;
    const panel = (selected.length > 0 ? selected : allowed);

    // 1. Fetch all pending items for this user
    const { data: pendingItems, error: fetchError } = await supabase
      .from("analysis_items")
      .select("id, url, index")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("index", { ascending: true });

    if (fetchError) {
      console.error("Error fetching pending items:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch pending items" },
        { status: 500 }
      );
    }

    if (!pendingItems || pendingItems.length === 0) {
      return NextResponse.json(
        { error: `No pending items found in database for user ${user.id.substring(0, 8)}... Please ensure items are imported and not already processing.` },
        { status: 400 }
      );
    }

    // 2. Create a new analysis job record (status = processing immediately).
    //    The panel is stamped on the job: which models judged a page is part of
    //    the result, not an environment detail.
    const { data: job, error: jobError } = await supabase
      .from("analysis_jobs")
      .insert({
        user_id: user.id,
        user_email: user.email,
        total_urls: pendingItems.length,
        completed_urls: 0,
        failed_urls: 0,
        status: "processing",
        language,
        keyword,
        models: panel,
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

    // One extraction per address. A URL that already appeared earlier keeps its
    // row, in order, and receives that score when the first position finishes.
    const seenUrl = new Set<string>();
    const firstPositions = pendingItems.filter((item) => {
      if (seenUrl.has(item.url)) return false;
      seenUrl.add(item.url);
      return true;
    });

    await publish(
      firstPositions.map((item, i) => ({
        path: "/api/worker/extract",
        body: { jobId: job.id, itemId: item.id },
        delaySeconds: Math.floor(i / PARALLEL_LIMIT) * STAGGER_DELAY_SECONDS,
      }))
    );

    return NextResponse.json({
      jobId: job.id,
      totalUrls: pendingItems.length,
      models: panel,
    });
  } catch (error) {
    console.error("Error in /api/jobs/start:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
