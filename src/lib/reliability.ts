// src/lib/reliability.ts
//
// Phase 4: inter-rater reliability for the model panel.
//
// DISCERN studies routinely report how well independent raters agreed — usually
// as an intraclass correlation. Treating each LLM as a rater lets this work be
// reported the same way a human-rater study would be, which is what makes the
// multi-model approach defensible in a paper.
//
// Pure functions, no I/O.

/**
 * ICC(2,1) and ICC(2,k): two-way random effects, absolute agreement.
 *
 * Two-way random is the right model here because both the pages (subjects) and
 * the models (raters) are samples from larger populations, and we care about
 * absolute agreement — two models that rank pages identically but sit a point
 * apart have NOT agreed, which is exactly the divergence this project flags.
 *
 * - ICC(2,1) — reliability of a single rater (how much you can trust one model)
 * - ICC(2,k) — reliability of the panel average (what the consensus score is worth)
 */
export type IccResult = {
  /** Reliability of one average model. */
  icc1: number;
  /** Reliability of the k-model mean — the consensus score. */
  iccK: number;
  /** Number of complete observations (rows) used. */
  subjects: number;
  /** Number of raters (models). */
  raters: number;
  /** Koo & Li (2016) bands, applied to ICC(2,k). */
  interpretation: "poor" | "moderate" | "good" | "excellent";
};

export function interpretIcc(icc: number): IccResult["interpretation"] {
  if (icc < 0.5) return "poor";
  if (icc < 0.75) return "moderate";
  if (icc < 0.9) return "good";
  return "excellent";
}

/**
 * `rows` is a subjects x raters matrix: one row per rated thing (here, one per
 * URL x DISCERN item), one column per model, in a consistent order. Rows with
 * any missing rating must be excluded by the caller — ICC needs complete cases.
 *
 * Returns null when there is too little data to estimate (needs >= 2 raters and
 * >= 2 subjects), or when the ratings carry no variance at all.
 */
export function computeIcc(rows: number[][]): IccResult | null {
  const n = rows.length; // subjects
  if (n < 2) return null;
  const k = rows[0]?.length ?? 0; // raters
  if (k < 2) return null;
  if (!rows.every((r) => r.length === k)) return null;

  const all = rows.flat();
  const grandMean = all.reduce((a, b) => a + b, 0) / all.length;

  const rowMeans = rows.map((r) => r.reduce((a, b) => a + b, 0) / k);
  const colMeans = Array.from({ length: k }, (_, j) =>
    rows.reduce((sum, r) => sum + r[j], 0) / n
  );

  // Two-way ANOVA decomposition.
  const ssTotal = all.reduce((sum, v) => sum + (v - grandMean) ** 2, 0);
  const ssRows = k * rowMeans.reduce((sum, m) => sum + (m - grandMean) ** 2, 0);
  const ssCols = n * colMeans.reduce((sum, m) => sum + (m - grandMean) ** 2, 0);
  const ssError = ssTotal - ssRows - ssCols;

  // Perfectly identical ratings: no variance to model, so ICC is undefined
  // rather than 1 — reporting 1.0 here would overstate the evidence.
  if (ssTotal === 0) return null;

  const msRows = ssRows / (n - 1);
  const msCols = ssCols / (k - 1);
  const msError = ssError / ((n - 1) * (k - 1));

  const numerator = msRows - msError;
  const denom1 = msRows + (k - 1) * msError + (k * (msCols - msError)) / n;
  const denomK = msRows + (msCols - msError) / n;

  if (denom1 === 0 || denomK === 0) return null;

  // A non-positive between-subject variance component means the raters carry no
  // shared signal at all — report 0 before dividing. Skipping this check lets a
  // negative numerator over a negative denominator produce a positive ratio
  // (ICC > 1), which is impossible and would read as perfect agreement.
  const raw1 = numerator <= 0 ? 0 : numerator / denom1;
  const rawK = numerator <= 0 ? 0 : numerator / denomK;

  // ICC is a proportion of variance, so it is bounded by [0, 1].
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const round = (v: number) => Math.round(clamp(v) * 1000) / 1000;

  const icc1 = round(raw1);
  const iccK = round(rawK);

  return {
    icc1,
    iccK,
    subjects: n,
    raters: k,
    interpretation: interpretIcc(iccK),
  };
}

/**
 * Builds the ICC matrix from per-item consensus data across a set of analyses.
 *
 * Each (analysis, DISCERN item) pair becomes one subject, so a job of 40 URLs
 * yields up to 640 subjects — plenty to estimate reliability. Only rows where
 * every model in `models` produced a score are kept.
 */
export function buildIccMatrix(
  analyses: { perItem: Record<string, { values: Record<string, number | null> }> }[],
  models: string[]
): number[][] {
  const rows: number[][] = [];

  for (const analysis of analyses) {
    for (const stat of Object.values(analysis.perItem ?? {})) {
      const row = models.map((m) => stat.values?.[m]);
      if (row.every((v) => typeof v === "number" && Number.isFinite(v))) {
        rows.push(row as number[]);
      }
    }
  }

  return rows;
}
