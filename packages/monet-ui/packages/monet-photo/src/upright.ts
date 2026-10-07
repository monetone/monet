// Upright — LR/ACR's Upright buttons, solved TS-side into the three keystone
// floats the engine already applies (develop.rs geometry_keystone_buf). Shared by
// Galerie's Transform panel and Vision's Camera Raw Geometry section (#444).
//
// The model: vertical V (tv = V/4) gives a source-vertical line at u = x−0.5 a
// destination tilt (dx/dy, unit-square space) of −V·u; horizontal H gives a
// source-horizontal line at c = y−0.5 a slope of −H·c; rotate r (θ = r·15°) adds
// −tanθ tilt to verticals and +tanθ slope to horizontals. Fitting measured line
// tilts to that model yields the correcting parameters directly — no ABI slots.

import type { UprightMode } from "./developRecipe";

export interface UprightSolution {
  vertical: number;
  horizontal: number;
  rotate: number;
}
/** A user-drawn Guided Upright alignment line, normalized 0..1 coordinates. */
export interface UprightLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface UprightImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** One measured line: `pos` is u (verticals) or c (horizontals), `tilt` the
 *  unit-square dx/dy (verticals) or dy/dx (horizontals). */
interface UprightObs {
  pos: number;
  tilt: number;
  weight: number;
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** Weighted least squares `tilt = slope·pos + intercept`. A single observation
 *  (or all-same pos) can't separate the two, so it degrades to pure intercept —
 *  LR's "one guide line = straighten only" behaviour. */
function fitObs(obs: UprightObs[]): { slope: number; intercept: number } | null {
  let sw = 0, sp = 0, spp = 0, st = 0, spt = 0;
  for (const o of obs) {
    sw += o.weight;
    sp += o.weight * o.pos;
    spp += o.weight * o.pos * o.pos;
    st += o.weight * o.tilt;
    spt += o.weight * o.pos * o.tilt;
  }
  if (sw <= 0) return null;
  const det = sw * spp - sp * sp;
  if (Math.abs(det) < 1e-9) return { slope: 0, intercept: st / sw };
  const slope = (sw * spt - sp * st) / det;
  return { slope, intercept: (st - slope * sp) / sw };
}

/** Invert the tilt model: observed tilt A·u+B / slope C·c+D ⇒ the engine
 *  parameters that cancel them (V=A, H=C, tanθ = (B−D)/2). */
function solveObservations(vertical: UprightObs[], horizontal: UprightObs[]): UprightSolution {
  const v = fitObs(vertical);
  const h = fitObs(horizontal);
  const tanTheta = v && h ? (v.intercept - h.intercept) / 2 : v ? v.intercept : h ? -h.intercept : 0;
  const thetaDeg = (Math.atan(tanTheta) * 180) / Math.PI;
  return {
    vertical: v ? clamp1(v.slope) : 0,
    horizontal: h ? clamp1(h.slope) : 0,
    rotate: clamp1(thetaDeg / 15),
  };
}

/** Guided Upright: solve from up to 4 user-drawn guide lines. Vertical-ish
 *  lines constrain Vertical+Rotate, horizontal-ish ones Horizontal+Rotate. */
export function solveGuidedUpright(lines: UprightLine[]): UprightSolution {
  const vert: UprightObs[] = [];
  const horiz: UprightObs[] = [];
  for (const l of lines.slice(0, 4)) {
    let dx = l.x1 - l.x0;
    let dy = l.y1 - l.y0;
    if (Math.abs(dy) >= Math.abs(dx)) {
      if (dy < 0) { dx = -dx; dy = -dy; }
      if (dy < 1e-6) continue; // degenerate point
      vert.push({ pos: (l.x0 + l.x1) / 2 - 0.5, tilt: dx / dy, weight: 1 });
    } else {
      if (dx < 0) { dx = -dx; dy = -dy; }
      horiz.push({ pos: (l.y0 + l.y1) / 2 - 0.5, tilt: dy / dx, weight: 1 });
    }
  }
  return solveObservations(vert, horiz);
}

/** The Sobel threshold and orientation stats below are tuned for a ~320 px
 *  preview (Galerie reads one that size); Vision hands over its proxy, which can
 *  be several times larger, so bigger images are box-downsampled first. */
const UPRIGHT_MAX_DIM = 320;

function downsample(img: UprightImage): UprightImage {
  const f = Math.ceil(Math.max(img.width, img.height) / UPRIGHT_MAX_DIM);
  if (f <= 1) return img;
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const out = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < f; dy++) {
          const row = ((y * f + dy) * img.width + x * f) * 4;
          for (let dx = 0; dx < f; dx++) sum += img.data[row + dx * 4 + c];
        }
        data[out + c] = sum / (f * f);
      }
      data[out + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

/** Auto/Level/Vertical/Full: Sobel edges → line-orientation observations → the
 *  same least-squares solve Guided uses. Null when the image has no straight
 *  edges to measure, so callers can say so instead of applying a zero warp.
 *  ponytail: gradient-orientation stats, not a line-segment/vanishing-point
 *  detector — upgrade to an LSD fit if Auto misfires on busy scenes. */
export function solveUpright(
  mode: Exclude<UprightMode, "off" | "guided">,
  img: UprightImage,
): UprightSolution | null {
  const { data, width: w, height: h } = downsample(img);
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  const vert: UprightObs[] = [];
  const horiz: UprightObs[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1];
      const gy = lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1];
      const mag = Math.hypot(gx, gy);
      if (mag < 120) continue; // weak edge — noise
      // Edge direction is ⟂ to the gradient; convert to unit-square space.
      const dx = -gy / w;
      const dy = gx / h;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      // Only near-axis edges vote (< ~18° off-axis) — diagonals carry no
      // keystone signal and would drag the fit.
      if (ady > 3 * adx) {
        vert.push({ pos: x / w - 0.5, tilt: (dy < 0 ? -dx : dx) / ady, weight: mag });
      } else if (adx > 3 * ady) {
        horiz.push({ pos: y / h - 0.5, tilt: (dx < 0 ? -dy : dy) / adx, weight: mag });
      }
    }
  }
  if (vert.length === 0 && horiz.length === 0) return null;
  const s = solveObservations(vert, horiz);
  switch (mode) {
    case "level":
      return { vertical: 0, horizontal: 0, rotate: s.rotate };
    case "vertical":
      return { vertical: s.vertical, horizontal: 0, rotate: s.rotate };
    case "full":
      return s;
    case "auto":
      // ponytail: LR's Auto balances correction against composition; we apply
      // Full at 85% — tune or replace with a content-aware weight if needed.
      return { vertical: 0.85 * s.vertical, horizontal: 0.85 * s.horizontal, rotate: 0.85 * s.rotate };
  }
}

export const UPRIGHT_MODES: { key: UprightMode; label: string }[] = [
  { key: "off", label: "Off" },
  { key: "auto", label: "Auto" },
  { key: "level", label: "Level" },
  { key: "vertical", label: "Vertical" },
  { key: "full", label: "Full" },
  { key: "guided", label: "Guided" },
];
