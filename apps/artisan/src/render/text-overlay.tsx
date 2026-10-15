// ─────────────────────────────────────────────────────────────
// render/fallback-overlay — SVG for what the Rust canvas can't decode
// ─────────────────────────────────────────────────────────────
// In raster mode the Rust engine paints shapes, text, groups, effects, masks,
// and base64 PNG images. This overlay draws only the remainder (an image the
// PNG rasterizer cannot decode) so those pixels have one owner. Painting an
// effect or mask here as well would composite it above the whole canvas.

import { Fragment } from "react";
import { Mat, type Document, type Item, type Matrix } from "../engine";
import { ItemNode } from "./item-node";

function rustPaints(it: Item): boolean {
  if (it.type === "image") {
    const comma = it.href.indexOf(",");
    if (comma < 0) return false;
    const header = it.href.slice(0, comma).toLowerCase();
    return header.includes("base64") && header.includes("image/png");
  }
  return (
    it.type === "rect" ||
    it.type === "ellipse" ||
    it.type === "polygon" ||
    it.type === "star" ||
    it.type === "line" ||
    it.type === "path" ||
    it.type === "compound" ||
    it.type === "text" ||
    it.type === "group"
  );
}

function needsSvg(it: Item): boolean {
  return !rustPaints(it);
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
