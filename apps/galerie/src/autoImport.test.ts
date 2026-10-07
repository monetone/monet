// Auto Import parity: the watcher must route new files through the FULL import
// path — Destination (move out of the watched folder), File Naming, Apply
// During Import and Initial Previews — and it must see subfolders.

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ watch: vi.fn() }));
vi.mock("./catalog/catalog", () => ({
  listMetadataPresets: vi.fn(),
  listPresets: vi.fn(),
  listSourcePaths: vi.fn(),
}));
vi.mock("./import", () => ({
  IMPORT_EXTENSIONS: ["jpg", "dng"],
  importWithOptions: vi.fn(),
  listImportableFiles: vi.fn(),
}));

import { isTauri } from "@tauri-apps/api/core";
import { watch } from "@tauri-apps/plugin-fs";

import { autoImportPlan, restartAutoImport } from "./autoImport";
import { listMetadataPresets, listPresets, listSourcePaths } from "./catalog/catalog";
import { importWithOptions, listImportableFiles } from "./import";
import type { MetadataPresetRow, PresetRow } from "./catalog/types";
import type { PresetStorage } from "./lib/exportPresets";
import { DEFAULT_WATCHED_FOLDER, saveWatchedFolder, type WatchedFolder } from "./lib/watchedFolder";

const devPreset = { id: 4, name: "Punchy", recipeJson: "{}" } as PresetRow;
const metaPreset = { id: 9, name: "Studio" } as MetadataPresetRow;

/** The watcher reads the setting through the module-level localStorage. */
function storeSetting(setting: Partial<WatchedFolder>): void {
  const map = new Map<string, string>();
  const mem: PresetStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
  saveWatchedFolder({ ...DEFAULT_WATCHED_FOLDER, ...setting }, mem);
  vi.stubGlobal("localStorage", mem);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(listSourcePaths).mockResolvedValue([]);
  vi.mocked(listPresets).mockResolvedValue([devPreset]);
  vi.mocked(listMetadataPresets).mockResolvedValue([metaPreset]);
  vi.mocked(listImportableFiles).mockResolvedValue([]);
  vi.mocked(importWithOptions).mockResolvedValue(1);
  vi.mocked(watch).mockResolvedValue(vi.fn());
});

it("plans a MOVE into moveTo/subfolder, with the file naming", () => {
  expect(
    autoImportPlan({
      ...DEFAULT_WATCHED_FOLDER,
      moveTo: "/Photos",
      subfolder: "Tethered",
      rename: true,
      template: "{name}-{sequence}",
      startNumber: 7,
    }),
  ).toEqual({
    handling: "move",
    destDir: "/Photos/Tethered",
    rename: true,
    template: "{name}-{sequence}",
    startNumber: 7,
  });
});

it("falls back to add-in-place when no destination is configured", () => {
  expect(autoImportPlan(DEFAULT_WATCHED_FOLDER)).toMatchObject({
    handling: "add",
    destDir: null,
  });
});

it("scans the watched folder recursively and moves + applies on arrival", async () => {
  storeSetting({
    path: "/inbox",
    enabled: true,
    moveTo: "/Photos",
    subfolder: "Tethered",
    developPresetId: 4,
    metadataPresetId: 9,
    keywords: "studio, tethered",
    previewTier: "oneToOne",
  });
  vi.mocked(listImportableFiles).mockResolvedValue(["/inbox/sub/a.dng", "/inbox/b.jpg"]);

  await restartAutoImport();

  // Recursive: the audit's non-recursive readDir would have missed /inbox/sub.
  expect(listImportableFiles).toHaveBeenCalledExactlyOnceWith("/inbox", true);
  expect(importWithOptions).toHaveBeenCalledExactlyOnceWith(
    ["/inbox/b.jpg", "/inbox/sub/a.dng"], // planFolderSync sorts
    expect.objectContaining({ handling: "move", destDir: "/Photos/Tethered" }),
    {
      keywords: ["studio", "tethered"],
      metadataPreset: metaPreset,
      developPreset: devPreset,
      previewTier: "oneToOne",
    },
  );
  expect(watch).toHaveBeenCalledWith("/inbox", expect.any(Function), {
    delayMs: 1500,
    recursive: true,
  });
});

it("skips files the catalog already knows", async () => {
  storeSetting({ path: "/inbox", enabled: true });
  vi.mocked(listSourcePaths).mockResolvedValue([
    { sourceAssetId: 1, path: "/inbox/old.jpg", missing: false },
  ]);
  vi.mocked(listImportableFiles).mockResolvedValue(["/inbox/old.jpg", "/inbox/new.jpg"]);

  await restartAutoImport();

  expect(importWithOptions).toHaveBeenCalledExactlyOnceWith(
    ["/inbox/new.jpg"],
    expect.anything(),
    expect.anything(),
  );
});

// A preset deleted since the dialog was saved must degrade to "none", never
// wedge the watcher — the photos still import.
it("drops preset ids that no longer resolve", async () => {
  storeSetting({ path: "/inbox", enabled: true, developPresetId: 999, metadataPresetId: 999 });
  vi.mocked(listImportableFiles).mockResolvedValue(["/inbox/a.jpg"]);

  await restartAutoImport();

  expect(importWithOptions).toHaveBeenCalledWith(
    ["/inbox/a.jpg"],
    expect.anything(),
    expect.objectContaining({ developPreset: null, metadataPreset: null }),
  );
});

it("does nothing while disabled", async () => {
  storeSetting({ path: "/inbox", enabled: false });

  await restartAutoImport();

  expect(listImportableFiles).not.toHaveBeenCalled();
  expect(watch).not.toHaveBeenCalled();
});
