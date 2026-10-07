import { describe, expect, it } from "vitest";

import {
  BUILT_IN_EXPORT_PRESETS,
  deleteExportPreset,
  listExportPresets,
  saveExportPreset,
  type ExportConfig,
  type ExportPreset,
  type PresetStorage,
} from "./exportPresets";

function fakeStorage(initial: Record<string, string> = {}): PresetStorage {
  const map: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => {
      map[k] = v;
    },
  };
}

const cfg = (over: Partial<ExportConfig> = {}): ExportConfig => ({
  format: "jpeg",
  profile: "srgb",
  quality: 90,
  longEdge: null,
  namingIdx: 0,
  customText: "",
  startNumber: 1,
  sharpenFor: "off",
  sharpenAmount: "standard",
  wmText: "",
  wmPos: "bottom-right",
  wmOpacity: 70,
  wmSize: 4,
  ...over,
});

/** Only what the user saved — built-ins are always in the list now. */
const userNames = (list: ExportPreset[]): string[] => list.filter((p) => !p.builtIn).map((p) => p.name);
const builtInNames = BUILT_IN_EXPORT_PRESETS.map((p) => p.name);

describe("exportPresets", () => {
  it("saves, lists alphabetically, and round-trips a config", () => {
    const s = fakeStorage();
    saveExportPreset("Web", cfg({ longEdge: 2048 }), s);
    saveExportPreset("Archive", cfg({ format: "tiff16" }), s);
    const list = listExportPresets(s);
    expect(userNames(list)).toEqual(["Archive", "Web"]);
    expect(list.map((p) => p.name)).toEqual([...list.map((p) => p.name)].sort((a, b) => a.localeCompare(b)));
    expect(list.find((p) => p.name === "Web")!.config.longEdge).toBe(2048);
    expect(list.find((p) => p.name === "Archive")!.config.format).toBe("tiff16");
  });

  it("upserts by trimmed name rather than duplicating", () => {
    const s = fakeStorage();
    saveExportPreset("Web", cfg({ quality: 60 }), s);
    const after = saveExportPreset("  Web  ", cfg({ quality: 95 }), s);
    expect(userNames(after)).toEqual(["Web"]);
    expect(after.find((p) => p.name === "Web")!.config.quality).toBe(95);
  });

  it("ignores a blank name", () => {
    const s = fakeStorage();
    expect(userNames(saveExportPreset("   ", cfg(), s))).toEqual([]);
    expect(userNames(listExportPresets(s))).toEqual([]);
  });

  it("deletes by name", () => {
    const s = fakeStorage();
    saveExportPreset("A", cfg(), s);
    saveExportPreset("B", cfg(), s);
    expect(userNames(deleteExportPreset("A", s))).toEqual(["B"]);
    expect(userNames(listExportPresets(s))).toEqual(["B"]);
  });

  it("treats corrupt storage as empty", () => {
    const s = fakeStorage({ "galerie.exportPresets": "{not json" });
    expect(userNames(listExportPresets(s))).toEqual([]);
  });

  it("no-ops safely when storage is unavailable", () => {
    expect(userNames(listExportPresets(null))).toEqual([]);
    expect(userNames(saveExportPreset("X", cfg(), null))).toEqual([]);
    expect(userNames(deleteExportPreset("X", null))).toEqual([]);
  });

  // The gap this closes: a brand-new user used to open an empty preset menu.
  describe("built-ins", () => {
    it("seeds LR's built-in presets with no storage at all", () => {
      for (const list of [listExportPresets(fakeStorage()), listExportPresets(null)]) {
        expect(list.map((p) => p.name)).toEqual([...builtInNames].sort((a, b) => a.localeCompare(b)));
        expect(list.every((p) => p.builtIn)).toBe(true);
      }
      expect(builtInNames).toContain("Burn Full-Sized JPEGs");
      expect(builtInNames).toContain("Export to DNG");
      expect(builtInNames).toContain("For Email (Hard Drive)");
    });

    it("never writes built-ins into storage", () => {
      const map: Record<string, string> = {};
      const s: PresetStorage = { getItem: (k) => map[k] ?? null, setItem: (k, v) => void (map[k] = v) };
      saveExportPreset("Mine", cfg(), s);
      expect(JSON.parse(map["galerie.exportPresets"])).toEqual([{ name: "Mine", config: cfg() }]);
    });

    it("lets a same-named user preset shadow a built-in, and delete reveal it again", () => {
      const s = fakeStorage();
      const shadowed = saveExportPreset("For Email (Hard Drive)", cfg({ quality: 11 }), s);
      const hit = shadowed.filter((p) => p.name === "For Email (Hard Drive)");
      expect(hit).toHaveLength(1);
      expect(hit[0].builtIn).toBeUndefined();
      expect(hit[0].config.quality).toBe(11);

      const restored = deleteExportPreset("For Email (Hard Drive)", s);
      expect(restored.find((p) => p.name === "For Email (Hard Drive)")!.builtIn).toBe(true);
    });

    it("cannot delete a built-in", () => {
      const s = fakeStorage();
      expect(deleteExportPreset("Export to DNG", s).map((p) => p.name)).toContain("Export to DNG");
    });

    it("ignores a builtIn flag forged in storage", () => {
      const s = fakeStorage({
        "galerie.exportPresets": JSON.stringify([{ name: "Fake", config: cfg(), builtIn: true }]),
      });
      expect(listExportPresets(s).find((p) => p.name === "Fake")!.builtIn).toBeUndefined();
    });

    it("carries an After Export action on the presets that need one", () => {
      const email = BUILT_IN_EXPORT_PRESETS.find((p) => p.name === "For Email (Hard Drive)")!;
      expect(email.config.afterExport).toBe("showInFinder");
      expect(email.config.resizeMode).toBe("widthHeight");
      expect(email.config.quality).toBeLessThan(90);
      expect(BUILT_IN_EXPORT_PRESETS.find((p) => p.name === "Export to DNG")!.config.format).toBe("linearDng16");
    });
  });
});
