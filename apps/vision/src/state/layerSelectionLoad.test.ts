// Guards #410: Photoshop's ⌘-click-a-layer-thumbnail gesture. The layer's own
// transparency and its mask both become selections, with ⇧/⌥ combining them
// into the live one. The engine ops (layer_alpha_gray / layer_mask_gray /
// apply_selection_mask) are covered in packages/engine; this asserts the store
// hands the right plane to the right mode, in exactly one history step.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

type Call = [string, ...unknown[]];

const ALPHA = Uint8Array.of(255, 255, 0, 0);
const MASK = Uint8Array.of(0, 0, 255, 255);

function storeWith({ alpha = ALPHA, mask = MASK } = {}) {
  const calls: Call[] = [];
  const undo: string[] = [];
  const eng = {
    layer_alpha_gray: (id: number) => { calls.push(["alpha", id]); return alpha; },
    layer_mask_gray: (id: number) => { calls.push(["mask", id]); return mask; },
    apply_selection_mask: (plane: Uint8Array, mode: number) => {
      calls.push(["apply", Array.from(plane), mode]);
      undo.push("Load Selection");
    },
  };
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null };
  return { store: new Store(client as never), calls, undo, sync: client.sync };
}

describe("loading a layer's transparency as a selection (#410)", () => {
  it("hands the layer's alpha plane straight to the selection, replacing by default", () => {
    const { store, calls, undo, sync } = storeWith();
    store.loadLayerTransparencyAsSelection(7);
    // No scratch channel round trip — unlike a document plate, the engine can
    // hand back the coverage directly.
    expect(calls).toEqual([["alpha", 7], ["apply", [255, 255, 0, 0], 0]]);
    expect(undo).toEqual(["Load Selection"]); // one click, one undo step
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("loads the mask itself when the mask thumbnail is the target", () => {
    const { store, calls } = storeWith();
    store.loadLayerMaskAsSelection(7);
    expect(calls).toEqual([["mask", 7], ["apply", [0, 0, 255, 255], 0]]);
  });

  it("passes Photoshop's combine modes through unchanged", () => {
    const { store, calls } = storeWith();
    store.loadLayerTransparencyAsSelection(1, 1); // ⌘⇧ add
    store.loadLayerTransparencyAsSelection(1, 2); // ⌘⌥ subtract
    store.loadLayerMaskAsSelection(1, 3);         // ⌘⌥⇧ intersect
    expect(calls.filter((c) => c[0] === "apply").map((c) => c[2])).toEqual([1, 2, 3]);
  });

  it("does nothing when the layer has no plane to load", () => {
    // layer_alpha_gray returns an empty plane for an unknown id, and
    // layer_mask_gray for a layer with no mask — neither should touch the
    // selection or burn a history step.
    const { store, calls, undo } = storeWith({ alpha: new Uint8Array(), mask: new Uint8Array() });
    store.loadLayerTransparencyAsSelection(999);
    store.loadLayerMaskAsSelection(999);
    expect(calls.some((c) => c[0] === "apply")).toBe(false);
    expect(undo).toEqual([]);
  });
});
