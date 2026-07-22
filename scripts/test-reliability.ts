/**
 * Unit tests for the ICC math.
 *
 *   npx tsx scripts/test-reliability.ts
 */

import { computeIcc, buildIccMatrix, interpretIcc } from "@/lib/reliability";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

console.log("\nKnown reference dataset (Shrout & Fleiss 1979, the canonical ICC example):");
{
  // 6 subjects x 4 raters. The published ICC(2,1) for this matrix is 0.290
  // and ICC(2,k) is 0.620. Testing against a value from the literature is what
  // proves the implementation, rather than merely being self-consistent.
  const data = [
    [9, 2, 5, 8],
    [6, 1, 3, 2],
    [8, 4, 6, 8],
    [7, 1, 2, 6],
    [10, 5, 6, 9],
    [6, 2, 4, 7],
  ];
  const r = computeIcc(data)!;
  console.log(`    computed ICC(2,1)=${r.icc1}  ICC(2,k)=${r.iccK}  (expected 0.290 / 0.620)`);
  check("ICC(2,1) matches the published 0.290", near(r.icc1, 0.29), `got ${r.icc1}`);
  check("ICC(2,k) matches the published 0.620", near(r.iccK, 0.62), `got ${r.iccK}`);
  check("reports 6 subjects, 4 raters", r.subjects === 6 && r.raters === 4);
}

console.log("\nPerfect agreement:");
{
  const r = computeIcc([
    [5, 5],
    [3, 3],
    [1, 1],
    [4, 4],
  ])!;
  check("ICC is ~1", near(r.iccK, 1, 0.001), `got ${r.iccK}`);
  check("interpreted as excellent", r.interpretation === "excellent");
}

console.log("\nSystematic disagreement (one model always 2 points higher):");
{
  // Raters rank identically but never agree in absolute terms. Absolute-agreement
  // ICC must penalise this — a consistency-based ICC would wrongly report ~1.
  const r = computeIcc([
    [1, 3],
    [2, 4],
    [3, 5],
    [1, 3],
    [2, 4],
  ])!;
  console.log(`    ICC(2,k)=${r.iccK}`);
  check("absolute agreement is penalised (not ~1)", r.iccK < 0.95, `got ${r.iccK}`);
}

console.log("\nNo agreement (raters unrelated):");
{
  const r = computeIcc([
    [1, 5],
    [5, 1],
    [1, 5],
    [5, 1],
  ])!;
  check("ICC floors at 0, never negative", r.iccK >= 0, `got ${r.iccK}`);
  check("interpreted as poor", r.interpretation === "poor");
}

console.log("\nGuards:");
{
  check("single rater yields null", computeIcc([[1], [2], [3]]) === null);
  check("single subject yields null", computeIcc([[1, 2]]) === null);
  check("empty yields null", computeIcc([]) === null);
  check("all-identical ratings yield null (no variance)", computeIcc([[3, 3], [3, 3]]) === null);
  check("ragged rows yield null", computeIcc([[1, 2], [1]]) === null);
}

console.log("\nInterpretation bands (Koo & Li 2016):");
{
  check("0.4 -> poor", interpretIcc(0.4) === "poor");
  check("0.6 -> moderate", interpretIcc(0.6) === "moderate");
  check("0.8 -> good", interpretIcc(0.8) === "good");
  check("0.95 -> excellent", interpretIcc(0.95) === "excellent");
}

console.log("\nMatrix building from consensus data:");
{
  const analyses: { perItem: Record<string, { values: Record<string, number> }> }[] = [
    {
      perItem: {
        item01: { values: { a: 5, b: 4 } },
        item02: { values: { a: 3, b: 3 } },
        item03: { values: { a: 2 } }, // b missing -> excluded
      },
    },
    { perItem: { item01: { values: { a: 4, b: 5 } } } },
  ];
  const m = buildIccMatrix(analyses, ["a", "b"]);
  check("keeps only complete rows", m.length === 3, `got ${m.length}`);
  check("preserves model column order", m[0][0] === 5 && m[0][1] === 4);
}

console.log(failures === 0 ? "\nAll reliability tests passed.\n" : `\n${failures} test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
