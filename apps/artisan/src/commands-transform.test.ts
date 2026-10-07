// ─────────────────────────────────────────────────────────────
// commands-transform.test — Object ▸ Transform menu commands (parity)
// ─────────────────────────────────────────────────────────────
// Integration: a real ArtisanStore driven through the Transform commands, which
// must pivot the WHOLE selection around its bounding-box centre (Illustrator
// rotates/reflects a multi-object selection as one unit, not each object alone).

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query } from "./engine";

const setup = (rects: [number, number, number, number][]) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const items = rects.map(([x, y, w, h]) => makeRect(x, y, w, h));
  items.forEach((it) => doc.layers[0].items.push(it));
  store.replaceDoc(doc, { markClean: true });
  store.setSelection(items.map((it) => it.id));
  return { store, ids: items.map((it) => it.id) };
};
const selBounds = (store: ArtisanStore, ids: string[]) => Query.selectionBounds(store.getState().doc, ids)!;
const wb = (store: ArtisanStore, id: string) => Query.worldBounds(store.getState().doc, id)!;

describe("commands — Rotate 90° around the selection centre", () => {
  it("rotates the whole selection as a unit (bbox dims swap, centre stays)", () => {
    const { store, ids } = setup([[0, 0, 40, 20], [0, 40, 20, 40]]);
    const before = selBounds(store, ids);
    commands.rotate90CW(store);
    const after = selBounds(store, ids);
    expect([before.x + before.width / 2, before.y + before.height / 2]).toEqual([after.x + after.width / 2, after.y + after.height / 2]);
    expect([Math.round(after.width), Math.round(after.height)]).toEqual([Math.round(before.height), Math.round(before.width)]);
  });

  it("CW then CCW returns to the original bounds", () => {
    const { store, ids } = setup([[10, 10, 40, 20], [10, 40, 20, 40]]);
    const before = selBounds(store, ids);
    commands.rotate90CW(store);
    commands.rotate90CCW(store);
    const after = selBounds(store, ids);
    for (const k of ["x", "y", "width", "height"] as const) expect(Math.round(after[k])).toBe(Math.round(before[k]));
  });
});

describe("commands — Reflect around the selection centre", () => {
  it("Reflect Horizontal swaps left↔right objects", () => {
    const { store, ids } = setup([[120, 200, 40, 40], [280, 200, 40, 40]]);
    const [a, b] = ids;
    commands.reflectHorizontal(store);
    expect(Math.round(wb(store, a).x)).toBe(280); // A → B's column
    expect(Math.round(wb(store, b).x)).toBe(120); // B → A's column
  });

  it("Reflect Vertical swaps top↔bottom objects", () => {
    const { store, ids } = setup([[200, 120, 40, 40], [200, 280, 40, 40]]);
    const [a, b] = ids;
    commands.reflectVertical(store);
    expect(Math.round(wb(store, a).y)).toBe(280);
    expect(Math.round(wb(store, b).y)).toBe(120);
  });
});
