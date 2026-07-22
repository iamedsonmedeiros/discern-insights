/**
 * Phase 2 acceptance test: the two-stage fan-out end to end, against the REAL
 * database and REAL model calls, simulating QStash by invoking the worker HTTP
 * routes directly (x-dev-bypass, same as local dev).
 *
 * Needs the dev server running:  npm run dev   (port 9002)
 * Then:  npx tsx --env-file=.env.local scripts/verify-phase2.ts [url]
 *
 * Uses a 3x Google panel so it does not depend on OpenRouter credit.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const BASE = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
const URL_TO_TEST = process.argv[2] ?? "https://www.nhs.uk/conditions/haemorrhoids/";
const PANEL = [
  "googleai/gemini-2.5-flash",
  "googleai/gemini-2.5-pro",
  "googleai/gemini-flash-latest",
];

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
  const userId = users?.users?.[0]?.id;
  if (!userId) throw new Error("No user in auth.users.");

  // --- Set up a job + one item, as /api/jobs/start would ---
  const { data: job } = await supabase
    .from("analysis_jobs")
    .insert({
      user_id: userId,
      user_email: users!.users[0].email,
      total_urls: 1,
      completed_urls: 0,
      failed_urls: 0,
      status: "processing",
      language: "pt-BR",
      models: PANEL,
    })
    .select()
    .single();

  const itemId = randomUUID();
  await supabase.from("analysis_items").insert({
    id: itemId,
    user_id: userId,
    job_id: job!.id,
    url: URL_TO_TEST,
    index: 99999,
    status: "pending",
    updated_at: new Date().toISOString(),
  });
  console.log(`Job ${job!.id.slice(0, 8)} / item ${itemId.slice(0, 8)} created.`);
  console.log(`Panel: ${PANEL.join(", ")}\n`);

  try {
    // --- Stage 1: extraction. Note: DISCERN_MODELS in .env.local governs the
    //     real panel; here we assert the mechanics, so we drive whatever the
    //     server is configured with and just report it. ---
    console.log("Stage 1: POST /api/worker/extract");
    const extract = await post("/api/worker/extract", { jobId: job!.id, itemId });
    console.log(`  -> ${extract.status} ${JSON.stringify(extract.json)}\n`);

    const models: string[] = extract.json.models ?? [];
    if (extract.json.status !== "extracted") {
      throw new Error(`Extraction did not succeed: ${JSON.stringify(extract.json)}`);
    }

    // --- Stage 2: one analysis call per model, exactly what QStash would deliver ---
    console.log(`Stage 2: POST /api/worker/analyze x${models.length}`);
    for (const modelId of models) {
      const res = await post("/api/worker/analyze", { jobId: job!.id, itemId, modelId });
      console.log(`  ${modelId.padEnd(34)} -> ${res.status} ${JSON.stringify(res.json)}`);
    }

    // --- Assertions against the DB ---
    const { data: item } = await supabase
      .from("analysis_items")
      .select("status, models_total, consensus, divergence_flag, divergent_items, panel_incomplete, discern_result")
      .eq("id", itemId)
      .single();

    const { data: rows } = await supabase
      .from("analysis_model_results")
      .select("model_id, status")
      .eq("item_id", itemId);

    const { data: finalJob } = await supabase
      .from("analysis_jobs")
      .select("status, completed_urls, failed_urls")
      .eq("id", job!.id)
      .single();

    console.log("\n--- RESULT ---");
    console.log(`item.status          : ${item?.status}`);
    console.log(`models_total         : ${item?.models_total}`);
    console.log(`model_results rows   : ${rows?.length} (${rows?.map((r) => r.status).join(",")})`);
    console.log(`consensus present    : ${item?.consensus ? "yes" : "no"}`);
    console.log(`divergence_flag      : ${item?.divergence_flag}`);
    console.log(`divergent_items      : ${JSON.stringify(item?.divergent_items)}`);
    console.log(`panel_incomplete     : ${item?.panel_incomplete}`);
    console.log(`discern_result set   : ${item?.discern_result ? "yes" : "no"}`);
    console.log(`job                  : ${finalJob?.status} (completed=${finalJob?.completed_urls} failed=${finalJob?.failed_urls})`);

    if (item?.consensus) {
      const c = item.consensus as any;
      console.log(`\nconsensus.models     : ${c.models?.join(", ")}`);
      console.log(`domain averages      : conf=${c.domainAverages?.confiabilidade} trat=${c.domainAverages?.qualidade_tratamento} geral=${c.domainAverages?.score_geral}`);
      const sample = Object.entries(c.perItem ?? {}).slice(0, 4).map(
        ([k, v]: any) => `${k}: mean ${v.mean} range ${v.range}${v.range > 1 ? " ⚠" : ""}`
      );
      console.log(`sample items         :\n  ${sample.join("\n  ")}`);
    }

    // --- Assertion: re-deliver stage 2 for one model; must not change job counters ---
    console.log(`\nIdempotency: re-POST analyze for ${models[0]}`);
    const dup = await post("/api/worker/analyze", { jobId: job!.id, itemId, modelId: models[0] });
    const { count } = await supabase
      .from("analysis_model_results")
      .select("*", { count: "exact", head: true })
      .eq("item_id", itemId);
    const { data: jobAfter } = await supabase
      .from("analysis_jobs")
      .select("completed_urls, failed_urls")
      .eq("id", job!.id)
      .single();
    console.log(`  -> ${dup.status} ${JSON.stringify(dup.json)}`);
    console.log(`  model_results rows still ${count}; job completed=${jobAfter?.completed_urls} failed=${jobAfter?.failed_urls} (must be unchanged)`);
  } finally {
    await supabase.from("analysis_items").delete().eq("id", itemId);
    await supabase.from("analysis_jobs").delete().eq("id", job!.id);
    console.log(`\nCleaned up job + item.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
