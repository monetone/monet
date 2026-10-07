// ─────────────────────────────────────────────────────────────
// engine/generate/rng — deterministic PRNG
// ─────────────────────────────────────────────────────────────
// A seeded generator so noise (and any randomised generator) is reproducible
// in tests and across undo/redo. mulberry32 is tiny, fast and good enough for
// audio noise.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform random in [-1, 1] from a 0..1 generator. */
export function bipolar(rand: () => number): number {
  return rand() * 2 - 1;
}
