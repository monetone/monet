// ─────────────────────────────────────────────────────────────
// tools/paintbrush — calligraphic brush (freehand → filled ribbon)
// ─────────────────────────────────────────────────────────────
// Offsets the drag centerline by a fixed nib vector to produce a calligraphic
// ribbon (thin when moving along the nib, thick when crossing it), committed as
// a filled closed path colored with the current stroke (brush) color.

import {
  DEFAULT_CALLIGRAPHIC_BRUSH_SETTINGS,
  type Document,
  Ops,
  Query,
  brushApplication,
  brushSettings,
  type BrushDefinition,
  type PathGeometry,
  type Point,
  Vec,
  defaultStroke,
  makeAnchor,
  makePath,
  noPaint,
} from "../engine";
import type { Tool } from "./types";

const fallbackBrush: BrushDefinition = {
  id: "default-calligraphic",
  name: "Basic Calligraphic",
  kind: "calligraphic",
  ...DEFAULT_CALLIGRAPHIC_BRUSH_SETTINGS,
};

const activeBrush = (doc: Document, activeBrushId: string | null): BrushDefinition => {
  const brushes = Query.brushDefinitionEntries(doc).map((entry) => entry.brush);
  return brushes.find((brush) => brush.id === activeBrushId) ?? brushes[0] ?? fallbackBrush;
};

const ribbon = (points: Point[], halfW: number, angleDeg: number, roundness: number): PathGeometry => {
  const angle = (angleDeg * Math.PI) / 180;
  const effectiveHalfW = halfW * Math.max(0.01, Math.min(1, roundness));
  const ox = Math.cos(angle + Math.PI / 2) * effectiveHalfW;
  const oy = Math.sin(angle + Math.PI / 2) * effectiveHalfW;
  const left = points.map((p) => makeAnchor({ x: p.x + ox, y: p.y + oy }));
  const right = points.map((p) => makeAnchor({ x: p.x - ox, y: p.y - oy })).reverse();
  return { closed: true, anchors: [...left, ...right] };
};

export function createPaintbrushTool(): Tool {
  let pts: Point[] = [];
  let id: string | null = null;
  let startDoc: Document | null = null;
  let halfW = 5;
  let brush = fallbackBrush;

  return {
    id: "paintbrush",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const st = store.getState();
      brush = activeBrush(st.doc, st.activeBrushId);
      const settings = brushSettings(brush);
      halfW = settings.size / 2 / ctx.zoom;
      pts = [p.rawWorld];
      const fill = settings.paintSource === "fill" || st.stroke.paint.type === "none" ? st.fill : st.stroke.paint;
      const item = makePath(ribbon(pts, halfW, settings.angle, settings.roundness), { fill, stroke: defaultStroke(noPaint()), name: brush.name });
      item.brush = brushApplication(brush, { expanded: true });
      store.beginTransaction("Paintbrush");
      store.mutate((d) => {
        Ops.Items.insertNew(d, item, { layerId: st.activeLayerId, mode: st.drawingMode, insideTargetId: st.drawInsideTarget });
      });
      id = item.id;
      startDoc = store.doc;
      store.setSelection([item.id]);
    },
    onPointerMove(p, ctx) {
      if (!id) return;
      if (Vec.dist(pts[pts.length - 1], p.rawWorld) < halfW * 0.4) return;
      pts.push(p.rawWorld);
      const settings = brushSettings(brush);
      const geom = ribbon(pts, halfW, settings.angle, settings.roundness);
      ctx.store.mutateFrom(startDoc!, (d) => {
        const loc = Query.findItem(d, id!);
        if (loc?.item.type === "path") loc.item.geometry = geom;
      });
    },
    // Without this, a tool switch mid-stroke leaves `id`/`startDoc` set, and the
    // next hover replays mutateFrom(startDoc) — replacing the WHOLE document
    // with the abandoned stroke's snapshot, outside any transaction, so the work
    // it destroys cannot be recovered. Same leak freehand.ts fixes for Pencil.
    onDeactivate(ctx) {
      if (!id) return;
      ctx.store.cancelTransaction();
      id = null;
      startDoc = null;
      pts = [];
    },

    onPointerUp(_p, ctx) {
      if (!id) return;
      if (pts.length < 2) ctx.store.cancelTransaction();
      else ctx.store.endTransaction();
      id = null;
      startDoc = null;
      pts = [];
    },
  };
}
