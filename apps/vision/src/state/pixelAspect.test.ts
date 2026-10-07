import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIXEL_ASPECT_PRESETS,
  MAX_PIXEL_ASPECT_PRESETS,
  defaultPixelAspectPresetName,
  deletePixelAspectPreset,
  normalizePixelAspectPresets,
  normalizePixelAspectRatio,
  resetPixelAspectPresets,
  savePixelAspectPreset,
} from "./pixelAspect";

describe("pixel aspect presets", () => {
  it("normalizes ratios and rejects malformed preset rows", () => {
    expect(normalizePixelAspectRatio(0)).toBe(0.1);
    expect(normalizePixelAspectRatio(99)).toBe(10);
    expect(normalizePixelAspectPresets([{ name: " Film ", ratio: 1.2 }, { name: "film", ratio: 2 }, null]))
      .toEqual([{ name: "Film", ratio: 1.2, builtin: false }]);
  });

  it("saves by unique name and deletes built-in or custom rows", () => {
    const saved = savePixelAspectPreset(DEFAULT_PIXEL_ASPECT_PRESETS, "Cinema", 1.25);
    expect(saved.at(-1)).toEqual({ name: "Cinema", ratio: 1.25, builtin: false });
    expect(savePixelAspectPreset(saved, "cinema", 1.3).filter((p) => p.name.toLowerCase() === "cinema"))
      .toEqual([{ name: "cinema", ratio: 1.3, builtin: false }]);
    expect(deletePixelAspectPreset(saved, "Square").some((p) => p.name === "Square")).toBe(false);
  });

  it("a full library refuses a new preset instead of dropping the head (#155)", () => {
    // The old tail-slice kept the LAST 64 rows, so a 65th save silently destroyed
    // index 0 — the built-in "Square", the neutral 1:1 entry.
    const full = normalizePixelAspectPresets([
      ...DEFAULT_PIXEL_ASPECT_PRESETS,
      ...Array.from({ length: MAX_PIXEL_ASPECT_PRESETS - DEFAULT_PIXEL_ASPECT_PRESETS.length },
        (_, i) => ({ name: `P${i}`, ratio: 1.5, builtin: false })),
    ]);
    expect(full).toHaveLength(MAX_PIXEL_ASPECT_PRESETS);
    const after = savePixelAspectPreset(full, "One More", 1.7);
    expect(after).toEqual(full); // unchanged — nothing added, nothing lost
    expect(after.some((p) => p.name === "Square")).toBe(true);
    expect(after.some((p) => p.name === "One More")).toBe(false);
    // renaming/re-saving an EXISTING entry still works at capacity (the filter frees a slot)
    const updated = savePixelAspectPreset(full, "P0", 2.5);
    expect(updated).toHaveLength(MAX_PIXEL_ASPECT_PRESETS);
    expect(updated.at(-1)).toEqual({ name: "P0", ratio: 2.5, builtin: false });
    expect(updated[0]).toEqual(full[0]);
  });

  it("reset replaces the catalog or appends missing defaults without losing customs", () => {
    const customOnly = [{ name: "Cinema", ratio: 1.25, builtin: false }];
    expect(resetPixelAspectPresets(customOnly, false)).toEqual(DEFAULT_PIXEL_ASPECT_PRESETS);
    const appended = resetPixelAspectPresets(customOnly, true);
    expect(appended.some((p) => p.name === "Square")).toBe(true);
    expect(appended[0]).toEqual(customOnly[0]);
  });

  it("generates the first free custom name", () => {
    expect(defaultPixelAspectPresetName([])).toBe("Custom");
    expect(defaultPixelAspectPresetName([{ name: "Custom", ratio: 1, builtin: false }])).toBe("Custom 2");
  });
});
