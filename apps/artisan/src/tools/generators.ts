// ─────────────────────────────────────────────────────────────
// tools/generators — Flare + Graph tools (drag to generate a group)
// ─────────────────────────────────────────────────────────────

import {
  type Document,
  type GraphKind,
  type Item,
  Ops,
  type Paint,
  type Point,
  defaultStroke,
  makeEllipse,
  makeGroup,
  makeGraphGroup,
  noPaint,
} from "../engine";
import type { Tool } from "./types";

const glow = (alpha: number): Paint => ({
  type: "gradient",
  gradient: {
    type: "radial",
    stops: [
      { offset: 0, color: { r: 255, g: 255, b: 255, a: alpha } },
      { offset: 1, color: { r: 255, g: 255, b: 255, a: 0 } },
    ],
    x1: 0.5, y1: 0.5, x2: 1, y2: 0.5, cx: 0.5, cy: 0.5, r: 0.5,
  },
});

const circleAt = (c: Point, r: number, fill: Paint): Item =>
  makeEllipse(c.x - r, c.y - r, r * 2, r * 2, { fill, stroke: defaultStroke(noPaint()) });

const buildFlare = (center: Point, radius: number): Item => {
  const R = Math.max(20, radius);
  const items: Item[] = [circleAt(center, R, glow(0.85)), circleAt(center, R * 0.28, glow(1))];
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const p = { x: center.x + R * 1.6 * t, y: center.y + R * 1.6 * t };
    items.push(circleAt(p, R * (0.08 + 0.05 * i), glow(0.5)));
  }
  return makeGroup(items, { name: "Flare" });
};

export type GeneratorKind =
  | "flare"
  | "column-graph"
  | "pie-graph"
  | "line-graph"
  | "bar-graph"
  | "area-graph"
  | "scatter-graph"
  | "radar-graph";

const GRAPH_KIND_BY_TOOL: Partial<Record<GeneratorKind, GraphKind>> = {
  "column-graph": "column",
  "pie-graph": "pie",
  "line-graph": "line",
  "bar-graph": "bar",
  "area-graph": "area",
  "scatter-graph": "scatter",
  "radar-graph": "radar",
};

export function createGeneratorTool(kind: GeneratorKind): Tool {
  let start: Point = { x: 0, y: 0 };
  let id: string | null = null;
  let startDoc: Document | null = null;

  const build = (cur: Point): Item => {
    const radius = Math.hypot(cur.x - start.x, cur.y - start.y);
    const graphKind = GRAPH_KIND_BY_TOOL[kind];
    if (graphKind) return makeGraphGroup(graphKind, start, cur);
    return buildFlare(start, radius);
  };

  return {
    id: kind,
    cursor: "crosshair",
    onPointerDown(p, ctx) {
      const store = ctx.store;
      const st = store.getState();
      start = p.world;
      const item = build(p.world);
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
      const rebuilt = build(p.world);
      ctx.store.mutateFrom(startDoc!, (d) => {
        const layer = d.layers.find((l) => l.items.some((it) => it.id === id));
        if (!layer) return;
        const idx = layer.items.findIndex((it) => it.id === id);
        if (idx >= 0) {
          rebuilt.id = id!;
          if (rebuilt.type === "group" && rebuilt.graph) rebuilt.graph.id = id!;
          layer.items[idx] = rebuilt;
        }
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
