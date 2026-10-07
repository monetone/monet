// ─────────────────────────────────────────────────────────────
// render/fallback-overlay — SVG for what the Rust canvas can't do (hybrid)
// ─────────────────────────────────────────────────────────────
// In raster mode the Rust/WASM engine paints plain vector content; items it
// doesn't rasterize faithfully yet — TEXT (needs the browser font engine), and
// items with live EFFECTS or a MASK — are rendered here in SVG, positioned with
// their world transform and layered over the canvas. The engine skips these
// exact items (see render.rs `has_svg_fallback`), so nothing is double-drawn.
//
// Caveat: the SVG layer composites above the whole canvas, so a fallback item
// that should sit *behind* plain content can appear on top — corrected once the
// Rust renderer rasterizes effects/masks directly.

import { Fragment } from "react";
import { Mat, type Document, type Item, type Matrix } from "../engine";
import { ItemNode } from "./item-node";

function needsSvg(it: Item): boolean {
  return it.type === "text" || (it.effects?.length ?? 0) > 0 || (it.mask?.length ?? 0) > 0;
}

function collect(items: Item[], parent: Matrix, out: { item: Item; world: Matrix }[]) {
  for (const it of items) {
    if (!it.visible) continue;
    if (needsSvg(it)) {
      // ItemNode applies the item's own transform, so wrap in the PARENT world.
      out.push({ item: it, world: parent });
    } else if (it.type === "group") {
      collect(it.children, Mat.mul(parent, it.transform), out);
    }
  }
}

export function FallbackOverlay({ doc, hideId }: { doc: Document; hideId?: string }) {
  const out: { item: Item; world: Matrix }[] = [];
  for (const layer of doc.layers) {
    if (layer.visible && !layer.template) collect(layer.items, Mat.IDENTITY, out);
  }
  return (
    <Fragment>
      {out.map(({ item, world }) =>
        item.id === hideId ? null : (
          <g key={item.id} transform={Mat.isIdentity(world) ? undefined : Mat.toSVG(world)}>
            <ItemNode item={item} />
          </g>
        ),
      )}
    </Fragment>
  );
}
