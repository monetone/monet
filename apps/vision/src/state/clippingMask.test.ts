import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

// ⌥⌘G is a toggle: Create Clipping Mask on an unclipped layer, Release on a
// clipped one. The engine owns the flag; the store reads it back through the
// layer_clipping getter and writes through set_layer_clipping.
function storeWith(clippedIds: number[]) {
  const calls: [number, boolean][] = [];
  const eng = {
    layer_clipping: (id: number) => clippedIds.includes(id),
    set_layer_clipping: (id: number, clip: boolean) => calls.push([id, clip]),
  };
  const client = { engine: eng, e: eng, commit: vi.fn(() => true), onCommit: null };
  return { store: new Store(client as never), calls };
}

describe("clipping mask toggle", () => {
  it("clips an unclipped layer and releases a clipped one", () => {
    const { store, calls } = storeWith([7]);
    store.toggleClipping(3); // unclipped → Create Clipping Mask
    store.toggleClipping(7); // clipped → Release Clipping Mask
    expect(calls).toEqual([[3, true], [7, false]]);
  });

  it("reads the engine flag through layerClipping", () => {
    const { store } = storeWith([7]);
    expect(store.layerClipping(7)).toBe(true);
    expect(store.layerClipping(3)).toBe(false);
  });
});
