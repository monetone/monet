// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  ArtisanStore,
  Ops,
  Query,
  makeDocument,
  makeGraphGroup,
  makeGroup,
  makeImage,
  makeRect,
  rgba,
  solid,
  type GroupItem,
} from "./engine";
import { EditorProvider } from "./state/store-context";
import { BrushesPanel } from "./ui/panels/brushes-panel";
import { GraphsPanel } from "./ui/panels/graphs-panel";
import { LayersPanel } from "./ui/panels/layers-panel";
import { LinksPanel } from "./ui/panels/links-panel";
import { StrokePanel } from "./ui/panels/stroke-panel";
import { SymbolsPanel } from "./ui/panels/symbols-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

const mount = (store: ArtisanStore, panel: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EditorProvider store={store}>{panel}</EditorProvider>));
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("panel selection contracts", () => {
  it("renders nested artwork as a keyboard tree and toggles a child through the canonical ops", () => {
    const store = new ArtisanStore();
    const child = makeRect(0, 0, 20, 20, 0, 0, { name: "Nested shape" });
    const group = makeGroup([child], { name: "Artwork group" });
    const doc = makeDocument();
    doc.layers[0].items.push(group);
    store.replaceDoc(doc, { markClean: true });
    mount(store, <LayersPanel />);

    const rows = [...container!.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const groupRow = rows.find((row) => row.textContent?.includes("Artwork group"))!;
    const childRow = rows.find((row) => row.textContent?.includes("Nested shape"))!;
    expect(groupRow.getAttribute("aria-expanded")).toBe("true");
    expect(childRow.getAttribute("aria-level")).toBe("3");
    act(() => childRow.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(store.getState().selection).toEqual([child.id]);

    const eye = childRow.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Hide layer"]')!;
    act(() => eye.click());
    expect(Query.getItem(store.doc, child.id)?.visible).toBe(false);
    expect(store.getState().selection).toEqual([]);
  });

  it("expands replacement documents and preserves Shift-click selection", () => {
    const store = new ArtisanStore();
    mount(store, <LayersPanel />);

    const a = makeRect(0, 0, 20, 20, 0, 0, { name: "A" });
    const b = makeRect(30, 0, 20, 20, 0, 0, { name: "B" });
    const replacement = makeDocument();
    replacement.layers[0].items.push(a, b);
    act(() => store.replaceDoc(replacement, { markClean: true }));

    const rows = [...container!.querySelectorAll<HTMLElement>('[role="treeitem"][aria-level="2"]')];
    expect(rows).toHaveLength(2);
    act(() => {
      rows[0].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      rows[0].click();
    });
    act(() => {
      rows[1].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, shiftKey: true }));
      rows[1].click();
    });
    expect(new Set(store.getState().selection)).toEqual(new Set([a.id, b.id]));
  });

  it("reads the visible stroke of a nested selected object", () => {
    const store = new ArtisanStore();
    const rect = makeRect(0, 0, 20, 20);
    const visible = { ...rect.stroke, width: 20, paint: solid(rgba(255, 0, 0)) };
    rect.appearance = { entries: [{ id: "visible-stroke", kind: "stroke", stroke: visible }] };
    const doc = makeDocument();
    doc.layers[0].items.push(makeGroup([rect]));
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([rect.id]);
    mount(store, <StrokePanel />);

    expect(container!.querySelector<HTMLInputElement>('[role="spinbutton"]')!.value).toBe("20");
  });

  it("applies the active brush through a grouped panel selection", () => {
    const store = new ArtisanStore();
    const rect = makeRect(0, 0, 20, 20);
    const group = makeGroup([rect]);
    const doc = makeDocument();
    doc.layers[0].items.push(group);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([group.id]);
    mount(store, <BrushesPanel />);

    act(() => container!.querySelector<HTMLButtonElement>('[data-brush-action="apply"]')!.click());

    expect(Query.getItem(store.doc, rect.id)?.brush?.brushId).toBe(store.doc.brushes?.[0].id);
    expect(store.canUndo).toBe(true);
  });

  it("refuses hidden rows from the Symbols, Links, and Graphs panels", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const seed = makeRect(0, 0, 10, 10);
    doc.layers[0].items.push(seed);
    const symbol = Ops.Symbols.createSymbolFromSelection(doc, [seed.id], "Hidden symbol")!.definition;
    const instanceId = Ops.Symbols.placeSymbolInstance(doc, symbol.id)!;
    const image = makeImage("file:///hidden.png", 0, 0, 20, 20);
    const graph = makeGraphGroup("column", { x: 0, y: 0 }, { x: 80, y: 60 });
    doc.layers[0].items.push(image, graph);
    for (const id of [instanceId, image.id, graph.id]) Query.getItem(doc, id)!.visible = false;
    store.replaceDoc(doc, { markClean: true });

    mount(store, <SymbolsPanel />);
    act(() => container!.querySelector<HTMLButtonElement>(`[data-symbol-instance="${instanceId}"]`)!.click());
    expect(store.getState().selection).toEqual([]);
    act(() => root!.render(<EditorProvider store={store}><LinksPanel /></EditorProvider>));
    act(() => container!.querySelector<HTMLElement>(`[data-link-item="${image.id}"]`)!.click());
    expect(store.getState().selection).toEqual([]);
    act(() => root!.render(<EditorProvider store={store}><GraphsPanel /></EditorProvider>));
    act(() => container!.querySelector<HTMLButtonElement>(`[data-graph="${graph.id}"]`)!.click());
    expect(store.getState().selection).toEqual([]);
    expect((Query.getItem(store.doc, instanceId) as GroupItem).visible).toBe(false);
  });
});
