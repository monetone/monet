// ─────────────────────────────────────────────────────────────
// tools/vertical-type.test — Illustrator's vertical type family
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator's Vertical Type / Vertical Area Type / Vertical
// Type on a Path tools are the horizontal tools with a vertical writing mode.
// The model, renderer, Character panel and SVG I/O already carry `writingMode`,
// so these guard the one thing the tools add: new text starts out vertical, and
// the horizontal tools are unaffected.

import { describe, it, expect } from "vitest";
import { getTool } from "./registry";
import { ArtisanStore, makeDocument, makeRect, makePath, makeAnchor as anchor, solid, rgba, type TextItem } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const texts = (store: ArtisanStore): TextItem[] =>
  store.getState().doc.layers.flatMap((l) => l.items).filter((it): it is TextItem => it.type === "text");

const emptyDoc = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};
const docWithRect = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.layers[0].items.push(makeRect(0, 0, 120, 90, 0, 0, { fill: solid(rgba(200, 30, 30)) }));
  store.replaceDoc(doc, { markClean: true });
  return store;
};
const docWithPath = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.layers[0].items.push(
    makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] }, { stroke: { ...makeRect(0, 0, 1, 1).stroke, width: 2 } }),
  );
  store.replaceDoc(doc, { markClean: true });
  return store;
};
const click = (tool: Tool, ctx: ToolContext, x: number, y: number) =>
  (tool.onPointerDown ?? tool.onPointerUp)!.call(tool, ptr(x, y), ctx);

describe("vertical type tools", () => {
  it("Vertical Type creates point text in a vertical writing mode", () => {
    const store = emptyDoc();
    const tool = getTool("vertical-type");
    tool.onPointerUp!(ptr(40, 40), ctxOf(store));
    expect(texts(store)[0]?.writingMode).toBe("vertical-rl");
  });

  it("the plain Type tool still creates horizontal text", () => {
    const store = emptyDoc();
    getTool("type").onPointerUp!(ptr(40, 40), ctxOf(store));
    expect(texts(store)[0]?.writingMode).toBeUndefined();
  });

  it("Vertical Area Type flows vertical text into the clicked shape", () => {
    const store = docWithRect();
    click(getTool("vertical-area-type"), ctxOf(store), 60, 45);
    const t = texts(store)[0];
    expect(t?.writingMode).toBe("vertical-rl");
    expect(t?.boxWidth).toBe(120);
    expect(t?.name).toBe("Vertical Area Type");
  });

  it("Vertical Type on a Path sets vertical text along the clicked path", () => {
    const store = docWithPath();
    click(getTool("vertical-type-on-path"), ctxOf(store), 50, 0);
    expect(texts(store)[0]?.writingMode).toBe("vertical-rl");
  });

  it("each vertical tool keeps its own id, so the rail can select it", () => {
    for (const id of ["vertical-type", "vertical-area-type", "vertical-type-on-path"]) {
      expect(getTool(id).id).toBe(id);
    }
  });
});
