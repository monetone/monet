// ─────────────────────────────────────────────────────────────
// Liquify forward-warp brush — pure state helpers. The Store owns the live
// LiquifyState; these keep it valid (clamped ranges, known modes) and are
// engine-free so they unit-test in node. The warp itself runs in the Rust engine
// (liquify_begin/dab/end/cancel); this module is only the options reducer.
// ─────────────────────────────────────────────────────────────
import type { LiquifyState } from "./store";

// Modes, indexed exactly as the engine's liquify_dab `mode` byte. 0..5 and 8..13
// are engine warp modes; 6/7 paint the session-local Freeze/Thaw Mask overlay
// instead (the Store routes those to liquify_mask_dab). New modes are appended,
// never inserted — the index IS the engine ABI.
export const LIQUIFY_MODES = [
  "Push", "Bloat", "Pucker", "Twirl CW", "Twirl CCW", "Reconstruct", "Freeze Mask", "Thaw Mask",
  "Smooth", "Push Left", "Recon Rigid", "Recon Stiff", "Recon Smooth", "Recon Loose",
] as const;
export const LIQUIFY_MODE_COUNT = LIQUIFY_MODES.length;

/** Mode indices for the Liquify workspace tool rail, in Photoshop's rail order.
 *  The Reconstruct variants are not tools — they live in Reconstruct Options. */
export const LIQUIFY_TOOL_MODES = [0, 5, 8, 3, 4, 2, 1, 9, 6, 7] as const;

/** Photoshop's Reconstruct Options modes, in dialog order. Each relaxes the mesh
 *  toward a progressively larger share of its neighbourhood, so Revert flattens
 *  the warp outright while Loose keeps it continuous with the surround. The
 *  Strength slider is the reconstruct "amount". */
export const LIQUIFY_RECONSTRUCT_MODES = [
  { mode: 5, label: "Revert" },
  { mode: 10, label: "Rigid" },
  { mode: 11, label: "Stiff" },
  { mode: 12, label: "Smooth" },
  { mode: 13, label: "Loose" },
] as const;

/** The default Liquify options (Push, medium brush/density/strength). */
export function defaultLiquify(): LiquifyState {
  return { size: 100, density: 0.5, pressure: 1, strength: 0.5, mode: 0, targetLayerId: 0, preview: true, showBackdrop: false, backdropSource: "all", backdropOpacity: 0.5, showMesh: false, rate: 0, pinEdges: false };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const layerId = (v: number): number => Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;

/** Merge a patch into a LiquifyState, clamping every field to its valid range:
 *  size ≥ 1px; density/pressure/strength in 0..1; mode a known mode index. */
export function liquifyReduce(s: LiquifyState, patch: Partial<LiquifyState>): LiquifyState {
  const next = { ...s, ...patch };
  return {
    size: Math.max(1, next.size),
    density: clamp01(next.density),
    pressure: clamp01(next.pressure),
    strength: clamp01(next.strength),
    mode: Math.min(LIQUIFY_MODE_COUNT - 1, Math.max(0, Math.round(next.mode))),
    targetLayerId: layerId(next.targetLayerId),
    preview: !!next.preview,
    showBackdrop: !!next.showBackdrop,
    backdropSource: next.backdropSource === "active" || next.backdropSource === "behind" ? next.backdropSource : "all",
    backdropOpacity: clamp01(next.backdropOpacity),
    showMesh: !!next.showMesh,
    rate: clamp01(next.rate),
    pinEdges: !!next.pinEdges,
  };
}
