/**
 * Sanity-checks the infrastructure Phase 1 depends on: Redis round-trip,
 * the Phase 0 snapshot columns, and the Phase 1 model-results table.
 *
 *   npx tsx --env-file=.env.local scripts/verify-infra.ts
 */

import { Redis } from "@upstash/redis";
import { createClient } from "@supabase/supabase-js";

async function main() {
  // --- Redis ---
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });

  try {
    const key = "discern:healthcheck";
    await redis.set(key, { ok: true, at: Date.now() }, { ex: 60 });
    const got = await redis.get<{ ok: boolean }>(key);
    await redis.del(key);
    console.log(got?.ok ? "Redis      : round-trip OK (set/get/del)" : "Redis      : FALHOU (get vazio)");
  } catch (e) {
    console.log(`Redis      : FALHOU — ${e instanceof Error ? e.message : e}`);
  }

  // --- Supabase schema ---
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { error: snapErr } = await supabase
    .from("analysis_items")
    .select("content_snapshot, content_hash, extraction_method")
    .limit(1);
  console.log(
    snapErr
      ? `migration_content_snapshot : FALTANDO — ${snapErr.message}`
      : "migration_content_snapshot : colunas presentes (content_snapshot, content_hash, extraction_method)"
  );

  const { error: mrErr } = await supabase
    .from("analysis_model_results")
    .select("id, item_id, provider, model_id, status, scores, cost, latency_ms")
    .limit(1);
  console.log(
    mrErr
      ? `migration_model_results    : FALTANDO — ${mrErr.message}`
      : "migration_model_results    : tabela analysis_model_results presente"
  );

  const { count } = await supabase
    .from("analysis_model_results")
    .select("*", { count: "exact", head: true });
  console.log(`analysis_model_results     : ${count ?? 0} linha(s) hoje`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
