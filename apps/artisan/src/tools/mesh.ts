// ─────────────────────────────────────────────────────────────
// tools/mesh — gradient mesh (subdivide a shape into bilinearly-colored cells)
// ─────────────────────────────────────────────────────────────
// A pragmatic gradient mesh: the clicked shape is replaced by an N×M grid of
// filled quads whose colors are bilinearly interpolated between four corner
// colors derived from the shape's fill. Cells can then be recolored.

import { Mat, Ops, Query } from "../engine";
import type { Tool } from "./types";

export function createMeshTool(): Tool {
  return {
    id: "mesh",
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const hit = Query.hitTest(store.doc, p.world, 4 / ctx.zoom);
      if (!hit) return;
      const loc = Query.findItem(store.doc, hit.leaf.item.id);
      if (!loc) return;
      const mesh = [...loc.ancestors].reverse().find((group) => group.mesh);
      if (mesh) {
        const fill = store.getState().fill;
        if (fill.type !== "solid") return;
        const local = Mat.applyToPoint(Mat.invert(Query.worldTransform(store.doc, mesh.id)), p.world);
        const point = mesh.mesh!.points.reduce((nearest, candidate) => {
          const nearestDistance = (nearest.x - local.x) ** 2 + (nearest.y - local.y) ** 2;
          const candidateDistance = (candidate.x - local.x) ** 2 + (candidate.y - local.y) ** 2;
          return candidateDistance < nearestDistance ? candidate : nearest;
        });
        store.transact("Mesh Point Color", (d) => {
          Ops.Meshes.updateMeshPointColor(d, mesh.id, point.row, point.column, fill.color);
        });
        store.setSelection([mesh.id]);
        return;
      }
      if (loc.item.type === "group") return;
      let meshId: string | null = null;
      store.transact("Mesh", (d) => {
        meshId = Ops.Meshes.createMeshFromItem(d, loc.item.id);
      });
      if (meshId) store.setSelection([meshId]);
    },
  };
}
