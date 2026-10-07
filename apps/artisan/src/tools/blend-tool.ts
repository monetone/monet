// ─────────────────────────────────────────────────────────────
// tools/blend — Illustrator's Blend tool (W)
// ─────────────────────────────────────────────────────────────
// Click one object, then another: the two are blended (Object ▸ Blend ▸ Make).
// Keep clicking to extend the chain — each further click blends the running
// result with the newly clicked object, which is how Illustrator grows a blend
// past two key objects. Escape (or switching tools) clears the pending pick.
//
// ponytail: clicks pick whole objects, not the specific anchor point Illustrator
// blends from. Anchor-accurate picking only changes step orientation; add it if
// someone actually needs it.

import { Ops, Query, type ID } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

export const createBlendTool = (): Tool => {
  let pending: ID | null = null;

  const clear = (ctx: ToolContext) => {
    pending = null;
    ctx.requestRender();
  };

  return {
    id: "blend",
    cursor: "crosshair",

    onDeactivate(ctx) {
      clear(ctx);
    },

    onKeyDown(e, ctx) {
      if (e.key === "Escape") clear(ctx);
    },

    onPointerDown(p: ToolPointer, ctx: ToolContext) {
      const hit = Query.hitTest(ctx.store.getState().doc, p.world, 4 / ctx.zoom);
      if (!hit) {
        clear(ctx);
        return;
      }
      const id = hit.target.item.id;
      if (!pending) {
        pending = id;
        ctx.store.setSelection([id]);
        ctx.requestRender();
        return;
      }
      if (id === pending) return; // clicking the same object twice is a no-op

      let gid: ID | null = null;
      const pair = [pending, id];
      ctx.store.transact("Blend", (d) => {
        gid = Ops.Blend.blend(d, pair);
      });
      // Chain: the new blend becomes the next click's starting object.
      pending = gid ?? null;
      if (gid) ctx.store.setSelection([gid]);
      ctx.requestRender();
    },
  };
};
