// ─────────────────────────────────────────────────────────────
// ops/width-profile — Stroke panel "Width Profile" presets (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Adobe Illustrator's Stroke panel has a Width Profile dropdown (Uniform + six
// built-in variable-width profiles). Each profile is a half-width curve sampled
// along the path; Artisan stores it as Stroke.widthProfile (per-anchor width
// multipliers) which the renderer already draws as a variable-width ribbon.
//
// A preset is a normalized multiplier curve (sampled at uniform parameter t ∈
// [0,1]); applyWidthProfile resamples it to the path's anchor count. Uniform
// clears the profile (reverting to a plain even-width stroke). These v1 curve
// shapes are our interpretation of the six profiles, not pixel-exact to Adobe.

import { convertToPath } from "./path-edit";
import { findItem } from "../model/query";
import { paintedStroke, setPrimaryStroke } from "../model/appearance";
import { LIVE_SHAPES, type Document, type ID } from "../model/types";

export type WidthProfilePreset = "uniform" | "profile-1" | "profile-2" | "profile-3" | "profile-4" | "profile-5" | "profile-6";

// Half-width multiplier curves, sampled at evenly spaced t over [0,1].
export const WIDTH_PROFILE_PRESETS: Record<Exclude<WidthProfilePreset, "uniform">, number[]> = {
  "profile-1": [0, 1, 0], // centre bulge — tapers to points at both ends
  "profile-2": [1, 0], // taper out — wide start to a point
  "profile-3": [0, 1], // taper in — a point to a wide end
  "profile-4": [1, 0.2, 1], // waist — wide ends, pinched middle
  "profile-5": [0.3, 1, 0.5, 0.2], // bulge skewed toward the start
  "profile-6": [0.2, 0.5, 1, 0.3], // bulge skewed toward the end
};

/** Resample a multiplier curve to `n` evenly spaced anchors via linear
 *  interpolation. Returns one multiplier per anchor. Note a curve is only sampled
 *  at the anchors, so a centre-bulge profile on a 2-anchor (single-segment) line
 *  collapses to its endpoint values, e.g. [0,1,0] → [0,0] — Illustrator behaves
 *  the same; such a line needs ≥3 anchors to show the bulge. */
export const resampleProfile = (samples: number[], n: number): number[] => {
  const m = samples.length;
  if (n <= 1) return [samples[0] ?? 1];
  if (m === 1) return Array<number>(n).fill(samples[0]);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (m - 1); // position within the sample curve
    const lo = Math.floor(x);
    const hi = Math.min(lo + 1, m - 1);
    out.push(samples[lo] + (samples[hi] - samples[lo]) * (x - lo));
  }
  return out;
};

/**
 * Stroke panel "Width Profile" — apply a preset to each selected path/compound stroke.
 * Live shapes (rect/ellipse/…) are converted to paths first so the variable
 * width actually renders. "uniform" clears the profile. Returns modified ids.
 */
export const applyWidthProfile = (doc: Document, ids: Iterable<ID>, preset: WidthProfilePreset): ID[] => {
  const done: ID[] = [];
  for (const id of ids) {
    let loc = findItem(doc, id);
    if (!loc) continue;
    if (LIVE_SHAPES.includes(loc.item.type)) {
      convertToPath(doc, id);
      loc = findItem(doc, id);
      if (!loc) continue;
    }
    const it = loc.item;
    if (it.type !== "path" && it.type !== "compound") continue;
    const anchorCount = it.type === "path" ? it.geometry.anchors.length : it.subpaths.reduce((n, path) => n + path.anchors.length, 0);
    const stroke = paintedStroke(it);
    setPrimaryStroke(
      it,
      preset === "uniform"
        ? { ...stroke, widthProfile: undefined }
        : { ...stroke, widthProfile: resampleProfile(WIDTH_PROFILE_PRESETS[preset], anchorCount) },
    );
    done.push(id);
  }
  return done;
};
