// Guards #418: layers gained Photoshop's three independent locks beside the
// existing Lock All. The engine enforces them (covered in packages/engine);
// this asserts the store's bitfield plumbing, which is easy to get backwards.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

function storeWith({ locks = true } = {}) {
  const calls: [string, ...unknown[]][] = [];
  const state = new Map<number, number>();
  const eng: Record<string, unknown> = {
    set_layer_locked: (id: number, on: boolean) => calls.push(["all", id, on]),
  };
  if (locks) {
    eng.set_layer_locks = (id: number, f: number) => { state.set(id, f); calls.push(["locks", id, f]); };
    eng.layer_locks = (id: number) => state.get(id) ?? 0;
  }
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null };
  return { store: new Store(client as never), calls };
}

describe("per-attribute layer locks (#418)", () => {
  it("round-trips each bit independently", () => {
    const { store } = storeWith();
    store.setLayerLocks(3, 1);       // transparent only
    expect(store.layerLocks(3)).toBe(1);
    store.setLayerLocks(3, 1 | 4);   // + position, still no image lock
    expect(store.layerLocks(3)).toBe(5);
    store.setLayerLocks(3, 2);       // image only
    expect(store.layerLocks(3)).toBe(2);
  });

  it("masks off anything outside the three defined bits", () => {
    const { store, calls } = storeWith();
    store.setLayerLocks(1, 0xff);
    expect(calls).toContainEqual(["locks", 1, 7]);
  });

  it("keeps Lock All on its own setter, so the two do not clobber each other", () => {
    const { store, calls } = storeWith();
    store.setLayerLocks(1, 1);
    store.setLayerLocked(1, true);
    expect(calls).toEqual([["locks", 1, 1], ["all", 1, true]]);
    expect(store.layerLocks(1)).toBe(1); // Lock All did not reset the attributes
  });

  it("degrades to no locks on a wasm build without them", () => {
    const { store, calls } = storeWith({ locks: false });
    store.setLayerLocks(1, 7);
    expect(store.layerLocks(1)).toBe(0);
    expect(calls).toEqual([]); // and never calls a missing export
  });
});
