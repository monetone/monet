// Guards #421: Advanced Blending ▸ Channels. The engine enforces the
// restriction (covered in packages/engine); this pins the store plumbing and
// the Blending Options state that carries it, both easy to get backwards.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

function storeWith({ channels = true } = {}) {
  const calls: [string, ...unknown[]][] = [];
  const state = new Map<number, number>();
  const eng: Record<string, unknown> = {};
  for (const name of [
    "clear_layer_effects", "set_layer_blend_if", "set_layer_fill_opacity", "set_layer_knockout",
    "set_layer_transparency_shapes", "set_layer_blend_interior_group", "set_layer_blend_clipped_group",
  ]) eng[name] = (...a: unknown[]) => calls.push([name, ...a]);
  if (channels) {
    eng.set_layer_blend_channels = (id: number, mask: number) => { state.set(id, mask); calls.push(["set", id, mask]); };
    eng.layer_blend_channels = (id: number) => state.get(id) ?? 7;
  }
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null };
  return { store: new Store(client as never), calls };
}

describe("per-channel blend restriction (#421)", () => {
  it("round-trips each bit and masks off anything outside R/G/B", () => {
    const { store } = storeWith();
    expect(store.layerBlendChannels(3)).toBe(7); // layers blend everything by default
    store.setLayerBlendChannels(3, 0b101);
    expect(store.layerBlendChannels(3)).toBe(0b101);
    store.setLayerBlendChannels(3, 0xff);
    expect(store.layerBlendChannels(3)).toBe(7);
    store.setLayerBlendChannels(3, 0);
    expect(store.layerBlendChannels(3)).toBe(0);
  });

  it("degrades to all channels on a wasm build without the export", () => {
    const { store, calls } = storeWith({ channels: false });
    store.setLayerBlendChannels(1, 0b010);
    expect(store.layerBlendChannels(1)).toBe(7);
    expect(calls).toEqual([]); // …and never calls a missing export
  });

  it("carries the mask through the Blending Options state OK applies", () => {
    const { store, calls } = storeWith();
    vi.spyOn(store, "beginHistory").mockReturnValue(true);
    vi.spyOn(store, "commitHistory").mockReturnValue(true);
    const base = {
      effects: [], blendIf: [], fillOpacity: 100, knockout: 0,
      transparencyShapes: true, blendInteriorGroup: false, blendClippedGroup: false,
    };
    expect(store.applyLayerStyleState({ ...base, blendChannels: 0b011 })).toBe(true);
    expect(calls.at(-1)).toEqual(["set", store.state.activeLayerId, 0b011]);

    // A style recorded before the control existed replays as all three, not as
    // "no channels" — an omitted field must never mean a blank layer.
    expect(store.applyLayerStyleState(base)).toBe(true);
    expect(calls.at(-1)).toEqual(["set", store.state.activeLayerId, 7]);

    // …and a corrupt payload is refused whole.
    expect(store.applyLayerStyleState({ ...base, blendChannels: Number.NaN })).toBe(false);
  });
});
