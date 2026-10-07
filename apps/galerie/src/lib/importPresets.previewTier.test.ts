// Import presets carry LR's Build Previews ladder, not just the old on/off
// boolean: a tier survives save→list, and a preset written before the ladder
// existed (boolean only) still opens on a sensible tier.

import { describe, expect, it } from "vitest";

import type { PresetStorage } from "./exportPresets";
import {
  DEFAULT_IMPORT_CONFIG,
  importConfigFrom,
  listImportPresets,
  saveImportPreset,
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

describe("import preset preview tier", () => {
  it("defaults to building nothing", () => {
    expect(DEFAULT_IMPORT_CONFIG.previewTier).toBe("none");
    expect(DEFAULT_IMPORT_CONFIG.buildPreviews).toBe(false);
  });

  it("round-trips a tier the boolean cannot express", () => {
    const s = fakeStorage();
    saveImportPreset("Card ingest", { ...DEFAULT_IMPORT_CONFIG, previewTier: "oneToOne" }, s);
    const [restored] = listImportPresets(s);
    expect(restored.config.previewTier).toBe("oneToOne");
    // The legacy mirror only ever means "standard", so a 1:1 preset clears it.
    expect(restored.config.buildPreviews).toBe(false);
  });

  it("maps a pre-ladder boolean onto the tier", () => {
    expect(importConfigFrom({ buildPreviews: true }).previewTier).toBe("standard");
    expect(importConfigFrom({ buildPreviews: false }).previewTier).toBe("none");
  });

  it("keeps the mirror in sync with an explicitly stored tier", () => {
    expect(importConfigFrom({ previewTier: "standard", buildPreviews: false }).buildPreviews).toBe(true);
    expect(importConfigFrom({ previewTier: "minimal", buildPreviews: true }).buildPreviews).toBe(false);
  });
});
