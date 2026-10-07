// ─────────────────────────────────────────────────────────────
// Blur Gallery workspace — Photoshop opens ONE workspace from any of the five
// blur menu items (Field / Iris / Tilt-Shift / Path / Spin): every tool's pins
// coexist, preview together on the document and Apply commits the whole set as
// a single history step. This module owns everything decidable without the
// engine — the workspace state and the ordered engine steps it composes into —
// so it stays testable. Dialogs.tsx owns the UI and runs the steps; blurPins.ts
// owns the per-pin geometry.
//
// ponytail: Adobe's options-bar Selection Bleed / Focus / High Quality / Save
// Mask to Channels have no engine seam yet — gallery_blur_pins blends back on a
// hard selection edge, has no in-focus-zone blur term, no quality switch and
// never exposes its focus map. Wire them here once filters.rs grows them.
// ─────────────────────────────────────────────────────────────

import { defaultPin, flattenGalleryPins, flattenSpinPins, type BlurPin, type PinKind } from "./blurPins";

/** Path Blur is the one tool with no pin record in the engine ABI — it is a
 *  whole-layer directional streak, so it lives as a toggle plus params. */
export const PATH_TOOL = 4;
export type BlurTool = PinKind | typeof PATH_TOOL;

/** Rail order = Photoshop's Blur Tools panel order (Path sits before Spin). */
export const BLUR_TOOLS: readonly { tool: BlurTool; label: string }[] = [
  { tool: 0, label: "Field Blur" },
  { tool: 1, label: "Iris Blur" },
  { tool: 2, label: "Tilt-Shift" },
  { tool: PATH_TOOL, label: "Path Blur" },
  { tool: 3, label: "Spin Blur" },
];

/** Which tool each of the five menu items opens the shared workspace on. */
export const BLUR_TOOL_FOR_DIALOG = {
  fieldBlur: 0, irisBlur: 1, tiltShift: 2, spinBlur: 3, pathBlur: PATH_TOOL,
} as const satisfies Record<string, BlurTool>;

export interface GalleryPin extends BlurPin { kind: PinKind }

export interface BlurGalleryState {
  pins: GalleryPin[];
  /** Blur Tools ▸ Field/Iris/Tilt share the gallery ABI's single radius. */
  radius: number;
  /** Blur Tools ▸ Spin sweep, degrees. */
  spinAngle: number;
  /** Effects ▸ Light Bokeh · Bokeh Color, 0..100 as shown in the UI. */
  bokeh: number;
  bokehColor: number;
  /** Motion Effects ▸ Strobe Flashes (spin) and the Path Blur params. */
  strobe: number;
  pathOn: boolean;
  pathAngle: number;
  pathSpeed: number;
  pathTaper: number;
  pathCentered: boolean;
  /** Noise ▸ grain laid back over the blurred result, 0..100 (0 = off). */
  noise: number;
  noiseMono: boolean;
  noiseGaussian: boolean;
}

export const GALLERY_PINS_FID = 114;
export const SPIN_PINS_FID = 115;
export type PinnedBlurFid = typeof GALLERY_PINS_FID | typeof SPIN_PINS_FID;

/** Captured Layers-panel target for reopening one pinned blur smart filter. */
export interface PinnedBlurEditRequest {
  docId: number;
  layerId: number;
  index: number;
  fid: PinnedBlurFid;
  params: number[];
}

export function defaultBlurGalleryState(tool: BlurTool, w: number, h: number): BlurGalleryState {
  return {
    pins: tool === PATH_TOOL ? [] : [{ kind: tool, ...defaultPin(tool, w, h) }],
    radius: 15,
    spinAngle: 15,
    bokeh: 0,
    bokehColor: 0,
    strobe: 0,
    pathOn: tool === PATH_TOOL,
    pathAngle: 0,
    pathSpeed: 40,
    pathTaper: 0,
    pathCentered: false,
    noise: 0,
    noiseMono: false,
    noiseGaussian: false,
  };
}

export const pinsOfKind = (pins: GalleryPin[], kind: PinKind): GalleryPin[] =>
  pins.filter((p) => p.kind === kind);

/** Exact fid-114/115 payload for one pin tool. A re-edit keeps one smart-filter
 *  row one filter, even when the normal workspace can compose several tools. */
export function pinnedBlurSmartFilter(s: BlurGalleryState, tool: PinKind): { fid: PinnedBlurFid; params: Float32Array } {
  if (tool === 3) {
    return {
      fid: SPIN_PINS_FID,
      params: Float32Array.from([s.spinAngle, s.strobe, ...flattenSpinPins(pinsOfKind(s.pins, tool))]),
    };
  }
  return {
    fid: GALLERY_PINS_FID,
    params: Float32Array.from([
      tool, s.radius, s.bokeh / 100, s.bokehColor / 100,
      ...flattenGalleryPins(pinsOfKind(s.pins, tool)),
    ]),
  };
}

/** Restore the workspace fields stored by the engine's fid-114/115 arms. */
export function pinnedBlurState(fid: number, input: readonly number[], w: number, h: number): { tool: PinKind; state: BlurGalleryState } | null {
  const p = Array.from(input);
  if (!p.every(Number.isFinite)) return null;
  if (fid === GALLERY_PINS_FID) {
    const tool = p[0];
    if ((tool !== 0 && tool !== 1 && tool !== 2) || p.length < 4 || (p.length - 4) % 7 !== 0) return null;
    const pins: GalleryPin[] = [];
    for (let i = 4; i < p.length; i += 7) {
      pins.push({
        kind: tool, x: p[i], y: p[i + 1], amount: p[i + 2], focus: p[i + 3],
        feather: p[i + 4], rotation: (p[i + 5] * 180) / Math.PI, aspect: p[i + 6],
      });
    }
    return {
      tool,
      state: {
        ...defaultBlurGalleryState(tool, w, h), pins, radius: p[1],
        bokeh: p[2] * 100, bokehColor: p[3] * 100,
      },
    };
  }
  if (fid === SPIN_PINS_FID) {
    if (p.length < 2 || (p.length - 2) % 6 !== 0) return null;
    const pins: GalleryPin[] = [];
    for (let i = 2; i < p.length; i += 6) {
      pins.push({
        kind: 3, x: p[i], y: p[i + 1], amount: 1, focus: p[i + 2],
        aspect: p[i + 2] === 0 ? 1 : p[i + 3] / p[i + 2],
        rotation: (p[i + 4] * 180) / Math.PI, feather: p[i + 5],
      });
    }
    return {
      tool: 3,
      state: { ...defaultBlurGalleryState(3, w, h), pins, spinAngle: p[0], strobe: p[1] },
    };
  }
  return null;
}

/** One engine call. `pins` are already flattened to the ABI stride. */
export type BlurStep =
  | { op: "gallery"; kind: PinKind; radius: number; pins: Float32Array; bokeh: number; bokehColor: number }
  | { op: "path"; angle: number; speed: number; taper: number; centered: boolean }
  | { op: "spin"; angle: number; strobe: number; pins: Float32Array }
  | { op: "noise"; amount: number; mono: boolean; gaussian: boolean; seed: number };

/** The engine ops the workspace composes to, in Blur Tools rail order with the
 *  Noise grain last. A tool contributes only when it has pins (Path: when it is
 *  switched on and actually moves), so an untouched workspace applies nothing.
 *
 *  ponytail: each step re-blurs the previous step's pixels, so stacking two
 *  tools compounds instead of compositing one combined focus map the way
 *  Photoshop does, and the Noise grain lands on the whole layer rather than
 *  only the blurred region. One filters.rs entry point taking every pin kind
 *  (plus a grain-in-blur term) is the upgrade path. */
export function blurGallerySteps(s: BlurGalleryState, noiseSeed: number): BlurStep[] {
  const steps: BlurStep[] = [];
  for (const kind of [0, 1, 2] as const) {
    const pins = pinsOfKind(s.pins, kind);
    if (pins.length > 0) {
      steps.push({
        op: "gallery", kind, radius: s.radius, pins: flattenGalleryPins(pins),
        bokeh: s.bokeh / 100, bokehColor: s.bokehColor / 100,
      });
    }
  }
  if (s.pathOn && s.pathSpeed > 0) {
    steps.push({
      op: "path", angle: s.pathAngle, speed: s.pathSpeed,
      taper: s.pathTaper / 100, centered: s.pathCentered,
    });
  }
  const spin = pinsOfKind(s.pins, 3);
  if (spin.length > 0) {
    steps.push({ op: "spin", angle: s.spinAngle, strobe: s.strobe, pins: flattenSpinPins(spin) });
  }
  if (s.noise > 0) {
    steps.push({
      op: "noise", amount: s.noise / 100, mono: s.noiseMono,
      gaussian: s.noiseGaussian, seed: noiseSeed >>> 0,
    });
  }
  return steps;
}
