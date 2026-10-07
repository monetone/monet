// ─────────────────────────────────────────────────────────────
// tools/symbolism-paint.test — Symbol Stainer / Styler actually paint
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator's Symbol Stainer tints instances toward the fill
// colour; the Symbol Styler applies the current appearance to them. Both act on
// the INSTANCES of a Symbol Set — and every instance is a GROUP
// (`makeSymbolInstance` returns a GroupItem, so it can hold the symbol's
// artwork). Skipping group children therefore skips every instance there is,
// which made both tools silent no-ops while the four transform-based symbolism
// tools kept working.

import { describe, it, expect } from "vitest";
import { createSymbolismTool } from "./symbolism";
import { createSymbolSprayerTool } from "./symbol-sprayer";
import { ArtisanStore, makeDocument, makeRect, paintedFill, solid, rgba, type GroupItem, type Item } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const sweep = (tool: Tool, ctx: ToolContext, from: number, to: number) => {
  tool.onPointerDown!(ptr(from, 100), ctx);
  for (let x = from; x <= to; x += 10) tool.onPointerMove!(ptr(x, 100), ctx);
  tool.onPointerUp!(ptr(to, 100), ctx);
};

/** Spray a Symbol Set, exactly as the e2e scene does, and select it. */
const sprayedSet = (stacked = false) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const source = makeRect(0, 0, 60, 60, 0, 0, { fill: solid(rgba(200, 30, 30)) });
  if (stacked) {
    source.appearance = {
      entries: [
        { id: "hidden", kind: "fill", paint: solid(rgba(200, 30, 30)), visible: false },
        { id: "visible", kind: "fill", paint: solid(rgba(30, 30, 200)) },
      ],
    };
  }
  doc.layers[0].items.push(source);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([doc.layers[0].items[0].id]);
  store.setFill(solid(rgba(40, 200, 120)));

  sweep(createSymbolSprayerTool(), ctxOf(store), 100, 300);
  const set = store.getState().doc.layers.flatMap((l) => l.items).find((it): it is GroupItem => it.type === "group" && it.name === "Symbol Set");
  expect(set, "the sprayer must produce a Symbol Set").toBeTruthy();
  expect(set!.children.length, "with at least one instance").toBeGreaterThan(0);
  store.setSelection([set!.id]);
  return { store, setId: set!.id };
};

const currentSet = (store: ArtisanStore, id: string) =>
  store.getState().doc.layers.flatMap((l) => l.items).find((it): it is GroupItem => it.id === id)!;

/** Every leaf fill under an item — instances are groups, so the paint is inside. */
const leafFills = (item: Item): string[] => {
  if (item.type === "group") return item.children.flatMap(leafFills);
  return [JSON.stringify(item.fill)];
};

const leafPaintedFills = (item: Item): string[] => {
  if (item.type === "group") return item.children.flatMap(leafPaintedFills);
  return [JSON.stringify(paintedFill(item))];
};

describe("Symbol Stainer", () => {
  it("tints the instances toward the current fill", () => {
    const { store, setId } = sprayedSet();
    const before = leafFills(currentSet(store, setId));
    sweep(createSymbolismTool("stainer"), ctxOf(store), 100, 300);
    const after = leafFills(currentSet(store, setId));

    expect(after).not.toEqual(before);
    expect(store.canUndo).toBe(true);
  });
});

describe("Symbol Styler", () => {
  it("applies the current appearance to the instances", () => {
    const { store, setId } = sprayedSet();
    const before = leafFills(currentSet(store, setId));
    sweep(createSymbolismTool("styler"), ctxOf(store), 100, 300);
    const after = leafFills(currentSet(store, setId));

    expect(after).not.toEqual(before);
  });
});

describe("stacked symbol artwork", () => {
  it.each(["stainer", "styler"] as const)("%s changes the visible fill", (kind) => {
    const { store, setId } = sprayedSet(true);
    const before = leafPaintedFills(currentSet(store, setId));

    sweep(createSymbolismTool(kind), ctxOf(store), 100, 300);

    expect(leafPaintedFills(currentSet(store, setId))).not.toEqual(before);
  });
});

describe("the transform-based symbolism tools still only move things", () => {
  it("the spinner changes transforms, not paint", () => {
    const { store, setId } = sprayedSet();
    const beforeFills = leafFills(currentSet(store, setId));
    const beforeXf = currentSet(store, setId).children.map((c) => JSON.stringify(c.transform));

    sweep(createSymbolismTool("spinner"), ctxOf(store), 100, 300);

    expect(currentSet(store, setId).children.map((c) => JSON.stringify(c.transform))).not.toEqual(beforeXf);
    expect(leafFills(currentSet(store, setId))).toEqual(beforeFills);
  });
});
