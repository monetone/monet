// ─────────────────────────────────────────────────────────────
// tools/blob-brush — paint a filled shape by sweeping a round nib
// ─────────────────────────────────────────────────────────────
// The drag is buffered into a filled region (union of nib squares along the
// path) and committed as a filled compound path.

import { Ops, type Point, Vec } from "../engine";
import type { Pair } from "polygon-clipping";
import type { Tool } from "./types";

const ACCENT = "var(--accent-vector, #4a9eff)";

export function createBlobBrushTool(): Tool {
  let worldPts: Point[] = [];
  let screenPts: Point[] = [];
  const rScreen = 14;

  return {
    id: "blob-brush",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      worldPts = [p.rawWorld];
      screenPts = [p.screen];
      ctx.requestRender();
    },
    onPointerMove(p, ctx) {
      if (!worldPts.length) return;
      if (Vec.dist(screenPts[screenPts.length - 1], p.screen) >= rScreen / 2) {
        worldPts.push(p.rawWorld);
        screenPts.push(p.screen);
      }
      ctx.requestRender();
    },
    onPointerUp(_p, ctx) {
      const store = ctx.store;
      if (worldPts.length) {
        const r = rScreen / ctx.zoom;
        const region = worldPts.map((pt) => [
          [
            [pt.x - r, pt.y - r],
            [pt.x + r, pt.y - r],
            [pt.x + r, pt.y + r],
            [pt.x - r, pt.y + r],
          ] as Pair[],
        ]);
        const st = store.getState();
        let nid: string | null = null;
        store.transact("Blob Brush", (d) => {
          // commit the stroke, merging into overlapping same-fill shapes (Illustrator)
          nid = Ops.Pathfinder.blobBrushCommit(d, region, st.fill, st.stroke, st.activeLayerId);
        });
        if (nid) store.setSelection([nid]);
      }
      worldPts = [];
      screenPts = [];
      ctx.requestRender();
    },
    renderOverlay() {
      if (screenPts.length === 0) return null;
      return (
        <polyline points={screenPts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={ACCENT} strokeWidth={rScreen * 2} strokeLinecap="round" strokeLinejoin="round" opacity={0.2} />
      );
    },
  };
}
