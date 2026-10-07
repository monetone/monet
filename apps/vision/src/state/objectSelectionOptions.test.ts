// Guards #411: the Object Selection tool's options bar. Tolerance was a
// hardcoded 0.2 at the call site and the combine mode came only from Shift/Alt,
// so the bar had nothing to drive; these assert the store now sources both from
// options and that the lasso hint reaches the engine as a polygon.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

type Call = [string, ...unknown[]];

function storeWith() {
  const calls: Call[] = [];
  const eng = {
    set_selection_antialias: (on: boolean) => calls.push(["antialias", on]),
    select_object: (x: number, y: number, w: number, h: number, tol: number, mode: number) =>
      calls.push(["object", x, y, w, h, tol, mode]),
    select_object_lasso: (pts: Float32Array, tol: number, mode: number) =>
      calls.push(["lasso", Array.from(pts), tol, mode]),
    feather_selection: (r: number) => calls.push(["feather", r]),
  };
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null };
  return { store: new Store(client as never), calls };
}

describe("Object Selection options (#411)", () => {
  it("defaults match Photoshop's: box hint at 0.2 tolerance, on the shared mode", () => {
    const { store } = storeWith();
    // Mode is the selection-wide options-bar setting every selection tool
    // shares, not a private copy — selectObject already contracted to it.
    expect(store.state.selMode).toBe(0);
    expect(store.state.objectSelectionLasso).toBe(false);
    expect(store.state.objectSelectionTolerance).toBeCloseTo(0.2);
  });

  it("takes tolerance and combine mode from the options bar, not a constant", () => {
    const { store, calls } = storeWith();
    store.setOptions({ objectSelectionTolerance: 0.4, selMode: 3 });
    store.selectObject(1, 2, 10, 12);
    expect(calls).toContainEqual(["object", 1, 2, 10, 12, 0.4, 3]);
  });

  it("still lets an explicit mode win, so Shift/Alt keep overriding the bar", () => {
    const { store, calls } = storeWith();
    store.setOptions({ selMode: 0 });
    store.selectObject(0, 0, 8, 8, 0.2, 2); // Alt-drag → subtract
    expect(calls.find((c) => c[0] === "object")?.[6]).toBe(2);
  });

  it("sends the lasso hint through as a polygon, with the bar's tolerance", () => {
    const { store, calls } = storeWith();
    store.setOptions({ objectSelectionTolerance: 0.3, selMode: 1 });
    store.selectObjectLasso([0, 0, 10, 0, 10, 10]);
    expect(calls).toContainEqual(["lasso", [0, 0, 10, 0, 10, 10], 0.3, 1]);
  });

  it("applies anti-alias and feather to both hint shapes, like every selection tool", () => {
    const { store, calls } = storeWith();
    store.setOptions({ selectionFeather: 3, antiAlias: true });
    store.selectObject(0, 0, 8, 8);
    store.selectObjectLasso([0, 0, 8, 0, 8, 8]);
    expect(calls.filter((c) => c[0] === "antialias")).toHaveLength(2);
    expect(calls.filter((c) => c[0] === "feather")).toEqual([["feather", 3], ["feather", 3]]);
  });
});
