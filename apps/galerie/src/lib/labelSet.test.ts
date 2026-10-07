import { afterEach, describe, expect, it } from "vitest";

import type { PresetStorage } from "./exportPresets";
import {
  DEFAULT_LABEL_NAMES,
  labelName,
  labelNames,
  resetLabelNameCache,
  saveLabelNames,
} from "./labelSet";

function memStorage(initial: Record<string, string> = {}): PresetStorage {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

afterEach(() => resetLabelNameCache());

describe("color label sets", () => {
  it("defaults to the color names", () => {
    expect(labelNames(memStorage())).toEqual(DEFAULT_LABEL_NAMES);
  });

  it("saves custom names, blanks fall back, and lookups resolve", () => {
    const s = memStorage();
    const names = saveLabelNames({ red: "Review", green: "  Approved ", blue: "" }, s);
    expect(names.red).toBe("Review");
    expect(names.green).toBe("Approved"); // trimmed
    expect(names.blue).toBe("Blue"); // blank → default
    resetLabelNameCache();
    expect(labelName("red", s)).toBe("Review");
    expect(labelName("mystery", s)).toBe("mystery"); // unknown colors pass through
  });

  it("treats corrupt storage as defaults", () => {
    expect(labelNames(memStorage({ "galerie.labelSet": "{broken" }))).toEqual(DEFAULT_LABEL_NAMES);
  });
});
