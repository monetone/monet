// ─────────────────────────────────────────────────────────────
// 32-bit Preview Options (View ▸ 32-bit Preview Options…) — pure tone-map
// math for the float-document live preview. Engine-free so it unit-tests in
// node; the real preview runs in Rust against the full-precision `pixels_f32`
// authority (`Engine.hdr_preview_rgba8`, mod.rs `hdr_preview_tone_map`) — this
// module exists so the dialog's defaults/ranges have one source of truth, and
// so the transform has a plain-JS spec to test against. Mirrors
// `exposure.ts` / `hueSaturation.ts` house style.
//
// View state only: this never touches the document, the undo stack, or the
// saved/exported bytes. See EngineClient.setHdrPreview — it recomposites into
// a throwaway RGBA8 buffer, never `self.output` (the buffer save/export/
// eyedropper/clone-stamp read).
// ─────────────────────────────────────────────────────────────

export type HdrPreviewMethod = 0 | 1; // 0 = Exposure and Gamma, 1 = Highlight Compression

export interface HdrPreviewState {
  method: HdrPreviewMethod;
  /** Stops; the channel is multiplied by 2^exposure before tone mapping. */
  exposure: number;
  /** Only used by Exposure and Gamma; the channel is raised to 1/gamma. */
  gamma: number;
}

export const HDR_PREVIEW_METHODS: { value: HdrPreviewMethod; label: string }[] = [
  { value: 0, label: "Exposure and Gamma" },
  { value: 1, label: "Highlight Compression" },
];

// Slider ranges (match the dialog).
export const HDR_EXPOSURE_MIN = -10;
export const HDR_EXPOSURE_MAX = 10;
export const HDR_GAMMA_MIN = 0.1;
export const HDR_GAMMA_MAX = 3;

// Engine guard: gamma is floored here before the reciprocal, matching the
// Rust side's `gamma.max(f32::EPSILON)`, so gamma 0 can never divide by zero.
export const HDR_GAMMA_FLOOR = 1e-4;

/** A fresh, no-op preview (0 stops, gamma 1) — bit-identical to the plain
 *  clamp the engine used for every 32-bit document before this feature
 *  existed. See `hdr_preview_default_matches_plain_clamp` (mod.rs). */
export function defaultHdrPreview(): HdrPreviewState {
  return { method: 0, exposure: 0, gamma: 1 };
}

/** What `engine.getHdrPreview` / `setHdrPreview` actually store, including the
 *  on/off switch the tone-map math itself does not carry. */
export interface HdrPreviewSettings extends HdrPreviewState {
  on: boolean;
}

/** Replacing the dialog, Escape, or unmount without OK puts the opening
 *  tone map back. OK keeps the live slider values. */
export function hdrPreviewOnDismiss(
  committed: boolean,
  initial: HdrPreviewSettings,
  live: HdrPreviewSettings,
): HdrPreviewSettings {
  return committed ? live : initial;
}

/** The single-channel tone map, mirroring `hdr_preview_tone_map` in mod.rs
 *  exactly (that function is the source of truth). Input is scene-linear
 *  (unclamped, may exceed 1); output is unclamped too — callers clamp once at
 *  write-out, matching the engine's `to8`. */
export function applyHdrPreviewChannel(value: number, state: HdrPreviewState): number {
  if (state.method === 0 && state.exposure === 0 && state.gamma === 1) return value;
  const exposed = Math.max(value, 0) * 2 ** state.exposure;
  if (state.method === 1) return exposed / (1 + exposed);
  return Math.pow(exposed, 1 / Math.max(state.gamma, HDR_GAMMA_FLOOR));
}
