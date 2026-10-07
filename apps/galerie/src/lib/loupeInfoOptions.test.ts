import { beforeEach, describe, expect, it } from "vitest";

import type { PhotoRow } from "../catalog/types";
import { infoRows, metadataRows } from "../ui/MetadataOverlay";
import { toggleInfoField } from "../ui/ViewOptionsDialog";
import type { PresetStorage } from "./exportPresets";
import {
  DEFAULT_LOUPE_INFO,
  LOUPE_INFO_FIELDS,
  loupeInfo,
  resetLoupeInfoCache,
  saveLoupeInfo,
} from "./loupeInfoOptions";

function memStorage(initial: Record<string, string> = {}): PresetStorage {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

const KEY = "galerie.loupeInfo";

const photo = {
  path: "/shoot/a.cr3",
  width: 6000,
  height: 4000,
  cameraMake: "Canon",
  cameraModel: "EOS R5",
  lens: "RF 50mm F1.2",
  iso: 100,
  fNumber: 2.8,
  focalLength: 50,
  exposureTime: 0.005,
  captureTime: 1700000000,
  gpsLat: null,
  gpsLon: null,
} as PhotoRow;

beforeEach(resetLoupeInfoCache);

describe("loupe info options", () => {
  it("covers exactly the labels metadataRows emits", () => {
    // Drift guard: a renamed label must fail here, not render a blank overlay row.
    expect([...LOUPE_INFO_FIELDS]).toEqual(metadataRows(photo).map(([k]) => k));
  });

  it("defaults reproduce today's Info 1 / Info 2 rows in order", () => {
    expect(infoRows(photo, 1)).toEqual([
      ["File", "a.cr3"],
      ["Captured", metadataRows(photo).find(([k]) => k === "Captured")?.[1]],
      ["Dimensions", "6000 × 4000"],
    ]);
    expect(infoRows(photo, 2)).toEqual([
      ["File", "a.cr3"],
      ["Shutter", "1/200 s"],
      ["Aperture", "f/2.8"],
      ["ISO", "ISO 100"],
      ["Lens", "RF 50mm F1.2"],
    ]);
  });

  it("honors a supplied field list, order and all, and nulls unknown labels", () => {
    expect(infoRows(photo, 1, ["ISO", "File", "Nope"])).toEqual([
      ["ISO", "ISO 100"],
      ["File", "a.cr3"],
      ["Nope", null],
    ]);
  });

  it("drops persisted keys metadataRows no longer emits, keeping the rest in order", () => {
    const s = memStorage({ [KEY]: JSON.stringify({ 1: ["ISO", "Gone", "File"] }) });
    expect(loupeInfo(s)).toEqual({ 1: ["ISO", "File"], 2: DEFAULT_LOUPE_INFO[2] });
  });

  it("falls back to defaults on corrupt storage and round-trips a save", () => {
    expect(loupeInfo(memStorage({ [KEY]: "{not json" }))).toEqual(DEFAULT_LOUPE_INFO);
    resetLoupeInfoCache();
    expect(loupeInfo(memStorage({ [KEY]: JSON.stringify({ 1: "File" }) }))).toEqual({
      1: DEFAULT_LOUPE_INFO[1],
      2: DEFAULT_LOUPE_INFO[2],
    });
    resetLoupeInfoCache();

    const s = memStorage();
    saveLoupeInfo({ 1: ["Camera"], 2: ["GPS"] }, s);
    resetLoupeInfoCache();
    expect(loupeInfo(s)).toEqual({ 1: ["Camera"], 2: ["GPS"] });
  });

  it("appends on check and removes on uncheck (never reorders the rest)", () => {
    expect(toggleInfoField(["File", "Captured"], "ISO", true)).toEqual(["File", "Captured", "ISO"]);
    expect(toggleInfoField(["File", "Captured"], "File", false)).toEqual(["Captured"]);
    expect(toggleInfoField(["File"], "File", true)).toEqual(["File"]);
  });
});
