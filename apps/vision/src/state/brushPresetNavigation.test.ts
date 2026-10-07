import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

function makeStore() {
  const engine = new Proxy({} as Record<string, unknown>, {
    get: () => () => undefined,
  });
  return new Store({ engine, e: engine, lastBrush: [], onCommit: null } as never);
}

describe("brush preset selection", () => {
  it("applies adjacent and endpoint presets while retaining selection through edits", () => {
    const store = makeStore();
    store.navigateBrushPresets(1);
    expect(store.state.activeBrushPreset).toBe(0);
    expect(store.state.brush.size).toBe(30);

    store.setBrush({ size: 77 });
    expect(store.state.activeBrushPreset).toBe(0);
    store.navigateBrushPresets(1);
    expect(store.state.activeBrushPreset).toBe(1);
    expect(store.state.brush.size).toBe(20);

    store.navigateBrushPresets(1, true);
    expect(store.state.activeBrushPreset).toBe(store.state.brushPresets.length - 1);
    expect(store.state.brush.size).toBe(24);
  });

  it("tracks the selected preset through removal and reordering", () => {
    const store = makeStore();
    store.applyBrushPreset(2);
    const selected = store.state.brushPresets[2];

    store.removeBrushPreset(0);
    expect(store.state.activeBrushPreset).toBe(1);
    expect(store.state.brushPresets[1]).toBe(selected);

    store.reorderBrushPreset(1, 2);
    expect(store.state.activeBrushPreset).toBe(3);
    expect(store.state.brushPresets[3]).toBe(selected);

    store.removeBrushPreset(3);
    expect(store.state.activeBrushPreset).toBe(-1);
  });
});
