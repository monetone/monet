// ─────────────────────────────────────────────────────────────
// ops/split-grid.test — Object ▸ Path ▸ Split Into Grid (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Split Into Grid — divides an object's bounding box
// into rows × columns rectangular cells (with optional gutters); the cells
// inherit the object's appearance and replace it as a group.

import { describe, it, expect } from "vitest";
import { makeDocument, makeGroup, makeImage, makeRect, makePath, makeText, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { GroupItem } from "../index";

const RED = rgba(220, 0, 0);
const groupOf = (doc: ReturnType<typeof makeDocument>, id: string): GroupItem => {
  const it = Query.getItem(doc, id)!;
  if (it.type !== "group") throw new Error("not a group");
  return it;
};
const cellBox = (doc: ReturnType<typeof makeDocument>, g: GroupItem, k: number) => Query.worldBounds(doc, g.children[k].id)!;

describe("ops.split-grid.splitIntoGrid", () => {
  it("splits a 100×100 square into a 2×2 grid of 50×50 cells, replacing it", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);

    const ids = Ops.SplitGrid.splitIntoGrid(doc, [r.id], { rows: 2, columns: 2 });
    expect(ids).toHaveLength(1);
    expect(doc.layers[0].items).toHaveLength(1); // original replaced by the grid group
    expect(Query.getItem(doc, r.id)).toBeNull();

    const g = groupOf(doc, ids[0]);
    expect(g.children).toHaveLength(4);
    // row-major: (0,0),(50,0),(0,50),(50,50), each 50×50
    expect([cellBox(doc, g, 0).x, cellBox(doc, g, 0).y, cellBox(doc, g, 0).width, cellBox(doc, g, 0).height]).toEqual([0, 0, 50, 50]);
    expect([cellBox(doc, g, 1).x, cellBox(doc, g, 1).y]).toEqual([50, 0]);
    expect([cellBox(doc, g, 2).x, cellBox(doc, g, 2).y]).toEqual([0, 50]);
    expect([cellBox(doc, g, 3).x, cellBox(doc, g, 3).y]).toEqual([50, 50]);
  });

  it("subtracts gutters from the cell size", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    const g = groupOf(doc, Ops.SplitGrid.splitIntoGrid(doc, [r.id], { rows: 1, columns: 2, columnGutter: 10 })[0]);
    expect(g.children).toHaveLength(2);
    // cellW = (100 − 10) / 2 = 45; columns at x=0 and x=55
    const c0 = cellBox(doc, g, 0);
    const c1 = cellBox(doc, g, 1);
    expect([c0.x, c0.width]).toEqual([0, 45]);
    expect([c1.x, c1.width]).toEqual([55, 45]);
  });

  it("produces rows × columns cells and inherits the fill", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 120, 90, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    const g = groupOf(doc, Ops.SplitGrid.splitIntoGrid(doc, [r.id], { rows: 3, columns: 4 })[0]);
    expect(g.children).toHaveLength(12);
    expect(g.children.every((c) => c.type === "rect" && JSON.stringify(c.fill) === JSON.stringify(solid(RED)))).toBe(true);
  });

  it("keeps object state on the group and paint state on every cell", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    r.visible = false;
    r.locked = true;
    r.appearance = { entries: [{ id: "fill", kind: "fill", paint: solid(rgba(0, 0, 220)) }] };
    r.effects = [{ type: "blur", radius: 3 }];
    r.overprintFill = true;
    r.evenOdd = true;
    r.mask = [makeRect(0, 0, 5, 5)];
    r.brush = {
      brushId: "brush",
      brushName: "Brush",
      kind: "calligraphic",
      settings: { size: 4, angle: 0, roundness: 1, paintSource: "stroke" },
    };
    Ops.Items.addItem(doc, r);

    const group = groupOf(doc, Ops.SplitGrid.splitIntoGrid(doc, [r.id], { rows: 1, columns: 2 })[0]);

    expect(group).toMatchObject({ visible: false, locked: true, appearance: r.appearance, effects: r.effects, mask: r.mask });
    for (const cell of group.children) {
      expect(cell).toMatchObject({ appearance: r.appearance, brush: r.brush, overprintFill: true, evenOdd: true });
    }
  });

  it("grids a closed path by its bounding box", () => {
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 10, y: 10 }), anchor({ x: 110, y: 10 }), anchor({ x: 110, y: 110 }), anchor({ x: 10, y: 110 })] }, { fill: solid(RED) });
    Ops.Items.addItem(doc, p);
    const g = groupOf(doc, Ops.SplitGrid.splitIntoGrid(doc, [p.id], { rows: 2, columns: 2 })[0]);
    expect(g.children).toHaveLength(4);
    // bbox starts at (10,10) → first cell there, each 50×50
    expect([cellBox(doc, g, 0).x, cellBox(doc, g, 0).y, cellBox(doc, g, 0).width]).toEqual([10, 10, 50]);
  });

  it("clamps rows/columns to ≥1 and skips when gutters exceed the box", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    // gutters larger than the box ⇒ no valid cells ⇒ object untouched
    expect(Ops.SplitGrid.splitIntoGrid(doc, [r.id], { rows: 2, columns: 2, columnGutter: 200 })).toEqual([]);
    expect(Query.getItem(doc, r.id)).toBeTruthy(); // not replaced

    // rows/columns of 0 clamp up to 1 ⇒ a single full-box cell
    const g = groupOf(doc, Ops.SplitGrid.splitIntoGrid(doc, [r.id], { rows: 0, columns: 0 })[0]);
    expect(g.children).toHaveLength(1);
  });

  it("splits groups, text and images by their existing local bounds", () => {
    for (const item of [
      makeGroup([makeRect(10, 20, 30, 40)]),
      makeText("Hi", 10, 20),
      makeImage("data:image/png;base64,AA==", 10, 20, 30, 40),
    ]) {
      const doc = makeDocument();
      Ops.Items.addItem(doc, item);

      const result = Ops.SplitGrid.splitIntoGrid(doc, [item.id], { rows: 2, columns: 2 });

      expect(result).toHaveLength(1);
      expect(groupOf(doc, result[0]).children).toHaveLength(4);
    }
  });
});
