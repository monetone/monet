// ─────────────────────────────────────────────────────────────
// model/shapes — live-shape ⇄ path geometry + local bounds
// ─────────────────────────────────────────────────────────────
// Converts live shapes (rect/ellipse/polygon/star/line) into editable path
// geometry in LOCAL coordinates, and computes each item's local-space bounds.

import { anchor, bounds as pathBounds, type PathGeometry } from "../geometry/path";
import { applyToPoint } from "../geometry/matrix";
import { type Rect, fromPoints, fromTwoPoints, transform as transformRect, union } from "../geometry/bbox";
import type { Point } from "../geometry/vec";
import type { Item } from "./types";

const KAPPA = 0.5522847498307936; // 4/3 * (sqrt(2) - 1)

/** Path geometry (local space) for a single-outline live shape, else null. */
/** A rounded rect needs a <path> (not a plain <rect>) only when it is actually
 *  rounded AND the corner style is chamfer/inverted — round corners use <rect>. */
export const isRectCustomCorner = (rx = 0, ry = 0, cornerStyle?: string): boolean =>
  rx > 1e-6 && ry > 1e-6 && cornerStyle != null && cornerStyle !== "round";

export const rectPath = (w: number, h: number, rx = 0, ry = 0, cornerStyle?: "round" | "chamfer" | "inverted"): PathGeometry => {
  rx = Math.max(0, Math.min(rx, w / 2));
  ry = Math.max(0, Math.min(ry, h / 2));
  if (rx < 1e-6 || ry < 1e-6) {
    return {
      closed: true,
      anchors: [
        anchor({ x: 0, y: 0 }),
        anchor({ x: w, y: 0 }),
        anchor({ x: w, y: h }),
        anchor({ x: 0, y: h }),
      ],
    };
  }
  // The three Illustrator corner styles share the offset anchors; only the bezier
  // handle scale differs: round = +KAPPA (convex), chamfer = 0 (straight cut),
  // inverted = −KAPPA (negated → concave arc).
  const f = cornerStyle === "chamfer" ? 0 : cornerStyle === "inverted" ? -1 : 1;
  const cx = rx * KAPPA * f;
  const cy = ry * KAPPA * f;
  // 8 anchors, corners rounded with bezier handles.
  return {
    closed: true,
    anchors: [
      // top-left → top edge
      anchor({ x: rx, y: 0 }, { x: -cx, y: 0 }, { x: 0, y: 0 }),
      anchor({ x: w - rx, y: 0 }, { x: 0, y: 0 }, { x: cx, y: 0 }),
      // top-right corner
      anchor({ x: w, y: ry }, { x: 0, y: -cy }, { x: 0, y: 0 }),
      anchor({ x: w, y: h - ry }, { x: 0, y: 0 }, { x: 0, y: cy }),
      // bottom-right corner
      anchor({ x: w - rx, y: h }, { x: cx, y: 0 }, { x: 0, y: 0 }),
      anchor({ x: rx, y: h }, { x: 0, y: 0 }, { x: -cx, y: 0 }),
      // bottom-left corner
      anchor({ x: 0, y: h - ry }, { x: 0, y: cy }, { x: 0, y: 0 }),
      anchor({ x: 0, y: ry }, { x: 0, y: 0 }, { x: 0, y: -cy }),
    ],
  };
};

/** A live ellipse is a "pie" wedge when its pie angles span less than a whole
 *  turn; a full sweep (or no pie angles) is a plain ellipse. */
export const isEllipsePie = (pieStart?: number, pieEnd?: number): boolean =>
  pieStart != null && pieEnd != null && (pieEnd - pieStart) % 360 !== 0;

export const ellipsePath = (w: number, h: number, pieStart?: number, pieEnd?: number): PathGeometry => {
  const rx = w / 2;
  const ry = h / 2;
  const cx = rx;
  const cy = ry;
  if (!isEllipsePie(pieStart, pieEnd)) {
    const ox = rx * KAPPA;
    const oy = ry * KAPPA;
    return {
      closed: true,
      anchors: [
        anchor({ x: cx, y: 0 }, { x: -ox, y: 0 }, { x: ox, y: 0 }),
        anchor({ x: w, y: cy }, { x: 0, y: -oy }, { x: 0, y: oy }),
        anchor({ x: cx, y: h }, { x: ox, y: 0 }, { x: -ox, y: 0 }),
        anchor({ x: 0, y: cy }, { x: 0, y: oy }, { x: 0, y: -oy }),
      ],
    };
  }
  // Pie wedge: centre apex → elliptical arc (start→end) → close to centre.
  const start = (pieStart! * Math.PI) / 180;
  let end = (pieEnd! * Math.PI) / 180;
  while (end <= start) end += 2 * Math.PI; // normalise to a positive sweep
  // Reduce a multi-turn span to a single turn so the rendered sweep matches what
  // isEllipsePie classifies (e.g. 0→540° is a 180° wedge, not a full ellipse).
  const sweep = ((end - start) % (2 * Math.PI)) || 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(sweep / (Math.PI / 2)));
  const step = sweep / segs;
  const a = (4 / 3) * Math.tan(step / 4); // bezier handle factor per segment
  const pt = (t: number): Point => ({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  const tan = (t: number): Point => ({ x: -rx * Math.sin(t) * a, y: ry * Math.cos(t) * a }); // a × dP/dt

  const anchors = [anchor({ x: cx, y: cy })]; // wedge apex (straight lines to the arc ends)
  for (let i = 0; i <= segs; i++) {
    const t = start + i * step;
    const tg = tan(t);
    anchors.push(
      anchor(
        pt(t),
        i === 0 ? { x: 0, y: 0 } : { x: -tg.x, y: -tg.y }, // handleIn (from previous segment)
        i === segs ? { x: 0, y: 0 } : { x: tg.x, y: tg.y }, // handleOut (to next segment)
      ),
    );
  }
  return { closed: true, anchors };
};

const radialPoints = (radius: number, count: number, phase = -Math.PI / 2): Point[] => {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return pts;
};

export const polygonPath = (radius: number, sides: number): PathGeometry => ({
  closed: true,
  anchors: radialPoints(radius, Math.max(3, Math.round(sides))).map((p) => anchor(p)),
});

export const starPath = (radius1: number, radius2: number, points: number): PathGeometry => {
  const n = Math.max(3, Math.round(points));
  const anchors = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? radius1 : radius2;
    const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
    anchors.push(anchor({ x: Math.cos(a) * r, y: Math.sin(a) * r }));
  }
  return { closed: true, anchors };
};

export const linePath = (x1: number, y1: number, x2: number, y2: number): PathGeometry => ({
  closed: false,
  anchors: [anchor({ x: x1, y: y1 }), anchor({ x: x2, y: y2 })],
});

/** All outline subpaths of an item in LOCAL coordinates (empty for group/image). */
export const localPaths = (item: Item): PathGeometry[] => {
  switch (item.type) {
    case "path":
      return [item.geometry];
    case "compound":
      return item.subpaths;
    case "rect":
      return [rectPath(item.width, item.height, item.rx, item.ry, item.cornerStyle)];
    case "ellipse":
      return [ellipsePath(item.width, item.height, item.pieStart, item.pieEnd)];
    case "polygon":
      return [polygonPath(item.radius, item.sides)];
    case "star":
      return [starPath(item.radius1, item.radius2, item.points)];
    case "line":
      return [linePath(item.x1, item.y1, item.x2, item.y2)];
    default:
      return [];
  }
};

/** Rough local text bounds (refined by the renderer's real measurement). */
export const estimateTextBounds = (item: Extract<Item, { type: "text" }>): Rect => {
  const lines = item.text.split("\n");
  const lineH = item.fontSize * item.lineHeight;
  const widest = lines.reduce((m, l) => Math.max(m, l.length), 1);
  const w = item.boxWidth ?? widest * item.fontSize * 0.52;
  const ascent = item.fontSize * 0.8;
  const h = item.boxHeight ?? lines.length * lineH;
  let x = 0;
  if (!item.boxWidth) {
    if (item.align === "center") x = -w / 2;
    else if (item.align === "right") x = -w;
  }
  // Point text sits on its baseline, so its box starts one ascent above the
  // origin. AREA type does not: item-node.tsx draws its foreignObject at local
  // (0,0)…(boxWidth,boxHeight), so offsetting it too would put the selection
  // rectangle, handles and hit-testing an ascent above the painted text.
  return { x, y: item.boxWidth ? 0 : -ascent, width: w, height: h };
};

/** Local-space bounds of an item (geometry only; ignores stroke width). */
export const localBounds = (item: Item): Rect => {
  switch (item.type) {
    case "group": {
      // Clip group: visible bounds = clipped content ∩ clip shape (children[0]),
      // not the union of everything (which would include clipped-away content and
      // the unpainted clip shape).
      if (item.clip && item.children.length >= 2) {
        const clipB = transformRect(localBounds(item.children[0]), item.children[0].transform);
        let content: Rect | null = null;
        for (let i = 1; i < item.children.length; i++) {
          content = union(content, transformRect(localBounds(item.children[i]), item.children[i].transform));
        }
        if (content) {
          const x = Math.max(content.x, clipB.x);
          const y = Math.max(content.y, clipB.y);
          const x2 = Math.min(content.x + content.width, clipB.x + clipB.width);
          const y2 = Math.min(content.y + content.height, clipB.y + clipB.height);
          if (x2 > x && y2 > y) return { x, y, width: x2 - x, height: y2 - y };
        }
        return clipB;
      }
      let r: Rect | null = null;
      for (const child of item.children) {
        r = union(r, transformRect(localBounds(child), child.transform));
      }
      return r ?? { x: 0, y: 0, width: 0, height: 0 };
    }
    case "rect":
    case "ellipse":
    case "image":
      return { x: 0, y: 0, width: item.width, height: item.height };
    case "line":
      return fromTwoPoints({ x: item.x1, y: item.y1 }, { x: item.x2, y: item.y2 });
    case "text":
      return estimateTextBounds(item);
    case "polygon":
    case "star":
    case "path":
    case "compound": {
      const paths = localPaths(item);
      let r: Rect | null = null;
      for (const p of paths) r = union(r, pathBounds(p));
      return r ?? { x: 0, y: 0, width: 0, height: 0 };
    }
  }
};

/** Local-space corner points of an item's bounds (for transformed-AABB math). */
export const localCorners = (item: Item): Point[] => {
  const b = localBounds(item);
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ];
};

export { fromPoints, applyToPoint };
