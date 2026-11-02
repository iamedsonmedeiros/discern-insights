/**
 * A short, stable label for one analysis, derived from its id.
 * The same job always shows the same code, including analyses created before this existed.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function jobCode(id: string): string {
  let n = BigInt(`0x${id.replace(/-/g, "").slice(0, 10)}`);
  let code = "";
  for (let i = 0; i < 5; i++) {
    code = ALPHABET[Number(n % BigInt(ALPHABET.length))] + code;
    n /= BigInt(ALPHABET.length);
  }
  return code;
}
