// ─────────────────────────────────────────────────────────────
// tools/selection — the Selection (V) tool: click, move, marquee, transform
// ─────────────────────────────────────────────────────────────

import { BBox, type Document, Ops, type Point, Query, Vec } from "../engine";
import { constrainAngle, constrainAxis } from "./snap";
import {
  type HandleId,
  handleCursor,
  handlesForBounds,
  hitHandle,
  oppositeHandle,
} from "./handles";
import type { Tool, ToolContext, ToolPointer } from "./types";

type Mode = "idle" | "move" | "marquee" | "scale" | "rotate";

interface SelState {
  mode: Mode;
  started: boolean;
  startScreen: Point;
  startWorld: Point;
  startDoc: Document | null;
  ids: string[];
  handle: HandleId | null;
  pivot: Point;
  startHandleWorld: Point;
  startAngle: number;
  marquee: { x: number; y: number; w: number; h: number } | null;
  shiftAtDown: boolean;
  /** True when an Alt-drag cloned the selection (move-a-copy). */
  duplicated: boolean;
  cursor: string;
}

const DRAG_THRESHOLD = 3;

export function createSelectionTool(opts: { id?: string; targetLeaf?: boolean; progressive?: boolean } = {}): Tool {
  const s: SelState = {
    mode: "idle",
    started: false,
    startScreen: { x: 0, y: 0 },
    startWorld: { x: 0, y: 0 },
    startDoc: null,
    ids: [],
    handle: null,
    pivot: { x: 0, y: 0 },
    startHandleWorld: { x: 0, y: 0 },
    startAngle: 0,
    marquee: null,
    shiftAtDown: false,
    duplicated: false,
    cursor: "default",
  };
  // Group-Selection progressive expansion: repeated clicks on the same leaf walk up.
  let lastLeafId: string | null = null;
  let groupDepth = 0;

  const tool: Tool = {
    id: opts.id ?? "selection",
    receivesHover: true,
    get cursor() {
      return s.cursor;
    },

    onPointerDown(p, ctx) {
      const { store } = ctx;
      const doc = store.doc;
      s.startScreen = p.screen;
      s.startWorld = p.world;
      s.started = false;
      s.marquee = null;
      s.handle = null;
      s.duplicated = false;

      const sel = store.selection;
      // Only hit-test the transform handles when the canvas actually DRAWS them
      // (canvas-view.tsx's `showHandles`). Hide Edges (⌘H), Hide Bounding Box
      // (⇧⌘B) and Trim View all hide them, and an invisible handle that still
      // captures the drag scales or rotates artwork the user meant to click past.
      const st = ctx.store.getState();
      const handlesVisible = !st.editingTextId && !st.hideEdges && st.showBoundingBox && !st.trimView;
      if (sel.length && handlesVisible) {
        const b = Query.selectionBounds(doc, sel);
        if (b) {
          const handles = handlesForBounds(b, ctx.worldToScreen);
          const h = hitHandle(handles, p.screen);
          if (h === "rot") {
            s.mode = "rotate";
            s.pivot = handles.center;
            s.startAngle = Math.atan2(p.rawWorld.y - s.pivot.y, p.rawWorld.x - s.pivot.x);
            s.ids = sel.slice();
            return;
          }
          if (h) {
            s.mode = "scale";
            s.handle = h;
            s.pivot = handles.world[oppositeHandle[h]];
            s.startHandleWorld = handles.world[h];
            s.ids = sel.slice();
            return;
          }
        }
      }

      const hit = Query.hitTest(doc, p.world, 4 / ctx.zoom);
      if (hit) {
        if (opts.progressive && !p.shift) {
          // Group Selection: 1st click selects the leaf; each repeat on the same
          // leaf selects the next ancestor group up (Illustrator parity).
          const chain = hit.leaf.ancestors.slice().reverse(); // immediate parent … top-level
          if (hit.leaf.item.id === lastLeafId) groupDepth = Math.min(groupDepth + 1, chain.length);
          else {
            lastLeafId = hit.leaf.item.id;
            groupDepth = 0;
          }
          const targetId = groupDepth === 0 ? hit.leaf.item.id : chain[groupDepth - 1].id;
          store.setSelection([targetId]);
          s.mode = "move";
          s.ids = [targetId];
        } else {
          const targetId = (opts.targetLeaf ? hit.leaf : hit.target).item.id;
          if (p.shift) {
            store.toggleSelection(targetId);
          } else if (!store.selection.includes(targetId)) {
            store.setSelection([targetId]);
          } else if (store.selection.length > 1) {
            // Re-clicking an already-selected object in a multi-selection makes it
            // the Align "Key Object" — alignment then measures against it (Illustrator).
            store.setKeyObject(targetId);
          }
          s.mode = "move";
          s.ids = store.selection.slice();
          lastLeafId = null; // shift-click breaks the expansion chain
        }
      } else {
        if (!p.shift) store.clearSelection();
        s.mode = "marquee";
        s.shiftAtDown = p.shift;
        lastLeafId = null; // empty click resets the expansion chain
        groupDepth = 0;
      }
    },

    onPointerMove(p, ctx) {
      const { store } = ctx;
      const moved = Vec.dist(p.screen, s.startScreen) > DRAG_THRESHOLD;

      if (s.mode === "idle") {
        // Hover feedback: resize cursor over handles, move cursor over objects.
        let cursor = "default";
        const sel = store.selection;
        if (sel.length) {
          const b = Query.selectionBounds(store.doc, sel);
          if (b) {
            const handles = handlesForBounds(b, ctx.worldToScreen);
            const h = hitHandle(handles, p.screen);
            if (h) cursor = handleCursor[h];
          }
        }
        if (cursor === "default" && Query.hitTest(store.doc, p.world, 4 / ctx.zoom)) cursor = "move";
        if (cursor !== s.cursor) {
          s.cursor = cursor;
          ctx.requestRender();
        }
        return;
      }

      if (s.mode === "marquee") {
        s.marquee = {
          x: Math.min(s.startScreen.x, p.screen.x),
          y: Math.min(s.startScreen.y, p.screen.y),
          w: Math.abs(p.screen.x - s.startScreen.x),
          h: Math.abs(p.screen.y - s.startScreen.y),
        };
        ctx.requestRender();
        return;
      }

      if (!moved && !s.started) return;
      if (!s.started) {
        store.beginTransaction(s.mode === "move" ? "Move" : s.mode === "scale" ? "Scale" : "Rotate");
        // Alt-drag with the Selection tool moves a COPY (Illustrator), leaving the
        // original. Clone in place, retarget the drag to the copies, and snapshot
        // AFTER the clone so the base includes them (originals stay put).
        if (s.mode === "move" && p.alt) {
          let copies: string[] = [];
          store.mutate((d) => {
            copies = Ops.Items.duplicateItems(d, s.ids, 0, 0);
          });
          s.ids = copies;
          s.duplicated = true;
        }
        s.startDoc = store.doc;
        s.started = true;
      }
      const base = s.startDoc!;

      if (s.mode === "move") {
        let dx = p.world.x - s.startWorld.x;
        let dy = p.world.y - s.startWorld.y;
        if (p.shift) ({ dx, dy } = constrainAxis(dx, dy));
        store.mutateFrom(base, (d) => Ops.Transform.translateItems(d, s.ids, dx, dy));
      } else if (s.mode === "scale") {
        const dX = s.startHandleWorld.x - s.pivot.x;
        const dY = s.startHandleWorld.y - s.pivot.y;
        let sx = Math.abs(dX) > 1e-6 ? (p.world.x - s.pivot.x) / dX : 1;
        let sy = Math.abs(dY) > 1e-6 ? (p.world.y - s.pivot.y) / dY : 1;
        const h = s.handle!;
        if (h === "n" || h === "s") sx = 1;
        if (h === "e" || h === "w") sy = 1;
        if (p.shift && h.length === 2) {
          const f = Math.max(Math.abs(sx), Math.abs(sy));
          sx = Math.sign(sx || 1) * f;
          sy = Math.sign(sy || 1) * f;
        }
        if (Math.abs(sx) < 1e-3) sx = 1e-3;
        if (Math.abs(sy) < 1e-3) sy = 1e-3;
        store.mutateFrom(base, (d) => Ops.Transform.scaleItems(d, s.ids, sx, sy, s.pivot));
      } else if (s.mode === "rotate") {
        const cur = Math.atan2(p.rawWorld.y - s.pivot.y, p.rawWorld.x - s.pivot.x);
        let delta = cur - s.startAngle;
        if (p.shift) delta = constrainAngle(delta);
        store.mutateFrom(base, (d) => Ops.Transform.rotateItems(d, s.ids, delta, s.pivot));
      }
    },

    onPointerUp(p, ctx) {
      const { store } = ctx;
      if (s.mode === "marquee") {
        if (s.marquee && (s.marquee.w > 2 || s.marquee.h > 2)) {
          const a = ctx.screenToWorld({ x: s.marquee.x, y: s.marquee.y });
          const b = ctx.screenToWorld({ x: s.marquee.x + s.marquee.w, y: s.marquee.y + s.marquee.h });
          const ids = Query.itemsInRect(store.doc, BBox.fromTwoPoints(a, b), "crossing");
          if (s.shiftAtDown) store.addSelection(ids);
          else store.setSelection(ids);
        }
        s.marquee = null;
        ctx.requestRender();
      }
      if (s.started) store.endTransaction();
      if (s.duplicated) store.setSelection(s.ids); // select the moved copies
      s.duplicated = false;
      s.mode = "idle";
      s.started = false;
      s.startDoc = null;
    },

    onDeactivate(ctx) {
      // Finalize an in-flight drag if the tool changes mid-gesture (e.g. a tool
      // shortcut pressed during a move), committing under its own label instead
      // of leaking the open transaction into the next tool. Then reset drag state.
      if (s.started) ctx.store.endTransaction();
      if (s.duplicated) ctx.store.setSelection(s.ids);
      s.started = false;
      s.startDoc = null;
      s.mode = "idle";
      s.marquee = null;
      s.handle = null;
      s.duplicated = false;
    },

    onDoubleClick(p, ctx) {
      const hit = Query.hitTest(ctx.store.doc, p.world, 4 / ctx.zoom);
      if (!hit) return;
      // Double-clicking a type object enters text-edit on it, switching to the
      // Type tool whose overlay hosts the inline editor (Illustrator parity).
      if (hit.leaf.item.type === "text") {
        ctx.store.setSelection([hit.leaf.item.id]);
        // The Type tool opens the transaction in its onActivate: switching tools
        // runs canvas-view's leaked-transaction guard, which would cancel one
        // opened here before the edit had even started.
        ctx.store.setEditingText(hit.leaf.item.id);
        ctx.store.setTool("type");
        return;
      }
      // Otherwise dive into a group: select the deepest leaf under the pointer.
      ctx.store.setSelection([hit.leaf.item.id]);
    },

    renderOverlay() {
      if (!s.marquee) return null;
      return (
        <rect
          x={s.marquee.x}
          y={s.marquee.y}
          width={s.marquee.w}
          height={s.marquee.h}
          fill="rgba(74,158,255,0.10)"
          stroke="var(--accent-vector,#4a9eff)"
          strokeWidth={1}
        />
      );
    },
  };
  return tool;
}
