// ─────────────────────────────────────────────────────────────
// Color Range ▸ Selection Preview — how an uncommitted selection is shown over
// the document while the dialog is open. Photoshop offers five renderings; the
// mask itself is a coverage plane (255 = selected). Pure colour math with no
// engine import, so it unit-tests in node, exactly like quickMaskOverlay — which
// this deliberately reuses for the Quick Mask rendering rather than re-deriving
// the rubylith. Display-only: the engine's output is never tinted.
// ─────────────────────────────────────────────────────────────
import { quickMaskPixel, type QuickMaskRGBA } from "./quickMaskOverlay";

/** Photoshop's Selection Preview dropdown. "none" draws nothing. */
export type SelectionPreviewMode = "none" | "gray" | "black" | "white" | "quickmask";

export const SELECTION_PREVIEW_MODES: readonly { value: SelectionPreviewMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "gray", label: "Grayscale" },
  { value: "black", label: "Black Matte" },
  { value: "white", label: "White Matte" },
  { value: "quickmask", label: "Quick Mask" },
];

/** One coverage byte → the overlay pixel for `mode`.
 *  - grayscale: the mask alone, opaque, standing in for the document
 *  - black/white matte: the document shows through where selected, and the
 *    unselected part is covered by the matte colour (so a partial edge reads as
 *    a partial matte, which is the point of the mattes)
 *  - quick mask: the shared rubylith, so it matches Q exactly */
export function selectionPreviewPixel(cov: number, mode: SelectionPreviewMode): QuickMaskRGBA {
  const v = Math.max(0, Math.min(255, cov | 0));
  switch (mode) {
    case "gray":
      return { r: v, g: v, b: v, a: 255 };
    case "black":
      return { r: 0, g: 0, b: 0, a: 255 - v };
    case "white":
      return { r: 255, g: 255, b: 255, a: 255 - v };
    case "quickmask":
      return quickMaskPixel(v);
    default:
      return { r: 0, g: 0, b: 0, a: 0 };
  }
}
