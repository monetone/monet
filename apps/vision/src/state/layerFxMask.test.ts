// Guards #423: the store surfaces WHICH effect types a layer carries
// (`LayerInfo.fxMask`), so the Layers filter bar's Effect dropdown has
// something to narrow on. The engine only answers per-type counts and
// per-instance params; the enabled-flag folding lives here.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";
import { FX } from "./effects";

/** One layer (id 7) whose effects are `instances`: effect id → per-instance
 *  enabled flags. Everything else the sync reads falls back to 0. */
function syncedLayer(instances: Record<number, number[]>) {
  const replies: Record<string, (...args: unknown[]) => unknown> = {
    layer_count: () => 1,
    layer_id_at: () => 7,
    layer_name: () => "Layer 7",
    layer_has_effects: () => Object.values(instances).some((flags) => flags.some((on) => on >= 0.5)),
    layer_effect_count: (_id: unknown, fx: unknown) => instances[fx as number]?.length ?? 0,
    layer_effect_params_at: (_id: unknown, fx: unknown, k: unknown) => Float32Array.of(instances[fx as number][k as number], 0, 0),
    history_labels: () => [],
  };
  const engine = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => (...args: unknown[]) => replies[prop]?.(...args) ?? 0,
  });
  const client = new Proxy({ engine, e: engine, onCommit: null, onSync: null, layerThumbUrl: () => "" } as Record<string, unknown>, {
    get: (t, prop: string) => (prop in t ? t[prop] : () => 0),
  });
  const store = new Store(client as never);
  store.syncFromEngine();
  return store.getSnapshot().layers[0];
}

describe("LayerInfo.fxMask (#423)", () => {
  it("sets the bit of every effect type with an enabled instance", () => {
    const layer = syncedLayer({ [FX.DROP_SHADOW]: [1], [FX.STROKE]: [0, 1] });
    expect(layer.fxMask).toBe((1 << FX.DROP_SHADOW) | (1 << FX.STROKE));
  });

  it("ignores a type whose every instance is disabled, like the Attribute filter's Layer Effects", () => {
    expect(syncedLayer({ [FX.DROP_SHADOW]: [1], [FX.BEVEL]: [0, 0] }).fxMask).toBe(1 << FX.DROP_SHADOW);
  });

  it("is 0 for a layer without effects", () => {
    expect(syncedLayer({}).fxMask).toBe(0);
  });
});
