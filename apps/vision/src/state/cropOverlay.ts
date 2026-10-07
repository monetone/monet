// Pure guide geometry for the Crop tool's Photoshop-style composition overlays.
// The canvas renders the returned segments inside the live crop preview.

export type CropOverlay =
  | "none"
  | "thirds"
  | "grid"
  | "diagonal"
  | "triangle"
  | "golden"
  | "spiral";

export interface OverlayLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Photoshop's six overlay designs, plus Vision's explicit hidden state. */
export const CROP_OVERLAYS: { key: CropOverlay; label: string }[] = [
  { key: "thirds", label: "Rule of Thirds" },
  { key: "grid", label: "Grid" },
  { key: "diagonal", label: "Diagonal" },
  { key: "triangle", label: "Triangle" },
  { key: "golden", label: "Golden Ratio" },
  { key: "spiral", label: "Golden Spiral" },
  { key: "none", label: "None" },
];

const CROP_OVERLAY_CYCLE = CROP_OVERLAYS
  .map(({ key }) => key)
  .filter((key): key is Exclude<CropOverlay, "none"> => key !== "none");

/** O cycles the six designs; visibility is deliberately not part of the cycle. */
export function nextCropOverlay(mode: CropOverlay): CropOverlay {
  const index = CROP_OVERLAY_CYCLE.indexOf(mode as Exclude<CropOverlay, "none">);
  return CROP_OVERLAY_CYCLE[(index + 1) % CROP_OVERLAY_CYCLE.length];
}

/** Shift+O changes only Triangle (2 ways) and Golden Spiral (8 ways). */
export function nextCropOverlayOrientation(mode: CropOverlay, orientation: number): number {
  const count = mode === "triangle" ? 2 : mode === "spiral" ? 8 : 0;
  return count ? (Math.trunc(orientation) + 1 + count) % count : orientation;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const PHI_LO = 1 / (PHI * PHI);
const PHI_HI = 1 / PHI;

function projectionLine(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): OverlayLine {
  const dx = bx - ax;
  const dy = by - ay;
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  return { x1: px, y1: py, x2: ax + t * dx, y2: ay + t * dy };
}

function triangleLines(x: number, y: number, w: number, h: number, orientation: number): OverlayLine[] {
  if ((Math.trunc(orientation) & 1) === 0) {
    return [
      { x1: x, y1: y, x2: x + w, y2: y + h },
      projectionLine(x + w, y, x, y, x + w, y + h),
      projectionLine(x, y + h, x, y, x + w, y + h),
    ];
  }
  return [
    { x1: x + w, y1: y, x2: x, y2: y + h },
    projectionLine(x, y, x + w, y, x, y + h),
    projectionLine(x + w, y + h, x + w, y, x, y + h),
  ];
}

type UnitPoint = { x: number; y: number };

function orientPoint(point: UnitPoint, orientation: number): UnitPoint {
  const { x, y } = point;
  switch ((Math.trunc(orientation) % 8 + 8) % 8) {
    case 1: return { x: 1 - y, y: x };
    case 2: return { x: 1 - x, y: 1 - y };
    case 3: return { x: y, y: 1 - x };
    case 4: return { x: 1 - x, y };
    case 5: return { x: 1 - y, y: 1 - x };
    case 6: return { x, y: 1 - y };
    case 7: return { x: y, y: x };
    default: return point;
  }
}

function goldenSpiralLines(x: number, y: number, w: number, h: number, orientation: number): OverlayLine[] {
  const base: OverlayLine[] = [];
  let rect = { x: 0, y: 0, w: PHI, h: 1 };
  const directions = ["left", "top", "right", "bottom"] as const;

  for (let i = 0; i < 8; i += 1) {
    const direction = directions[i % directions.length];
    const side = direction === "left" || direction === "right" ? rect.h : rect.w;
    let squareX = rect.x;
    let squareY = rect.y;
    let centerX = 0;
    let centerY = 0;
    let startAngle = 0;

    if (direction === "left") {
      base.push({ x1: rect.x + side, y1: rect.y, x2: rect.x + side, y2: rect.y + rect.h });
      centerX = rect.x + side; centerY = rect.y + side; startAngle = Math.PI;
      rect = { ...rect, x: rect.x + side, w: rect.w - side };
    } else if (direction === "top") {
      base.push({ x1: rect.x, y1: rect.y + side, x2: rect.x + rect.w, y2: rect.y + side });
      centerX = rect.x; centerY = rect.y + side; startAngle = -Math.PI / 2;
      rect = { ...rect, y: rect.y + side, h: rect.h - side };
    } else if (direction === "right") {
      squareX = rect.x + rect.w - side;
      base.push({ x1: squareX, y1: rect.y, x2: squareX, y2: rect.y + rect.h });
      centerX = squareX; centerY = rect.y; startAngle = 0;
      rect = { ...rect, w: rect.w - side };
    } else {
      squareY = rect.y + rect.h - side;
      base.push({ x1: rect.x, y1: squareY, x2: rect.x + rect.w, y2: squareY });
      centerX = rect.x + side; centerY = squareY; startAngle = Math.PI / 2;
      rect = { ...rect, h: rect.h - side };
    }

    let previous = {
      x: centerX + side * Math.cos(startAngle),
      y: centerY + side * Math.sin(startAngle),
    };
    for (let step = 1; step <= 8; step += 1) {
      const angle = startAngle + (Math.PI / 2) * step / 8;
      const current = {
        x: centerX + side * Math.cos(angle),
        y: centerY + side * Math.sin(angle),
      };
      base.push({ x1: previous.x, y1: previous.y, x2: current.x, y2: current.y });
      previous = current;
    }
  }

  const mapPoint = (px: number, py: number): UnitPoint => {
    const point = orientPoint({ x: px / PHI, y: py }, orientation);
    return { x: x + point.x * w, y: y + point.y * h };
  };
  return base.map((line) => {
    const a = mapPoint(line.x1, line.y1);
    const b = mapPoint(line.x2, line.y2);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });
}

/** Guide segments inside (x,y,w,h). Empty for None or a non-positive rect. */
export function overlayLines(
  mode: CropOverlay,
  x: number,
  y: number,
  w: number,
  h: number,
  orientation = 0,
): OverlayLine[] {
  if (mode === "none" || w <= 0 || h <= 0) return [];
  const vert = (fx: number): OverlayLine => ({ x1: x + w * fx, y1: y, x2: x + w * fx, y2: y + h });
  const horiz = (fy: number): OverlayLine => ({ x1: x, y1: y + h * fy, x2: x + w, y2: y + h * fy });
  switch (mode) {
    case "thirds":
      return [vert(1 / 3), vert(2 / 3), horiz(1 / 3), horiz(2 / 3)];
    case "grid":
      return [vert(0.25), vert(0.5), vert(0.75), horiz(0.25), horiz(0.5), horiz(0.75)];
    case "golden":
      return [vert(PHI_LO), vert(PHI_HI), horiz(PHI_LO), horiz(PHI_HI)];
    case "diagonal": {
      // Four true 45° rays from the corners. On a non-square crop these differ
      // from corner-to-corner diagonals, whose angle varies with aspect ratio.
      const diagonal = Math.min(w, h);
      const lines = [
        { x1: x, y1: y, x2: x + diagonal, y2: y + diagonal },
        { x1: x + w, y1: y, x2: x + w - diagonal, y2: y + diagonal },
        { x1: x, y1: y + h, x2: x + diagonal, y2: y + h - diagonal },
        { x1: x + w, y1: y + h, x2: x + w - diagonal, y2: y + h - diagonal },
      ];
      // Opposing rays coincide on a square; render each diagonal once so the
      // SVG stroke does not become brighter through alpha double-compositing.
      return w === h ? lines.slice(0, 2) : lines;
    }
    case "triangle":
      return triangleLines(x, y, w, h, orientation);
    case "spiral":
      return goldenSpiralLines(x, y, w, h, orientation);
    default:
      return [];
  }
}
