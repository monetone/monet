// Unit tests for the gradient preset list + lookups. Engine-free (node); the
// options-bar wiring is covered by e2e/gradient-presets.spec.ts.
import { describe, it, expect } from "vitest";
import type { GradientStop } from "./store";
import {
  GRADIENT_PRESETS,
  CUSTOM_GRADIENT,
  gradientByName,
  gradientPresetFor,
  defaultGradientPresetName,
  addGradientPresetTo,
  removeGradientPresetAt,
  parseGradientPresets,
  type GradientPreset,
} from "./gradientPresets";

// The store's default ramp (store.ts `initial`): black → white.
const DEFAULT_STOPS: GradientStop[] = [
  { pos: 0, r: 0, g: 0, b: 0, a: 255 },
  { pos: 1, r: 255, g: 255, b: 255, a: 255 },
];

describe("GRADIENT_PRESETS", () => {
  it("is a list of valid, uniquely-named, >=2-stop gradients", () => {
    expect(GRADIENT_PRESETS.length).toBeGreaterThan(0);
    const names = new Set<string>();
    for (const p of GRADIENT_PRESETS) {
      expect(p.stops.length).toBeGreaterThanOrEqual(2);
      expect(names.has(p.name)).toBe(false);
      names.add(p.name);
      for (const s of p.stops) {
        expect(s.pos).toBeGreaterThanOrEqual(0);
        expect(s.pos).toBeLessThanOrEqual(1);
        for (const c of [s.r, s.g, s.b, s.a]) {
          expect(Number.isInteger(c) && c >= 0 && c <= 255).toBe(true);
        }
      }
    }
    expect(names.has(CUSTOM_GRADIENT)).toBe(false); // "Custom" is the sentinel, not a preset
  });

  it("includes 'Black, White' matching the store's default ramp", () => {
    expect(gradientByName("Black, White")?.stops).toEqual(DEFAULT_STOPS);
  });
});

describe("gradientByName", () => {
  it("returns the matching preset, or undefined", () => {
    expect(gradientByName("White, Black")?.name).toBe("White, Black");
    expect(gradientByName("Nope")).toBeUndefined();
    expect(gradientByName(CUSTOM_GRADIENT)).toBeUndefined();
  });
});

describe("gradientPresetFor", () => {
  it("matches the default ramp to 'Black, White'", () => {
    expect(gradientPresetFor(DEFAULT_STOPS)?.name).toBe("Black, White");
  });
  it("returns undefined (→ Custom) for a modified ramp", () => {
    const modified = [{ pos: 0, r: 10, g: 20, b: 30, a: 255 }, { pos: 1, r: 255, g: 255, b: 255, a: 255 }];
    expect(gradientPresetFor(modified)).toBeUndefined();
  });
  it("returns undefined when the stop count differs from every preset", () => {
    const oneStop = [{ pos: 0, r: 0, g: 0, b: 0, a: 255 }];
    expect(gradientPresetFor(oneStop)).toBeUndefined();
  });
  it("searches a supplied list (so user-saved gradients resolve)", () => {
    const user: GradientPreset[] = [{ name: "Mine", stops: DEFAULT_STOPS }];
    expect(gradientPresetFor(DEFAULT_STOPS, user)?.name).toBe("Mine"); // not "Black, White"
    expect(gradientByName("Mine", user)?.name).toBe("Mine");
    expect(gradientByName("Black, White", user)).toBeUndefined(); // built-ins not in this list
  });
});

describe("defaultGradientPresetName", () => {
  it("starts at 'Gradient 1' and counts one past the highest 'Gradient N'", () => {
    expect(defaultGradientPresetName([])).toBe("Gradient 1");
    expect(defaultGradientPresetName(["Sunset", "Gradient 1", "Gradient 3"])).toBe("Gradient 4");
    expect(defaultGradientPresetName(["Gradient", "my Gradient 2"])).toBe("Gradient 1"); // non-matching ignored
  });
});

describe("addGradientPresetTo / removeGradientPresetAt", () => {
  const base: GradientPreset[] = [{ name: "A", stops: DEFAULT_STOPS }];
  it("appends a new-named preset and is a same-ref no-op for a duplicate name", () => {
    const next = addGradientPresetTo(base, { name: "B", stops: DEFAULT_STOPS });
    expect(next.map((p) => p.name)).toEqual(["A", "B"]);
    expect(addGradientPresetTo(base, { name: "A", stops: DEFAULT_STOPS })).toBe(base);
  });
  it("removes by index; out-of-range is a same-ref no-op", () => {
    const list: GradientPreset[] = [{ name: "A", stops: DEFAULT_STOPS }, { name: "B", stops: DEFAULT_STOPS }];
    expect(removeGradientPresetAt(list, 0).map((p) => p.name)).toEqual(["B"]);
    expect(removeGradientPresetAt(list, 5)).toBe(list);
    expect(removeGradientPresetAt(list, -1)).toBe(list);
  });
});

describe("parseGradientPresets", () => {
  it("round-trips a serialized library", () => {
    const list: GradientPreset[] = [{ name: "A", stops: DEFAULT_STOPS }, ...GRADIENT_PRESETS.slice(0, 2)];
    expect(parseGradientPresets(JSON.stringify(list))).toEqual(list);
  });
  it("keeps a legitimately empty library empty instead of rejecting it (#146)", () => {
    // "[]" is what removing the last preset persists. Rejecting it made the loader fall
    // back to the store's initial value, resurrecting every built-in on the next launch.
    expect(parseGradientPresets("[]")).toEqual([]);
  });
  it("returns null for missing, non-array or malformed payloads", () => {
    expect(parseGradientPresets(null)).toBeNull();
    expect(parseGradientPresets("")).toBeNull();
    expect(parseGradientPresets("not json")).toBeNull();                  // parse error
    expect(parseGradientPresets('{"name":"x"}')).toBeNull();              // not an array
    expect(parseGradientPresets('[{"name":"x"}]')).toBeNull();            // missing stops
    expect(parseGradientPresets('[{"name":"x","stops":[]}]')).toBeNull(); // empty stops
    expect(parseGradientPresets('[{"name":"x","stops":[{"pos":0}]}]')).toBeNull(); // stop missing rgba
    expect(parseGradientPresets('[{"stops":[{"pos":0,"r":0,"g":0,"b":0,"a":255}]}]')).toBeNull(); // missing name
  });
});
