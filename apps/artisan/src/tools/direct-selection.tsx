// ─────────────────────────────────────────────────────────────
// tools/direct-selection — the Direct Selection (A) tool
// ─────────────────────────────────────────────────────────────
// Edits anchor points and bezier handles of selected paths. Clicking a path
// selects it (and reveals its anchors); clicking an anchor selects it; dragging
// moves anchors or handles. Live shapes convert to editable paths on first edit.

import { Mat, type Anchor, type Document, type Matrix, Ops, type Point, Query, Shapes, Vec } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ACCENT = "var(--accent-vector, #4a9eff)";
const HIT = 6;

interface Editable {
  id: string;
  world: Matrix;
  anchors: Anchor[];
}

function editables(doc: Document, ids: string[]): Editable[] {
  const out: Editable[] = [];
  for (const id of ids) {
    const loc = Query.findItem(doc, id);
    if (!loc) continue;
    const it = loc.item;
    const world = Query.worldTransformAt(loc);
    if (it.type === "path") out.push({ id, world, anchors: it.geometry.anchors });
    else if (it.type === "compound") out.push({ id, world, anchors: it.subpaths.flatMap((path) => path.anchors) });
    else if (it.type === "rect" || it.type === "ellipse" || it.type === "polygon" || it.type === "star" || it.type === "line") {
      const paths = Shapes.localPaths(it);
      if (paths[0]) out.push({ id, world, anchors: paths[0].anchors });
    }
  }
  return out;
}

export function createDirectSelectionTool(): Tool {
  let mode: "idle" | "anchor" | "handle" = "idle";
  let started = false;
  let startWorld: Point = { x: 0, y: 0 };
  let startDoc: Document | null = null;
  let dragId: string | null = null;
  let dragHandle: { index: number; which: "in" | "out" } | null = null;
  let dragAnchorPoint: Point | null = null;

  const localOf = (ctx: ToolContext, id: string, world: Matrix, p: Point): Point =>
    Mat.applyToPoint(Mat.invert(world), p);

  return {
    id: "direct-selection",
    cursor: "default",

    onPointerDown(p, ctx) {
      const store = ctx.store;
      const doc = store.doc;
      const ids = store.selection;
      const anchorSel = store.getState().anchorSelection;
      startWorld = p.world;
      started = false;
      mode = "idle";
      dragHandle = null;
      dragAnchorPoint = null;

      const eds = editables(doc, ids);

      // 1) Handle of a selected anchor?
      for (const ed of eds) {
        const sel = anchorSel[ed.id] ?? [];
        for (const idx of sel) {
          const a = ed.anchors[idx];
          if (!a) continue;
          for (const which of ["in", "out"] as const) {
            const h = which === "in" ? a.handleIn : a.handleOut;
            if (!h.x && !h.y) continue;
            const sp = ctx.worldToScreen(Mat.applyToPoint(ed.world, { x: a.point.x + h.x, y: a.point.y + h.y }));
            if (Vec.dist(sp, p.screen) <= HIT) {
              dragId = ed.id;
              dragHandle = { index: idx, which };
              dragAnchorPoint = { ...a.point };
              mode = "handle";
              return;
            }
          }
        }
      }

      // 2) An anchor point?
      for (const ed of eds) {
        for (let i = 0; i < ed.anchors.length; i++) {
          const sp = ctx.worldToScreen(Mat.applyToPoint(ed.world, ed.anchors[i].point));
          if (Vec.dist(sp, p.screen) <= HIT) {
            const prev = store.getState().anchorSelection[ed.id] ?? [];
            const next = p.shift ? (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]) : [i];
            store.setAnchorSelection({ [ed.id]: next });
            dragId = ed.id;
            mode = "anchor";
            return;
          }
        }
      }

      // 3) Path body → select that object and show its anchors.
      const hit = Query.hitTest(doc, p.world, HIT / ctx.zoom);
      if (hit) {
        store.setSelection([hit.leaf.item.id]);
        store.setAnchorSelection({});
      } else {
        store.clearSelection();
        store.setAnchorSelection({});
      }
    },

    onPointerMove(p, ctx) {
      if (mode === "idle" || !dragId) return;
      const store = ctx.store;
      const moved = Vec.dist(p.rawWorld, startWorld) > 0.5;
      if (!moved && !started) return;

      if (!started) {
        // Convert a live shape to a path before the first edit.
        const loc = Query.findItem(store.doc, dragId);
        if (loc && loc.item.type !== "path" && loc.item.type !== "compound") {
          store.transact("Convert to Path", (d) => Ops.PathEdit.convertToPath(d, dragId!));
        }
        startDoc = store.doc;
        store.beginTransaction(mode === "handle" ? "Move Handle" : "Move Anchor");
        started = true;
      }
      const base = startDoc!;
      const loc = Query.findItem(base, dragId);
      if (!loc) return;
      const world = Query.worldTransformAt(loc);

      if (mode === "anchor") {
        const ls = localOf(ctx, dragId, world, startWorld);
        const lc = localOf(ctx, dragId, world, p.world);
        const ldx = lc.x - ls.x;
        const ldy = lc.y - ls.y;
        const indices = store.getState().anchorSelection[dragId] ?? [];
        store.mutateFrom(base, (d) => Ops.PathEdit.moveAnchors(d, dragId!, indices, ldx, ldy));
      } else if (mode === "handle" && dragHandle) {
        if (dragAnchorPoint) {
          const lc = localOf(ctx, dragId, world, p.rawWorld);
          const vec = { x: lc.x - dragAnchorPoint.x, y: lc.y - dragAnchorPoint.y };
          store.mutateFrom(base, (d) => Ops.PathEdit.setHandle(d, dragId!, dragHandle!.index, dragHandle!.which, vec, !p.alt));
        }
      }
    },

    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      mode = "idle";
      started = false;
      dragId = null;
      dragHandle = null;
      dragAnchorPoint = null;
      startDoc = null;
    },

    onKeyDown(e, ctx) {
      if (e.key === "Delete" || e.key === "Backspace") {
        const store = ctx.store;
        const anchorSel = store.getState().anchorSelection;
        const ids = Object.keys(anchorSel).filter((id) => anchorSel[id]?.length);
        if (ids.length) {
          e.preventDefault();
          e.stopImmediatePropagation();
          store.transact("Delete Anchors", (d) => {
            for (const id of ids) Ops.PathEdit.deleteAnchors(d, id, anchorSel[id]);
          });
          store.setAnchorSelection({});
        }
      }
    },

    renderOverlay(ctx) {
      const store = ctx.store;
      const eds = editables(store.doc, store.selection);
      if (!eds.length) return null;
      const anchorSel = store.getState().anchorSelection;
      const nodes: React.ReactNode[] = [];
      for (const ed of eds) {
        const sel = new Set(anchorSel[ed.id] ?? []);
        // Handles for selected anchors.
        for (const i of sel) {
          const a = ed.anchors[i];
          if (!a) continue;
          const ap = ctx.worldToScreen(Mat.applyToPoint(ed.world, a.point));
          for (const which of ["in", "out"] as const) {
            const h = which === "in" ? a.handleIn : a.handleOut;
            if (!h.x && !h.y) continue;
            const hp = ctx.worldToScreen(Mat.applyToPoint(ed.world, { x: a.point.x + h.x, y: a.point.y + h.y }));
            nodes.push(<line key={`${ed.id}-${i}-${which}-l`} x1={ap.x} y1={ap.y} x2={hp.x} y2={hp.y} stroke={ACCENT} strokeWidth={1} />);
            nodes.push(<circle key={`${ed.id}-${i}-${which}-c`} cx={hp.x} cy={hp.y} r={3} fill={ACCENT} />);
          }
        }
        // Anchor squares.
        for (let i = 0; i < ed.anchors.length; i++) {
          const sp = ctx.worldToScreen(Mat.applyToPoint(ed.world, ed.anchors[i].point));
          const isSel = sel.has(i);
          nodes.push(
            <rect key={`${ed.id}-a-${i}`} x={sp.x - 3} y={sp.y - 3} width={6} height={6} fill={isSel ? ACCENT : "#fff"} stroke={ACCENT} strokeWidth={1} />,
          );
        }
      }
      return <g>{nodes}</g>;
    },
  };
}
