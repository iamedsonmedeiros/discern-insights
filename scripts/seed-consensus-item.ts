/**
 * Seeds ONE real completed item with a multi-model consensus for the first
 * auth user, by driving the actual extract + analyze worker routes (dev bypass),
 * then prints the itemId. Used to verify the Phase 3 UI against real data.
 *
 * Dev server must be running with QSTASH_TOKEN unset.
 *   npx tsx --env-file=.env.local scripts/seed-consensus-item.ts [url]
 *
 * Prints the itemId. Does NOT clean up — the item is meant to be viewed in the UI.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const BASE = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
const URL_TO_TEST = process.argv[2] ?? "https://www.nhs.uk/conditions/haemorrhoids/";
const PANEL = ["googleai/gemini-2.5-flash", "openai/gpt-5.6-luna", "x-ai/grok-4.5"];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dev-bypass": "1" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

async function main() {
  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users?.users?.[0];
  if (!user) throw new Error("No user in auth.users.");

  const { data: job } = await supabase
    .from("analysis_jobs")
    .insert({
      user_id: user.id,
      user_email: user.email,
      total_urls: 1,
      completed_urls: 0,
      failed_urls: 0,
      status: "processing",
      language: "pt-BR",
      keyword: "DEMO Consenso (Fase 3)",
      models: PANEL,
    })
    .select()
    .single();

  const itemId = randomUUID();
  await supabase.from("analysis_items").insert({
    id: itemId,
    user_id: user.id,
    job_id: job!.id,
    url: URL_TO_TEST,
    index: 0,
    status: "pending",
    updated_at: new Date().toISOString(),
  });

  console.log(`Seeding item ${itemId} for ${user.email} with panel ${PANEL.join(", ")}`);

  const extract = await post("/api/worker/extract", { jobId: job!.id, itemId });
  const models: string[] = extract.json.models ?? [];
  console.log(`extract -> ${extract.json.status}, models: ${models.join(", ")}`);

  for (const modelId of models) {
    const res = await post("/api/worker/analyze", { jobId: job!.id, itemId, modelId });
    console.log(`  ${modelId} -> ${res.json.status}`);
  }

  const { data: item } = await supabase
    .from("analysis_items")
    .select("status, divergence_flag, divergent_items, panel_incomplete, consensus")
    .eq("id", itemId)
    .single();

  console.log(`\nSEEDED itemId=${itemId}`);
  console.log(`status=${item?.status} divergence=${item?.divergence_flag} divergent=${JSON.stringify(item?.divergent_items)} incomplete=${item?.panel_incomplete}`);
  console.log(`consensus.models=${JSON.stringify((item?.consensus as any)?.models)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
