// #428: the Patch tool's Mode / Source-Destination / Transparent / Structure /
// Color live in the store and must reach the engine on every drag. The engine
// side (what each one does to the pixels) is covered in packages/engine.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";
import { engine, patchSelection, store as appStore } from "./app";

function storeWith(hasSelection = true) {
  const calls: unknown[][] = [];
  const eng = {
    has_selection: () => hasSelection,
    patch_selection: (...args: unknown[]) => calls.push(args),
  };
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null };
  return { store: new Store(client as never), calls, client };
}

describe("patch options reach the engine (#428)", () => {
  it("sends Normal / Source / opaque / 4 / 2 by default, with the drag rounded", () => {
    const { store, calls, client } = storeWith();
    store.patchSelectionBy(3.4, -2.6);
    expect(calls).toEqual([[3, -3, 0, false, false, 4, 2]]);
    expect(client.commit).toHaveBeenCalledTimes(1);
  });

  it("forwards every option the bar can set", () => {
    const { store, calls } = storeWith();
    store.setOptions({ patchMode: 1, patchDestination: true, patchTransparent: true, patchStructure: 7, patchColor: 10 });
    store.patchSelectionBy(20, 0);
    expect(calls).toEqual([[20, 0, 1, true, true, 7, 10]]);
  });

  it("does nothing without a selection", () => {
    const { store, calls, client } = storeWith(false);
    store.patchSelectionBy(20, 0);
    expect(calls).toEqual([]);
    expect(client.commit).not.toHaveBeenCalled();
  });
});

// Edit ▸ Patch Selection has no drag to take a direction from, so it picks one.
// It always sampled `width + 20` to the RIGHT, which walks off the canvas for
// any selection near that edge: the heal came out partial, or did nothing at
// all, and said nothing either way.
describe("Edit ▸ Patch Selection samples a region that is on the canvas (#428)", () => {
  /** The offset the command chooses, which is the whole of its decision. */
  const offsetFor = (bounds: number[], width: number) => {
    engine.engine = {
      selection_bounds: () => Int32Array.from(bounds),
      width: () => width,
    } as never;
    const by = vi.spyOn(appStore, "patchSelectionBy").mockImplementation(() => {});
    try {
      patchSelection();
      return by.mock.calls[0]?.[0] as number;
    } finally { by.mockRestore(); engine.engine = null as never; }
  };

  it("samples to the right when the canvas has room", () => {
    expect(offsetFor([10, 5, 8, 8], 200), "the neighbouring region, one gap over").toBe(28);
  });

  it("samples the other way when the right edge is too close", () => {
    const [x, w] = [170, 20];

    const dx = offsetFor([x, 5, w, 8], 200);

    expect(x + dx, "the source region starts on the canvas").toBeGreaterThanOrEqual(0);
    expect(x + w + dx, "and ends on it").toBeLessThanOrEqual(200);
  });
});
