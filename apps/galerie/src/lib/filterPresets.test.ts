import { describe, expect, it } from "vitest";

import {
  BUILTIN_FILTER_PRESETS,
  NEUTRAL_FILTER,
  deleteFilterPreset,
  listFilterPresets,
  saveFilterPreset,
} from "./filterPresets";
import type { PresetStorage } from "./exportPresets";

function memStorage(initial: Record<string, string> = {}): PresetStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("filter presets", () => {
  it("ships LR's stock presets over a neutral base", () => {
    const names = BUILTIN_FILTER_PRESETS.map((p) => p.name);
    expect(names).toEqual(["Flagged", "Rated", "Unrated", "Rejected Photos"]);
    expect(BUILTIN_FILTER_PRESETS[0].snapshot).toEqual({ ...NEUTRAL_FILTER, flag: 1 });
    expect(BUILTIN_FILTER_PRESETS[2].snapshot.ratingOp).toBe("=");
  });

  it("saves, lists sorted, upserts by name, and deletes", () => {
    const s = memStorage();
    saveFilterPreset("Zebra", { ...NEUTRAL_FILTER, text: "z" }, s);
    saveFilterPreset("Alpha", { ...NEUTRAL_FILTER, minRating: 3 }, s);
    expect(listFilterPresets(s).map((p) => p.name)).toEqual(["Alpha", "Zebra"]);

    saveFilterPreset("Alpha", { ...NEUTRAL_FILTER, minRating: 5 }, s); // upsert
    expect(listFilterPresets(s).find((p) => p.name === "Alpha")!.snapshot.minRating).toBe(5);

    deleteFilterPreset("Zebra", s);
    expect(listFilterPresets(s).map((p) => p.name)).toEqual(["Alpha"]);
  });

  it("treats blank names, missing storage, and corrupt JSON as no-ops", () => {
    const s = memStorage({ "galerie.filterPresets": "{not json" });
    expect(listFilterPresets(s)).toEqual([]);
    expect(saveFilterPreset("  ", NEUTRAL_FILTER, s)).toEqual([]);
    expect(listFilterPresets(null)).toEqual([]);
  });
});
