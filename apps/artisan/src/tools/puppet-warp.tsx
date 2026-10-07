// ─────────────────────────────────────────────────────────────
// tools/puppet-warp — pinned mesh deformation of a path
// ─────────────────────────────────────────────────────────────
// Click to drop pins on a shape, then drag a pin to deform it: every anchor
// moves by the sum of the pins' displacements, weighted by inverse-square
// distance (so pins hold their region while the dragged pin pulls nearby points).

import { Mat, type Document, Ops, type Point, Query, Vec } from "../engine";
import type { Tool, ToolContext } from "./types";

const ACCENT = "var(--accent-vector, #4a9eff)";

interface Pin {
  rest: Point; // local
  cur: Point; // local
}

export function createPuppetWarpTool(): Tool {
  let itemId: string | null = null;
  let restAnchors: Point[] | null = null;
  let pins: Pin[] = [];
  let drag: number | null = null;
  let startDoc: Document | null = null;
  let started = false;

  const localOf = (ctx: ToolContext, world: Point): Point => {
    const loc = itemId ? Query.findItem(ctx.store.doc, itemId) : null;
    if (!loc) return world;
    return Mat.applyToPoint(Mat.invert(Query.worldTransformAt(loc)), world);
  };
  const worldOf = (ctx: ToolContext, local: Point): Point => {
    const loc = itemId ? Query.findItem(ctx.store.doc, itemId) : null;
    if (!loc) return local;
    return Mat.applyToPoint(Query.worldTransformAt(loc), local);
  };

  const recompute = (d: Document) => {
    if (!itemId || !restAnchors) return;
    const anchors = Ops.PathEdit.editableAnchorRefs(d, itemId).map((ref) => ref.anchor);
    for (let i = 0; i < anchors.length && i < restAnchors.length; i++) {
      const rp = restAnchors[i];
      let wx = 0;
      let wy = 0;
      let wsum = 0;
      const ws = pins.map((pin) => 1 / (Vec.distSq(rp, pin.rest) + 1));
      pins.forEach((pin, k) => {
        const w = ws[k];
        wsum += w;
        wx += (pin.cur.x - pin.rest.x) * w;
        wy += (pin.cur.y - pin.rest.y) * w;
      });
      if (wsum > 0) {
        anchors[i].point = { x: rp.x + wx / wsum, y: rp.y + wy / wsum };
      }
    }
  };

  return {
    id: "puppet-warp",
    cursor: "crosshair",

    onPointerDown(p, ctx) {
      const store = ctx.store;
      const hit = Query.hitTest(store.doc, p.world, 6 / ctx.zoom);
      if (hit && hit.leaf.item.id !== itemId) {
        itemId = hit.leaf.item.id;
        pins = [];
        restAnchors = null;
        ctx.requestRender();
      }
      if (!itemId) return;
      // Near an existing pin?
      const nearIdx = pins.findIndex((pin) => Vec.dist(ctx.worldToScreen(worldOf(ctx, pin.cur)), p.screen) < 9);
      if (nearIdx >= 0) {
        drag = nearIdx;
      } else {
        const local = localOf(ctx, p.world);
        pins.push({ rest: local, cur: local });
        drag = pins.length - 1;
      }
      started = false;
    },

    onPointerMove(p, ctx) {
      if (itemId == null || drag == null) return;
      const store = ctx.store;
      if (!started) {
        const loc0 = Query.findItem(store.doc, itemId);
        if (loc0 && loc0.item.type !== "path" && loc0.item.type !== "compound") store.transact("Convert to Path", (d) => Ops.PathEdit.convertToPath(d, itemId!));
        startDoc = store.doc;
        if (!restAnchors) restAnchors = Ops.PathEdit.editableAnchorRefs(startDoc, itemId).map((ref) => ({ ...ref.anchor.point }));
        store.beginTransaction("Puppet Warp");
        started = true;
      }
      pins[drag].cur = localOf(ctx, p.rawWorld);
      store.mutateFrom(startDoc!, (d) => recompute(d));
    },

    onPointerUp(_p, ctx) {
      if (started) ctx.store.endTransaction();
      // keep pins so further drags compound; sync rest to current after a drag
      if (started && restAnchors) {
        pins = pins.map((pin) => ({ rest: { ...pin.cur }, cur: { ...pin.cur } }));
        if (itemId) restAnchors = Ops.PathEdit.editableAnchorRefs(ctx.store.doc, itemId).map((ref) => ({ ...ref.anchor.point }));
      }
      drag = null;
      started = false;
      startDoc = null;
    },

    onDeactivate() {
      itemId = null;
      pins = [];
      restAnchors = null;
    },

    renderOverlay(ctx) {
      if (!itemId || pins.length === 0) return null;
      return (
        <g pointerEvents="none">
          {pins.map((pin, i) => {
            const s = ctx.worldToScreen(worldOf(ctx, pin.cur));
            return <circle key={i} cx={s.x} cy={s.y} r={5} fill="#fff" stroke={ACCENT} strokeWidth={1.5} />;
          })}
        </g>
      );
    },
  };
}
