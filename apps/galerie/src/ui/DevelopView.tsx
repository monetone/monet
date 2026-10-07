// DevelopView — the Develop module (Phase 2 slice). Decodes the active photo
// into a persistent engine proxy, renders it through the canonical Develop recipe
// canonical DevelopRecipeV2, and edits the Basic panel live. The recipe is the
// source of truth: loaded from / debounce-saved to the catalog, so reopening the
// photo reproduces the edit.
//
// Rendering is rAF-coalesced and two-tier (PERF-11, LR's draft→refine): a
// recipe edit renders on the session's canvas-sized draft engine so a slider
// drag stays live, and REFINE_MS after the last edit one full-proxy pass
// replaces it. Zoomed to 1:1 (where a draft would read soft) it stays full.

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { isEditableTarget, Select } from "@monet-ui/monet-react";
import {
  averageRgbSample,
  channelCounts,
  createDefaultRecipe,
  createMask,
  cropRadiusToFrame,
  cropToFrame,
  CURRENT_PROCESS_VERSION,
  duplicateMask,
  maskToCropSpace,
  maskToFrameSpace,
  MAX_COLOR_RANGE_SAMPLES,
  MAX_HEAL_SPOTS,
  moveMask,
  normalizeRecipe,
  toneRegionAt,
  type CropView,
  type DevelopRecipeV2,
  type Mask,
  type ParametricRegions,
  type ParametricSplits,
} from "@monet-ui/monet-photo";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { getPhoto, getRecipe, listHistory } from "../catalog/catalog";
import type { HistoryRow } from "../catalog/types";
import { clampPan, fitScale, panForFocus, zoomToPoint, type Pan } from "../lib/loupeZoom";
import {
  bakeProofLut,
  maskRenderJobs,
  openProgressiveDevelopSession,
  replayFrames,
  type DecodedImage,
  type ProgressiveDevelopSession,
} from "../engine";
import { applySoftProof, PROOF_INTENTS, sniffProofProfile } from "../lib/softProof";
import { bandForPixel, tatBandValue } from "../lib/tat";
import { PHOTO_DRAG_TYPE, readPhotoDrag } from "../lib/photoDrag";
import { loadPreview } from "../lib/thumbnailLoader";
import { basename } from "./GridCell";
import { CopySettingsDialog } from "./CopySettingsDialog";
import { DEVELOP_RESET_EVENT, type MixerChannel } from "./DevelopPanels";
import {
  newAiSubjectMask,
  newBrushMask,
  newComponent,
  newGradientMask,
  newRangeMask,
  strokeDab,
  type BrushSettings,
  type ComponentKind,
  type DepthKind,
  type GradientKind,
  type RangeKind,
} from "../lib/maskEdit";
import { autoTone } from "../lib/autoTone";
import { applyCrop, isIdentityCrop } from "../lib/cropTransform";
import { computeSubjectMask } from "../lib/subjectMask";
import { compositeMasks, getOverlayFrame, onOverlayFrame } from "../lib/maskComposite";
import { persistDevelopRecipe } from "../lib/persistDevelopRecipe";
import { mergeRecipePatch, type DeepPartial } from "../lib/recipePatch";
import { sampleToSocket } from "./pointColorSample";
import { CropOverlay } from "./CropOverlay";
import { HealOverlay } from "./HealOverlay";
import { detectDustSpots, pickHealSource, type DetectedSpot } from "@monet-ui/monet-photo";
import { visualizeSpots } from "@monet-ui/monet-photo";
import { queueXmpWrite } from "../lib/xmpAutoWrite";
import { HistoryPanel } from "./HistoryPanel";
import { MaskOverlay } from "./MaskOverlay";
import { MasksPanel } from "./MasksPanel";
import { store, useCatalog } from "../state/store";
import { BasicPanel } from "./BasicPanel";
import {
  CalibrationPanel,
  ColorGradingPanel,
  ColorMixerPanel,
  DetailPanel,
  EffectsPanel,
  OpticsPanel,
  ProfilePanel,
  TransformPanel,
} from "./DevelopPanels";
import { PointColorPanel } from "./PointColorPanel";
import { PresetsPanel } from "./PresetsPanel";
import { SnapshotsPanel } from "./SnapshotsPanel";
import { SoloStack } from "./SoloStack";
import { ToneCurvePanel } from "./ToneCurvePanel";

/** Immutably set one field of a recipe sub-panel (key is a valid field of T). */
const patchPanel = <T,>(panel: T, key: string, value: number | boolean): T =>
  ({ ...panel, [key]: value }) as T;

// Tone-curve Targeted Adjustment Tool math — the parametric-region twin of
// lib/tat's bandForPixel/tatBandValue (Color Mixer). Kept pure so the region
// mapping and drag scaling are unit-tested without a canvas.
// ponytail: lives here rather than beside its Color Mixer twin in lib/tat.ts;
// move it there when that file is next touched.

/** Which parametric tone region a sampled canvas pixel targets (Rec.709 luma,
 *  split at the recipe's own region boundaries). */
export function toneRegionForPixel(
  r: number,
  g: number,
  b: number,
  splits?: ParametricSplits,
): keyof ParametricRegions {
  return toneRegionAt((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, splits);
}

/** New region value from an upward drag: dyPixels is (startY − currentY), so
 *  dragging up brightens. ~200px spans the full −100..100 slider domain, the
 *  same feel as the mixer's TAT. */
export function toneTatValue(startValue: number, dyPixels: number): number {
  return Math.max(-100, Math.min(100, startValue + dyPixels / 2));
}

// ── Red Eye / Pet Eye pupil detection (GAL-DEV-26) ───────────────────────────
// The red-eye pixel test mirrors the raster engine's Red Eye tool
// (raster/mod.rs remove_red_eye): a flash pupil is bright red AND far redder
// than its own green/blue mean, so a red sweater or lips never qualify. Pet
// eyes reflect the flash off the tapetum instead — green/yellow/white and
// BRIGHT, not red — so Pet mode tests luma, and RELATIVE to the surroundings:
// an absolute bar would swallow a whole sunlit face. Both run on 8-bit display
// pixels (the rendered canvas), where the engine's 0..1 thresholds scale by 255.
const RED_EYE_R_MIN = 89; // 0.35 × 255
const RED_EYE_REDNESS = 1.6; // engine's 2.2 − pupil·1.2 at the default pupil 0.5
const PET_EYE_LUMA_MIN = 0.55;
const PET_EYE_LUMA_LEAD = 0.15; // …and this much brighter than what surrounds it
const PUPIL_RING_SAMPLES = 16;

const lumaAt = (d: Uint8ClampedArray, i: number): number =>
  (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;

/** Find the flash pupil nearest a click: the pupil pixel closest to the click
 *  seeds it, the centre is the centroid of the pupil pixels around that seed
 *  (LR re-centres a sloppy click the same way), then the radius grows while
 *  each ring is still mostly pupil — the first ring that drops below half stops
 *  it, so an iris highlight or a red lip a few pixels away can never inflate
 *  the correction. Returns pixel coordinates, or null when nothing under the
 *  click looks like a pupil. */
export function findRedEyePupil(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  maxR: number,
  pet = false,
): { x: number; y: number; radius: number } | null {
  const x0 = Math.max(0, cx - maxR);
  const y0 = Math.max(0, cy - maxR);
  const x1 = Math.min(width - 1, cx + maxR);
  const y1 = Math.min(height - 1, cy + maxR);
  // Pet mode's bar: the search box's own edge is the local background (the
  // pupil is near the click, never all round the rim), so a glow only counts
  // when it clearly out-shines the fur/skin it sits in.
  let edge = 0;
  let edgeN = 0;
  for (let x = x0; x <= x1; x++) {
    edge += lumaAt(data, (y0 * width + x) * 4) + lumaAt(data, (y1 * width + x) * 4);
    edgeN += 2;
  }
  for (let y = y0; y <= y1; y++) {
    edge += lumaAt(data, (y * width + x0) * 4) + lumaAt(data, (y * width + x1) * 4);
    edgeN += 2;
  }
  const petMin = Math.max(PET_EYE_LUMA_MIN, edge / (edgeN || 1) + PET_EYE_LUMA_LEAD);
  /** Is this pixel part of the flash pupil? */
  const isPupil = (x: number, y: number): boolean => {
    const i = (y * width + x) * 4;
    if (pet) return lumaAt(data, i) >= petMin;
    return data[i] >= RED_EYE_R_MIN && data[i] / ((data[i + 1] + data[i + 2]) / 2 + 1) >= RED_EYE_REDNESS;
  };
  let seedD = Infinity;
  let seedX = -1;
  let seedY = -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!isPupil(x, y)) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < seedD) {
        seedD = d;
        seedX = x;
        seedY = y;
      }
    }
  }
  if (seedX < 0) return null;
  // Centroid of the pupil pixels within maxR of the seed — a flat-coloured
  // pupil has no "strongest" pixel to centre on, so mass is the honest answer.
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - seedX) ** 2 + (y - seedY) ** 2 > maxR * maxR) continue;
      if (!isPupil(x, y)) continue;
      sx += x;
      sy += y;
      n++;
    }
  }
  const bx = Math.round(sx / n);
  const by = Math.round(sy / n);
  let radius = 1;
  for (let r = 2; r <= maxR; r++) {
    let hit = 0;
    for (let k = 0; k < PUPIL_RING_SAMPLES; k++) {
      const a = (k / PUPIL_RING_SAMPLES) * Math.PI * 2;
      const x = Math.round(bx + Math.cos(a) * r);
      const y = Math.round(by + Math.sin(a) * r);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (isPupil(x, y)) hit++;
    }
    if (hit * 2 < PUPIL_RING_SAMPLES) break;
    radius = r;
  }
  return { x: bx, y: by, radius };
}

/** Recipe keys a develop preset never carries between photos: they describe THIS
 *  photo's framing, retouching, capture WB and provenance, not the look. Same
 *  spirit as scoped Paste Settings (store.pasteDevelop) — process version and the
 *  local-edit graphs survive the paste instead of being clobbered. */
const PRESET_PRESERVED = new Set([
  "version",
  "processVersion",
  "rawDecode",
  "crop",
  "heal",
  "masks",
  "engineMasks",
  "enhance",
  "metadata",
]);
/** …and the WB fields, which live inside Basic and so need a field-level skip. */
const PRESET_PRESERVED_BASIC = ["wbMode", "temp", "tint"];

/** Apply a preset over a photo's current recipe instead of replacing it, so the
 *  crop, heal spots, masks and the photo's own white balance survive.
 *  ponytail: fixed preserve-list, because a preset is stored as a whole
 *  canonical recipe and can't say which settings it meant to set. Upgrade path:
 *  persist a scope beside `preset.recipeJson` (parseXmpPreset already knows
 *  exactly which properties an .xmp set) and honour that instead. */
export function applyPresetRecipe(
  base: DevelopRecipeV2,
  preset: DevelopRecipeV2,
): DevelopRecipeV2 {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(preset)) {
    if (!PRESET_PRESERVED.has(k)) patch[k] = v;
  }
  const look: Record<string, unknown> = { ...preset.basic };
  for (const k of PRESET_PRESERVED_BASIC) delete look[k];
  patch.basic = look;
  return mergeRecipePatch(base, patch as DeepPartial<DevelopRecipeV2>);
}

/** GAL-DEV-18: claim a whole-recipe Reset (Develop > Reset, ⇧⌘R) while a photo
 *  is loaded. Cancelling the event tells resetDevelopAdjustments the view owns
 *  the recipe; resetting through `apply` (setRecipe) re-renders the canvas and
 *  records the History step via the normal persist path. Unloaded, the event
 *  stays uncancelled and the store fallback resets the selection instead. */
export function claimDevelopReset(
  e: Event,
  loadedId: number | null,
  apply: (r: DevelopRecipeV2) => void,
): boolean {
  if (loadedId == null) return false;
  e.preventDefault();
  apply(createDefaultRecipe());
  return true;
}

// ── Before/After layouts (GAL-DEV-11) ────────────────────────────────────────
// LR's four Y-view layouts: Before/After Left/Right and Top/Bottom, each with
// a split variant that folds both halves into the single canvas. Y toggles the
// view, ⇧Y the split variant, ⌥Y the orientation — LR's Y-family shortcuts.

export type BALayout = "leftRight" | "splitLR" | "topBottom" | "splitTB";

export const isSplitLayout = (l: BALayout): boolean => l === "splitLR" || l === "splitTB";

/** Next layout for a ⇧Y (`split`) or ⌥Y (`orient`) press. */
export function cycleBALayout(l: BALayout, key: "split" | "orient"): BALayout {
  const table: Record<"split" | "orient", Record<BALayout, BALayout>> = {
    split: { leftRight: "splitLR", splitLR: "leftRight", topBottom: "splitTB", splitTB: "topBottom" },
    orient: { leftRight: "topBottom", topBottom: "leftRight", splitLR: "splitTB", splitTB: "splitLR" },
  };
  return table[key][l];
}

/** Overwrite the Before half of an After frame in place: the left half for the
 *  Left/Right split, the top half for Top/Bottom. Both frames come through the
 *  same crop viewport, so the seam is one straight pixel column/row. A size
 *  drift (photo switch mid-flight) skips the composite instead of tearing;
 *  returns whether the composite happened. */
export function compositeSplit(
  after: Uint8ClampedArray,
  before: Uint8ClampedArray,
  width: number,
  height: number,
  topBottom: boolean,
): boolean {
  if (before.length !== after.length || after.length !== width * height * 4) return false;
  if (topBottom) {
    after.set(before.subarray(0, width * Math.floor(height / 2) * 4));
  } else {
    const half = Math.floor(width / 2) * 4;
    const row = width * 4;
    for (let y = 0; y < height; y++) after.set(before.subarray(y * row, y * row + half), y * row);
  }
  return true;
}

// ── Develop zoom (Fit ↔ 1:1) ─────────────────────────────────────────────────
// Reuses the Loupe's pure zoom math. The canvas already holds the full-
// resolution develop render, so scale 1 is true 1:1; while zoomed the wrap is
// drawn at the render's pixel size and translated/scaled in stage space.
// ponytail: Fit ↔ 1:1 only — the LR zoom ladder (2:1…11:1) and a Navigator
// panel would layer on this same DevZoom state when needed.

export interface DevZoom {
  scale: number;
  pan: Pan;
}

/** Fit ↔ 1:1 toggle at the stage point (cx, cy). `fit` is the letterboxed
 *  canvas box in stage coordinates, so the zoom anchors on the image pixel
 *  under the cursor; a null result means back to fit. */
export function toggleZoomAt(
  zoom: DevZoom | null,
  cx: number,
  cy: number,
  fit: { left: number; top: number; width: number },
  shown: { w: number; h: number },
  view: { w: number; h: number },
): DevZoom | null {
  if (zoom) return null;
  if (shown.w <= 0 || fit.width <= 0 || view.w <= 0 || view.h <= 0) return null;
  const fitScale = fit.width / shown.w;
  return zoomToPoint(cx, cy, fitScale, { x: fit.left, y: fit.top }, 1, shown.w, shown.h, view.w, view.h);
}

/** Inline style for the canvas wrap while zoomed: absolute at the render's
 *  pixel size, panned in stage space. The pan is re-clamped here so a stage
 *  resize can never strand the image off-screen. */
export function zoomWrapStyle(
  zoom: DevZoom,
  shown: { w: number; h: number },
  view: { w: number; h: number },
): CSSProperties {
  const pan = clampPan(zoom.pan, shown.w, shown.h, zoom.scale, view.w, view.h);
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: shown.w,
    height: shown.h,
    maxWidth: "none",
    maxHeight: "none",
    transformOrigin: "0 0",
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom.scale})`,
  };
}

// ── Soft Proofing (GAL-DEV-15) ───────────────────────────────────────────────
// S toggles a display-only proof of the develop render against a print
// profile — LR's Develop soft proof. The proof LUT bakes in the engine
// (working sRGB → profile → sRGB with gamut flags) and remaps pixels on the
// blit path only; recipe, History, export and preview pixels never change.

/** The bundled CMYK press profile (same asset Vision ships) — the default
 *  proof target. Fetched once; null = asset missing, proofing stays off. */
let pressProfileFetch: Promise<Uint8Array | null> | null = null;
const fetchPressProfile = () =>
  (pressProfileFetch ??= fetch("/profiles/ISOcoated_v2_300_eci.icc")
    .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null))
    .catch(() => null));

const PRESS_PROFILE_LABEL = "ISO Coated v2 (CMYK press)";

// ── Reference View (GAL-DEV-23) ──────────────────────────────────────────────
// LR's ⇧R two-up: the pinned reference beside the live develop canvas, with
// zoom and pan synchronized so a 1:1 develop view puts the reference on the
// matching part of its own frame. The develop zoom stays the single source of
// truth; the pane derives its transform from it.

/** The reference pane's transform for the current develop zoom. Both panes
 *  hold the same zoom FACTOR relative to their own fit and centre on the same
 *  normalized image point — the same shared-focal-point trick Compare uses.
 *  null = fit (the pane letterboxes on its intrinsic size). */
export function referenceZoom(
  zoom: DevZoom | null,
  shown: { w: number; h: number },
  view: { w: number; h: number },
  nat: { w: number; h: number },
  refView: { w: number; h: number },
): { scale: number; pan: Pan } | null {
  if (!zoom || zoom.scale <= 0) return null;
  if (shown.w <= 0 || shown.h <= 0 || view.w <= 0 || view.h <= 0) return null;
  if (nat.w <= 0 || nat.h <= 0 || refView.w <= 0 || refView.h <= 0) return null;
  const activeFit = fitScale(shown.w, shown.h, view.w, view.h);
  if (activeFit <= 0) return null;
  const scale = fitScale(nat.w, nat.h, refView.w, refView.h) * (zoom.scale / activeFit);
  // Centre of the active viewport, in normalized image coordinates. Clamp
  // first so a stale pan (stage resize) maps to what is actually on screen.
  const pan = clampPan(zoom.pan, shown.w, shown.h, zoom.scale, view.w, view.h);
  const nx = (view.w / 2 - pan.x) / (shown.w * zoom.scale);
  const ny = (view.h / 2 - pan.y) / (shown.h * zoom.scale);
  return { scale, pan: panForFocus(nx, ny, nat.w, nat.h, scale, refView.w, refView.h) };
}

/** The pane's own viewport: clips the zoomed reference and is what the synced
 *  pan is measured against. Inline because the pane's CSS is layout-only. */
const REF_VIEWPORT: CSSProperties = {
  alignItems: "center",
  display: "flex",
  flex: "1 1 auto",
  justifyContent: "center",
  minHeight: 0,
  overflow: "hidden",
  position: "relative",
  width: "100%",
};

/** Reference View pane: the pinned photo rendered from the shared preview
 *  store, side by side with the live develop canvas and following its zoom.
 *  Drop a filmstrip photo here to re-pin the reference (LR's drag-to-set).
 *  ponytail: the reference comes from the cached 2560px standard preview, so
 *  its "1:1" is preview pixels, and panning is driven from the develop canvas
 *  only — render it through the develop pipeline / add a reverse pan if
 *  pixel-peeping the reference itself ever matters. */
function ReferencePane({
  photoId,
  zoom,
  shown,
  view,
}: {
  photoId: number;
  zoom: DevZoom | null;
  shown: { w: number; h: number } | null;
  view: { w: number; h: number };
}) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  // Natural size of the loaded preview — the space the synced pan lives in.
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [refView, setRefView] = useState({ w: 0, h: 0 });
  const [dropOver, setDropOver] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setNat(null); // a new reference invalidates the old natural size
    (async () => {
      const photo = await getPhoto(photoId);
      if (!photo) return;
      url = await loadPreview(photo, "standard", 2560);
      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (url) setPreview({ url, name: basename(photo.path) });
    })().catch((e) => console.error("galerie reference: load failed", e));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photoId]);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setRefView({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const rz = shown && nat ? referenceZoom(zoom, shown, view, nat, refView) : null;
  return (
    <div
      className="gal-dev-ref"
      style={dropOver ? { outline: "2px solid var(--accent, #4c8dff)", outlineOffset: -2 } : undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PHOTO_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropOver(true);
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => {
        setDropOver(false);
        if (!e.dataTransfer.types.includes(PHOTO_DRAG_TYPE)) return;
        e.preventDefault();
        const [id] = readPhotoDrag(e.dataTransfer);
        if (id != null) store.setReference(id);
      }}
    >
      <div className="gal-dev-ref-label">Reference{preview ? ` — ${preview.name}` : ""}</div>
      <div ref={boxRef} style={REF_VIEWPORT}>
        {preview ? (
          <img
            src={preview.url}
            alt=""
            draggable={false}
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={
              rz && nat
                ? {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: nat.w,
                    height: nat.h,
                    maxWidth: "none",
                    maxHeight: "none",
                    transformOrigin: "0 0",
                    transform: `translate(${rz.pan.x}px, ${rz.pan.y}px) scale(${rz.scale})`,
                  }
                : { maxWidth: "100%", maxHeight: "100%" }
            }
          />
        ) : (
          <div className="gal-cell-spinner" />
        )}
      </div>
    </div>
  );
}

/** The active canvas's own half of the stage while the Reference pane is up:
 *  a positioned, clipping viewport so the zoomed (absolute) canvas wrap stays
 *  on its side instead of covering the whole stage. */
const REF_CANVAS_PANE: CSSProperties = {
  alignItems: "center",
  alignSelf: "stretch",
  display: "flex",
  flex: "1 1 50%",
  justifyContent: "center",
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
  position: "relative",
};

/** Idle gap after the last recipe edit before the full-proxy refine pass runs
 *  (PERF-11). Long enough that a slider drag never triggers one mid-drag,
 *  short enough that letting go feels like it sharpened immediately. */
const REFINE_MS = 200;

export function DevelopView() {
  const st = useCatalog();
  const active = st.activeId != null ? st.photos.find((p) => p.id === st.activeId) : undefined;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<ProgressiveDevelopSession | null>(null);
  // Develop stage long edge in DEVICE pixels — the draft tier's render size.
  // A ref so the ResizeObserver can refresh it without re-running the load
  // effect. ponytail: the draft tier is sized at photo open, so a window
  // resize does not re-open it; the refine pass is full-res either way.
  const viewEdgeRef = useRef(0);
  // Render tier for the next pass + the idle timer that promotes it back to
  // full; `lastRecipeRef` tells a recipe edit (drag frame) from a flag flip.
  const qualityRef = useRef<"draft" | "full">("full");
  const refineTimerRef = useRef<number | undefined>(undefined);
  const lastRecipeRef = useRef<DevelopRecipeV2 | null>(null);
  const pendingRef = useRef<DevelopRecipeV2 | null>(null);
  const rafRef = useRef(0);
  const persistRef = useRef<number | undefined>(undefined);
  const pendingSaveRef = useRef<{ id: number; recipe: DevelopRecipeV2 } | null>(null);
  // The photo id the current `recipe` was loaded for. Null across a switch (before
  // the new photo's recipe lands) so we never persist the old recipe under the new
  // id — `recipe` state lags `active` by one render during the switch.
  const loadedIdRef = useRef<number | null>(null);
  // Baseline for history diffing: the last-recorded recipe json for the loaded
  // photo. A persist that differs from it records a new history step (so the
  // redundant save right after a load doesn't spam the timeline).
  const historyBaselineRef = useRef<{ id: number; json: string } | null>(null);

  const [recipe, setRecipe] = useState<DevelopRecipeV2 | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  // Before/After (GAL-DEV-11): `beforeRecipe` is the comparison baseline —
  // seeded at load with the closest derivable "state at import" (see the load
  // effect) instead of a zeroed recipe, and settable via the Copy Before's/
  // After's Settings and Swap buttons below.
  // ponytail: Before renders globals only; rendering its mask stack would
  // need a second maskRenderJobs batch in renderOnce.
  const [showBefore, setShowBefore] = useState(false);
  const [beforeRecipe, setBeforeRecipe] = useState<DevelopRecipeV2>(createDefaultRecipe);
  // Y Before/After view (Lightroom's Y family): the Before render beside or
  // above the live canvas, in one of the four BALayout arrangements.
  // Exclusive with the full `\` flip.
  const [sideBySide, setSideBySide] = useState(false);
  const [baLayout, setBaLayout] = useState<BALayout>("leftRight");
  // Soft Proofing (GAL-DEV-15): see the module header above DevelopView.
  const [proofing, setProofing] = useState(false);
  const [proofIntent, setProofIntent] = useState(1); // moxcms id: 0 perceptual, 1 relative (LR default)
  const [proofPaperInk, setProofPaperInk] = useState(false);
  const [proofGamut, setProofGamut] = useState(true); // destination gamut warning
  // null = the bundled press profile; else a user-loaded printer/device ICC.
  const [proofProfile, setProofProfile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [proofLut, setProofLut] = useState<Uint8Array | null>(null);
  const beforeCanvasRef = useRef<HTMLCanvasElement>(null);
  // The Before render only changes with the photo or a Copy/Swap — cache it
  // per (session, beforeRecipe).
  const beforeImgRef = useRef<{
    session: unknown;
    recipe: DevelopRecipeV2;
    /** Tier it was rendered on — a draft Before must not pair with a full After. */
    quality: "draft" | "full";
    rgba: Uint8ClampedArray;
    width: number;
    height: number;
  } | null>(null);
  // Bumped after a history step is recorded/cleared so HistoryPanel reloads.
  const [historyRev, setHistoryRev] = useState(0);
  // The mask being edited (its geometry shows a drag overlay on the canvas).
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  // Whether the published develop frame carries a depth channel. Nothing builds
  // one today (no HEIC import, so no Portrait depth aux image), so this reads
  // false and the Depth Range button stays disabled rather than offering a mask
  // that would select zero pixels. It turns itself on the day a render site
  // populates RenderedFrame.depth — no code change needed here.
  const [hasDepth, setHasDepth] = useState(() => !!getOverlayFrame()?.base?.depth);
  useEffect(() => onOverlayFrame(() => setHasDepth(!!getOverlayFrame()?.base?.depth)), []);
  const [cropping, setCropping] = useState(false);
  // Heal tool: the on-canvas spot-removal overlay (mutually exclusive with Crop).
  const [healing, setHealing] = useState(false);
  // Red Eye Correction: armed mode ("eye" / "pet"), or null when the tool is
  // off. One state because the mode only exists while the tool owns the canvas.
  const [redEye, setRedEye] = useState<"eye" | "pet" | null>(null);
  // Visualize Spots (Lightroom's dust-reveal checkbox): a preview-only edge-map
  // display transform while the Heal tool is open. Never touches the recipe.
  const [visualizeHeal, setVisualizeHeal] = useState(false);
  const [visualizeThr, setVisualizeThr] = useState(0.5);
  // The last full (uncropped) frame shown while healing — the exact normalized
  // space heal spots live in, so the overlay can match source patches against it
  // without re-rendering on every click.
  const healFrameRef = useRef<{ rgba: Uint8ClampedArray; width: number; height: number } | null>(null);
  // Full (uncropped) frame size of the last render — the space masks live in;
  // the crop-view mapping needs it (straighten rotates in pixel space).
  const frameSizeRef = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!healing) setVisualizeHeal(false);
  }, [healing]);
  // Pixel size of the frame currently on the canvas (post-crop viewport). Its
  // aspect drives the wrapper's letterbox; the size anchors the 1:1 zoom.
  const [shownSize, setShownSize] = useState<{ w: number; h: number } | null>(null);
  const aspect = shownSize ? shownSize.w / shownSize.h : null;
  // Zoom: null = fit (the CSS letterbox); else 1:1 with a stage-space pan.
  const [zoom, setZoom] = useState<DevZoom | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stageRoRef = useRef<ResizeObserver | null>(null);
  const zoomDragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const zoomDraggedRef = useRef(false);
  // Space/Z toggle: a ref so the mount-once key listener sees current geometry.
  const zoomToggleRef = useRef<() => void>(() => {});
  // Measure the stage (the zoom viewport) via a ResizeObserver attached on mount.
  const measureStage = useCallback((el: HTMLDivElement | null) => {
    stageRoRef.current?.disconnect();
    stageRef.current = el;
    if (!el) {
      stageRoRef.current = null;
      return;
    }
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      viewEdgeRef.current = Math.round(Math.max(w, h) * (window.devicePixelRatio || 1));
      setView({ w, h });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    stageRoRef.current = ro;
    measure();
  }, []);
  // Entering/leaving Crop or Heal swaps the canvas between cropped and
  // full-frame space — a carried-over pan would land elsewhere, so reset to
  // fit (Space/Z re-zooms inside the tool).
  useEffect(() => {
    setZoom(null);
  }, [cropping, healing]);
  // Space/Z: Fit ↔ 1:1 (LR's Develop zoom keys). Capture phase + stopPropagation,
  // because the App-level culling handler routes Space/Z to "open Loupe" and
  // registered first — inside Develop these keys belong to the develop zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== " " && e.key.toLowerCase() !== "z") return;
      if (isEditableTarget(e.target)) return;
      // Space on a focused (closed) dropdown opens it, as on a native select.
      if (e.key === " " && (e.target as Element | null)?.closest?.('[role="combobox"]')) return;
      e.preventDefault();
      e.stopPropagation();
      zoomToggleRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  // Targeted Adjustment Tool: drag-on-image samples the pixel under the cursor
  // and adjusts whichever panel armed it — the Color Mixer's hue band, or the
  // Tone Curve's parametric region. Only one panel owns the canvas at a time, so
  // the armed panel is the state; the drag's origin target/value is captured on
  // pointer-down so the whole drag is one continuous edit.
  const [mixerChannel, setMixerChannel] = useState<MixerChannel>("hue");
  const [tatTarget, setTatTarget] = useState<"mixer" | "tone" | null>(null);
  const tatActive = tatTarget !== null;
  const tatDragRef = useRef<
    | { kind: "mixer"; band: number; startY: number; startValue: number }
    | { kind: "tone"; region: keyof ParametricRegions; startY: number; startValue: number }
    | null
  >(null);
  // Color-range mask picker: the mask id armed to receive a canvas color sample.
  const [pickingMaskId, setPickingMaskId] = useState<string | null>(null);
  // Brush painting: the armed brush mask + current brush settings; brushStrokeRef
  // holds the last dab position during a drag so dabs stay quarter-radius spaced.
  const [brushMaskId, setBrushMaskId] = useState<string | null>(null);
  // Point Color eyedropper armed: the next canvas click samples a socket colour.
  const [pickingPointColor, setPickingPointColor] = useState(false);
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    radius: 0.08,
    flow: 0.5,
    density: 1,
    erase: false,
  });
  const brushStrokeRef = useRef<{ x: number; y: number } | null>(null);
  // Select Subject inference in flight (disables the button, shows progress).
  const [subjectBusy, setSubjectBusy] = useState(false);
  // Sync… dialog (the Copy Settings panel picker in sync mode).
  const [syncOpen, setSyncOpen] = useState(false);

  // Flush a debounced recipe save immediately. Kept in a ref so the load/unmount
  // effect cleanups can call it without re-subscribing: a photo switch or unmount
  // must PERSIST the pending edit, not cancel it — otherwise the last <500ms of
  // edits are dropped when we free the session. The {id, recipe} pair is captured
  // together so we never write one photo's recipe under the next photo's id.
  const flushRef = useRef(() => {});
  flushRef.current = () => {
    window.clearTimeout(persistRef.current);
    const p = pendingSaveRef.current;
    if (!p) return;
    pendingSaveRef.current = null;
    void persistDevelopRecipe(
      p.id,
      p.recipe,
      historyBaselineRef.current?.id === p.id ? historyBaselineRef.current.json : null,
    ).then(
      ({ canonicalJson, historyRecorded }) => {
        // Local history state mutates only after Rust accepted/canonicalized the
        // recipe and, when needed, the native history write succeeded.
        historyBaselineRef.current = { id: p.id, json: canonicalJson };
        if (historyRecorded) setHistoryRev((v) => v + 1);
        // LR auto-write: develop edits refresh the sidecar too.
        const s = store.getState();
        const r = s.photos.find((x) => x.id === p.id);
        if (r) queueXmpWrite(r);
        // Auto Sync: mirror the committed edit onto the rest of the filmstrip
        // selection. Gated on historyRecorded so only a REAL change syncs — the
        // redundant save right after a photo load must not push that photo's
        // recipe over everything else. Fires per debounced commit, not per drag
        // frame, which is where LR lands too (it syncs on mouse-up).
        if (historyRecorded && s.autoSync && s.selection.length > 1) {
          void store.syncDevelop(p.id, s.selection, { quiet: true });
        }
      },
      () => {
        /* invalid recipe leaves catalog/history unchanged */
      },
    );
  };

  // Load the photo into a proxy + fetch its recipe when the active photo changes.
  useEffect(() => {
    sessionRef.current?.free();
    sessionRef.current = null;
    // A new photo's first frame is never a drag frame — open at full quality.
    window.clearTimeout(refineTimerRef.current);
    lastRecipeRef.current = null;
    qualityRef.current = "full";
    setRecipe(null);
    setZoom(null); // a new photo always opens at fit
    setSelectedMaskId(null);
    setBrushMaskId(null);
    setPickingMaskId(null);
    loadedIdRef.current = null; // recipe no longer corresponds to any photo until B loads
    historyBaselineRef.current = null;
    if (!active) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const [bytes, json, history] = await Promise.all([
          readFile(active.readPath),
          getRecipe(active.id),
          listHistory(active.id).catch(() => [] as HistoryRow[]),
        ]);
        const raw = active.format.startsWith("raw:");
        const loaded = json ? JSON.parse(json) as DevelopRecipeV2 : createDefaultRecipe();
        const session = await openProgressiveDevelopSession(
          bytes,
          raw,
          active.readPath,
          loaded,
          viewEdgeRef.current,
        );
        if (cancelled) {
          session.free();
          return;
        }
        sessionRef.current = session;
        if (cancelled) return;
        setRecipe(loaded);
        // Before baseline: the oldest history step when there is one, else the
        // recipe as imported — so an import develop preset IS the Before, not a
        // neutral render. ponytail: LR's true Before is the exact at-import
        // state; once edits exist that needs an import-time recipe column in
        // the catalog (history is append-only but capped at 200 rows).
        let before = loaded;
        const oldest = history[history.length - 1];
        if (oldest) {
          try {
            before = JSON.parse(oldest.recipeJson) as DevelopRecipeV2;
          } catch {
            /* undecodable old step: keep the loaded recipe as Before */
          }
        }
        setBeforeRecipe(before);
        loadedIdRef.current = active.id; // recipe now belongs to this photo → safe to persist
        historyBaselineRef.current = json ? { id: active.id, json } : null;
        setStatus("idle");
      } catch (e) {
        console.error("galerie develop: load failed", active.path, e);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(refineTimerRef.current);
      flushRef.current(); // persist the outgoing photo's pending edit before freeing
      sessionRef.current?.free();
      sessionRef.current = null;
    };
  }, [active?.id, active?.path]);

  // Render on recipe change, coalesced to one develop per animation frame.
  // The develop passes themselves run in the session's worker (PERF-03), so a
  // slider drag never blocks the UI thread; busy/dirty keep exactly one batch
  // in flight and always re-render the latest recipe + flags afterwards.
  // Flags ride a ref (refreshed every React render) so the async pass snapshots
  // current values, and a pass whose flag snapshot went stale mid-flight skips
  // its blit — the overlay coordinate contract depends on the flags a frame
  // was rendered with, and the dirty rerun blits with the fresh ones.
  // The proof rides the flags ref like the tool toggles: `proofLut` is null
  // until the bake lands, so an in-flight bake just means one unproofed frame.
  const renderFlagsRef = useRef({ showBefore, sideBySide, baLayout, cropping, healing, visualizeHeal, visualizeThr, proofLut, proofPaperInk, proofGamut });
  renderFlagsRef.current = { showBefore, sideBySide, baLayout, cropping, healing, visualizeHeal, visualizeThr, proofLut, proofPaperInk, proofGamut };
  const renderBusyRef = useRef(false);
  const renderDirtyRef = useRef(false);
  const renderOnce = async () => {
    const session = sessionRef.current;
    const cv = canvasRef.current;
    const r = pendingRef.current;
    if (!session || !cv || !r) return;
    const f = renderFlagsRef.current;
    // Tier for this pass (PERF-11), snapshotted like the flags: the dirty
    // rerun below picks up a refine that landed mid-flight.
    const quality = qualityRef.current;
    // In the Y view the main canvas always shows After; the flip only applies
    // to the single-canvas mode.
    const flipBefore = f.showBefore && !f.sideBySide;
    // ONE worker round trip carries every engine pass this frame needs:
    // [Y-view Before?, base, one pass per contributing mask]. The Before frame
    // sits first so a maskRenderJobs drift can never consume it.
    let cache = beforeImgRef.current;
    const wantBefore =
      f.sideBySide &&
      (!cache || cache.session !== session || cache.recipe !== beforeRecipe || cache.quality !== quality);
    const jobs = flipBefore ? [] : maskRenderJobs(r);
    const recipes = [...(wantBefore ? [beforeRecipe] : []), flipBefore ? beforeRecipe : r, ...jobs];
    let frames: DecodedImage[];
    try {
      frames = await session.renderBatch(recipes, quality);
    } catch {
      return; // session freed mid-flight (photo switch) — the new load re-renders
    }
    if (sessionRef.current !== session) return; // stale: a newer session owns the canvas
    const g = renderFlagsRef.current;
    if (
      g.showBefore !== f.showBefore || g.sideBySide !== f.sideBySide ||
      g.baLayout !== f.baLayout ||
      g.cropping !== f.cropping || g.healing !== f.healing ||
      g.visualizeHeal !== f.visualizeHeal || g.visualizeThr !== f.visualizeThr ||
      g.proofLut !== f.proofLut || g.proofPaperInk !== f.proofPaperInk || g.proofGamut !== f.proofGamut
    ) {
      return; // flags flipped while rendering: the dirty rerun blits instead
    }
    const img = frames[wantBefore ? 1 : 0];
    // Local (masked) adjustments: composite each enabled mask over the base,
    // replaying the pre-rendered per-mask frames — the same sync compositeMasks
    // Export/Print use, so the overlay frame still publishes on this thread.
    // Before/After shows the global-only base.
    const out = flipBefore
      ? new Uint8ClampedArray(img.rgba)
      : compositeMasks(replayFrames(frames.slice(wantBefore ? 2 : 1), img), r, img);
    // Crop is the final viewport step — masks are already folded in full-image
    // space, and it applies to Before/After alike (a viewport, not a develop
    // comparison). While the Crop or Heal tool is active, show the full frame
    // so the overlay geometry lines up with the un-cropped source space.
    const shown = !f.cropping && !f.healing
      ? applyCrop({ rgba: out, width: img.width, height: img.height }, r.crop)
      : { rgba: out, width: img.width, height: img.height };
    frameSizeRef.current = { width: img.width, height: img.height };
    // Only the After frame is a valid heal source (Before is the baseline look).
    healFrameRef.current = f.healing && !flipBefore ? shown : null;
    // Refresh the Before cache from this batch's leading frame, then derive
    // the cropped Before view every two-up layout shares.
    if (wantBefore) {
      const b = frames[0];
      cache = {
        session,
        recipe: beforeRecipe,
        quality,
        rgba: new Uint8ClampedArray(b.rgba),
        width: b.width,
        height: b.height,
      };
      beforeImgRef.current = cache;
    }
    let bshown: { rgba: Uint8ClampedArray; width: number; height: number } | null = null;
    if (f.sideBySide && cache) {
      const bfull = { rgba: new Uint8ClampedArray(cache.rgba), width: cache.width, height: cache.height };
      bshown = !f.cropping && !f.healing ? applyCrop(bfull, r.crop) : bfull;
    }
    // Split layouts fold the Before half into the single After canvas. Never
    // while healing — healFrameRef aliases `shown`, and the heal source must
    // match pure After pixels.
    const split = f.sideBySide && isSplitLayout(f.baLayout) && !f.healing;
    const didSplit =
      split && bshown != null &&
      compositeSplit(shown.rgba, bshown.rgba, shown.width, shown.height, f.baLayout === "splitTB");
    if (cv.width !== shown.width) cv.width = shown.width;
    if (cv.height !== shown.height) cv.height = shown.height;
    setShownSize((p) => (p && p.w === shown.width && p.h === shown.height ? p : { w: shown.width, h: shown.height }));
    const ctx = cv.getContext("2d");
    if (ctx) {
      // Visualize Spots: swap in the dust-reveal edge map while healing.
      const view =
        f.healing && f.visualizeHeal
          ? visualizeSpots(shown.rgba, shown.width, shown.height, f.visualizeThr)
          : shown.rgba;
      // Soft proof (GAL-DEV-15): remap the outgoing pixels — after the split
      // composite, so both halves proof. Never while healing: healFrameRef
      // aliases these bytes and the heal source matcher needs true render
      // values (LR likewise drops the proof inside the heal tool).
      if (f.proofLut && !f.healing) {
        applySoftProof(view, f.proofLut, { paperInk: f.proofPaperInk, gamutWarning: f.proofGamut });
      }
      // The buffer is always a fresh clamped buffer (concrete ArrayBuffer) at
      // runtime; the cast narrows the declared ArrayBufferLike for ImageData.
      const data = view as Uint8ClampedArray<ArrayBuffer>;
      ctx.putImageData(new ImageData(data, shown.width, shown.height), 0, 0);
      if (didSplit) {
        // 1px seam so the split boundary reads (LR draws the same divider).
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        if (f.baLayout === "splitTB") ctx.fillRect(0, Math.floor(shown.height / 2), shown.width, 1);
        else ctx.fillRect(Math.floor(shown.width / 2), 0, 1, shown.height);
      }
    }
    // Two-pane layouts: blit the cached Before render into its own pane
    // through the same crop viewport, so both panes show the same framing.
    const bcv = beforeCanvasRef.current;
    if (f.sideBySide && !split && bcv && bshown) {
      if (bcv.width !== bshown.width) bcv.width = bshown.width;
      if (bcv.height !== bshown.height) bcv.height = bshown.height;
      const bctx = bcv.getContext("2d");
      if (bctx) {
        const bdata = bshown.rgba as Uint8ClampedArray<ArrayBuffer>;
        // Proof the Before pane too — LR proofs the whole view, and `bdata` is
        // this render's own copy, never the beforeImgRef cache.
        if (f.proofLut && !f.healing) {
          applySoftProof(bdata, f.proofLut, { paperInk: f.proofPaperInk, gamutWarning: f.proofGamut });
        }
        bctx.putImageData(new ImageData(bdata, bshown.width, bshown.height), 0, 0);
      }
    }
  };
  // Kept in a ref (same pattern as flushRef) so the mount-scoped effect below
  // always runs the latest pass without depending on this render's closure.
  const renderPassRef = useRef(() => {});
  renderPassRef.current = () => {
    if (renderBusyRef.current) {
      renderDirtyRef.current = true;
      return;
    }
    renderBusyRef.current = true;
    void (async () => {
      try {
        do {
          renderDirtyRef.current = false;
          await renderOnce();
        } while (renderDirtyRef.current);
      } finally {
        renderBusyRef.current = false;
      }
    })();
  };
  // Draft → refine (PERF-11). A recipe change is a potential drag frame, so it
  // renders on the draft tier and (re)arms the refine timer — a drag therefore
  // costs one draft develop per frame plus ONE full pass when it stops. A flag
  // flip (Y, proof, tool toggle) is a discrete action, not a drag, so it goes
  // straight to full. So do zoom (a 1:1 view of a fit-sized draft reads soft)
  // and the Crop/Heal tools, whose overlays are pinned to the frame's pixels.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    if (!recipe) return;
    pendingRef.current = recipe;
    const edited = lastRecipeRef.current !== null && lastRecipeRef.current !== recipe;
    lastRecipeRef.current = recipe;
    const f = renderFlagsRef.current;
    window.clearTimeout(refineTimerRef.current);
    if (edited && !zoomRef.current && !f.cropping && !f.healing) {
      qualityRef.current = "draft";
      refineTimerRef.current = window.setTimeout(() => {
        qualityRef.current = "full";
        renderPassRef.current();
      }, REFINE_MS);
    } else {
      qualityRef.current = "full";
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      renderPassRef.current();
    });
    // The flag deps matter even though renderOnce reads them from the ref: a
    // flag flip must schedule a pass of its own (the recipe may not change).
  }, [recipe, showBefore, sideBySide, baLayout, beforeRecipe, cropping, healing, visualizeHeal, visualizeThr, proofLut, proofPaperInk, proofGamut]);

  // `\` toggles the full Before/After flip; `Y` the two-up view, `⇧Y` its
  // split variant, `⌥Y` its orientation (Lightroom's Y family). Each turns
  // the other mode off. Ignored while typing. Y matches on e.code because
  // macOS ⌥Y types "¥".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isFlip = e.key === "\\" && !e.altKey;
      const isY = e.code === "KeyY";
      if ((!isFlip && !isY) || e.metaKey || e.ctrlKey) return;
      if (isEditableTarget(e.target)) return;
      if (isFlip) {
        setShowBefore((v) => !v);
        setSideBySide(false);
        return;
      }
      if (e.altKey || e.shiftKey) {
        setBaLayout((l) => cycleBALayout(l, e.altKey ? "orient" : "split"));
        setSideBySide(true); // ⇧Y/⌥Y with the view off turns it on, like LR
      } else {
        setSideBySide((v) => !v);
      }
      setShowBefore(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // S: Soft Proofing toggle (LR's Develop shortcut). Capture + stopPropagation
  // because the App-level handler routes S to stack-toggling and registered
  // first — inside Develop the key belongs to the proof (same pattern as
  // Space/Z above).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "s") return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      setProofing((v) => !v);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Bake the proof LUT whenever the proof target changes. The bake runs in the
  // main-thread engine (a 33³ lattice, one-off per profile/intent — not per
  // frame); a failed bake notifies and leaves the render unproofed.
  useEffect(() => {
    if (!proofing) {
      setProofLut(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const bytes = proofProfile?.bytes ?? (await fetchPressProfile());
      const lut = bytes?.length ? await bakeProofLut(bytes, proofIntent) : new Uint8Array(0);
      if (cancelled) return;
      if (!lut.length) {
        store.notify(`Soft proof unavailable: ${proofProfile?.name ?? PRESS_PROFILE_LABEL} could not be loaded.`);
      }
      setProofLut(lut.length ? lut : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [proofing, proofProfile, proofIntent]);

  // "Other profile…": load a printer/device ICC from disk. Validated at this
  // trust boundary (sniffProofProfile) so a junk file reads as an error, not a
  // silently-wrong proof.
  const loadProofProfile = async () => {
    try {
      const path = await openFileDialog({
        multiple: false,
        filters: [{ name: "ICC profiles", extensions: ["icc", "icm"] }],
      });
      if (typeof path !== "string") return;
      const bytes = await readFile(path);
      setProofProfile({ name: sniffProofProfile(basename(path), bytes).name, bytes });
    } catch (e) {
      store.notify(String(e));
    }
  };

  // LR's Previous button: take the settings of the photo we were on before this
  // one and drop them on the current photo. Goes through setRecipe so it renders,
  // persists and lands in History like any other edit.
  const applyPrevious = async () => {
    const prev = store.getState().prevActiveId;
    if (prev == null) return;
    try {
      const json = await getRecipe(prev);
      if (!json) {
        store.notify("The previous photo has no develop settings.");
        return;
      }
      setRecipe(normalizeRecipe(JSON.parse(json) as unknown));
    } catch (e) {
      store.notify(String(e));
    }
  };

  // Develop > Reset (⇧⌘R), dispatched from the menu/shortcut in App via
  // resetDevelopAdjustments. Claimed here so the reset flows through setRecipe
  // (render + persist + History) instead of the store writing behind our back.
  useEffect(() => {
    const onReset = (e: Event) => claimDevelopReset(e, loadedIdRef.current, setRecipe);
    window.addEventListener(DEVELOP_RESET_EVENT, onReset);
    return () => window.removeEventListener(DEVELOP_RESET_EVENT, onReset);
  }, []);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    flushRef.current();
  }, []);

  // Debounced persistence of the canonical recipe to the catalog. No cleanup-cancel
  // here: a photo switch/unmount flushes the pending save (see the load + unmount
  // effects) rather than dropping it. pendingSaveRef pins the recipe to its photo id.
  useEffect(() => {
    // loadedIdRef pins the recipe to its photo; it's null during a switch, so we
    // never schedule a save that would write the outgoing recipe under the new id.
    if (!recipe || loadedIdRef.current == null) return;
    pendingSaveRef.current = { id: loadedIdRef.current, recipe };
    window.clearTimeout(persistRef.current);
    persistRef.current = window.setTimeout(() => flushRef.current(), 500);
  }, [recipe, active?.id]);

  // Mask-graph editing — all edits go through setRecipe(masks) so they render +
  // persist through the normal Develop path (recipe.masks is canonical).
  const masks = recipe?.masks.masks ?? [];
  const selectedMask = masks.find((m) => m.id === selectedMaskId) ?? null;
  const setMasks = (next: Mask[]) =>
    setRecipe((prev) => (prev ? { ...prev, masks: { masks: next } } : prev));
  const withMaskComponent = (mask: Mask, compId: string, next: Mask["components"][number]): Mask => ({
    ...mask,
    components: mask.components.map((c) => (c.id === compId ? next : c)),
  });
  // The component a canvas edit (paint / color-pick) targets in `mask`: the
  // selected one if it's the right kind, else the first of that kind (so a
  // single-component base mask still works when nothing is explicitly selected).
  const editComponent = (mask: Mask, kind: string) =>
    mask.components.find((c) => c.id === selectedComponentId && c.kind === kind) ??
    mask.components.find((c) => c.kind === kind);
  const MASK_LABELS: Record<GradientKind | RangeKind | DepthKind | "brush", string> = {
    linearGradient: "Linear",
    radialGradient: "Radial",
    rangeColor: "Color",
    rangeLuminance: "Luma",
    rangeDepth: "Depth",
    brush: "Brush",
  };
  const addMask = (kind: GradientKind | RangeKind | DepthKind | "brush") => {
    const id = crypto.randomUUID();
    const n = masks.filter((m) => m.components[0]?.kind === kind).length + 1;
    const name = `${MASK_LABELS[kind]} ${n}`;
    const mask =
      kind === "linearGradient" || kind === "radialGradient"
        ? newGradientMask(kind, id, name)
        : kind === "brush"
          ? newBrushMask(id, name)
          : newRangeMask(kind, id, name);
    setMasks([...masks, mask]);
    setSelectedMaskId(id);
    setSelectedComponentId(null); // new mask → edit its base component
    if (kind === "brush") setBrushMaskId(id); // arm painting immediately
  };
  // Append a component to the selected mask (Add/Subtract/Intersect refinement);
  // computeMaskCoverage already folds the ordered components by combine mode.
  const addComponent = (kind: ComponentKind) => {
    const target = selectedMask;
    if (!target) return;
    const cid = crypto.randomUUID();
    setMasks(
      masks.map((m) =>
        m.id === target.id ? { ...m, components: [...m.components, newComponent(kind, cid, "add")] } : m,
      ),
    );
    setSelectedComponentId(cid);
    if (kind === "brush") {
      setPickingMaskId(null);
      setBrushMaskId(target.id); // arm painting the new brush component immediately
    } else {
      setBrushMaskId(null);
      setPickingMaskId(null); // a non-brush component ends any armed paint/pick
    }
  };
  const selectMask = (id: string) => {
    setSelectedMaskId(id);
    setSelectedComponentId(null); // default to editing the mask's base component
    setBrushMaskId(null);
    setPickingMaskId(null); // navigating masks ends any armed paint/pick
  };
  const updateMask = (updated: Mask) => setMasks(masks.map((m) => (m.id === updated.id ? updated : m)));
  // Duplicate (optionally inverted) right below the source, and select the copy
  // — LR's Duplicate and Invert Mask lands you on the half you just made.
  const duplicateMaskAt = (id: string, invert: boolean) => {
    const i = masks.findIndex((m) => m.id === id);
    if (i < 0) return;
    const copy = duplicateMask(masks[i], () => crypto.randomUUID(), invert);
    setMasks([...masks.slice(0, i + 1), copy, ...masks.slice(i + 1)]);
    setSelectedMaskId(copy.id);
    setSelectedComponentId(null);
  };
  const deleteMask = (id: string) => {
    setMasks(masks.filter((m) => m.id !== id));
    setSelectedMaskId((cur) => (cur === id ? null : cur));
    setSelectedComponentId(null);
  };

  // TAT: set the current sub-channel's value for one band (immutable band array).
  const setMixerBand = (band: number, value: number) =>
    setRecipe((prev) =>
      prev
        ? {
            ...prev,
            colorMixer: {
              ...prev.colorMixer,
              [mixerChannel]: prev.colorMixer[mixerChannel].map((x, j) => (j === band ? value : x)),
            },
          }
        : prev,
    );
  // Canvas pixel coordinates under a pointer event (null if outside the canvas).
  const canvasPixel = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] | null => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const cx = Math.floor(((e.clientX - rect.left) / rect.width) * cv.width);
    const cy = Math.floor(((e.clientY - rect.top) / rect.height) * cv.height);
    if (cx < 0 || cy < 0 || cx >= cv.width || cy >= cv.height) return null;
    return [cx, cy];
  };
  // Sample the RGBA of the canvas pixel under a pointer event (null if outside).
  const samplePixel = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number, number] | null => {
    const ctx = canvasRef.current?.getContext("2d", { willReadFrequently: true });
    const p = canvasPixel(e);
    if (!ctx || !p) return null;
    const [r, g, b] = ctx.getImageData(p[0], p[1], 1, 1).data;
    return [r, g, b];
  };
  // Set one parametric tone region (immutable, like setMixerBand).
  const setToneRegion = (region: keyof ParametricRegions, value: number) =>
    setRecipe((prev) =>
      prev
        ? {
            ...prev,
            toneCurve: { ...prev.toneCurve, parametric: { ...prev.toneCurve.parametric, [region]: value } },
          }
        : prev,
    );
  const tatPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!recipe) return;
    const rgb = samplePixel(e);
    if (!rgb) return;
    if (tatTarget === "tone") {
      const region = toneRegionForPixel(rgb[0], rgb[1], rgb[2], recipe.toneCurve.parametricSplits);
      tatDragRef.current = {
        kind: "tone",
        region,
        startY: e.clientY,
        startValue: recipe.toneCurve.parametric[region],
      };
    } else {
      const band = bandForPixel(rgb[0], rgb[1], rgb[2]);
      tatDragRef.current = {
        kind: "mixer",
        band,
        startY: e.clientY,
        startValue: recipe.colorMixer[mixerChannel][band],
      };
    }
    canvasRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  // Color-range picking: press anchors, release commits one averaged sample.
  // A click averages a small patch (a lone pixel samples sensor noise); drag a
  // rectangle to average a whole region, like LR's Color Range picker. The
  // picker stays armed so up to MAX_COLOR_RANGE_SAMPLES land per arm.
  // ponytail: the drag rectangle has no live marquee — it commits on release;
  // upgrade path is a rubber-band rect in MaskOverlay if it proves fiddly.
  const COLOR_PICK_PATCH = 5; // odd, an eyedropper-style "5 by 5 average" click
  const colorPickAnchorRef = useRef<[number, number] | null>(null);
  const pickColorAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    colorPickAnchorRef.current = canvasPixel(e);
    canvasRef.current?.setPointerCapture(e.pointerId); // so the release always lands here
    e.preventDefault();
  };
  const pickColorUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = colorPickAnchorRef.current;
    colorPickAnchorRef.current = null;
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d", { willReadFrequently: true });
    if (!start || !cv || !ctx || !pickingMaskId) return;
    const target = masks.find((m) => m.id === pickingMaskId);
    const c = target && editComponent(target, "rangeColor");
    if (!c || c.kind !== "rangeColor" || c.samples.length >= MAX_COLOR_RANGE_SAMPLES) return;
    const end = canvasPixel(e) ?? start; // released off-canvas → treat as a click
    // A click (no real drag) widens to a patch; a drag uses its own rectangle.
    const dragged = Math.abs(end[0] - start[0]) > 1 || Math.abs(end[1] - start[1]) > 1;
    const pad = dragged ? 0 : (COLOR_PICK_PATCH - 1) / 2;
    const x0 = Math.max(0, Math.min(start[0], end[0]) - pad);
    const y0 = Math.max(0, Math.min(start[1], end[1]) - pad);
    const x1 = Math.min(cv.width - 1, Math.max(start[0], end[0]) + pad);
    const y1 = Math.min(cv.height - 1, Math.max(start[1], end[1]) + pad);
    const sample = averageRgbSample(ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data);
    const samples = [...c.samples, sample];
    setMasks(masks.map((m) => (m.id === pickingMaskId ? withMaskComponent(m, c.id, { ...c, samples }) : m)));
    if (samples.length >= MAX_COLOR_RANGE_SAMPLES) setPickingMaskId(null); // LR's cap
    e.preventDefault();
  };
  // Sample a pixel into a new Point Color socket, then disarm the eyedropper.
  const pickPointColorAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rgb = samplePixel(e);
    if (!rgb) return;
    setRecipe((prev) => {
      if (!prev || prev.pointColor.samples.length >= 8) return prev;
      return {
        ...prev,
        pointColor: { samples: [...prev.pointColor.samples, sampleToSocket(rgb[0], rgb[1], rgb[2])] },
      };
    });
    setPickingPointColor(false);
    e.preventDefault();
  };
  // Normalized (0..1) canvas coordinates for a pointer event.
  const canvasNorm = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return null;
    return { x, y };
  };
  // The crop viewport currently shown, or null when the canvas displays the
  // full frame (identity crop, or the Crop/Heal tools' full-frame view). Masks
  // are stored in full-frame space, so on-canvas mask edits map through this.
  const maskCropView = (): CropView | null => {
    const f = frameSizeRef.current;
    if (!recipe || !f || cropping || healing || isIdentityCrop(recipe.crop)) return null;
    return { rect: recipe.crop.rect, angle: recipe.crop.angle, width: f.width, height: f.height };
  };
  // Append a dab to the armed brush mask if the pointer moved far enough.
  // Display points/radius map into full-frame mask space when the view is
  // cropped, so a stroke lands exactly where it was painted.
  const stampDab = (disp: { x: number; y: number }) => {
    const view = maskCropView();
    const p = view ? cropToFrame(view, disp.x, disp.y) : disp;
    const settings = view
      ? { ...brushSettings, radius: cropRadiusToFrame(view, brushSettings.radius) }
      : brushSettings;
    const dab = strokeDab(brushStrokeRef.current, p.x, p.y, settings);
    if (!dab) return;
    brushStrokeRef.current = p;
    setMasks(
      masks.map((m) => {
        if (m.id !== brushMaskId) return m;
        const c = editComponent(m, "brush");
        if (!c || c.kind !== "brush") return m;
        return withMaskComponent(m, c.id, { ...c, dabs: [...c.dabs, dab] });
      }),
    );
  };
  const brushPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = canvasNorm(e);
    if (!p) return;
    brushStrokeRef.current = null; // new stroke: first dab always stamps
    stampDab(p);
    canvasRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const brushPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.buttons !== 1) return;
    const p = canvasNorm(e);
    if (p) stampDab(p);
  };
  const brushPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    brushStrokeRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };
  const clearBrushDabs = (maskId: string) =>
    setMasks(
      masks.map((m) => {
        if (m.id !== maskId) return m;
        const c = editComponent(m, "brush");
        if (!c || c.kind !== "brush") return m;
        return withMaskComponent(m, c.id, { ...c, dabs: [] });
      }),
    );
  // Red Eye / Pet Eye Correction (GAL-DEV-26): click an eye and the detected
  // pupil becomes a radial mask that desaturates and darkens it — the same
  // neutral-from-green/blue result the raster engine's Red Eye tool produces,
  // expressed in the mask graph so it renders, persists, exports and stays
  // draggable (MaskOverlay) like any other local edit. Pet Eye darkens harder
  // because a tapetum reflection is a bright glow, not a red tint.
  // ponytail: no dedicated recipe field — the 1086-float develop ABI has no
  // red-eye slot, and a mask says everything a disc-shaped correction needs.
  // Upgrade path if a big pupil ever reads soft: a `redEye` panel + engine pass
  // on a new advanced-tail version, like the heal block.
  const RED_EYE_SEARCH = 0.03; // of the shorter side — LR's click slop
  const RED_EYE_PAD = 1.25; // mask edge sits just outside the detected pupil
  const RED_EYE_FEATHER = 0.4;
  const placeRedEye = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d", { willReadFrequently: true });
    const p = canvasPixel(e);
    const n = canvasNorm(e);
    if (!cv || !ctx || !p || !n || !recipe) return;
    e.preventDefault();
    const pet = redEye === "pet";
    const maxR = Math.max(4, Math.round(Math.min(cv.width, cv.height) * RED_EYE_SEARCH));
    // One whole-canvas read per click (a click is rare; a windowed read would
    // only buy offset bugs).
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const found = findRedEyePupil(px, cv.width, cv.height, p[0], p[1], maxR, pet);
    if (!found) {
      store.notify(
        pet ? "No pet eye found there — click the bright pupil." : "No red eye found there — click the red pupil.",
      );
      return;
    }
    const id = crypto.randomUUID();
    const label = pet ? "Pet Eye" : "Red Eye";
    const name = `${label} ${masks.filter((m) => m.name.startsWith(label)).length + 1}`;
    // Built in displayed-canvas space; a cropped view maps it back to the
    // full-frame space masks are stored in, exactly like an overlay drag.
    const seed = createMask(id, name, {
      kind: "radialGradient",
      id: `${id}-c`,
      combine: "add",
      invert: false,
      cx: found.x / cv.width,
      cy: found.y / cv.height,
      rx: (found.radius * RED_EYE_PAD) / cv.width,
      ry: (found.radius * RED_EYE_PAD) / cv.height,
      angle: 0,
      feather: RED_EYE_FEATHER,
    });
    const mask: Mask = {
      ...seed,
      // Local units are the Basic domain (slider × scale): saturation −1 is a
      // full desaturation to the pupil's own luminance, exposure is in EV.
      adjustments: { ...seed.adjustments, saturation: -1, exposure: pet ? -1.5 : -0.6 },
    };
    const view = maskCropView();
    setMasks([...masks, view ? maskToFrameSpace(mask, view) : mask]);
    setSelectedMaskId(mask.id);
    setSelectedComponentId(null);
  };

  // Select Subject: run U²-Net on the current global render, cache its coverage,
  // and add an AI mask referencing it. Inference is async + WASM-gated.
  const runSelectSubject = async () => {
    const session = sessionRef.current;
    if (!session || !recipe || subjectBusy) return;
    setSubjectBusy(true);
    try {
      const img = await session.render(recipe);
      const cacheId = crypto.randomUUID();
      const coverage = await computeSubjectMask(
        cacheId,
        new Uint8ClampedArray(img.rgba),
        img.width,
        img.height,
      );
      const id = crypto.randomUUID();
      const n = masks.filter((m) => m.components[0]?.kind === "aiSubject").length + 1;
      setMasks([...masks, newAiSubjectMask(id, `Subject ${n}`, cacheId)]);
      setSelectedMaskId(id);
      store.notify(`Subject selected (${Math.round(coverage * 100)}% of frame).`);
    } catch (e) {
      console.error("galerie select subject failed", e);
      store.notify("Select Subject failed — the model could not run.");
    } finally {
      setSubjectBusy(false);
    }
  };
  // Auto Tone: set the Basic tone group (Exposure/Contrast/Highlights/Shadows/
  // Whites/Blacks) from the current image's luma histogram. Measured from a
  // tone-neutral render (the whole group zeroed) so Auto is absolute and
  // idempotent — clicking it twice yields the same result.
  const applyAutoTone = async () => {
    const session = sessionRef.current;
    if (!session || !recipe) return;
    const zeroed = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
    const neutral = { ...recipe, basic: { ...recipe.basic, ...zeroed } };
    let img: DecodedImage;
    try {
      img = await session.render(neutral);
    } catch {
      return; // session freed mid-flight (photo switch)
    }
    const tone = autoTone(channelCounts(img.rgba, "luma"));
    setRecipe((prev) => (prev ? { ...prev, basic: { ...prev.basic, ...tone } } : prev));
  };
  const tatPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = tatDragRef.current;
    if (!drag) return;
    const dy = drag.startY - e.clientY;
    if (drag.kind === "tone") setToneRegion(drag.region, toneTatValue(drag.startValue, dy));
    else setMixerBand(drag.band, tatBandValue(drag.startValue, dy));
  };
  const tatPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!tatDragRef.current) return;
    tatDragRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  // Zoom gestures (the canvas fallback when no develop tool is armed): click
  // toggles Fit ↔ 1:1 at the clicked point, drag pans while zoomed — the same
  // gestures as the Library Loupe.
  const fitBoxInStage = () => {
    const cv = canvasRef.current;
    const stage = stageRef.current;
    if (!cv || !stage) return null;
    const r = cv.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return { left: r.left - s.left, top: r.top - s.top, width: r.width, stage: s };
  };
  zoomToggleRef.current = () => {
    if (zoom) {
      setZoom(null);
      return;
    }
    const fit = fitBoxInStage();
    if (!fit || !shownSize) return;
    setZoom(toggleZoomAt(null, view.w / 2, view.h / 2, fit, shownSize, view));
  };
  const zoomPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!zoom) return; // fit mode: the click handler zooms
    zoomDraggedRef.current = false;
    zoomDragRef.current = { sx: e.clientX, sy: e.clientY, px: zoom.pan.x, py: zoom.pan.y };
    canvasRef.current?.setPointerCapture(e.pointerId);
  };
  const zoomPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = zoomDragRef.current;
    if (!d || !zoom || !shownSize) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) zoomDraggedRef.current = true;
    const next = { x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) };
    setZoom({ scale: zoom.scale, pan: clampPan(next, shownSize.w, shownSize.h, zoom.scale, view.w, view.h) });
  };
  const zoomPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    zoomDragRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };
  const zoomClick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (zoomDraggedRef.current) {
      zoomDraggedRef.current = false; // a pan gesture is not a zoom toggle
      return;
    }
    const fit = fitBoxInStage();
    if (!fit || !shownSize) return;
    setZoom(toggleZoomAt(zoom, e.clientX - fit.stage.left, e.clientY - fit.stage.top, fit, shownSize, view));
  };

  if (!active) {
    return (
      <div className="gal-empty">
        <div className="gal-empty-title">No photo selected</div>
        <div className="gal-empty-sub">Select a photo, then press D for Develop.</div>
      </div>
    );
  }

  // "Detect Spots": seed heal spots from luminance anomalies in the current
  // render (which already includes existing heals, so re-detection converges
  // instead of re-finding fixed spots). Replaces the spot list, like ACR.
  const detectHealSpots = async () => {
    const session = sessionRef.current;
    if (!session || !recipe) return;
    let img: DecodedImage;
    try {
      img = await session.render(recipe);
    } catch {
      return; // session freed mid-flight (photo switch)
    }
    const found = detectDustSpots(img.rgba, img.width, img.height, {
      sensitivity: 0.6,
      maxSpots: MAX_HEAL_SPOTS,
    });
    const spots = found.map((s, i) => ({
      mode: "heal" as const,
      x: s.x,
      y: s.y,
      // Match the source against the pixels, keeping clear of the other spots.
      ...pickHealSource(img.rgba, img.width, img.height, s, {
        avoid: found.filter((_, j) => j !== i),
      }),
      radius: Math.max(0.01, s.radius),
      feather: 0.5,
      opacity: 1,
    }));
    setRecipe((prev) => (prev ? { ...prev, heal: { spots } } : prev));
  };

  // Content-aware source for the overlay, matched against the cached frame.
  const pickSourceFor = (spot: DetectedSpot, avoid: readonly DetectedSpot[], rank: number) => {
    const f = healFrameRef.current;
    return f ? pickHealSource(f.rgba, f.width, f.height, spot, { avoid, rank }) : null;
  };

  // The crop viewport the mask overlay maps through (null = full frame shown).
  const maskView = maskCropView();

  // Zoom gestures only when no develop tool owns the canvas (Crop/Heal draw
  // their overlays over the full frame; TAT/brush/pickers own the pointer).
  const zoomable =
    !cropping && !healing && !redEye && !tatActive && !brushMaskId && !pickingMaskId && !pickingPointColor;

  // Split layouts fold into the single canvas; two-pane layouts get a Before
  // pane, stacked above the canvas when the orientation is Top/Bottom.
  const splitView = isSplitLayout(baLayout);

  // The pinned Reference photo, unless it IS the photo being developed.
  const refPhotoId =
    st.referenceActive && st.referencePhotoId != null && st.referencePhotoId !== active.id
      ? st.referencePhotoId
      : null;

  // The develop canvas and its overlays. With the Reference pane up the
  // zoomed wrap (absolute) would cover the whole stage, so it gets a
  // clipping viewport of its own — and THAT viewport, not the stage, is the
  // zoom viewport we measure.
  const canvasWrap = (
    <div
      className="gal-dev-canvas-wrap"
      style={
        zoom && shownSize
          ? zoomWrapStyle(zoom, shownSize, view)
          : aspect
            ? { aspectRatio: String(aspect) }
            : undefined
      }
    >
      <canvas
        ref={canvasRef}
        className={
          "gal-dev-canvas" +
          (tatActive || pickingMaskId || brushMaskId || pickingPointColor || redEye ? " is-tat" : "")
        }
        style={zoomable && shownSize ? { cursor: zoom ? "grab" : "zoom-in" } : undefined}
        onPointerDown={
          redEye
            ? placeRedEye
            : brushMaskId
              ? brushPointerDown
              : pickingMaskId
                ? pickColorAt
                : pickingPointColor
                  ? pickPointColorAt
                  : tatActive
                    ? tatPointerDown
                    : zoomable
                      ? zoomPointerDown
                      : undefined
        }
        onPointerMove={
          brushMaskId
            ? brushPointerMove
            : tatActive && !pickingMaskId
              ? tatPointerMove
              : zoomable
                ? zoomPointerMove
                : undefined
        }
        onPointerUp={
          brushMaskId
            ? brushPointerUp
            : pickingMaskId
              ? pickColorUp
              : tatActive
                ? tatPointerUp
                : zoomable
                  ? zoomPointerUp
                  : undefined
        }
        onClick={zoomable ? zoomClick : undefined}
      />
      {/* Mask handles: masks are stored in full-frame space, so on a cropped
          view the overlay edits a crop-space copy (maskToCropSpace) and maps
          drags back. Hidden while cropping/healing — those tools own the
          canvas and show the full frame. */}
      {selectedMask && !showBefore && !cropping && !healing && recipe && (
        <MaskOverlay
          mask={maskView ? maskToCropSpace(selectedMask, maskView) : selectedMask}
          componentIndex={Math.max(
            0,
            selectedMask.components.findIndex((c) => c.id === selectedComponentId),
          )}
          onChange={(m) => updateMask(maskView ? maskToFrameSpace(m, maskView) : m)}
        />
      )}
      {cropping && recipe && (
        <CropOverlay
          crop={recipe.crop}
          onChange={(crop) => setRecipe((prev) => (prev ? { ...prev, crop } : prev))}
          onDone={() => setCropping(false)}
          aspect={aspect}
        />
      )}
      {healing && recipe && (
        <HealOverlay
          heal={recipe.heal ?? { spots: [] }}
          onChange={(heal) => setRecipe((prev) => (prev ? { ...prev, heal } : prev))}
          onDone={() => setHealing(false)}
          aspect={aspect}
          onDetect={() => void detectHealSpots()}
          visualize={visualizeHeal}
          onVisualize={setVisualizeHeal}
          threshold={visualizeThr}
          onThreshold={setVisualizeThr}
          pickSource={pickSourceFor}
        />
      )}
    </div>
  );
  const canvasPane =
    refPhotoId == null ? (
      canvasWrap
    ) : (
      <div style={REF_CANVAS_PANE} ref={measureStage}>
        {canvasWrap}
      </div>
    );

  return (
    <div className="gal-develop">
      <div
        className="gal-dev-stage"
        ref={refPhotoId == null ? measureStage : null}
        style={sideBySide && !splitView && baLayout === "topBottom" ? { flexDirection: "column" } : undefined}
      >
        {refPhotoId != null && <ReferencePane photoId={refPhotoId} zoom={zoom} shown={shownSize} view={view} />}
        {sideBySide && !splitView && (
          <div className="gal-dev-before">
            <div className="gal-dev-ref-label">Before</div>
            <canvas
              ref={beforeCanvasRef}
              className="gal-dev-before-canvas"
              style={aspect ? { aspectRatio: String(aspect) } : undefined}
            />
          </div>
        )}
        {canvasPane}
        {status === "loading" && <div className="gal-cell-spinner" />}
        {status === "error" && <div className="gal-empty-err">Could not decode this photo.</div>}
        <button
          className={"gal-dev-ba" + (showBefore ? " is-before" : "")}
          onClick={() => {
            setShowBefore((v) => !v);
            setSideBySide(false);
          }}
          title="Before / After ( \\ )"
        >
          {showBefore ? "Before" : "After"}
        </button>
        <button
          className={"gal-dev-ba gal-dev-y" + (sideBySide ? " is-before" : "")}
          onClick={() => {
            setSideBySide((v) => !v);
            setShowBefore(false);
          }}
          title="Before / After view (Y — ⇧Y toggles split, ⌥Y toggles top/bottom)"
        >
          Y
        </button>
        {(showBefore || sideBySide) && recipe && (
          // LR's Before/After toolbar: Copy Before's / After's Settings + Swap.
          // Copy-to-After flows through setRecipe, so it persists and records
          // a History step like any edit; the Before side is view-only state.
          <div style={{ position: "absolute", top: 38, right: 10, display: "flex", gap: 6 }}>
            <button
              className="gal-dev-ba is-inline"
              onClick={() => setRecipe(beforeRecipe)}
              title="Copy Before's settings to After"
            >
              B→A
            </button>
            <button
              className="gal-dev-ba is-inline"
              onClick={() => setBeforeRecipe(recipe)}
              title="Copy After's settings to Before"
            >
              A→B
            </button>
            <button
              className="gal-dev-ba is-inline"
              onClick={() => {
                setBeforeRecipe(recipe);
                setRecipe(beforeRecipe);
              }}
              title="Swap Before and After settings"
            >
              Swap
            </button>
          </div>
        )}
        <button
          className={"gal-dev-crop-btn" + (cropping ? " is-active" : "")}
          onClick={() => {
            setCropping((v) => !v);
            setHealing(false);
            setRedEye(null);
          }}
          title="Crop & Straighten"
        >
          {cropping ? "Done" : "Crop"}
        </button>
        <button
          className={"gal-dev-crop-btn gal-dev-heal-btn" + (healing ? " is-active" : "")}
          onClick={() => {
            setHealing((v) => !v);
            setCropping(false);
            setRedEye(null);
          }}
          title="Heal — remove spots (click places a spot; drag circles to adjust)"
        >
          {healing ? "Done" : "Heal"}
        </button>
        {/* Red Eye Correction — arms the tool; while armed, a second button
            switches to Pet Eye (LR's mode radio). A click on the canvas turns
            the detected pupil into a mask, so the Masks panel tunes it after. */}
        <button
          className={"gal-dev-crop-btn" + (redEye ? " is-active" : "")}
          style={{ right: 296 }} // sits left of Proof in the same button row
          onClick={() => {
            setRedEye((v) => (v ? null : "eye"));
            setCropping(false);
            setHealing(false);
          }}
          title="Red Eye Correction — click an eye to neutralize the flash pupil"
        >
          {redEye ? "Done" : "Red Eye"}
        </button>
        {redEye && (
          <button
            className={"gal-dev-crop-btn" + (redEye === "pet" ? " is-active" : "")}
            style={{ right: 344 }} // clears the armed button's "Done" label
            onClick={() => setRedEye((v) => (v === "pet" ? "eye" : "pet"))}
            title="Pet Eye — detect the bright tapetum glow instead of a red pupil"
          >
            Pet Eye
          </button>
        )}
        <button
          className={"gal-dev-crop-btn gal-dev-zoom-btn" + (zoom ? " is-active" : "")}
          style={{ right: 208 }} // sits left of Heal in the same button row
          onClick={() => zoomToggleRef.current()}
          title="Zoom Fit / 1:1 (Space or Z — click the image to zoom at a point, drag to pan)"
        >
          {zoom ? "1:1" : "Fit"}
        </button>
        <button
          className={"gal-dev-crop-btn" + (proofing ? " is-active" : "")}
          style={{ right: 252 }} // sits left of Fit in the same button row
          onClick={() => setProofing((v) => !v)}
          title="Soft Proofing (S) — preview the render through a print profile"
        >
          Proof
        </button>
        {proofing && (
          // LR's soft-proof toolbar: profile to simulate, rendering intent,
          // Simulate Paper & Ink, destination gamut warning, Create Proof Copy.
          <div
            className="gal-dev-proof-bar"
            style={{
              position: "absolute",
              left: 10,
              bottom: 10,
              display: "flex",
              gap: 8,
              alignItems: "center",
              background: "rgba(0, 0, 0, 0.6)",
              border: "1px solid var(--border-1, #333)",
              borderRadius: 4,
              padding: "4px 8px",
              font: "10px var(--font-ui, system-ui)",
              color: "var(--text-2)",
            }}
          >
            <span>Soft Proof</span>
            <Select
              size="sm"
              aria-label="Profile to simulate"
              value={proofProfile ? "custom" : "press"}
              options={[
                { value: "press", label: PRESS_PROFILE_LABEL },
                ...(proofProfile ? [{ value: "custom", label: proofProfile.name }] : []),
                { value: "other", label: "Other profile…" },
              ]}
              onChange={(v) => {
                if (v === "press") setProofProfile(null);
                else if (v === "other") void loadProofProfile();
              }}
            />
            <Select
              size="sm"
              aria-label="Rendering intent"
              value={String(proofIntent)}
              options={PROOF_INTENTS.map((i) => ({ value: String(i.value), label: i.label }))}
              onChange={(v) => setProofIntent(Number(v))}
            />
            <label>
              <input
                type="checkbox"
                checked={proofPaperInk}
                onChange={(e) => setProofPaperInk(e.target.checked)}
              />
              {" Paper & Ink"}
            </label>
            <label title="Destination gamut warning — colors the profile cannot reproduce show red">
              <input
                type="checkbox"
                checked={proofGamut}
                onChange={(e) => setProofGamut(e.target.checked)}
              />
              {" Gamut"}
            </label>
            {/* ponytail: the copy carries the full recipe; the proof target
                itself stays session state — persisting it per-photo needs a
                catalog/recipe field (schema addition), the noted upgrade. */}
            <button
              className="gal-dev-ba is-inline"
              onClick={() => void store.createVirtualCopy(active.id)}
              title="Create Proof Copy — a virtual copy to hold the print-targeted edit"
            >
              Proof Copy
            </button>
          </div>
        )}
        <button
          className={
            "gal-dev-pv" + (recipe && recipe.processVersion < CURRENT_PROCESS_VERSION ? " is-stale" : "")
          }
          disabled={!recipe || recipe.processVersion >= CURRENT_PROCESS_VERSION}
          onClick={() =>
            setRecipe((prev) =>
              prev ? { ...prev, processVersion: CURRENT_PROCESS_VERSION } : prev,
            )
          }
          title={
            recipe && recipe.processVersion < CURRENT_PROCESS_VERSION
              ? `This photo uses Process Version ${recipe.processVersion}. Click to update to PV ${CURRENT_PROCESS_VERSION} (recorded in History).`
              : `Process Version ${recipe?.processVersion ?? CURRENT_PROCESS_VERSION} (current)`
          }
        >
          {recipe && recipe.processVersion < CURRENT_PROCESS_VERSION
            ? `PV ${recipe.processVersion} → Update`
            : `PV ${recipe?.processVersion ?? CURRENT_PROCESS_VERSION}`}
        </button>
      </div>
      {recipe && (
        <div className="gal-dev-rail">
          {/* LR's Develop rail actions: Previous, Sync…, Auto Sync. Styled with
              the existing overlay-button class, un-positioned (like Proof Copy)
              so they flow in the rail rather than float over the stage. */}
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button
              className="gal-dev-ba is-inline"
              disabled={st.prevActiveId == null}
              onClick={() => void applyPrevious()}
              title="Previous — apply the previously-selected photo's develop settings to this one"
            >
              Previous
            </button>
            <button
              className="gal-dev-ba is-inline"
              disabled={st.selection.length < 2}
              onClick={() => setSyncOpen(true)}
              title="Sync… — push the chosen panels of this photo to the rest of the selection"
            >
              Sync…
            </button>
            <button
              className={"gal-dev-ba is-inline" + (st.autoSync ? " is-before" : "")}
              aria-pressed={st.autoSync}
              onClick={() => store.setAutoSync(!st.autoSync)}
              title="Auto Sync — mirror every edit onto the rest of the selection as you make it"
            >
              Auto Sync
            </button>
          </div>
          {syncOpen && (
            <CopySettingsDialog photoId={active.id} mode="sync" onClose={() => setSyncOpen(false)} />
          )}
          <SoloStack>
          <PresetsPanel
            currentRecipe={recipe}
            onApply={(r) => setRecipe((prev) => (prev ? applyPresetRecipe(prev, r) : r))}
          />
          <MasksPanel
            hasDepth={hasDepth}
            masks={masks}
            selectedId={selectedMaskId}
            onAdd={addMask}
            selectedComponentId={selectedComponentId}
            onSelectComponent={setSelectedComponentId}
            onAddComponent={addComponent}
            onSelect={selectMask}
            onDelete={deleteMask}
            onDuplicate={duplicateMaskAt}
            onMove={(id, delta) => setMasks(moveMask(masks, id, delta))}
            onChange={updateMask}
            onPickColorSample={(id) => {
              setBrushMaskId(null);
              setPickingPointColor(false);
              setPickingMaskId((cur) => (cur === id ? null : id));
            }}
            pickingMaskId={pickingMaskId}
            onToggleBrush={(id) => {
              setPickingMaskId(null);
              setPickingPointColor(false);
              setBrushMaskId((cur) => (cur === id ? null : id));
            }}
            brushMaskId={brushMaskId}
            brushSettings={brushSettings}
            onBrushSettingsChange={setBrushSettings}
            onClearBrush={clearBrushDabs}
            onSelectSubject={() => void runSelectSubject()}
            subjectBusy={subjectBusy}
          />
          <SnapshotsPanel photoId={active.id} recipe={recipe} onRestore={(r) => setRecipe(r)} />
          <HistoryPanel
            photoId={active.id}
            rev={historyRev}
            onRestore={(r) => setRecipe(r)}
            onChanged={() => setHistoryRev((v) => v + 1)}
          />
          <BasicPanel
            basic={recipe.basic}
            enabled={recipe.enabled.basic}
            onToggleEnabled={(on) =>
              setRecipe((prev) => (prev ? { ...prev, enabled: { ...prev.enabled, basic: on } } : prev))
            }
            onChange={(key, value) =>
              setRecipe((prev) => (prev ? { ...prev, basic: { ...prev.basic, [key]: value } } : prev))
            }
            onAuto={() => void applyAutoTone()}
            onReset={() =>
              setRecipe((prev) => (prev ? { ...createDefaultRecipe(), ...prev, basic: createDefaultRecipe().basic } : prev))
            }
          />
          <ToneCurvePanel
            values={recipe.toneCurve}
            enabled={recipe.enabled.toneCurve}
            onToggleEnabled={(on) =>
              setRecipe((prev) => (prev ? { ...prev, enabled: { ...prev.enabled, toneCurve: on } } : prev))
            }
            onChange={(channel, pts) =>
              setRecipe((prev) => (prev ? { ...prev, toneCurve: { ...prev.toneCurve, [channel]: pts } } : prev))
            }
            onParametricChange={(key, value) =>
              setRecipe((prev) =>
                prev
                  ? {
                      ...prev,
                      toneCurve: {
                        ...prev.toneCurve,
                        parametric: { ...prev.toneCurve.parametric, [key]: value },
                      },
                    }
                  : prev,
              )
            }
            onSplitsChange={(splits) =>
              setRecipe((prev) => (prev ? { ...prev, toneCurve: { ...prev.toneCurve, parametricSplits: splits } } : prev))
            }
            tatActive={tatTarget === "tone"}
            onToggleTat={() => setTatTarget((t) => (t === "tone" ? null : "tone"))}
            onReset={() => setRecipe((prev) => (prev ? { ...prev, toneCurve: createDefaultRecipe().toneCurve } : prev))}
          />
          <TransformPanel
            values={recipe.transform}
            enabled={recipe.enabled.transform}
            onToggleEnabled={(on) =>
              setRecipe((prev) => (prev ? { ...prev, enabled: { ...prev.enabled, transform: on } } : prev))
            }
            onChange={(key, value) =>
              setRecipe((prev) => (prev ? { ...prev, transform: patchPanel(prev.transform, key, value) } : prev))
            }
            onReset={() => setRecipe((prev) => (prev ? { ...prev, transform: createDefaultRecipe().transform } : prev))}
          />
          <DetailPanel
            values={recipe.detail}
            enabled={recipe.enabled.detail}
            onToggleEnabled={(on) =>
              setRecipe((prev) => (prev ? { ...prev, enabled: { ...prev.enabled, detail: on } } : prev))
            }
            onChange={(key, value) =>
              setRecipe((prev) => (prev ? { ...prev, detail: patchPanel(prev.detail, key, value) } : prev))
            }
            onReset={() => setRecipe((prev) => (prev ? { ...prev, detail: createDefaultRecipe().detail } : prev))}
          />
          <ColorMixerPanel
            values={recipe.colorMixer}
            enabled={recipe.enabled.colorMixer}
            onToggleEnabled={(on) =>
              setRecipe((prev) => (prev ? { ...prev, enabled: { ...prev.enabled, colorMixer: on } } : prev))
            }
            channel={mixerChannel}
            onChannelChange={setMixerChannel}
            tatActive={tatTarget === "mixer"}
            onToggleTat={() => setTatTarget((t) => (t === "mixer" ? null : "mixer"))}
            onChange={(channel, band, value) =>
              setRecipe((prev) =>
                prev
                  ? {
                      ...prev,
                      colorMixer: {
                        ...prev.colorMixer,
                        [channel]: prev.colorMixer[channel].map((x, j) => (j === band ? value : x)),
                      },
                    }
                  : prev,
              )
            }
            onReset={() => setRecipe((prev) => (prev ? { ...prev, colorMixer: createDefaultRecipe().colorMixer } : prev))}
          />
          <ColorGradingPanel
            values={recipe.colorGrading}
            enabled={recipe.enabled.colorGrading}
            onToggleEnabled={(on) =>
              setRecipe((prev) => (prev ? { ...prev, enabled: { ...prev.enabled, colorGrading: on } } : prev))
            }
            onChange={(zone, field, value) =>
              setRecipe((prev) =>
                prev
                  ? {
                      ...prev,
                      colorGrading: {
                        ...prev.colorGrading,
                        [zone]: { ...prev.colorGrading[zone], [field]: value },
                      },
                    }
                  : prev,
              )
            }
            onReset={() =>
              setRecipe((prev) => (prev ? { ...prev, colorGrading: createDefaultRecipe().colorGrading } : prev))
            }
          />
          <OpticsPanel
            values={recipe.optics}
            enabled={recipe.enabled.optics}
            onToggleEnabled={(on) =>
              setRecipe((prev) => (prev ? { ...prev, enabled: { ...prev.enabled, optics: on } } : prev))
            }
            onChange={(key, value) =>
              setRecipe((prev) => (prev ? { ...prev, optics: patchPanel(prev.optics, key, value) } : prev))
            }
            onReset={() => setRecipe((prev) => (prev ? { ...prev, optics: createDefaultRecipe().optics } : prev))}
          />
          <EffectsPanel
            values={recipe.effects}
            enabled={recipe.enabled.effects}
            onToggleEnabled={(on) =>
              setRecipe((prev) => (prev ? { ...prev, enabled: { ...prev.enabled, effects: on } } : prev))
            }
            onChange={(key, value) =>
              setRecipe((prev) => (prev ? { ...prev, effects: patchPanel(prev.effects, key, value) } : prev))
            }
            onReset={() => setRecipe((prev) => (prev ? { ...prev, effects: createDefaultRecipe().effects } : prev))}
          />
          <ProfilePanel
            values={recipe.profile}
            onSelect={(id, name) =>
              setRecipe((prev) => (prev ? { ...prev, profile: { ...prev.profile, id, name } } : prev))
            }
            onAmount={(amount) =>
              setRecipe((prev) => (prev ? { ...prev, profile: { ...prev.profile, amount } } : prev))
            }
            onReset={() => setRecipe((prev) => (prev ? { ...prev, profile: createDefaultRecipe().profile } : prev))}
          />
          <CalibrationPanel
            values={recipe.calibration}
            enabled={recipe.enabled.calibration}
            onToggleEnabled={(on) =>
              setRecipe((prev) => (prev ? { ...prev, enabled: { ...prev.enabled, calibration: on } } : prev))
            }
            onChange={(key, value) =>
              setRecipe((prev) => (prev ? { ...prev, calibration: patchPanel(prev.calibration, key, value) } : prev))
            }
            onReset={() =>
              setRecipe((prev) => (prev ? { ...prev, calibration: createDefaultRecipe().calibration } : prev))
            }
          />
          <PointColorPanel
            values={recipe.pointColor}
            enabled={recipe.enabled.pointColor}
            onToggleEnabled={(on) =>
              setRecipe((prev) => (prev ? { ...prev, enabled: { ...prev.enabled, pointColor: on } } : prev))
            }
            onChange={(next) => setRecipe((prev) => (prev ? { ...prev, pointColor: next } : prev))}
            onReset={() => setRecipe((prev) => (prev ? { ...prev, pointColor: createDefaultRecipe().pointColor } : prev))}
            picking={pickingPointColor}
            onPick={() => {
              setBrushMaskId(null);
              setPickingMaskId(null);
              setPickingPointColor((cur) => !cur);
            }}
          />
          </SoloStack>
        </div>
      )}
    </div>
  );
}
