import { describe, it, expect } from "vitest";
import {
  MAX_LAYER_COMPS,
  MAX_LAYERS_PER_COMP,
  MAX_LAYER_STATES,
  defaultLayerCompName,
  addLayerComp,
  cloneLayerComps,
  normalizeLayerComps,
  removeLayerCompAt,
  type LayerComp,
  type LayerCompState,
} from "./layerComps";
import { FX, FX_MAX_INSTANCES } from "./effects";

const comp = (name: string): LayerComp => ({ name, layers: [] });

describe("defaultLayerCompName", () => {
  it("starts at 1 when empty", () => {
    expect(defaultLayerCompName([])).toBe("Layer Comp 1");
  });
  it("increments past sequential names", () => {
    expect(defaultLayerCompName(["Layer Comp 1", "Layer Comp 2"])).toBe("Layer Comp 3");
  });
  it("goes one past the max (not gap-fill)", () => {
    expect(defaultLayerCompName(["Layer Comp 1", "Layer Comp 5"])).toBe("Layer Comp 6");
  });
  it("ignores non-matching names", () => {
    expect(defaultLayerCompName(["Sky", "Layer Comp 2", "draft"])).toBe("Layer Comp 3");
  });
});

describe("addLayerComp / removeLayerCompAt", () => {
  it("appends immutably", () => {
    const a = [comp("Layer Comp 1")];
    const b = addLayerComp(a, comp("Layer Comp 2"));
    expect(b).toHaveLength(2);
    expect(a).toHaveLength(1); // original unchanged
    expect(b[1].name).toBe("Layer Comp 2");
  });
  it("removes in-range immutably", () => {
    const a = [comp("Layer Comp 1"), comp("Layer Comp 2")];
    const b = removeLayerCompAt(a, 0);
    expect(b).toHaveLength(1);
    expect(b[0].name).toBe("Layer Comp 2");
    expect(a).toHaveLength(2);
  });
  it("is a no-op out of range", () => {
    const a = [comp("Layer Comp 1")];
    expect(removeLayerCompAt(a, 5)).toHaveLength(1);
    expect(removeLayerCompAt(a, -1)).toHaveLength(1);
  });

  it("accepts the exact comp cap and refuses the next append", () => {
    const almostFull = Array.from({ length: MAX_LAYER_COMPS - 1 }, (_, i) => comp(`Comp ${i}`));
    const full = addLayerComp(almostFull, comp("Last"));
    expect(full).toHaveLength(MAX_LAYER_COMPS);
    expect(addLayerComp(full, comp("Dropped"))).toBe(full);
  });

  it("accepts the exact aggregate layer-state cap and refuses overflow", () => {
    const state: LayerCompState = { id: 1, visible: true, opacity: 100, blendMode: "normal" };
    const almostFull = Array.from({ length: 10 }, (_, i) => ({
      name: `Comp ${i}`,
      layers: Array<LayerCompState>(9_999).fill(state),
    }));
    const full = addLayerComp(almostFull, { name: "Boundary", layers: Array<LayerCompState>(10).fill(state) });
    expect(full.reduce((total, item) => total + item.layers.length, 0)).toBe(MAX_LAYER_STATES);
    expect(addLayerComp(full, { name: "Overflow", layers: [state] })).toBe(full);
    expect(addLayerComp([], { name: "Oversized", layers: Array<LayerCompState>(MAX_LAYERS_PER_COMP + 1).fill(state) })).toEqual([]);
  });
});

describe("persisted Layer Comps", () => {
  it("clones and bounds complete position and appearance state", () => {
    const layerComps: LayerComp[] = [{
      name: "Wide gamut comp",
      layers: [{
        id: 7,
        visible: false,
        opacity: 125,
        blendMode: "multiply",
        offset: [2.4, -3.6],
        style: { effects: [{ fx: 0, params: [1, 2] }], blendIf: [], fillOpacity: -5 },
      }],
    }];

    const cloned = cloneLayerComps(layerComps);
    expect(cloned).not.toBe(layerComps);
    expect(cloned[0].layers[0]).toMatchObject({ id: 7, visible: false, opacity: 100, offset: [2, -4] });
    expect(cloned[0].layers[0].style).toMatchObject({ fillOpacity: 0, blendIf: [] });
    expect(cloned[0].layers[0].style?.effects).toEqual([{ fx: 0, params: [1, 2] }]);
  });

  it("filters malformed comps, duplicate layer ids, and invalid style payloads", () => {
    expect(normalizeLayerComps([
      { name: "kept", layers: [
        { id: 3, visible: true, opacity: 50, blendMode: "normal", style: { effects: [], blendIf: [1], fillOpacity: 100 } },
        { id: 3, visible: false, opacity: 20, blendMode: "screen" },
        { id: "bad", visible: true, opacity: 20, blendMode: "normal" },
      ] },
      { name: 4, layers: [] },
    ])).toEqual([{ name: "kept", layers: [{ id: 3, visible: true, opacity: 50, blendMode: "normal" }] }]);
  });

  it("bounds inspected comp and layer entries, including malformed ones", () => {
    const oversizedLayers: unknown[] = Array.from({ length: 10_001 }, () => null);
    oversizedLayers[10_000] = { id: 9, visible: true, opacity: 100, blendMode: "normal" };
    const oversizedComps: unknown[] = Array.from({ length: 1_001 }, () => null);
    oversizedComps[999] = { name: "bounded", layers: oversizedLayers };
    oversizedComps[1_000] = { name: "too late", layers: [] };

    expect(normalizeLayerComps(oversizedComps)).toEqual([{ name: "bounded", layers: [] }]);
  });

  it("drops a hostile style entry (bad fx id, over-cap instance count) instead of reaching the engine", () => {
    const tooMany = Array.from({ length: FX_MAX_INSTANCES + 5 }, () => ({ fx: FX.STROKE, params: [1] }));
    const comps = normalizeLayerComps([{
      name: "hostile",
      layers: [{
        id: 1, visible: true, opacity: 100, blendMode: "normal",
        style: { effects: [{ fx: 999, params: [1] }, ...tooMany], blendIf: [], fillOpacity: 100 },
      }],
    }]);
    const style = comps[0].layers[0].style!;
    expect(style.effects.every((e) => e.fx !== 999)).toBe(true); // unknown fx id dropped
    expect(style.effects.filter((e) => e.fx === FX.STROKE)).toHaveLength(FX_MAX_INSTANCES); // capped
  });

  it("rejects a style whose effect list exceeds the total entry bound outright", () => {
    const huge = Array.from({ length: 10 * FX_MAX_INSTANCES + 1 }, () => ({ fx: FX.STROKE, params: [1] }));
    const comps = normalizeLayerComps([{
      name: "oversized style",
      layers: [{ id: 1, visible: true, opacity: 100, blendMode: "normal", style: { effects: huge, blendIf: [], fillOpacity: 100 } }],
    }]);
    expect(comps[0].layers[0].style).toBeUndefined();
  });
});
