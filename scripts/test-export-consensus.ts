/**
 * Verifies the long-format consensus CSV against REAL consensus data pulled from
 * the database. Stubs the browser download APIs and captures what would be written.
 *
 *   npx tsx --env-file=.env.local scripts/test-export-consensus.ts
 */

import { createClient } from "@supabase/supabase-js";

let captured = "";

// Minimal DOM stubs so the browser-targeted export function can run in node.
(globalThis as any).Blob = class {
  constructor(parts: string[]) {
    captured = parts.join("");
  }
};
// Attach to the real URL class — replacing it wholesale would strip the
// constructor that other libraries (like supabase-js) rely on.
(URL as any).createObjectURL = () => "blob:stub";
(globalThis as any).document = {
  createElement: () => ({ setAttribute() {}, click() {}, style: {} }),
  body: { appendChild() {}, removeChild() {} },
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

async function main() {
  const { exportConsensusCsv } = await import("@/lib/utils");

  const { data } = await supabase
    .from("analysis_items")
    .select("url, meta, consensus")
    .not("consensus", "is", null)
    .limit(3);

  if (!data?.length) {
    console.log("No consensus data in the database to export.");
    return;
  }

  const items = data.map((d, i) => ({
    id: String(i),
    index: i,
    url: d.url,
    status: "completed" as const,
    updatedAt: new Date().toISOString(),
    meta: d.meta as any,
    consensus: d.consensus as any,
  }));

  exportConsensusCsv(items as any, "test");

  const lines = captured.replace(/^﻿/, "").split("\n");
  const header = lines[0].split(",");
  const models: string[] = items[0].consensus.models;

  console.log(`\nGenerated CSV: ${lines.length - 1} data rows, ${header.length} columns`);
  console.log(`Header: ${lines[0].slice(0, 120)}...\n`);

  check("one row per (analysis x 16 items)", lines.length - 1 === items.length * 16,
    `got ${lines.length - 1}, expected ${items.length * 16}`);
  check("has a score column per model",
    models.every((m) => header.includes(`score_${m}`)),
    `header: ${header.filter((h) => h.startsWith("score_")).join("|")}`);
  check("has consensus statistics columns",
    ["consensus_mean", "sd", "min", "max", "range", "diverged"].every((c) => header.includes(c)));

  // Every data row must have exactly as many fields as the header. Naive CSV
  // building breaks here the moment a question or title contains a comma.
  const badRows = lines.slice(1).filter((line) => {
    const fields = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [];
    return fields.length - 1 !== header.length;
  });
  check("every row has the header's field count (commas escaped)", badRows.length === 0,
    `${badRows.length} malformed row(s)`);

  const divergedRows = lines.slice(1).filter((l) => l.includes(",yes,"));
  check("divergence is marked on some row", divergedRows.length > 0,
    "no row flagged as diverged — expected at least one");

  console.log("\nSample row (a diverged item):");
  console.log(`  ${divergedRows[0]?.slice(0, 160) ?? "(none)"}`);

  console.log(failures === 0 ? "\nExport checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
