// Layer Comps panel ▸ Store wiring: `setLayerCompOptions` (the write path for
// Layer Comp Options — rename, comment, Apply To Layers flags) and the
// `updateLayerComp` field-preservation fix (re-capturing a comp used to drop
// its comment/apply flags, resetting them to "applies everything"). Engine-free
// (node) — mirrors storePreferences.test.ts's newStore() idiom; layerComps.ts /
// layerCompOptions.test.ts already cover the pure helpers these methods call.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";
import { MAX_LAYER_COMPS } from "./layerComps";

function newStore(onEditError = vi.fn()) {
  const engine = {};
  const client = { onCommit: null as null | (() => void), onEditError, engine, sync: vi.fn(), buildNew: vi.fn(() => engine) };
  return new Store(client as never);
}

describe("saveLayerComp — persistence bounds", () => {
  it("reports instead of accepting the first comp a document switch would drop", () => {
    const onEditError = vi.fn();
    const store = newStore(onEditError);
    for (let i = 0; i < MAX_LAYER_COMPS; i++) store.saveLayerComp();

    store.saveLayerComp();

    expect(store.state.layerComps).toHaveLength(MAX_LAYER_COMPS);
    expect(onEditError).toHaveBeenCalledWith(expect.stringContaining(`${MAX_LAYER_COMPS} comps`));
  });
});

describe("setLayerCompOptions", () => {
  it("renames a comp and sets its comment / apply flags", () => {
    const store = newStore();
    store.saveLayerComp(); // seeds "Layer Comp 1"
    store.setLayerCompOptions(0, { name: "Hero", comment: "hero variant", applyPosition: false });
    const [comp] = store.state.layerComps;
    expect(comp.name).toBe("Hero");
    expect(comp.comment).toBe("hero variant");
    expect(comp.applyPosition).toBe(false);
    expect(comp.applyVisibility).toBeUndefined(); // untouched flag still means "applies"
  });

  it("is a no-op out of range", () => {
    const store = newStore();
    store.saveLayerComp();
    store.setLayerCompOptions(5, { name: "nope" });
    expect(store.state.layerComps[0].name).toBe("Layer Comp 1");
  });

  it("merges the patch onto the existing comp, keeping untouched fields", () => {
    const store = newStore();
    store.saveLayerComp();
    store.setLayerCompOptions(0, { comment: "note" });
    store.setLayerCompOptions(0, { applyAppearance: false });
    const [comp] = store.state.layerComps;
    expect(comp.name).toBe("Layer Comp 1"); // untouched by either patch
    expect(comp.comment).toBe("note"); // survived the second, unrelated patch
    expect(comp.applyAppearance).toBe(false);
  });
});

describe("updateLayerComp — field preservation (regression)", () => {
  it("keeps comment and apply flags when re-capturing", () => {
    const store = newStore();
    store.saveLayerComp();
    store.setLayerCompOptions(0, { comment: "note", applyVisibility: false, applyAppearance: false });
    store.updateLayerComp(0);
    const [comp] = store.state.layerComps;
    expect(comp.comment).toBe("note");
    expect(comp.applyVisibility).toBe(false);
    expect(comp.applyAppearance).toBe(false);
    expect(comp.layers).toEqual([]); // still re-captured (no layers in this store)
  });

  it("is still a no-op out of range", () => {
    const store = newStore();
    store.saveLayerComp();
    store.updateLayerComp(5);
    expect(store.state.layerComps).toHaveLength(1);
  });
});
