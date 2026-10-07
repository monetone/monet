import { describe, expect, it } from "vitest";

import type { PresetStorage } from "./exportPresets";
import { filterMetadataRows, loadMetadataView, saveMetadataView } from "./metadataViews";

function memStorage(initial: Record<string, string> = {}): PresetStorage {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

const ROWS: [string, string | null][] = [
  ["File", "a.cr3"],
  ["Dimensions", "6000 × 4000"],
  ["ISO", "100"],
  ["GPS", null],
];

describe("metadata views", () => {
  it("All passes rows through; named views filter by label", () => {
    expect(filterMetadataRows(ROWS, "All")).toEqual(ROWS);
    expect(filterMetadataRows(ROWS, "Minimal").map(([k]) => k)).toEqual(["File"]);
    expect(filterMetadataRows(ROWS, "EXIF").map(([k]) => k)).toEqual(["Dimensions", "ISO"]);
    expect(filterMetadataRows(ROWS, "Location").map(([k]) => k)).toEqual(["File", "GPS"]);
  });

  it("persists the choice and treats unknown/corrupt values as All", () => {
    const s = memStorage();
    saveMetadataView("EXIF", s);
    expect(loadMetadataView(s)).toBe("EXIF");
    expect(loadMetadataView(memStorage({ "galerie.metadataView": "Bogus" }))).toBe("All");
    expect(loadMetadataView(memStorage())).toBe("All");
  });
});
