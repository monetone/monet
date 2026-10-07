import { describe, expect, it } from "vitest";
import type { LayerInfo } from "./store";
import { autoNameLayerUpdates, isGenericLayerName, suggestedLayerBaseName } from "./layerAutoName";

const layer = (patch: Partial<LayerInfo>): LayerInfo => ({
  id: patch.id ?? 1,
  name: patch.name ?? "Layer 1",
  visible: patch.visible ?? true,
  locked: false,
  opacity: 100,
  fillOpacity: 100,
  blendMode: "normal",
  thumb: "",
  hasMask: patch.hasMask ?? false,
  hasFx: patch.hasFx ?? false,
  kind: patch.kind ?? 0,
  group: 0,
});

describe("layer auto naming", () => {
  it("detects generic Photoshop-style names", () => {
    expect(isGenericLayerName("Layer 12")).toBe(true);
    expect(isGenericLayerName("Hero image")).toBe(false);
  });

  it("builds names from layer kind and state", () => {
    expect(suggestedLayerBaseName(layer({ kind: 2, hasMask: true }))).toBe("Text Layer Mask");
    expect(suggestedLayerBaseName(layer({ kind: 7, hasFx: true, visible: false }))).toBe("Smart Object Hidden FX");
  });

  it("auto-names only generic layers when requested and keeps names unique", () => {
    const updates = autoNameLayerUpdates([
      layer({ id: 1, name: "Hero" }),
      layer({ id: 2, name: "Layer 2", kind: 3 }),
      layer({ id: 3, name: "Layer 3", kind: 3 }),
    ], { onlyGeneric: true });
    expect(updates).toEqual([{ id: 2, name: "Shape Layer" }, { id: 3, name: "Shape Layer 2" }]);
  });

  it("names fill layers (#152)", () => {
    expect(suggestedLayerBaseName(layer({ kind: 4 }))).toBe("Fill Layer");
  });

  it("does not collide with preserved layer names (#153)", () => {
    const updates = autoNameLayerUpdates([
      layer({ id: 1, name: "Pixel Layer 2" }),
      layer({ id: 2, name: "Layer 1" }),
      layer({ id: 3, name: "Layer 2" }),
    ], { onlyGeneric: true });
    expect(updates).toEqual([{ id: 2, name: "Pixel Layer" }, { id: 3, name: "Pixel Layer 3" }]);
  });

  it("does not collide with a preserved name that comes later (#153)", () => {
    const updates = autoNameLayerUpdates([
      layer({ id: 1, name: "Layer 1" }),
      layer({ id: 2, name: "Pixel Layer" }),
    ], { onlyGeneric: true });
    expect(updates).toEqual([{ id: 1, name: "Pixel Layer 2" }]);
  });
});
