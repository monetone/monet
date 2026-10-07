// Layer Comp Options — the per-comp comment and the three Apply To Layers
// flags (Visibility / Position / Appearance), plus how they narrow an apply.
import { describe, it, expect } from "vitest";
import { cloneLayerComps, compForApply, normalizeLayerComps, type LayerComp, type LayerCompLiveState } from "./layerComps";

const style = { effects: [], blendIf: [], fillOpacity: 50 };
const saved: LayerComp = {
  name: "Sky",
  layers: [{ id: 1, visible: false, opacity: 20, blendMode: "multiply", offset: [10, 20], style }],
};
const live: LayerCompLiveState[] = [{ id: 1, visible: true, opacity: 90, blendMode: "normal" }];

describe("normalizeLayerComps — options", () => {
  it("keeps a comment and only the disabled flags", () => {
    expect(normalizeLayerComps([{ ...saved, comment: "hero variant", applyPosition: false, applyAppearance: true }])).toEqual([
      { ...saved, comment: "hero variant", applyPosition: false },
    ]);
  });
  it("drops non-string comments and non-false flags", () => {
    expect(normalizeLayerComps([{ ...saved, comment: 7, applyVisibility: "no" }])).toEqual([saved]);
  });
  it("bounds an oversized comment", () => {
    const decoded = normalizeLayerComps([{ ...saved, comment: "x".repeat(9000) }]);
    expect(decoded[0].comment).toHaveLength(4096);
  });
  it("round-trips options through the persistence clone", () => {
    const comps: LayerComp[] = [{ ...saved, comment: "note", applyVisibility: false, applyAppearance: false }];
    expect(cloneLayerComps(comps)).toEqual(comps);
  });
});

describe("compForApply", () => {
  it("returns the comp untouched when it applies everything", () => {
    expect(compForApply(saved, live)).toBe(saved);
  });
  it("takes visibility from the document when Visibility is off", () => {
    const [layer] = compForApply({ ...saved, applyVisibility: false }, live).layers;
    expect(layer.visible).toBe(true);
    expect(layer.opacity).toBe(20); // appearance still applies
    expect(layer.offset).toEqual([10, 20]);
  });
  it("drops the offset when Position is off", () => {
    const [layer] = compForApply({ ...saved, applyPosition: false }, live).layers;
    expect(layer.offset).toBeUndefined();
    expect(layer.visible).toBe(false);
  });
  it("takes opacity/blend from the document and drops the style when Appearance is off", () => {
    const [layer] = compForApply({ ...saved, applyAppearance: false }, live).layers;
    expect(layer.opacity).toBe(90);
    expect(layer.blendMode).toBe("normal");
    expect(layer.style).toBeUndefined();
  });
  it("falls back to the saved values for layers no longer in the document", () => {
    const [layer] = compForApply({ ...saved, applyVisibility: false, applyAppearance: false }, []).layers;
    expect(layer).toEqual({ id: 1, visible: false, opacity: 20, blendMode: "multiply", offset: [10, 20] });
  });
});
