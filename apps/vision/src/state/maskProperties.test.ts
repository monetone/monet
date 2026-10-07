import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

// Properties ▸ Density / Feather. The engine owns both (non-destructively — the
// mask bytes never change); the store only converts units and commits, so this
// pins the 0..100 ⇄ 0..1 density conversion and the px pass-through for feather.
function storeWith(density: number, feather: number) {
  const calls: [string, number, number][] = [];
  const eng = {
    layer_mask_density: () => density,
    layer_mask_feather: () => feather,
    set_layer_mask_density: (id: number, d: number) => calls.push(["density", id, d]),
    set_layer_mask_feather: (id: number, f: number) => calls.push(["feather", id, f]),
  };
  const commit = vi.fn<(...args: unknown[]) => boolean>(() => true);
  const client = { engine: eng, e: eng, commit, onCommit: null };
  return { store: new Store(client as never), calls, commit };
}

describe("mask properties", () => {
  it("writes density as a 0..1 fraction and feather as raw px", () => {
    const { store, calls, commit } = storeWith(1, 0);
    store.setLayerMaskDensity(4, 60);
    store.setLayerMaskFeather(4, 2.5);
    expect(calls).toEqual([["density", 4, 0.6], ["feather", 4, 2.5]]);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("reads density back as a percentage and feather back as px", () => {
    const { store } = storeWith(0.35, 12.5);
    expect(store.layerMaskDensity(4)).toBe(35);
    expect(store.layerMaskFeather(4)).toBe(12.5);
  });
});
