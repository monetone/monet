import { afterEach, describe, expect, it } from "vitest";

import type { PresetStorage } from "./exportPresets";
import {
  DEFAULT_GRID_VIEW_OPTIONS,
  gridViewOptions,
  resetGridViewOptionsCache,
  saveGridViewOptions,
} from "./gridViewOptions";

function memStorage(initial: Record<string, string> = {}): PresetStorage {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

afterEach(() => resetGridViewOptionsCache());

describe("grid view options", () => {
  it("defaults to everything on", () => {
    expect(gridViewOptions(memStorage())).toEqual(DEFAULT_GRID_VIEW_OPTIONS);
  });

  it("round-trips toggles and fills gaps with defaults", () => {
    const s = memStorage();
    saveGridViewOptions({ ...DEFAULT_GRID_VIEW_OPTIONS, ratings: false, filename: false }, s);
    resetGridViewOptionsCache();
    const opts = gridViewOptions(s);
    expect(opts.ratings).toBe(false);
    expect(opts.filename).toBe(false);
    expect(opts.flags).toBe(true);

    // Partial/foreign stored values only override known boolean keys.
    resetGridViewOptionsCache();
    expect(
      gridViewOptions(memStorage({ "galerie.gridViewOptions": '{"labels":false,"junk":1}' })).labels,
    ).toBe(false);
  });

  it("treats corrupt storage as defaults", () => {
    expect(gridViewOptions(memStorage({ "galerie.gridViewOptions": "{broken" }))).toEqual(
      DEFAULT_GRID_VIEW_OPTIONS,
    );
  });
});
