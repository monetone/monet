// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtisanStore, makeDocument, makeGroup, makeRect, makeText, Query, type TextItem } from "./engine";
import { EditorProvider } from "./state/store-context";
import { CharacterPanel } from "./ui/panels/character-panel";
import { ParagraphPanel } from "./ui/panels/paragraph-panel";
import { TypeStylesPanel } from "./ui/panels/type-styles-panel";
import { VariablesPanel } from "./ui/panels/variables-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

const mount = (store: ArtisanStore, panel: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EditorProvider store={store}>{panel}</EditorProvider>));
};

const text = (store: ArtisanStore, id: string) => Query.getItem(store.doc, id) as TextItem;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("text panel controls", () => {
  it("edits every text leaf in a selected group", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const a = makeText("A", 0, 0, { fontSize: 12, fontStyle: "italic" });
    const b = makeText("B", 100, 0, { fontSize: 36 });
    const group = makeGroup([a, b]);
    doc.layers[0].items.push(group);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([group.id]);
    mount(store, <><CharacterPanel /><TypeStylesPanel /></>);

    expect(container!.textContent).toContain("2 text objects");
    expect(container!.querySelector<HTMLButtonElement>("[data-type-style-new-character]")!.disabled).toBe(false);
    const italic = container!.querySelector<HTMLButtonElement>("[data-character-italic]")!;
    expect(italic.getAttribute("aria-pressed")).toBe("mixed");
    act(() => italic.click());
    expect([text(store, a.id).fontStyle, text(store, b.id).fontStyle]).toEqual(["italic", "italic"]);

    const leading = container!.querySelector<HTMLInputElement>('[data-character-prop="leading"] input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(leading, "20");
      leading.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => leading.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(text(store, a.id).lineHeight * text(store, a.id).fontSize).toBeCloseTo(20);
    expect(text(store, b.id).lineHeight * text(store, b.id).fontSize).toBeCloseTo(20);
  });

  it("converts every eligible object in a mixed text selection", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const area = makeText("Area", 0, 0);
    area.boxWidth = 100;
    area.boxHeight = 40;
    const point = makeText("Point", 0, 50);
    doc.layers[0].items.push(area, point);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([area.id, point.id]);
    mount(store, <ParagraphPanel />);

    const areaButton = container!.querySelector<HTMLButtonElement>('[data-paragraph-convert="area"]')!;
    expect(areaButton.disabled).toBe(false);
    act(() => areaButton.click());
    expect(text(store, point.id).boxWidth).toBeDefined();
  });

  it("enables a text variable when any selected object can carry it", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const rect = makeRect(0, 0, 20, 20);
    const label = makeText("Headline", 0, 30);
    doc.layers[0].items.push(rect, label);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([rect.id, label.id]);
    vi.spyOn(window, "prompt").mockReturnValue("Headline");
    mount(store, <VariablesPanel />);

    const addText = container!.querySelector<HTMLButtonElement>('[data-variable-action="new-text"]')!;
    expect(addText.disabled).toBe(false);
    act(() => addText.click());
    expect(store.doc.variables?.variables[0]?.binding?.itemId).toBe(label.id);
  });
});
