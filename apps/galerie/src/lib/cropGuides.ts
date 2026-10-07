// cropGuides — compositional overlay guides drawn inside the crop rectangle
// (Lightroom's crop overlays, cycled with the `O` key). Kept pure so the line
// geometry is unit-tested; CropOverlay renders the returned segments as SVG.
//
// Fractional guides (Thirds, Grid, Golden Ratio) are aspect-independent. Diagonal
// and Triangle are true-angle guides, so they take the rect's on-screen pixel
// aspect (derived from the image aspect). Golden Spiral is a polyline of quarter
// arcs, anamorphically stretched to the rect (as Lightroom draws it).

export type CropGuide = "thirds" | "grid" | "goldenRatio" | "diagonal" | "triangle" | "goldenSpiral";

/** Cycle order for the `O` shortcut. Thirds is Lightroom's default. */
export const CROP_GUIDES: readonly CropGuide[] = ["thirds", "grid", "diagonal", "triangle", "goldenRatio", "goldenSpiral"];

export const CROP_GUIDE_LABELS: Record<CropGuide, string> = {
  thirds: "Rule of Thirds",
  grid: "Grid",
  goldenRatio: "Golden Ratio",
  diagonal: "Diagonal",
  triangle: "Triangle",
  goldenSpiral: "Golden Spiral",
};

/** The next guide in the cycle (wraps around). */
export function nextCropGuide(guide: CropGuide): CropGuide {
  const i = CROP_GUIDES.indexOf(guide);
  return CROP_GUIDES[(i + 1) % CROP_GUIDES.length];
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface GuideLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Interior division fractions per fractional guide (same on both axes). Golden
// Ratio splits at 1/φ and its complement; Grid is quarters.
const PHI_INV = 0.6180339887498949; // 1/φ
const PHI = 1.6180339887498949;
const FRACTIONS: Record<CropGuide, readonly number[]> = {
  thirds: [1 / 3, 2 / 3],
  grid: [1 / 4, 2 / 4, 3 / 4],
  goldenRatio: [1 - PHI_INV, PHI_INV],
  diagonal: [], // angle-based (handled below), not fractional
  triangle: [],
  goldenSpiral: [], // polyline-based (cropGuideSpiral), not fractional
};

/** The guide's line segments in the same normalized 0..1 space as the crop rect
 *  (so CropOverlay's `viewBox="0 0 1 1"` renders them directly). `imageAspect` is
 *  the overlay's on-screen width/height; it only matters for the true-angle guides
 *  (Diagonal, Triangle) — the rect's pixel aspect is `(width/height)·imageAspect`. */
export function cropGuideLines(guide: CropGuide, rect: Rect, imageAspect = 1): GuideLine[] {
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  // Map local unit-rect coords (u, v) → overlay-normalized coords.
  const px = (u: number): number => rect.left + u * w;
  const py = (v: number): number => rect.top + v * h;

  if (guide === "diagonal" || guide === "triangle") {
    // Rect pixel aspect (width/height on screen); guard a degenerate height.
    const rp = h > 0 ? (w / h) * imageAspect : 1;
    if (guide === "triangle") {
      // Main diagonal + the perpendicular from each off-diagonal corner; both feet
      // land on the diagonal at parameter t = rp²/(rp²+1) and 1/(rp²+1).
      const t = (rp * rp) / (rp * rp + 1);
      const t2 = 1 / (rp * rp + 1);
      return [
        { x1: px(0), y1: py(0), x2: px(1), y2: py(1) },
        { x1: px(1), y1: py(0), x2: px(t), y2: py(t) },
        { x1: px(0), y1: py(1), x2: px(t2), y2: py(t2) },
      ];
    }
    // Diagonal method: a 45°(on-screen) line from each corner, stopping at the far
    // edge — the short side sets how far it reaches on the long side.
    if (rp >= 1) {
      const k = 1 / rp; // horizontal reach (local) for a full-height line
      return [
        { x1: px(0), y1: py(0), x2: px(k), y2: py(1) },
        { x1: px(1), y1: py(0), x2: px(1 - k), y2: py(1) },
        { x1: px(0), y1: py(1), x2: px(k), y2: py(0) },
        { x1: px(1), y1: py(1), x2: px(1 - k), y2: py(0) },
      ];
    }
    const k = rp; // vertical reach (local) for a full-width line
    return [
      { x1: px(0), y1: py(0), x2: px(1), y2: py(k) },
      { x1: px(1), y1: py(0), x2: px(0), y2: py(k) },
      { x1: px(0), y1: py(1), x2: px(1), y2: py(1 - k) },
      { x1: px(1), y1: py(1), x2: px(0), y2: py(1 - k) },
    ];
  }

  const lines: GuideLine[] = [];
  for (const f of FRACTIONS[guide]) {
    lines.push({ x1: px(f), y1: py(0), x2: px(f), y2: py(1) }); // vertical
    lines.push({ x1: px(0), y1: py(f), x2: px(1), y2: py(f) }); // horizontal
  }
  return lines;
}

export interface GuidePoint {
  x: number;
  y: number;
}

/** How many golden-spiral orientations `⇧O` cycles through (the square's 8
 *  symmetries: 4 rotations × mirrored). */
export const SPIRAL_ORIENTATIONS = 8;

/** The Golden Spiral guide as one continuous polyline in the same normalized
 *  space as the crop rect. Built as the classic quarter-circle chain in a
 *  canonical φ:1 golden rectangle — each square cut off hosts one arc, the
 *  radius shrinks by 1/φ, and the centre advances along the end-angle direction
 *  so consecutive arcs share a tangent — then stretched to fill the rect
 *  (Lightroom stretches the spiral to the crop aspect too). `orientation`
 *  (0..7) mirrors when ≥ 4 and rotates by the low two bits × 90°. */
export function cropGuideSpiral(rect: Rect, orientation = 0, arcs = 7, samplesPerArc = 16): GuidePoint[] {
  const pts: GuidePoint[] = [];
  let cx = 1;
  let cy = 0;
  let r = 1;
  let a = Math.PI;
  for (let k = 0; k < arcs; k++) {
    const e = a - Math.PI / 2;
    // Skip the first sample after arc 0 — it duplicates the previous arc's end.
    for (let s = k === 0 ? 0 : 1; s <= samplesPerArc; s++) {
      const th = a + (e - a) * (s / samplesPerArc);
      pts.push({ x: (cx + r * Math.cos(th)) / PHI, y: cy + r * Math.sin(th) });
    }
    cx += (r - r / PHI) * Math.cos(e);
    cy += (r - r / PHI) * Math.sin(e);
    r /= PHI;
    a = e;
  }
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  return pts.map((p) => {
    let u = orientation >= 4 ? 1 - p.x : p.x;
    let v = p.y;
    for (let i = 0; i < (orientation & 3); i++) [u, v] = [1 - v, u];
    return { x: rect.left + u * w, y: rect.top + v * h };
  });
}
