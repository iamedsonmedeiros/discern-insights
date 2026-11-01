import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

import { reconcileStalledItem } from "@/lib/jobs";

// Closes an item that is still processing because one model never wrote a row.
export const maxDuration = 30;

async function handler(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const jobId = body.jobId as string | undefined;
  const itemId = body.itemId as string | undefined;
  if (!jobId || !itemId) {
    return NextResponse.json({ error: "Missing jobId or itemId" }, { status: 400 });
  }

  try {
    const outcome = await reconcileStalledItem(jobId, itemId);
    return NextResponse.json({ jobId, itemId, ...outcome });
  } catch (error) {
    console.error("Reconcile error:", jobId, itemId, error);
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const devBypass = request.headers.get("x-dev-bypass");
  if (devBypass === "1" && !process.env.QSTASH_TOKEN) {
    return handler(request);
  }
  return verifySignatureAppRouter(handler)(request);
}
