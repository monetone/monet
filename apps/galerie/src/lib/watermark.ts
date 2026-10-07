// watermark — Lightroom Classic "Simple text watermark" for raster exports.
//
// LR's Watermark Editor supports Text or Graphic with a 9-position anchor grid,
// opacity, size, and inset. This is the text-only core: the placement math is
// pure (tested here); the export encoder draws the text onto the output canvas.

/** LR's 3×3 anchor grid. */
export type WatermarkAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface WatermarkSpec {
  text: string;
  anchor: WatermarkAnchor;
  /** 0–1. */
  opacity: number;
  /** Font size as a percentage of the output height. */
  sizePct: number;
  /** Edge inset as a percentage of the output's shorter side. */
  insetPct: number;
}

/** Font size in px for a given output height. Floored so it stays legible. */
export function fontPx(canvasH: number, sizePct: number): number {
  return Math.max(8, Math.round((sizePct / 100) * canvasH));
}

function align(anchor: WatermarkAnchor, lo: string, hi: string): "start" | "center" | "end" {
  if (anchor.includes(lo)) return "start";
  if (anchor.includes(hi)) return "end";
  return "center";
}

/** Top-left draw position for a `tw`×`th` text box on a `cw`×`ch` canvas, given
 *  the anchor + inset. Clamped so the box stays fully on-canvas. Pure. */
export function watermarkLayout(
  cw: number,
  ch: number,
  tw: number,
  th: number,
  spec: Pick<WatermarkSpec, "anchor" | "insetPct">,
): { x: number; y: number } {
  // ponytail: one inset measured against the shorter side, so a panorama gets the
  // same gap on both axes where LR would measure each against its own. Split into
  // insetXPct (× cw) / insetYPct (× ch) if someone asks — but that moves every
  // watermark on an existing non-square export, so it needs to be a stated change.
  const inset = (spec.insetPct / 100) * Math.min(cw, ch);
  const h = align(spec.anchor, "left", "right");
  const v = align(spec.anchor, "top", "bottom");
  const rawX = h === "start" ? inset : h === "end" ? cw - tw - inset : (cw - tw) / 2;
  const rawY = v === "start" ? inset : v === "end" ? ch - th - inset : (ch - th) / 2;
  return {
    x: Math.min(Math.max(0, cw - tw), Math.max(0, rawX)),
    y: Math.min(Math.max(0, ch - th), Math.max(0, rawY)),
  };
}
