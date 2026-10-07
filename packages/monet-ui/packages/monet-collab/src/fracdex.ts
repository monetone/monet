// fracdex — fractional indexing. Generates an ordering key strictly between two
// existing keys, so an item's position is a single value (not an index into a
// list). Two clients inserting/reordering converge: each item's key lives at its
// own slot in a Y.Map (LWW per item), so concurrent edits never duplicate or
// drop an item the way a shared order Y.Array can. Keys are non-empty base-62
// strings compared lexicographically (the alphabet is monotonic by char code:
// 0-9 < A-Z < a-z). Based on the canonical "midpoint" algorithm.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const FIRST = DIGITS[0];

/**
 * A string `m` with `a < m < b` (lexicographic). `a` may be "" (treated as 0);
 * `b` may be null (treated as 1, i.e. no upper bound). Inputs must satisfy
 * `a < b` and be "normalized" (not ending in the first digit), which `keyBetween`
 * guarantees by construction.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Descend through any shared prefix (padding `a` with the lowest digit).
    let n = 0;
    while ((a[n] ?? FIRST) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : BASE;
  if (db - da > 1) {
    return DIGITS[Math.round(0.5 * (da + db))];
  }
  // First digits are consecutive — borrow `b`'s next digit, or descend past `a`.
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return DIGITS[da] + midpoint(a.slice(1), null);
}

/** An ordering key strictly between `a` and `b`. `null` = open end (start/append). */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`keyBetween: a (${a}) must be < b (${b})`);
  }
  if (a === null && b === null) return DIGITS[Math.floor(BASE / 2)];
  if (a === null) return midpoint("", b as string);
  return midpoint(a, b);
}

/** Generate `n` strictly-increasing keys (for seeding a fresh ordered list). */
export function initialKeys(n: number): string[] {
  const out: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const k = keyBetween(prev, null);
    out.push(k);
    prev = k;
  }
  return out;
}
