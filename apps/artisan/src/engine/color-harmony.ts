// ─────────────────────────────────────────────────────────────
// engine/color-harmony — Color Guide harmony rules (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Illustrator's Color Guide derives a palette from a base colour by rotating its
// HUE on the colour wheel (saturation + brightness preserved). Each rule is a set
// of fixed hue offsets in degrees; 0° is the base colour itself.

import { type RGBA, rgbToHsv, hsvToRgb } from "./color";

export type HarmonyRule = "complementary" | "analogous" | "triadic" | "tetradic" | "split-complementary";

export const HARMONY_RULES: HarmonyRule[] = ["complementary", "analogous", "triadic", "tetradic", "split-complementary"];

// Hue offsets (degrees) per rule; the 0° entry is the unchanged base colour.
const OFFSETS: Record<HarmonyRule, number[]> = {
  complementary: [0, 180],
  analogous: [-30, 0, 30], // base centred between its two neighbours
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
  "split-complementary": [0, 150, 210],
};

/** Rotate a colour's hue by `deg` (any sign), preserving saturation, value, alpha. */
const rotateHue = (c: RGBA, deg: number): RGBA => {
  const hsv = rgbToHsv(c);
  return hsvToRgb({ ...hsv, h: hsv.h + deg }, c.a); // hsvToRgb normalises h mod 360
};

/** Colour-harmony palette for `base` under `rule` (Illustrator Color Guide). The
 *  base colour appears unchanged at its 0° offset; the rest are hue rotations. */
export const harmony = (base: RGBA, rule: HarmonyRule): RGBA[] =>
  OFFSETS[rule].map((d) => (d === 0 ? base : rotateHue(base, d)));
