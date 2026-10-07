// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArtisanStore,
  Ops,
  Query,
  makeDimensionGroup,
  makeDocument,
  makeEllipse,
  makeRect,
  makeText,
  rgba,
  solid,
  type GroupItem,
  type TextItem,
} from "./engine";
import { EditorProvider } from "./state/store-context";
import { AppearancePanel } from "./ui/panels/appearance-panel";
import { BrushesPanel } from "./ui/panels/brushes-panel";
import { CharacterPanel } from "./ui/panels/character-panel";
import { PropertiesPanel } from "./ui/panels/properties-panel";
import { SymbolsPanel } from "./ui/panels/symbols-panel";
import { VariablesPanel } from "./ui/panels/variables-panel";

vi.mock("@monet-ui/monet-react", async (importOriginal) => ({ ...(await importOriginal<typeof import("@monet-ui/monet-react")>()), Slider: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

const mount = (store: ArtisanStore, panel: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EditorProvider store={store}>{panel}</EditorProvider>));
};

const button = (selector: string) => container!.querySelector<HTMLButtonElement>(selector)!;

// Monet <Select>: open the trigger, then click the option in the portalled listbox.
const choose = (selector: string, value: string) => {
  act(() => button(selector).click());
  act(() => document.querySelector<HTMLElement>(`.monet-listbox [role="option"][data-value="${value}"]`)!.click());
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("formerly disconnected engine operations", () => {
  it("duplicates the active appearance entry from the Appearance panel", () => {
    const doc = makeDocument("Appearance Duplicate");
    const rect = makeRect(0, 0, 40, 40);
    doc.layers[0].items.push(rect);
    const store = new ArtisanStore();
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([rect.id]);
    mount(store, <AppearancePanel />);

    act(() => button('[data-appearance-action="duplicate"]').click());

    const item = Query.getItem(store.doc, rect.id)!;
    expect(item.appearance?.entries).toHaveLength(3);
    expect(item.appearance?.entries[1].name).toBe("Fill copy");
    expect(container!.querySelector(".is-selected")?.textContent).toContain("Fill copy");
  });

  it("duplicates and activates a brush from the Brushes panel", () => {
    const store = new ArtisanStore();
    const before = store.doc.brushes!.length;
    mount(store, <BrushesPanel />);

    act(() => button('[data-brush-action="duplicate"]').click());

    expect(store.doc.brushes).toHaveLength(before + 1);
    expect(store.doc.brushes?.at(-1)).toMatchObject({
      id: store.getState().activeBrushId,
      name: `${store.doc.brushes?.[0].name} copy`,
    });
  });

  it("selects, replaces, duplicates, and deletes definitions from the Symbols panel", () => {
    const doc = makeDocument("Symbol Panel");
    const rect = makeRect(0, 0, 20, 20);
    const ellipse = makeEllipse(30, 0, 20, 20);
    doc.layers[0].items.push(rect, ellipse);
    const first = Ops.Symbols.createSymbolFromSelection(doc, [rect.id], "First")!.definition;
    const second = Ops.Symbols.createSymbolFromSelection(doc, [ellipse.id], "Second")!.definition;
    const instanceId = Ops.Symbols.placeSymbolInstance(doc, first.id)!;
    const store = new ArtisanStore();
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([instanceId]);
    mount(store, <SymbolsPanel />);

    expect(button('[data-symbol-action="redefine"]')).toMatchObject({ disabled: true });
    act(() => button(`[data-symbol-select="${second.id}"]`).click());
    act(() => button('[data-symbol-action="swap"]').click());
    expect((Query.getItem(store.doc, instanceId) as GroupItem).symbolInstance).toEqual({ symbolId: second.id });

    act(() => button('[data-symbol-action="duplicate"]').click());
    expect(store.doc.symbols).toHaveLength(3);
    expect(store.doc.symbols?.at(-1)?.name).toBe("Second copy");

    act(() => button(`[data-symbol-select="${second.id}"]`).click());
    act(() => button('[data-symbol-action="delete"]').click());
    expect(store.doc.symbols?.some((definition) => definition.id === second.id)).toBe(false);
    expect((Query.getItem(store.doc, instanceId) as GroupItem).symbolInstance).toBeUndefined();
  });

  it("edits each contextual live-object type from the Properties panel", () => {
    const doc = makeDocument("Live Object Properties");
    const dimension = makeDimensionGroup({ x: 0, y: 0 }, { x: 80, y: 0 });
    const meshSource = makeRect(100, 0, 60, 60);
    const livePaintSource = makeRect(200, 0, 60, 60);
    const perspectiveSource = makeRect(300, 0, 60, 60);
    doc.layers[0].items.push(dimension, meshSource, livePaintSource, perspectiveSource);
    const meshId = Ops.Meshes.createMeshFromItem(doc, meshSource.id)!;
    const livePaintId = Ops.LivePaint.makeLivePaintGroup(doc, [livePaintSource.id])!;
    const perspectiveId = Ops.Perspective.makePerspectiveGroup(doc, [perspectiveSource.id])!;
    const liveGroup = Query.getItem(doc, livePaintId) as GroupItem;
    liveGroup.children[0].fill = solid(rgba(20, 180, 60));
    const store = new ArtisanStore();
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([dimension.id]);
    mount(store, <PropertiesPanel />);

    choose('[data-dimension-prop="units"] [role="combobox"]', "mm");
    act(() => button('[data-dimension-action="regenerate"]').click());
    expect((Query.getItem(store.doc, dimension.id) as GroupItem).dimension?.units).toBe("mm");
    act(() => button('[data-dimension-action="detach"]').click());
    expect((Query.getItem(store.doc, dimension.id) as GroupItem).dimension).toBeUndefined();

    act(() => store.setSelection([meshId]));
    act(() => {
      container!.querySelector('[data-mesh-prop="rows"] input')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect((Query.getItem(store.doc, meshId) as GroupItem).mesh?.rows).toBe(4);
    act(() => button('[data-mesh-action="regenerate"]').click());
    act(() => button('[data-mesh-action="detach"]').click());
    expect((Query.getItem(store.doc, meshId) as GroupItem).mesh).toBeUndefined();

    act(() => store.setSelection([livePaintId]));
    choose('[data-live-paint-prop="gap-detection"] [role="combobox"]', "large");
    act(() => button('[data-live-paint-action="sync"]').click());
    const syncedLivePaint = (Query.getItem(store.doc, livePaintId) as GroupItem).livePaint!;
    expect(syncedLivePaint.gapDetection).toBe("large");
    expect(syncedLivePaint.faces[0].fill).toEqual(solid(rgba(20, 180, 60)));

    act(() => store.setSelection([perspectiveId]));
    choose('[data-perspective-prop="plane"] [role="combobox"]', "two-point");
    act(() => button('[data-perspective-action="sync-source"]').click());
    const perspective = (Query.getItem(store.doc, perspectiveId) as GroupItem).perspective!;
    expect(perspective.plane).toBe("two-point");
    expect(perspective.sourceItems[0].type).toBe("path");
  });

  it("edits OpenType and data-set values from their incumbent panels", () => {
    const doc = makeDocument("Type Data");
    const text = makeText("Alice", 0, 0);
    doc.layers[0].items.push(text);
    const variableId = Ops.Variables.createVariableFromSelection(doc, [text.id], "text", "Name")!;
    const dataSetId = Ops.Variables.captureDataSet(doc, "People");
    const store = new ArtisanStore();
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([text.id]);
    mount(store, <CharacterPanel />);

    act(() => container!.querySelector<HTMLInputElement>('[data-character-feature="liga"]')!.click());
    expect((Query.getItem(store.doc, text.id) as TextItem).features).toEqual([{ tag: "liga", value: false }]);

    act(() => root!.render(<EditorProvider store={store}><VariablesPanel /></EditorProvider>));
    const input = container!.querySelector<HTMLInputElement>(`[data-variable-value="${variableId}"]`)!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Bob");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(store.doc.variables?.dataSets.find((entry) => entry.id === dataSetId)?.values[variableId]).toEqual({ text: "Bob" });
    act(() => button('[data-variable-action="apply"]').click());
    expect((Query.getItem(store.doc, text.id) as TextItem).text).toBe("Bob");
  });
});
