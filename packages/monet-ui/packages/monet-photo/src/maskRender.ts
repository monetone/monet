// maskRender — turn a stored mask graph into pixels, without touching the engine.
//
// The develop ABI (recipeToParams) serializes only *global* params — masks are
// not in the 1086-float layout. So local (masked) adjustments are realized by a
// TS composite: render the base once, render a second pass with the mask's local
// adjustments folded into the recipe, and blend the two by the mask's coverage
// (an alpha field computed here from geometry, and for range masks, the base
// image's own pixels).
//
// ponytail: the AI* kinds (aiSubject, aiSky, ...) still compute to zero here —
// they need a segmentation model, not just pixels. rangeDepth renders whenever
// the source carries a `depth` channel; nothing ingests one yet (iPhone Portrait
// HEIC auxiliary images), so today it is zero in practice too.
// Overlapping masks composite in graph order (a later mask wins by its
// coverage) — an approximation of LR's in-pipeline stacking, fine for a few
// masks; the per-mask extra render is the cost ceiling.

import type { DevelopRecipeV2 } from "./developRecipe";
import type { LocalAdjustments, Mask, MaskComponent } from "./maskGraph";

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Hermite smoothstep of a value already clamped to 0..1. */
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** Auto Mask colour tolerance (raw-sRGB distance where the weight hits 0). */
const AUTO_MASK_TOLERANCE = 0.25;

/**
 * The base image a mask's range components sample (brush and gradients are
 * pure geometry and don't need it). RGBA8, sRGB-encoded, straight alpha, one
 * pixel per coverage cell — must match the coverage width/height exactly.
 */
export interface MaskRenderSource {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** Optional depth channel for rangeDepth: one 0..1 value per pixel, row-major
   *  at the same width/height (0 = nearest, 1 = farthest). Absent = the photo
   *  carries no depth data, and depth components cover nothing. */
  depth?: Float32Array;
}

/** LR's Color Range picker caps at five samples — past that the min-distance
 *  match below just widens into everything. */
export const MAX_COLOR_RANGE_SAMPLES = 5;

/**
 * Average an RGBA8 patch — a click's neighbourhood or a dragged rectangle — into
 * one normalized rgb sample for a rangeColor component. Averaging is what makes
 * Color Range usable: a single pixel carries sensor noise and JPEG blocking, so
 * a one-pixel sample selects a colour that isn't really there.
 */
export function averageRgbSample(pixels: Uint8ClampedArray): { r: number; g: number; b: number } {
  const n = Math.floor(pixels.length / 4);
  if (n === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < n * 4; i += 4) {
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  return { r: r / n / 255, g: g / n / 255, b: b / n / 255 };
}

/**
 * Coverage of a scalar `v` against the band [min,max]: 1 inside, a smoothstep
 * ramp of half-width 0.5·smoothness outside, 0 beyond. Shared by the two
 * band-range kinds (luminance, depth) so they feather identically; an inverted
 * band (min > max) selects nothing.
 */
function bandCoverage(v: number, min: number, max: number, smoothness: number): number {
  if (min > max) return 0;
  if (v >= min && v <= max) return 1;
  const edge = 0.5 * clamp01(smoothness); // 0 smoothness = hard edge
  if (edge <= 0) return 0;
  const d = v < min ? min - v : v - max;
  return smooth(clamp01(1 - d / edge));
}

/** Normalized (0..1) sRGB rgb of `base` at pixel (x,y). */
function baseRgb(base: MaskRenderSource, x: number, y: number): [number, number, number] {
  const i = (y * base.width + x) * 4;
  return [base.pixels[i] / 255, base.pixels[i + 1] / 255, base.pixels[i + 2] / 255];
}

/**
 * Coverage 0..1 of one component at pixel (x,y). Geometry kinds (gradients,
 * brush) work from the normalized position (nx,ny); range kinds additionally
 * sample `base` at the integer pixel and read 0 when it's absent.
 */
function componentCoverage(
  c: MaskComponent,
  nx: number,
  ny: number,
  x: number,
  y: number,
  width: number,
  height: number,
  base: MaskRenderSource | undefined,
): number {
  switch (c.kind) {
    case "linearGradient": {
      const dx = c.x2 - c.x1;
      const dy = c.y2 - c.y1;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return 0; // degenerate axis → no effect
      // Project onto the axis: 0 at the near line, 1 past the far line.
      return clamp01(((nx - c.x1) * dx + (ny - c.y1) * dy) / len2);
    }
    case "radialGradient": {
      const px = nx - c.cx;
      const py = ny - c.cy;
      // Un-rotate into the ellipse's own axes, then normalize by the radii so
      // the ellipse edge sits at distance 1.
      const cos = Math.cos(-c.angle);
      const sin = Math.sin(-c.angle);
      const ux = (px * cos - py * sin) / (c.rx || 1e-6);
      const uy = (px * sin + py * cos) / (c.ry || 1e-6);
      const d = Math.sqrt(ux * ux + uy * uy);
      const inner = 1 - clamp01(c.feather); // full effect out to here
      if (d <= inner) return 1;
      if (d >= 1) return 0;
      return 1 - (d - inner) / (1 - inner); // linear feather ramp to the edge
    }
    case "brush": {
      const minDim = Math.min(width, height);
      // Feather: full coverage out to (1-feather)·radius, smoothstep ramp
      // beyond. Absent feather = 1, which reproduces the pre-feather falloff
      // (smoothstep over the whole radius) exactly.
      const inner = 1 - clamp01(c.feather ?? 1);
      let cov = 0;
      for (const dab of c.dabs) {
        const radiusPx = dab.radius * minDim;
        if (radiusPx <= 0) continue; // no area, dab has no effect
        const dxPx = (nx - dab.x) * width;
        const dyPx = (ny - dab.y) * height;
        const d = Math.sqrt(dxPx * dxPx + dyPx * dyPx) / radiusPx; // 0 centre → 1 edge
        let falloff: number;
        if (d <= inner) falloff = 1;
        else if (d >= 1) falloff = 0;
        else falloff = 1 - smooth((d - inner) / (1 - inner));
        if (falloff <= 0) continue;
        if (c.autoMask && base) {
          // ponytail: Auto Mask ≈ colour similarity to the base pixel under the
          // dab centre (what LR samples as you paint), applied to paint AND
          // erase dabs — not a true edge-aware flood fill. Good on clean edges
          // (sky/skin/horizon); upgrade path is a per-dab flood constraint
          // stopped at luminance edges.
          const sx = Math.round(dab.x * (base.width > 1 ? base.width - 1 : 1));
          const sy = Math.round(dab.y * (base.height > 1 ? base.height - 1 : 1));
          const [cr, cg, cb] = baseRgb(base, Math.min(base.width - 1, Math.max(0, sx)), Math.min(base.height - 1, Math.max(0, sy)));
          const [r, g, b] = baseRgb(base, x, y);
          const dr = r - cr;
          const dg = g - cg;
          const db = b - cb;
          // Same raw-sRGB distance proxy rangeColor uses; fixed tolerance.
          falloff *= smooth(clamp01(1 - Math.sqrt(dr * dr + dg * dg + db * db) / AUTO_MASK_TOLERANCE));
          if (falloff <= 0) continue;
        }
        if (dab.erase) cov = Math.max(0, cov - dab.flow * falloff);
        else cov = Math.min(Math.max(cov, 0) + dab.flow * falloff, clamp01(dab.density));
      }
      return cov;
    }
    case "rangeColor": {
      if (!base || c.samples.length === 0) return 0;
      const [r, g, b] = baseRgb(base, x, y);
      // Distance in raw sRGB-encoded rgb (not linearized) — a cheap proxy for
      // perceived similarity, matching what an eyedropper actually samples.
      let minDist = Infinity;
      for (const s of c.samples) {
        const dr = r - s.r;
        const dg = g - s.g;
        const db = b - s.b;
        const d = Math.sqrt(dr * dr + dg * dg + db * db);
        if (d < minDist) minDist = d;
      }
      const tolerance = 0.08 + 0.42 * clamp01(c.refine); // refine widens the selection
      return smooth(clamp01(1 - minDist / tolerance));
    }
    case "rangeLuminance": {
      if (!base) return 0;
      const [r, g, b] = baseRgb(base, x, y);
      const luma = 0.299 * r + 0.587 * g + 0.114 * b; // Rec.601, this codebase's luma convention
      return bandCoverage(luma, c.min, c.max, c.smoothness);
    }
    case "rangeDepth": {
      // Same band as luminance, read from the source's depth channel instead of
      // its pixels. ponytail: no ingest fills that channel yet (iPhone Portrait
      // HEIC auxiliary image / a depth model), so this is zero on every photo
      // today; the upgrade path is decoding the aux image at import.
      if (!base?.depth) return 0;
      return bandCoverage(base.depth[y * base.width + x], c.near, c.far, c.smoothness ?? 0.5);
    }
    default:
      // ai* — needs a segmentation model, not just pixels.
      return 0;
  }
}

/**
 * Per-pixel coverage (row-major, width*height, 0..1) for a mask: fold each
 * component through its combine mode (add=union, subtract, intersect), apply
 * component + whole-mask inversion, and scale by opacity. The first component is
 * the base (its combine is ignored, per the schema).
 */
export function computeMaskCoverage(
  mask: Mask,
  width: number,
  height: number,
  base?: MaskRenderSource,
): Float32Array {
  if (base && (base.width !== width || base.height !== height)) {
    throw new Error(
      `computeMaskCoverage: base image is ${base.width}x${base.height}, expected ${width}x${height}`,
    );
  }
  // A short depth channel would read undefined mid-image and silently produce
  // NaN coverage, so reject it at the boundary rather than render garbage.
  if (base?.depth && base.depth.length !== base.width * base.height) {
    throw new Error(
      `computeMaskCoverage: depth channel has ${base.depth.length} values, expected ${base.width * base.height}`,
    );
  }
  const out = new Float32Array(width * height);
  const comps = mask.components;
  if (!comps.length || width <= 0 || height <= 0) return out;
  const opacity = clamp01(mask.opacity);
  const wDen = width > 1 ? width - 1 : 1;
  const hDen = height > 1 ? height - 1 : 1;
  for (let y = 0; y < height; y++) {
    const ny = y / hDen;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const nx = x / wDen;
      let acc = 0;
      for (let i = 0; i < comps.length; i++) {
        const c = comps[i];
        let cov = componentCoverage(c, nx, ny, x, y, width, height, base);
        if (c.invert) cov = 1 - cov;
        if (i === 0) acc = cov;
        else if (c.combine === "add") acc = acc > cov ? acc : cov;
        else if (c.combine === "subtract") acc = acc * (1 - cov);
        else acc = acc < cov ? acc : cov; // intersect
      }
      if (mask.inverted) acc = 1 - acc;
      out[row + x] = acc * opacity;
    }
  }
  return out;
}

/**
 * The crop viewport a mask edit happens through. Masks are stored normalized to
 * the FULL (uncropped) frame while the develop canvas shows the cropped view,
 * so on-canvas mask tools map points between the two spaces. `width`/`height`
 * are the full frame's pixel size — straighten rotates in pixel space, so the
 * frame aspect matters. The math mirrors the apps' crop resample (rect window,
 * then inverse-rotate about the frame centre).
 */
export interface CropView {
  rect: { left: number; top: number; right: number; bottom: number };
  /** Straighten angle, degrees. */
  angle: number;
  width: number;
  height: number;
}

/** Map a point normalized to the cropped view → full-frame normalized. */
export function cropToFrame(view: CropView, x: number, y: number): { x: number; y: number } {
  const { rect, width: W, height: H } = view;
  const px = (rect.left + x * (rect.right - rect.left)) * W;
  const py = (rect.top + y * (rect.bottom - rect.top)) * H;
  const rad = (-view.angle * Math.PI) / 180; // same inverse rotation the crop resample uses
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - W / 2;
  const dy = py - H / 2;
  return { x: (W / 2 + dx * cos - dy * sin) / W, y: (H / 2 + dx * sin + dy * cos) / H };
}

/** Inverse of cropToFrame: full-frame normalized → cropped-view normalized. */
export function frameToCrop(view: CropView, x: number, y: number): { x: number; y: number } {
  const { rect, width: W, height: H } = view;
  const rad = (view.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x * W - W / 2;
  const dy = y * H - H / 2;
  const px = W / 2 + dx * cos - dy * sin;
  const py = H / 2 + dx * sin + dy * cos;
  const cw = rect.right - rect.left || 1e-6; // degenerate rect → avoid /0
  const ch = rect.bottom - rect.top || 1e-6;
  return { x: (px / W - rect.left) / cw, y: (py / H - rect.top) / ch };
}

/** Map a brush radius picked on the cropped view (fraction of the view's
 *  shorter side, the kernel's convention) to the equivalent full-frame
 *  fraction, so a stamped dab covers exactly what the cursor showed. */
export function cropRadiusToFrame(view: CropView, radius: number): number {
  const cw = (view.rect.right - view.rect.left) * view.width;
  const ch = (view.rect.bottom - view.rect.top) * view.height;
  return (radius * Math.min(cw, ch)) / Math.min(view.width, view.height);
}

/** Shared body of maskToCropSpace/maskToFrameSpace: remap only the gradient
 *  kinds (the ones with draggable handles). Brush dabs are stamped pre-mapped
 *  and range/AI kinds carry no geometry, so they pass through untouched — that
 *  also keeps repeated to-and-fro mapping from drifting them.
 *  ponytail: under a straighten angle the radial ellipse maps axis-aligned
 *  (centre exact, radii scaled per-axis) — fine for straighten's small angles;
 *  exact would rotate the overlay ellipse with the view. */
function mapMaskGeometry(
  mask: Mask,
  pt: (x: number, y: number) => { x: number; y: number },
  rsx: number,
  rsy: number,
): Mask {
  return {
    ...mask,
    components: mask.components.map((c) => {
      if (c.kind === "linearGradient") {
        const a = pt(c.x1, c.y1);
        const b = pt(c.x2, c.y2);
        return { ...c, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      }
      if (c.kind === "radialGradient") {
        const p = pt(c.cx, c.cy);
        return { ...c, cx: p.x, cy: p.y, rx: c.rx * rsx, ry: c.ry * rsy };
      }
      return c;
    }),
  };
}

/** A copy of `mask` with gradient geometry mapped frame → cropped-view space,
 *  for handle overlays drawn over a cropped canvas. */
export function maskToCropSpace(mask: Mask, view: CropView): Mask {
  const cw = view.rect.right - view.rect.left || 1e-6;
  const ch = view.rect.bottom - view.rect.top || 1e-6;
  return mapMaskGeometry(mask, (x, y) => frameToCrop(view, x, y), 1 / cw, 1 / ch);
}

/** Inverse of maskToCropSpace: overlay edits back into stored frame space. */
export function maskToFrameSpace(mask: Mask, view: CropView): Mask {
  const cw = view.rect.right - view.rect.left;
  const ch = view.rect.bottom - view.rect.top;
  return mapMaskGeometry(mask, (x, y) => cropToFrame(view, x, y), cw, ch);
}

/**
 * Fold a mask's local adjustments into a copy of `recipe` so that rendering it
 * yields the "mask fully applied everywhere" look; the app blends that back over
 * the base through computeMaskCoverage to localize it. Local values share the
 * Basic panel's scaled domain (sliderInt * scale), so folding is field addition.
 * moire has no engine ABI slot yet, so it is dropped.
 */
export function foldLocalAdjustments(recipe: DevelopRecipeV2, adj: LocalAdjustments): DevelopRecipeV2 {
  const b = recipe.basic;
  return {
    ...recipe,
    basic: {
      ...b,
      temp: b.temp + adj.temp,
      tint: b.tint + adj.tint,
      exposure: b.exposure + adj.exposure,
      contrast: b.contrast + adj.contrast,
      highlights: b.highlights + adj.highlights,
      shadows: b.shadows + adj.shadows,
      whites: b.whites + adj.whites,
      blacks: b.blacks + adj.blacks,
      texture: b.texture + adj.texture,
      clarity: b.clarity + adj.clarity,
      dehaze: b.dehaze + adj.dehaze,
      saturation: b.saturation + adj.saturation,
    },
    detail: {
      ...recipe.detail,
      sharpenAmount: recipe.detail.sharpenAmount + adj.sharpness,
      nrLuminance: recipe.detail.nrLuminance + adj.noise,
    },
    optics: {
      ...recipe.optics,
      defringePurpleAmount: recipe.optics.defringePurpleAmount + adj.defringe,
    },
  };
}

/**
 * Alpha-composite `masked` over `base` (both tightly-packed RGBA8, same pixel
 * count as `coverage`) using the coverage map as per-pixel alpha. Mutates `base`
 * in place; the alpha byte is left untouched. base_rgb = base*(1-a) + masked*a.
 */
export function blendMasked(
  base: Uint8Array | Uint8ClampedArray,
  masked: Uint8Array | Uint8ClampedArray,
  coverage: Float32Array,
): void {
  for (let i = 0; i < coverage.length; i++) {
    const a = coverage[i];
    if (a <= 0) continue;
    const o = i * 4;
    if (a >= 1) {
      base[o] = masked[o];
      base[o + 1] = masked[o + 1];
      base[o + 2] = masked[o + 2];
      continue;
    }
    const ia = 1 - a;
    base[o] = base[o] * ia + masked[o] * a;
    base[o + 1] = base[o + 1] * ia + masked[o + 1] * a;
    base[o + 2] = base[o + 2] * ia + masked[o + 2] * a;
  }
}
