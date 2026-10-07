import { describe, expect, it } from "vitest";

import type { PresetStorage } from "./exportPresets";
import {
  DEFAULT_IMPORT_CONFIG,
  deleteImportPreset,
  importConfigFrom,
  listImportPresets,
  saveImportPreset,
  type ImportConfig,
} from "./importPresets";

function fakeStorage(initial: Record<string, string> = {}): PresetStorage {
  const map: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => {
      map[k] = v;
    },
  };
}

const cfg = (over: Partial<ImportConfig> = {}): ImportConfig => ({ ...DEFAULT_IMPORT_CONFIG, ...over });

describe("importPresets", () => {
  it("saves, lists alphabetically, and round-trips a config", () => {
    const s = fakeStorage();
    saveImportPreset("Card copy", cfg({ handling: "copy", destDir: "/Photos", organizeByDate: true }), s);
    saveImportPreset("Add in place", cfg({ keywords: "travel, italy" }), s);
    const list = listImportPresets(s);
    expect(list.map((p) => p.name)).toEqual(["Add in place", "Card copy"]);
    expect(list[1].config).toEqual(
      cfg({ handling: "copy", destDir: "/Photos", organizeByDate: true }),
    );
    expect(list[0].config.keywords).toBe("travel, italy");
  });

  it("upserts by trimmed name rather than duplicating", () => {
    const s = fakeStorage();
    saveImportPreset("Card", cfg({ startNumber: 1 }), s);
    const after = saveImportPreset("  Card  ", cfg({ startNumber: 500 }), s);
    expect(after).toHaveLength(1);
    expect(after[0].config.startNumber).toBe(500);
  });

  it("ignores a blank name", () => {
    const s = fakeStorage();
    expect(saveImportPreset("   ", cfg(), s)).toEqual([]);
    expect(listImportPresets(s)).toEqual([]);
  });

  it("deletes by name", () => {
    const s = fakeStorage();
    saveImportPreset("A", cfg(), s);
    saveImportPreset("B", cfg(), s);
    expect(deleteImportPreset("A", s).map((p) => p.name)).toEqual(["B"]);
    expect(listImportPresets(s).map((p) => p.name)).toEqual(["B"]);
  });

  it("treats corrupt storage as empty", () => {
    expect(listImportPresets(fakeStorage({ "galerie.importPresets": "{not json" }))).toEqual([]);
    expect(listImportPresets(fakeStorage({ "galerie.importPresets": '{"not":"an array"}' }))).toEqual([]);
  });

  // A preset written before an option existed must still restore — a missing
  // field would otherwise feed `undefined` into a controlled dialog input.
  it("fills an older preset's missing fields with defaults", () => {
    const s = fakeStorage({
      "galerie.importPresets": JSON.stringify([
        { name: "Legacy", config: { handling: "copy", destDir: "/old", rename: true, template: "{name}", startNumber: 1, skipDupes: true, keywords: "" } },
      ]),
    });
    const [preset] = listImportPresets(s);
    expect(preset.config).toEqual(
      cfg({ handling: "copy", destDir: "/old", rename: true, skipDupes: true }),
    );
    expect(preset.config.organizeByDate).toBe(false);
    expect(preset.config.secondCopyDir).toBeNull();
    expect(preset.config.collectionId).toBeNull();
  });

  it("importConfigFrom defaults a missing config entirely", () => {
    expect(importConfigFrom(null)).toEqual(DEFAULT_IMPORT_CONFIG);
  });

  it("no-ops safely when storage is unavailable", () => {
    expect(listImportPresets(null)).toEqual([]);
    expect(saveImportPreset("X", cfg(), null)).toEqual([]);
    expect(deleteImportPreset("X", null)).toEqual([]);
  });
});
