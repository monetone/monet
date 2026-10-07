import { describe, expect, it } from "vitest";

import type { PresetStorage } from "./exportPresets";
import {
  autoImportDestDir,
  DEFAULT_WATCHED_FOLDER,
  loadWatchedFolder,
  saveWatchedFolder,
} from "./watchedFolder";

function memStorage(initial: Record<string, string> = {}): PresetStorage {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe("watched folder setting", () => {
  it("defaults to disabled with no path", () => {
    expect(loadWatchedFolder(memStorage())).toEqual(DEFAULT_WATCHED_FOLDER);
  });

  it("round-trips and normalizes empty paths to null", () => {
    const s = memStorage();
    const setting = {
      ...DEFAULT_WATCHED_FOLDER,
      path: "/cards/inbox",
      enabled: true,
      moveTo: "/Photos",
      subfolder: "Tethered",
      rename: true,
      template: "{name}-{sequence:3}",
      startNumber: 7,
      developPresetId: 4,
      metadataPresetId: 9,
      keywords: "studio, tethered",
      previewTier: "oneToOne" as const,
    };
    saveWatchedFolder(setting, s);
    expect(loadWatchedFolder(s)).toEqual(setting);
    saveWatchedFolder({ ...setting, path: "" }, s);
    expect(loadWatchedFolder(s).path).toBeNull();
  });

  it("treats corrupt storage as the default", () => {
    expect(loadWatchedFolder(memStorage({ "galerie.autoImport": "{oops" }))).toEqual(
      DEFAULT_WATCHED_FOLDER,
    );
  });

  // A record written by an older build has none of the destination/apply fields;
  // it must still load as a usable setting rather than an undefined-riddled one.
  it("fills in missing fields from a legacy record", () => {
    const s = memStorage({
      "galerie.autoImport": JSON.stringify({ path: "/cards/inbox", enabled: true }),
    });
    expect(loadWatchedFolder(s)).toEqual({
      ...DEFAULT_WATCHED_FOLDER,
      path: "/cards/inbox",
      enabled: true,
    });
  });

  it("rejects a garbage preview tier and a garbage start number", () => {
    const s = memStorage({
      "galerie.autoImport": JSON.stringify({ previewTier: "huge", startNumber: "many" }),
    });
    expect(loadWatchedFolder(s).previewTier).toBe(DEFAULT_WATCHED_FOLDER.previewTier);
    expect(loadWatchedFolder(s).startNumber).toBe(DEFAULT_WATCHED_FOLDER.startNumber);
  });
});

describe("autoImportDestDir", () => {
  const base = { ...DEFAULT_WATCHED_FOLDER, moveTo: "/Photos" };

  it("joins the destination and the subfolder", () => {
    expect(autoImportDestDir({ ...base, subfolder: "Tethered" })).toBe("/Photos/Tethered");
  });

  it("is the destination itself when the subfolder is blank", () => {
    expect(autoImportDestDir({ ...base, subfolder: "  " })).toBe("/Photos");
  });

  it("collapses stray slashes on both sides", () => {
    expect(autoImportDestDir({ ...base, moveTo: "/Photos/", subfolder: "/Tethered/" })).toBe(
      "/Photos/Tethered",
    );
  });

  it("is null with no destination — the files import in place", () => {
    expect(autoImportDestDir({ ...base, moveTo: null })).toBeNull();
  });
});
