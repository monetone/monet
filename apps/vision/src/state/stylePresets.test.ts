// Unit tests for the Styles-panel preset helpers. Engine-free (node); the panel +
// store wiring (save/apply/persist) is covered by e2e/styles-panel.spec.ts.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_STYLE_PRESETS,
  defaultStylePresetName,
  addStylePresetTo,
  removeStylePresetAt,
  parseStylePresets,
  sanitizeStyleEffects,
  type StylePreset,
} from "./stylePresets";
import { FX, FX_MAX_INSTANCES, defaultBlendIf } from "./effects";

// blendIf is the neutral 32-value default: the persistence validator pins the length to
// 0 (unset) or 32, the only two shapes the engine and PSD export accept (#143).
const mk = (name: string): StylePreset => ({
  name,
  style: { effects: [{ fx: FX.DROP_SHADOW, params: [1, 0, 0.75, 0, 0, 0, 120, 5, 0, 5] }], blendIf: defaultBlendIf(), fillOpacity: 100 },
});

describe("DEFAULT_STYLE_PRESETS", () => {
  it("ships built-in styles, each a valid, uniquely-named StyleData with an enabled effect", () => {
    expect(DEFAULT_STYLE_PRESETS.length).toBeGreaterThanOrEqual(5);
    const names = new Set<string>();
    for (const p of DEFAULT_STYLE_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(names.has(p.name)).toBe(false); // unique names (add/rename rely on this)
      names.add(p.name);
      expect(p.style.effects.length).toBeGreaterThan(0);
      expect(p.style.effects.every((e) => e.params.length > 0)).toBe(true);
      expect(p.style.effects.some((e) => e.params[0] === 1)).toBe(true); // at least one enabled effect
      expect(p.style.blendIf).toHaveLength(32);
      expect(p.style.fillOpacity).toBe(100);
    }
  });

  it("round-trips the built-in library through the persistence validator", () => {
    expect(parseStylePresets(JSON.stringify(DEFAULT_STYLE_PRESETS))).toEqual(DEFAULT_STYLE_PRESETS);
  });
});

describe("defaultStylePresetName", () => {
  it("starts at 'Style 1' and counts one past the highest 'Style N'", () => {
    expect(defaultStylePresetName([])).toBe("Style 1");
    expect(defaultStylePresetName(["Chrome", "Style 1", "Style 3"])).toBe("Style 4");
    expect(defaultStylePresetName(["Style", "my Style 2"])).toBe("Style 1"); // non-matching ignored
  });
});

describe("addStylePresetTo / removeStylePresetAt", () => {
  it("appends a new-named preset and is a same-ref no-op for a duplicate name", () => {
    const base = [mk("A")];
    expect(addStylePresetTo(base, mk("B")).map((p) => p.name)).toEqual(["A", "B"]);
    expect(addStylePresetTo(base, mk("A"))).toBe(base);
  });
  it("removes by index; out-of-range is a same-ref no-op", () => {
    const list = [mk("A"), mk("B")];
    expect(removeStylePresetAt(list, 0).map((p) => p.name)).toEqual(["B"]);
    expect(removeStylePresetAt(list, 5)).toBe(list);
    expect(removeStylePresetAt(list, -1)).toBe(list);
  });
});

describe("parseStylePresets", () => {
  it("round-trips a serialized library", () => {
    const list = [mk("A"), mk("B")];
    expect(parseStylePresets(JSON.stringify(list))).toEqual(list);
  });
  it("round-trips a stacked style (two strokes on one layer)", () => {
    const list = [{
      name: "Double Stroke",
      style: {
        effects: [
          { fx: FX.STROKE, params: [1, 0, 1, 1, 0, 0, 3, 0] },
          { fx: FX.STROKE, params: [1, 0, 1, 1, 1, 1, 6, 1] },
        ],
        blendIf: [],
        fillOpacity: 100,
      },
    }];
    expect(parseStylePresets(JSON.stringify(list))).toEqual(list);
  });
  it("keeps a legitimately empty library empty instead of rejecting it (#146)", () => {
    // "[]" is what removing the last preset persists. Rejecting it made the loader fall
    // back to the store's initial value, resurrecting every built-in on the next launch.
    expect(parseStylePresets("[]")).toEqual([]);
  });
  it("rejects a non-finite or wrong-length blend-if / fill opacity (#143)", () => {
    // JSON has no NaN, but 1e999 parses to Infinity — and `typeof Infinity === "number"`,
    // so the old check let it through. A 32-entry ±Infinity blend-if makes the engine's
    // blend_if_factor return 0 (the layer composites invisibly) and hard-fails PSD export.
    const st = (blendIf: string, fillOpacity: string) =>
      `[{"name":"x","style":{"effects":[],"blendIf":${blendIf},"fillOpacity":${fillOpacity}}}]`;
    // Built as TEXT: the JSON must literally contain 1e999 (which JSON.parse turns
    // into Infinity). Writing it as a JS number literal loses precision at runtime.
    const inf32 = `[${Array.from({ length: 32 }, () => "1e999").join(",")}]`;
    expect(parseStylePresets(st(inf32, "100"))).toBeNull();          // ±Infinity entries
    expect(parseStylePresets(st("[0,0,1]", "100"))).toBeNull();       // not 0 or 32 long
    expect(parseStylePresets(st("[]", "1e999"))).toBeNull();          // Infinity fillOpacity
    // the two legal shapes still load
    expect(parseStylePresets(st("[]", "100"))).not.toBeNull();
    expect(parseStylePresets(st(JSON.stringify(defaultBlendIf()), "100"))).not.toBeNull();
  });
  it("returns null for missing, non-array or malformed payloads", () => {
    expect(parseStylePresets(null)).toBeNull();
    expect(parseStylePresets("")).toBeNull();
    expect(parseStylePresets("not json")).toBeNull();                // parse error
    expect(parseStylePresets('{"name":"x"}')).toBeNull();            // not an array
    expect(parseStylePresets('[{"name":"x"}]')).toBeNull();          // missing style
    expect(parseStylePresets('[{"name":"x","style":{"effects":[],"blendIf":[]}}]')).toBeNull(); // fillOpacity not a number
    expect(parseStylePresets('[{"name":"x","style":{"effects":[{"fx":0,"params":["a"]}],"blendIf":[0],"fillOpacity":1}}]')).toBeNull(); // non-numeric params
    expect(parseStylePresets('[{"style":{"effects":[],"blendIf":[],"fillOpacity":100}}]')).toBeNull(); // missing name
  });
  it("rejects a hostile entry — a bad fx id or an over-cap instance count — rather than accepting it", () => {
    // fx 99 doesn't exist (see FX in effects.ts): must never reach the engine.
    expect(parseStylePresets(JSON.stringify([{ name: "x", style: { effects: [{ fx: 99, params: [1] }], blendIf: [], fillOpacity: 100 } }]))).toBeNull();
    // FX_MAX_INSTANCES + 1 copies of one type is more than set_layer_effect_at allows.
    const tooMany = Array.from({ length: FX_MAX_INSTANCES + 1 }, () => ({ fx: FX.STROKE, params: [1, 0, 1, 1, 0, 0, 3, 0] }));
    expect(parseStylePresets(JSON.stringify([{ name: "x", style: { effects: tooMany, blendIf: [], fillOpacity: 100 } }]))).toBeNull();
  });
});

describe("sanitizeStyleEffects", () => {
  it("drops entries with an unknown fx id", () => {
    expect(sanitizeStyleEffects([{ fx: 99, params: [1] }, { fx: FX.STROKE, params: [1] }])).toEqual([{ fx: FX.STROKE, params: [1] }]);
  });
  it("drops non-numeric, empty, or over-length params", () => {
    expect(sanitizeStyleEffects([{ fx: FX.STROKE, params: ["a"] }])).toEqual([]);
    expect(sanitizeStyleEffects([{ fx: FX.STROKE, params: [] }])).toEqual([]);
    expect(sanitizeStyleEffects([{ fx: FX.STROKE, params: [1, 2, 3] }], 2)).toEqual([]);
  });
  it("caps instances per fx id at FX_MAX_INSTANCES, keeping the first ones", () => {
    const many = Array.from({ length: FX_MAX_INSTANCES + 5 }, (_, i) => ({ fx: FX.STROKE, params: [i] }));
    const out = sanitizeStyleEffects(many);
    expect(out).toHaveLength(FX_MAX_INSTANCES);
    expect(out.map((e) => e.params[0])).toEqual(Array.from({ length: FX_MAX_INSTANCES }, (_, i) => i));
  });
  it("is a no-op on already-valid data and returns [] for non-array input", () => {
    const valid = [{ fx: FX.DROP_SHADOW, params: [1, 2] }];
    expect(sanitizeStyleEffects(valid)).toEqual(valid);
    expect(sanitizeStyleEffects(null)).toEqual([]);
    expect(sanitizeStyleEffects("not an array")).toEqual([]);
  });
});
