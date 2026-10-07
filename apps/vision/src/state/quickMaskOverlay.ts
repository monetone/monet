// ─────────────────────────────────────────────────────────────
// Quick Mask overlay — pure colour math for the red rubylith overlay drawn over
// the document while in Quick Mask mode. The engine keeps a grayscale buffer
// (255 = selected, 0 = fully masked); this maps each buffer byte to the overlay
// pixel: red whose alpha grows as the pixel becomes more masked, so selected
// areas stay clear and masked areas frost red. Engine-free (no wasm import) so it
// unit-tests in node; CanvasView calls it per pixel to fill the overlay canvas.
// The overlay is display-only — the engine's real output (and thus
// export/pick_color/histogram) is never tinted.
// ─────────────────────────────────────────────────────────────

/** Photoshop's default Quick Mask colour: red. */
export const QM_COLOR = { r: 255, g: 0, b: 0 } as const;

/** Default overlay opacity (Photoshop's Quick Mask Options default is 50%). The
 *  alpha at a fully-masked pixel is `QM_DEFAULT_OPACITY * 255`. */
export const QM_DEFAULT_OPACITY = 0.5;

export interface QuickMaskRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Photoshop's Channel Options for the plane currently in the mask buffer:
 *  overlay colour, opacity, and whether the colour indicates Masked Areas (the
 *  default) or Selected Areas. `alone` is the channel's eye — the plane replaces
 *  the document as opaque grayscale instead of tinting it. */
export interface QuickMaskOverlay {
  color: { r: number; g: number; b: number };
  opacity: number;
  indicates: "masked" | "selected";
  alone: boolean;
}

export const QM_DEFAULT_OVERLAY: QuickMaskOverlay = {
  color: { ...QM_COLOR },
  opacity: QM_DEFAULT_OPACITY,
  indicates: "masked",
  alone: false,
};

// ponytail: module-level, because CanvasView calls quickMaskPixel per pixel with
// no options argument — threading a config through the inner loop would buy
// nothing. The store owns it (setQuickMaskOverlay) and resets it to the defaults
// whenever no channel is targeted, so the layer-mask rubylith, which shares this
// function, only ever sees the defaults outside a channel edit.
let overlay: QuickMaskOverlay = QM_DEFAULT_OVERLAY;

/** Install the targeted channel's display options (null → Photoshop defaults). */
export function setQuickMaskOverlay(next: Partial<QuickMaskOverlay> | null) {
  overlay = next ? { ...QM_DEFAULT_OVERLAY, ...next } : QM_DEFAULT_OVERLAY;
}

export function quickMaskOverlay(): QuickMaskOverlay {
  return overlay;
}

/** Map one Quick Mask buffer byte (0..255, 255 = selected) to its overlay pixel:
 *  `alpha = opacity * (1 - qm/255) * 255`. A selected pixel (255) is fully
 *  transparent; a fully-masked pixel (0) is the overlay colour at `opacity`.
 *  "Selected Areas" inverts which end tints; viewing the channel alone returns
 *  the plane itself — opaque gray, white where the buffer is 255. */
export function quickMaskPixel(qm: number, opacity = overlay.opacity): QuickMaskRGBA {
  const t = qm < 0 ? 0 : qm > 255 ? 255 : qm;
  if (overlay.alone) return { r: t, g: t, b: t, a: 255 };
  const tint = overlay.indicates === "selected" ? t / 255 : 1 - t / 255;
  const a = Math.round(opacity * tint * 255);
  return { r: overlay.color.r, g: overlay.color.g, b: overlay.color.b, a };
}
