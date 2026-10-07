import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

// Object Selection tool — like every other selection tool it must forward the
// combine mode (options-bar or Shift/Alt-derived) and honour the options-bar
// Anti-alias and Feather. Same harness idiom as ./makeSelectionFromPath.test.ts.
function storeWith(patch: Record<string, unknown> = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const rec = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); };
  const eng = {
    select_object: rec("select_object"),
    set_selection_antialias: rec("set_selection_antialias"),
    feather_selection: rec("feather_selection"),
  };
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null };
  const store = new Store(client as never);
  (store as unknown as { set(p: unknown): void }).set(patch);
  return { store, calls };
}

describe("selectObject", () => {
  it("defaults to the options-bar combine mode and anti-alias, with no feather", () => {
    const { store, calls } = storeWith();
    store.selectObject(10, 20, 30, 40);
    expect(calls.map((c) => c.fn)).toEqual(["set_selection_antialias", "select_object"]);
    expect(calls[0].args).toEqual([true]);
    expect(calls[1].args).toEqual([10, 20, 30, 40, 0.2, 0]);
  });

  it("takes the options-bar mode when the caller passes none", () => {
    const { store, calls } = storeWith({ selMode: 2 });
    store.selectObject(0, 0, 8, 8);
    expect(calls.find((c) => c.fn === "select_object")!.args[5]).toBe(2);
  });

  it("forwards an explicit (Shift/Alt-derived) combine mode over the options-bar one", () => {
    const { store, calls } = storeWith({ selMode: 0 });
    store.selectObject(0, 0, 8, 8, 0.2, 1); // Shift-drag → Add
    expect(calls.find((c) => c.fn === "select_object")!.args[5]).toBe(1);
  });

  it("applies the options-bar Feather to the built selection", () => {
    const { store, calls } = storeWith({ selectionFeather: 12 });
    store.selectObject(0, 0, 8, 8);
    expect(calls.find((c) => c.fn === "feather_selection")!.args).toEqual([12]);
  });

  it("skips a feather the engine would ignore and passes Anti-alias off through", () => {
    const { store, calls } = storeWith({ selectionFeather: 0.2, antiAlias: false });
    store.selectObject(0, 0, 8, 8);
    expect(calls.some((c) => c.fn === "feather_selection")).toBe(false);
    expect(calls[0].args).toEqual([false]);
  });

  it("rounds the drawn box to whole pixels", () => {
    const { store, calls } = storeWith();
    store.selectObject(10.4, 20.6, 30.5, 39.4);
    expect(calls.find((c) => c.fn === "select_object")!.args.slice(0, 4)).toEqual([10, 21, 31, 39]);
  });
});
