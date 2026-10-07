// ─────────────────────────────────────────────────────────────
// Color panel spectrum ramp — pure mapping for Photoshop's RGB Spectrum bar.
// A horizontal position (0..1) maps to a full-saturation rainbow colour; clicking
// the ramp sets the foreground to it. Engine-free (type-only HSV import) so it
// unit-tests in node; ColorPanel feeds it offsetX / strip width.
// ─────────────────────────────────────────────────────────────

import type { HSV } from "./hsv";

/** The RGB-spectrum colour at a horizontal position (0..1): a full-saturation,
 *  full-value rainbow hue. Positions outside [0,1] clamp to the ends. */
export function rampColorAt(fraction: number): HSV {
  const f = Math.max(0, Math.min(1, fraction));
  return { h: Math.round(f * 360), s: 1, v: 1, a: 1 };
}

// Photoshop's Color-panel ramp types (flyout): the strip the foreground is picked from.
export type RampMode = "spectrum" | "grayscale" | "current";

export interface RampModeOption {
  value: RampMode;
  label: string;
}

export const RAMP_MODES: RampModeOption[] = [
  { value: "spectrum", label: "Spectrum" },
  { value: "grayscale", label: "Grayscale" },
  { value: "current", label: "Current Colors" },
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The colour at a horizontal position (0..1) for the chosen ramp mode: spectrum =
 *  rainbow hue (rampColorAt); grayscale = black→white; current = foreground→background. */
export function rampColor(mode: RampMode, fraction: number, fg: HSV, bg: HSV): HSV {
  const f = Math.max(0, Math.min(1, fraction));
  if (mode === "grayscale") return { h: 0, s: 0, v: round2(f), a: 1 };
  if (mode === "current") return { h: Math.round(lerp(fg.h, bg.h, f)), s: round2(lerp(fg.s, bg.s, f)), v: round2(lerp(fg.v, bg.v, f)), a: 1 };
  return rampColorAt(f);
}
