// Select and Mask workspace — pure helpers (engine-free). The refine math
// lives in the engine (selection.rs::refine_edge et al); this module owns the
// workspace's View Mode compositor (what the preview canvas shows for a given
// composite + refined coverage) and the Refine Edge Brush stamp.

export type SamViewMode = "onion" | "ants" | "overlay" | "onblack" | "onwhite" | "bw" | "onlayers";
export type SamOutput = "selection" | "layermask" | "newlayermask";

export interface SamParams {
  radius: number; // Edge Detection radius, px
  smartRadius: boolean;
  smooth: number; // px
  feather: number; // px
  contrast: number; // 0..1
  shift: number; // Shift Edge, px (+expand / −contract)
}

// Photoshop's seven View modes, panel order.
export const SAM_VIEW_MODES: { value: SamViewMode; label: string }[] = [
  { value: "onion", label: "Onion Skin" },
  { value: "ants", label: "Marching Ants" },
  { value: "overlay", label: "Overlay" },
  { value: "onblack", label: "On Black" },
  { value: "onwhite", label: "On White" },
  { value: "bw", label: "Black & White" },
  { value: "onlayers", label: "On Layers" },
];

export const SAM_OUTPUTS: { value: SamOutput; label: string }[] = [
  { value: "selection", label: "Selection" },
  { value: "layermask", label: "Layer Mask" },
  { value: "newlayermask", label: "New Layer with Layer Mask" },
];

// Photoshop's light transparency checkerboard (8-px squares).
const checker = (x: number, y: number) => ((((x >> 3) ^ (y >> 3)) & 1) ? 204 : 255);

/** Composite one View mode into `out` (RGBA8, w*h*4). `coverage` is the
 *  refined selection (0..255, null = no selection → plain composite);
 *  `opacity` (0..1) is the View's Opacity / Transparency slider. */
export function renderSamView(
  view: SamViewMode,
  opacity: number,
  w: number,
  h: number,
  composite: Uint8ClampedArray,
  coverage: Uint8Array | null,
  out: Uint8ClampedArray,
): void {
  const n = w * h;
  const op = Math.min(1, Math.max(0, opacity));
  if (!coverage) {
    out.set(composite.subarray(0, n * 4));
    return;
  }
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const cov = coverage[i] / 255;
    const x = i % w;
    const y = (i / w) | 0;
    const r = composite[p], g = composite[p + 1], b = composite[p + 2];
    let or = r, og = g, ob = b;
    switch (view) {
      case "onion": {
        // Selected shows the image; unselected fades toward transparency
        // (checkerboard) by 1−opacity.
        const a = cov + (1 - cov) * op;
        const c = checker(x, y);
        or = r * a + c * (1 - a); og = g * a + c * (1 - a); ob = b * a + c * (1 - a);
        break;
      }
      case "ants":
        // Image untouched; a static dashed boundary is stamped in a second pass.
        break;
      case "overlay": {
        // Rubylith: red over the unselected area, opacity-weighted.
        const t = (1 - cov) * op;
        or = r * (1 - t) + 255 * t; og = g * (1 - t); ob = b * (1 - t);
        break;
      }
      case "onblack": case "onwhite": {
        const bg = view === "onblack" ? 0 : 255;
        // Matte over the solid at `opacity` strength (0 = plain image).
        const a = cov + (1 - cov) * (1 - op);
        or = r * a + bg * (1 - a); og = g * a + bg * (1 - a); ob = b * a + bg * (1 - a);
        break;
      }
      case "bw": {
        const v = coverage[i];
        or = v; og = v; ob = v;
        break;
      }
      case "onlayers": {
        // The matte alone over transparency — what an output mask would keep.
        const c = checker(x, y);
        or = r * cov + c * (1 - cov); og = g * cov + c * (1 - cov); ob = b * cov + c * (1 - cov);
        break;
      }
    }
    out[p] = or; out[p + 1] = og; out[p + 2] = ob; out[p + 3] = 255;
  }
  if (view === "ants") {
    // Static marching ants: boundary pixels (selected with an unselected
    // 4-neighbour) in an alternating black/white dash.
    // ponytail: not animated — the workspace re-renders on every tweak anyway.
    for (let i = 0; i < n; i++) {
      if (coverage[i] < 128) continue;
      const x = i % w;
      const y = (i / w) | 0;
      const edge =
        (x > 0 && coverage[i - 1] < 128) || (x < w - 1 && coverage[i + 1] < 128) ||
        (y > 0 && coverage[i - w] < 128) || (y < h - 1 && coverage[i + w] < 128);
      if (!edge) continue;
      const p = i * 4;
      const v = ((x + y) >> 2) & 1 ? 255 : 0;
      out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255;
    }
  }
}

/** Stamp a Refine Edge Brush dab: a hard circle of `radius` px at (cx, cy)
 *  into the doc-sized stroke `mask` (255 = refine here; `add` false erases). */
export function stampSamBrush(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  add: boolean,
): void {
  const r = Math.max(1, radius);
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const v = add ? 255 : 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) mask[y * w + x] = v;
    }
  }
}

/** Everything Photoshop's "Remember Settings" checkbox restores. */
export interface SamSettings extends SamParams {
  view: SamViewMode;
  viewOpacity: number;
  decontaminate: boolean;
  decontaminateAmount: number; // 0..1 — Photoshop's Amount slider
  output: SamOutput;
}

export const SAM_DEFAULTS: SamSettings = {
  view: "onion",
  viewOpacity: 0.5,
  radius: 0,
  smartRadius: false,
  smooth: 0,
  feather: 0,
  contrast: 0,
  shift: 0,
  decontaminate: false,
  decontaminateAmount: 1,
  output: "selection",
};

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;

/** Coerce a stored blob back to real settings — a hand-edited or stale
 *  localStorage entry must not be able to put the workspace in a bad state. */
export function normalizeSamSettings(raw: unknown): SamSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const views = SAM_VIEW_MODES.map((m) => m.value);
  const outputs = SAM_OUTPUTS.map((o) => o.value);
  return {
    view: views.includes(r.view as SamViewMode) ? (r.view as SamViewMode) : SAM_DEFAULTS.view,
    viewOpacity: num(r.viewOpacity, 0, 1, SAM_DEFAULTS.viewOpacity),
    radius: num(r.radius, 0, 250, SAM_DEFAULTS.radius),
    smartRadius: typeof r.smartRadius === "boolean" ? r.smartRadius : SAM_DEFAULTS.smartRadius,
    smooth: num(r.smooth, 0, 100, SAM_DEFAULTS.smooth),
    feather: num(r.feather, 0, 250, SAM_DEFAULTS.feather),
    contrast: num(r.contrast, 0, 1, SAM_DEFAULTS.contrast),
    shift: num(r.shift, -100, 100, SAM_DEFAULTS.shift),
    decontaminate: typeof r.decontaminate === "boolean" ? r.decontaminate : SAM_DEFAULTS.decontaminate,
    decontaminateAmount: num(r.decontaminateAmount, 0, 1, SAM_DEFAULTS.decontaminateAmount),
    output: outputs.includes(r.output as SamOutput) ? (r.output as SamOutput) : SAM_DEFAULTS.output,
  };
}
