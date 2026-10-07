// ─────────────────────────────────────────────────────────────
// tools/path-shapes — Arc + Spiral (drag-drawn bezier paths)
// ─────────────────────────────────────────────────────────────

import { type Anchor, type Document, Ops, type PathGeometry, type Point, Query, makeAnchor, makeCompound, makePath, noPaint } from "../engine";
import type { Tool } from "./types";

export type PathShapeKind = "arc" | "spiral";
export type GridKind = "rect-grid" | "polar-grid";

export const arcGeometry = (start: Point, cur: Point): PathGeometry => {
  const dx = cur.x - start.x;
  const dy = cur.y - start.y;
  // Quarter-ellipse from start to cur with bezier handles.
  const a0: Anchor = makeAnchor(start, { x: 0, y: 0 }, { x: 0, y: dy * 0.5523 });
  const a1: Anchor = makeAnchor(cur, { x: -dx * 0.5523, y: 0 }, { x: 0, y: 0 });
  return { closed: false, anchors: [a0, a1] };
};

export const spiralGeometry = (start: Point, cur: Point): PathGeometry => {
  const R = Math.hypot(cur.x - start.x, cur.y - start.y);
  if (R < 1) return { closed: false, anchors: [makeAnchor(start)] };
  const turns = 3;
  const baseAngle = Math.atan2(cur.y - start.y, cur.x - start.x);
  const steps = turns * 12;
  const decay = 0.82; // radius shrinks toward the center each quarter turn
  const pts: Point[] = [];
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const angle = baseAngle + t * turns * Math.PI * 2;
    const r = R * Math.pow(decay, (1 - t) * turns * 4);
    pts.push({ x: start.x + Math.cos(angle) * r, y: start.y + Math.sin(angle) * r });
  }
  // smooth via Catmull-Rom handles
  const n = pts.length;
  const anchors = pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    return makeAnchor(p, { x: -(next.x - prev.x) / 6, y: -(next.y - prev.y) / 6 }, { x: (next.x - prev.x) / 6, y: (next.y - prev.y) / 6 });
  });
  return { closed: false, anchors };
};

export function createPathShapeTool(kind: PathShapeKind): Tool {
  let id: string | null = null;
  let start: Point = { x: 0, y: 0 };
  let startDoc: Document | null = null;

  return {
    id: kind,
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const st = store.getState();
      start = p.world;
      const geom = kind === "arc" ? arcGeometry(start, p.world) : spiralGeometry(start, p.world);
      const item = makePath(geom, { fill: noPaint(), stroke: st.stroke, name: kind === "arc" ? "Arc" : "Spiral" });
      store.beginTransaction(kind === "arc" ? "Arc" : "Spiral");
      store.mutate((d) => {
        Ops.Items.insertNew(d, item, { layerId: st.activeLayerId, mode: st.drawingMode, insideTargetId: st.drawInsideTarget });
      });
      id = item.id;
      startDoc = store.doc;
      store.setSelection([item.id]);
    },
    onPointerMove(p, ctx) {
      if (!id) return;
      const geom = kind === "arc" ? arcGeometry(start, p.world) : spiralGeometry(start, p.world);
      ctx.store.mutateFrom(startDoc!, (d) => {
        const loc = Query.findItem(d, id!);
        if (loc && loc.item.type === "path") loc.item.geometry = geom;
      });
    },
    onPointerUp(_p, ctx) {
      if (!id) return;
      const loc = Query.findItem(ctx.store.doc, id);
      if (!loc || (loc.item.type === "path" && loc.item.geometry.anchors.length < 2)) ctx.store.cancelTransaction();
      else ctx.store.endTransaction();
      ctx.store.setTool("selection");
      id = null;
      startDoc = null;
    },
  };
}

// ── Grids (compound paths of lines / rings) ──────────────────
const KAPPA = 0.5522847498;

const circlePath = (c: Point, r: number): PathGeometry => {
  const k = KAPPA * r;
  return {
    closed: true,
    anchors: [
      makeAnchor({ x: c.x, y: c.y - r }, { x: -k, y: 0 }, { x: k, y: 0 }),
      makeAnchor({ x: c.x + r, y: c.y }, { x: 0, y: -k }, { x: 0, y: k }),
      makeAnchor({ x: c.x, y: c.y + r }, { x: k, y: 0 }, { x: -k, y: 0 }),
      makeAnchor({ x: c.x - r, y: c.y }, { x: 0, y: k }, { x: 0, y: -k }),
    ],
  };
};

export const rectGrid = (start: Point, cur: Point, cols = 5, rows = 5): PathGeometry[] => {
  const x = Math.min(start.x, cur.x);
  const y = Math.min(start.y, cur.y);
  const w = Math.abs(cur.x - start.x);
  const h = Math.abs(cur.y - start.y);
  const subs: PathGeometry[] = [
    { closed: true, anchors: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }].map((p) => makeAnchor(p)) },
  ];
  for (let i = 1; i < cols; i++) {
    const lx = x + (w * i) / cols;
    subs.push({ closed: false, anchors: [makeAnchor({ x: lx, y }), makeAnchor({ x: lx, y: y + h })] });
  }
  for (let j = 1; j < rows; j++) {
    const ly = y + (h * j) / rows;
    subs.push({ closed: false, anchors: [makeAnchor({ x, y: ly }), makeAnchor({ x: x + w, y: ly })] });
  }
  return subs;
};

export const polarGrid = (center: Point, R: number, rings = 4, spokes = 8): PathGeometry[] => {
  const subs: PathGeometry[] = [];
  for (let k = 1; k <= rings; k++) subs.push(circlePath(center, (R * k) / rings));
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * Math.PI * 2;
    subs.push({ closed: false, anchors: [makeAnchor(center), makeAnchor({ x: center.x + Math.cos(a) * R, y: center.y + Math.sin(a) * R })] });
  }
  return subs;
};

export function createGridTool(kind: GridKind): Tool {
  let id: string | null = null;
  let start: Point = { x: 0, y: 0 };
  let startDoc: Document | null = null;

  const build = (cur: Point): PathGeometry[] =>
    kind === "rect-grid" ? rectGrid(start, cur) : polarGrid(start, Math.max(1, Math.hypot(cur.x - start.x, cur.y - start.y)));

  return {
    id: kind,
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const st = store.getState();
      start = p.world;
      const item = makeCompound(build(p.world), { fill: noPaint(), stroke: st.stroke });
      item.name = kind === "rect-grid" ? "Rectangular Grid" : "Polar Grid";
      store.beginTransaction(item.name);
      store.mutate((d) => {
        Ops.Items.insertNew(d, item, { layerId: st.activeLayerId, mode: st.drawingMode, insideTargetId: st.drawInsideTarget });
      });
      id = item.id;
      startDoc = store.doc;
      store.setSelection([item.id]);
    },
    onPointerMove(p, ctx) {
      if (!id) return;
      const subs = build(p.world);
      ctx.store.mutateFrom(startDoc!, (d) => {
        const loc = Query.findItem(d, id!);
        if (loc && loc.item.type === "compound") loc.item.subpaths = subs;
      });
    },
    onPointerUp(_p, ctx) {
      if (!id) return;
      ctx.store.endTransaction();
      ctx.store.setTool("selection");
      id = null;
      startDoc = null;
    },
  };
}
