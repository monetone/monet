// Unit tests for the Layers-panel kind filter. Engine-free (node); the dropdown +
// row filtering are covered by e2e/layer-kind-filter.spec.ts.
import { describe, it, expect } from "vitest";
import {
  layerKindMatches, LAYER_KIND_FILTERS,
  layerAttributeMatches, LAYER_ATTRIBUTE_FILTERS,
  layerModeMatches, LAYER_MODE_FILTERS,
  layerEffectMatches, LAYER_EFFECT_FILTERS,
  type LayerAttributeFilter, type LayerAttributes,
} from "./layerKindFilter";
import { BLEND_ORDER, LAYER_KIND } from "./engineContracts";
import { FX, FX_DEFS } from "./effects";

const ALL_KINDS = Object.values(LAYER_KIND);

describe("layerKindMatches", () => {
  it("'all' passes every kind", () => {
    for (const k of ALL_KINDS) expect(layerKindMatches(k, "all")).toBe(true);
  });

  it("each kind filter matches its Photoshop layer class", () => {
    const cases: [Parameters<typeof layerKindMatches>[1], number][] = [
      ["pixel", LAYER_KIND.pixel], ["adjustment", LAYER_KIND.adjustment],
      ["type", LAYER_KIND.text], ["shape", LAYER_KIND.vector], ["smart", LAYER_KIND.smartObject],
    ];
    for (const [filter, kind] of cases) {
      expect(layerKindMatches(kind, filter)).toBe(true);
      for (const other of ALL_KINDS) {
        if (other !== kind && !(filter === "adjustment" && other === LAYER_KIND.fill)) {
          expect(layerKindMatches(other, filter)).toBe(false);
        }
      }
    }
    expect(layerKindMatches(LAYER_KIND.fill, "adjustment")).toBe(true);
  });

  it("a group (kind 6) matches only 'all'", () => {
    expect(layerKindMatches(LAYER_KIND.groupHeader, "all")).toBe(true);
    for (const f of ["pixel", "adjustment", "type", "shape", "smart"] as const) {
      expect(layerKindMatches(LAYER_KIND.groupHeader, f)).toBe(false);
    }
  });

  it("lists 'All' first", () => {
    expect(LAYER_KIND_FILTERS[0].value).toBe("all");
    expect(LAYER_KIND_FILTERS.map((o) => o.value)).toEqual(["all", "pixel", "adjustment", "type", "shape", "smart"]);
  });
});

const layer = (o: Partial<LayerAttributes> = {}): LayerAttributes =>
  ({ visible: true, locked: false, hasMask: false, hasFx: false, ...o });

describe("layerAttributeMatches", () => {
  it("'all' passes every layer", () => {
    expect(layerAttributeMatches(layer(), "all")).toBe(true);
    expect(layerAttributeMatches(layer({ visible: false, locked: true, hasMask: true, hasFx: true, clipped: true }), "all")).toBe(true);
  });

  it("each attribute selects exactly the layers carrying it", () => {
    const cases: [LayerAttributeFilter, Partial<LayerAttributes>][] = [
      ["visible", { visible: true }],
      ["hidden", { visible: false }],
      ["locked", { locked: true }],
      ["unlocked", { locked: false }],
      ["clipped", { clipped: true }],
      ["masked", { hasMask: true }],
      ["fx", { hasFx: true }],
    ];
    for (const [filter, on] of cases) {
      expect(layerAttributeMatches(layer(on), filter)).toBe(true);
    }
  });

  it("visible/hidden and locked/unlocked partition the list", () => {
    const shown = layer({ visible: true });
    const gone = layer({ visible: false });
    expect(layerAttributeMatches(shown, "hidden")).toBe(false);
    expect(layerAttributeMatches(gone, "visible")).toBe(false);
    const open = layer({ locked: false });
    const shut = layer({ locked: true });
    expect(layerAttributeMatches(open, "locked")).toBe(false);
    expect(layerAttributeMatches(shut, "unlocked")).toBe(false);
  });

  it("an undefined 'clipped' means not clipped, not a pass", () => {
    expect(layerAttributeMatches(layer(), "clipped")).toBe(false);
    expect(layerAttributeMatches(layer({ clipped: false }), "clipped")).toBe(false);
  });

  it("a disabled mask still counts as masked (Photoshop filters on presence)", () => {
    // LayerInfo.maskEnabled is deliberately not an input here.
    expect(layerAttributeMatches(layer({ hasMask: true }), "masked")).toBe(true);
  });

  it("a plain layer matches none of the attribute filters but 'all'", () => {
    const plain = layer();
    const passed = LAYER_ATTRIBUTE_FILTERS.filter((o) => layerAttributeMatches(plain, o.value)).map((o) => o.value);
    expect(passed).toEqual(["all", "visible", "unlocked"]);
  });

  it("lists 'All' first and only attributes LayerInfo can answer", () => {
    expect(LAYER_ATTRIBUTE_FILTERS[0].value).toBe("all");
    expect(LAYER_ATTRIBUTE_FILTERS.map((o) => o.value))
      .toEqual(["all", "visible", "hidden", "locked", "unlocked", "clipped", "masked", "fx"]);
  });
});

describe("layerModeMatches (#423)", () => {
  it("'all' passes every blend mode", () => {
    for (const mode of BLEND_ORDER) expect(layerModeMatches(mode, "all")).toBe(true);
  });

  it("a mode selects exactly the layers set to it", () => {
    expect(layerModeMatches("multiply", "multiply")).toBe(true);
    expect(layerModeMatches("normal", "multiply")).toBe(false);
    expect(layerModeMatches("pass-through", "pass-through")).toBe(true);
    expect(layerModeMatches("multiply", "normal")).toBe(false);
  });

  it("lists 'All' first, then every engine blend mode with a title-case label", () => {
    expect(LAYER_MODE_FILTERS[0]).toEqual({ value: "all", label: "All" });
    expect(LAYER_MODE_FILTERS.slice(1).map((o) => o.value)).toEqual([...BLEND_ORDER]);
    const label = (v: string) => LAYER_MODE_FILTERS.find((o) => o.value === v)?.label;
    expect(label("pass-through")).toBe("Pass Through");
    expect(label("color-burn")).toBe("Color Burn");
    expect(label("normal")).toBe("Normal");
  });
});

describe("layerEffectMatches (#423)", () => {
  const mask = (...ids: number[]) => ids.reduce((m, id) => m | (1 << id), 0);

  it("'all' passes a layer with no effects at all", () => {
    expect(layerEffectMatches(0, "all")).toBe(true);
  });

  it("an effect selects exactly the layers carrying it", () => {
    const shadowAndStroke = mask(FX.DROP_SHADOW, FX.STROKE);
    expect(layerEffectMatches(shadowAndStroke, FX.DROP_SHADOW)).toBe(true);
    expect(layerEffectMatches(shadowAndStroke, FX.STROKE)).toBe(true);
    expect(layerEffectMatches(shadowAndStroke, FX.BEVEL)).toBe(false);
    expect(layerEffectMatches(0, FX.DROP_SHADOW)).toBe(false);
  });

  it("lists 'All' first, then the ten effect types in FX id order", () => {
    expect(LAYER_EFFECT_FILTERS[0]).toEqual({ value: "all", label: "All" });
    expect(LAYER_EFFECT_FILTERS.slice(1)).toEqual(FX_DEFS.map((d) => ({ value: d.id, label: d.name })));
    expect(LAYER_EFFECT_FILTERS.slice(1).map((o) => o.label)).toEqual([
      "Drop Shadow", "Inner Shadow", "Outer Glow", "Inner Glow", "Bevel & Emboss",
      "Satin", "Color Overlay", "Gradient Overlay", "Pattern Overlay", "Stroke",
    ]);
  });
});
