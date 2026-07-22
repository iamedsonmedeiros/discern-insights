/**
 * Computes inter-rater reliability (ICC) for a job's model panel, from the
 * consensus data already stored on its items.
 *
 *   npx tsx --env-file=.env.local scripts/report-reliability.ts [jobId]
 *
 * With no jobId, uses the most recent job that has consensus data.
 */

import { createClient } from "@supabase/supabase-js";
import { computeIcc, buildIccMatrix, interpretIcc } from "@/lib/reliability";
import type { Consensus } from "@/lib/consensus";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  let jobId = process.argv[2];

  if (!jobId) {
    const { data } = await supabase
      .from("analysis_items")
      .select("job_id")
      .not("consensus", "is", null)
      .not("job_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1);
    jobId = data?.[0]?.job_id;
    if (!jobId) {
      console.log("No job with consensus data found yet.");
      return;
    }
  }

  const { data: job } = await supabase
    .from("analysis_jobs")
    .select("keyword, models, total_urls")
    .eq("id", jobId)
    .single();

  const { data: items } = await supabase
    .from("analysis_items")
    .select("url, consensus")
    .eq("job_id", jobId)
    .not("consensus", "is", null);

  const analyses = (items ?? []).map((i) => i.consensus as unknown as Consensus);
  if (analyses.length === 0) {
    console.log("That job has no consensus data.");
    return;
  }

  // Use the models common to every analysis, so the matrix is complete.
  const models = (job?.models ?? analyses[0].models).filter((m: string) =>
    analyses.every((a) => a.models.includes(m))
  );

  console.log(`\nJob: "${job?.keyword ?? jobId}"`);
  console.log(`Analyses with consensus: ${analyses.length}`);
  console.log(`Models compared: ${models.join(", ")}\n`);

  const matrix = buildIccMatrix(analyses, models);
  const icc = computeIcc(matrix);

  if (!icc) {
    console.log("Not enough complete data to estimate ICC.");
    return;
  }

  console.log("INTER-RATER RELIABILITY (two-way random, absolute agreement)");
  console.log(`  observations (URL x DISCERN item) : ${icc.subjects}`);
  console.log(`  raters (models)                   : ${icc.raters}`);
  console.log(`  ICC(2,1)  single model            : ${icc.icc1.toFixed(3)}`);
  console.log(`  ICC(2,k)  panel consensus         : ${icc.iccK.toFixed(3)}  (${icc.interpretation})`);
  // Each figure gets its own band — icc1 and iccK routinely land in different
  // ones, and that gap is the whole argument for using a panel.
  console.log(
    `\n  Reading: one model alone is ${interpretIcc(icc.icc1)} (${icc.icc1.toFixed(3)}); ` +
      `the ${icc.raters}-model consensus is ${interpretIcc(icc.iccK)} (${icc.iccK.toFixed(3)}).`
  );

  // Divergence summary, for context alongside the ICC.
  const totalItems = analyses.length * 16;
  const diverging = analyses.reduce((n, a) => n + (a.divergentItems?.length ?? 0), 0);
  console.log(
    `\n  Items where models disagreed by > 1 point: ${diverging}/${totalItems} ` +
      `(${((diverging / totalItems) * 100).toFixed(1)}%)\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
