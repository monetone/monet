// Unit tests for the Brushes-panel preset helpers. Engine-free (node); the panel +
// store wiring is covered by e2e/brushes-panel.spec.ts.
import { describe, it, expect } from "vitest";
import { DEFAULT_BRUSH_PRESETS, defaultBrushPresetName, addBrushPresetTo, removeBrushPresetAt, parseBrushPresets, brushPresetNavigationIndex, type BrushPreset } from "./brushPresets";

describe("DEFAULT_BRUSH_PRESETS", () => {
  it("ships several presets, each with a name and a numeric size", () => {
    expect(DEFAULT_BRUSH_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const p of DEFAULT_BRUSH_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(typeof p.brush.size).toBe("number");
    }
  });
});

describe("defaultBrushPresetName", () => {
  it("starts at 'Brush 1' and counts one past the highest 'Brush N'", () => {
    expect(defaultBrushPresetName([])).toBe("Brush 1");
    expect(defaultBrushPresetName(["Soft Round", "Brush 1", "Brush 3"])).toBe("Brush 4");
    expect(defaultBrushPresetName(["Brush", "my Brush 2"])).toBe("Brush 1"); // non-matching ignored
  });
});

describe("addBrushPresetTo", () => {
  const base: BrushPreset[] = [{ name: "Soft Round", brush: { size: 30 } }];

  it("appends a new-named preset", () => {
    const next = addBrushPresetTo(base, { name: "Brush 1", brush: { size: 12 } });
    expect(next).not.toBe(base);
    expect(next.map((p) => p.name)).toEqual(["Soft Round", "Brush 1"]);
  });

  it("is a same-ref no-op for a duplicate name", () => {
    expect(addBrushPresetTo(base, { name: "Soft Round", brush: { size: 99 } })).toBe(base);
  });
});

describe("removeBrushPresetAt", () => {
  const base: BrushPreset[] = [{ name: "A", brush: {} }, { name: "B", brush: {} }];

  it("removes the preset at the index", () => {
    expect(removeBrushPresetAt(base, 0).map((p) => p.name)).toEqual(["B"]);
  });

  it("is a same-ref no-op out of range", () => {
    expect(removeBrushPresetAt(base, 5)).toBe(base);
    expect(removeBrushPresetAt(base, -1)).toBe(base);
  });
});

describe("brushPresetNavigationIndex", () => {
  it("enters an unselected library from the nearest directional end", () => {
    expect(brushPresetNavigationIndex(-1, 4, 1)).toBe(0);
    expect(brushPresetNavigationIndex(-1, 4, -1)).toBe(3);
  });

  it("moves one preset and clamps at both ends", () => {
    expect(brushPresetNavigationIndex(1, 4, 1)).toBe(2);
    expect(brushPresetNavigationIndex(1, 4, -1)).toBe(0);
    expect(brushPresetNavigationIndex(0, 4, -1)).toBe(0);
    expect(brushPresetNavigationIndex(3, 4, 1)).toBe(3);
  });

  it("jumps to first/last and leaves an empty library unselected", () => {
    expect(brushPresetNavigationIndex(2, 4, -1, true)).toBe(0);
    expect(brushPresetNavigationIndex(1, 4, 1, true)).toBe(3);
    expect(brushPresetNavigationIndex(-1, 0, 1)).toBe(-1);
  });
});

describe("parseBrushPresets", () => {
  it("round-trips a serialized library", () => {
    const list: BrushPreset[] = [{ name: "A", brush: { size: 12 } }, { name: "B", brush: { size: 3, hardness: 1 } }];
    expect(parseBrushPresets(JSON.stringify(list))).toEqual(list);
  });
  it("keeps an emptied library empty instead of reverting to the factory set (#133)", () => {
    expect(parseBrushPresets("[]")).toEqual([]);
  });
  it("returns null for missing, non-array or malformed payloads", () => {
    expect(parseBrushPresets(null)).toBeNull();
    expect(parseBrushPresets("")).toBeNull();
    expect(parseBrushPresets("not json")).toBeNull();     // parse error
    expect(parseBrushPresets('{"name":"x"}')).toBeNull(); // not an array
    expect(parseBrushPresets('[{"name":"x"}]')).toBeNull(); // missing brush
    expect(parseBrushPresets('[{"brush":{}}]')).toBeNull(); // missing name
  });
});
