/**
 * The page itself, ignoring the click-tracking query Google and other sites
 * append. Two rows that differ only by `srsltid` are the same publication:
 * the first position is analyzed, and the later one repeats that score.
 */

const TRACKING_PARAMS = new Set([
  "srsltid",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "dclid",
  "msclkid",
  "twclid",
  "igshid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
]);

export function pageKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const drop: string[] = [];
    parsed.searchParams.forEach((_, key) => {
      const name = key.toLowerCase();
      if (name.startsWith("utm_") || TRACKING_PARAMS.has(name)) drop.push(key);
    });
    for (const key of drop) parsed.searchParams.delete(key);
    parsed.searchParams.sort();
    const path = parsed.pathname.replace(/\/$/, "") || "/";
    const query = parsed.searchParams.toString();
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${query ? `?${query}` : ""}`;
  } catch {
    return url.trim().replace(/\/$/, "");
  }
}
