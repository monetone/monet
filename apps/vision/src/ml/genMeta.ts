// ─────────────────────────────────────────────────────────────
// genMeta.ts — "Generate Similar" seed re-roll (pure; unit-tested).
// A generated document carries the GenerateOpts that produced it; a
// similar-variation re-roll keeps every setting but draws a fresh seed
// (generation is seed-deterministic, so a new seed = a new variation).
// ─────────────────────────────────────────────────────────────
import type { GenerateOpts } from "./diffusion";

export function similarOpts(
  meta: GenerateOpts | null,
  roll: () => number = Math.random,
): GenerateOpts | null {
  if (!meta) return null;
  let seed = Math.floor(roll() * 1_000_000);
  if (seed === meta.seed) seed += 1; // a re-roll must actually change the image
  return { ...meta, seed };
}
