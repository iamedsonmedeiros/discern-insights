/**
 * Reports on the most recent jobs and their per-model results — used to confirm
 * that a production run actually fanned out to the full model panel.
 *
 *   npx tsx --env-file=.env.local scripts/check-prod-run.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  const { data: jobs } = await supabase
    .from("analysis_jobs")
    .select("id, keyword, status, total_urls, completed_urls, failed_urls, models, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  console.log("\nMost recent jobs:");
  for (const j of jobs ?? []) {
    const when = new Date(j.created_at).toLocaleString();
    console.log(
      `  ${when}  ${j.status.padEnd(10)} ${j.completed_urls}/${j.total_urls} ok, ${j.failed_urls} failed` +
        `  panel=${j.models ? j.models.map((m: string) => m.split("/").pop()).join("+") : "(none recorded)"}` +
        `  "${j.keyword ?? ""}"`
    );

    const { data: items } = await supabase
      .from("analysis_items")
      .select("id, url, models_total, divergence_flag, divergent_items, panel_incomplete")
      .eq("job_id", j.id)
      .limit(3);

    for (const it of items ?? []) {
      const { count } = await supabase
        .from("analysis_model_results")
        .select("*", { count: "exact", head: true })
        .eq("item_id", it.id);
      console.log(
        `      ${it.url.slice(0, 58)}  models=${count}/${it.models_total ?? "?"}` +
          `  divergence=${it.divergence_flag}` +
          `${it.divergent_items ? ` ${JSON.stringify(it.divergent_items)}` : ""}` +
          `${it.panel_incomplete ? "  INCOMPLETE" : ""}`
      );
    }
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
