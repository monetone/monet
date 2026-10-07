import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("./catalog/catalog", () => ({
  addKeyword: vi.fn(),
  addToCollection: vi.fn(),
  findDuplicate: vi.fn(),
  getPhoto: vi.fn(),
}));
vi.mock("./engine", () => ({ decodeImage: vi.fn() }));
vi.mock("./lib/fingerprint", () => ({ fingerprint: vi.fn() }));
vi.mock("./lib/thumbnailLoader", () => ({ buildPreviews: vi.fn() }));
vi.mock("./rawDecode", () => ({ decodeRawPath: vi.fn(), probeImageMetadata: vi.fn() }));
vi.mock("./state/store", () => ({
  store: {
    importPhotos: vi.fn(),
    notify: vi.fn(),
    applyMetadataPreset: vi.fn(),
    applyQuickDevelop: vi.fn(),
  },
}));

import { isTauri } from "@tauri-apps/api/core";
import { addToCollection, findDuplicate, getPhoto } from "./catalog/catalog";
import type { ImportPhoto, PhotoRow } from "./catalog/types";
import { copyFile, mkdir, readFile } from "@tauri-apps/plugin-fs";
import { decodeImage } from "./engine";
import { importPaths, importWithOptions, partitionDuplicates } from "./import";
import { fingerprint } from "./lib/fingerprint";
import { buildPreviews } from "./lib/thumbnailLoader";
import { decodeRawPath, probeImageMetadata } from "./rawDecode";
import type { ImageMetadataProbe } from "./rawDecode";
import { store } from "./state/store";

const bytes = new Uint8Array([1, 2, 3, 4]);

const emptyProbe: ImageMetadataProbe = {
  available: true,
  mtime: null,
  captureTime: null,
  cameraMake: null,
  cameraModel: null,
  lens: null,
  iso: null,
  fNumber: null,
  focalLength: null,
  exposureTime: null,
  gpsLat: null,
  gpsLon: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFile).mockResolvedValue(bytes);
  vi.mocked(fingerprint).mockResolvedValue("ab".repeat(32));
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(decodeRawPath).mockResolvedValue({
    nativeWidth: 5920,
    nativeHeight: 3950,
    orientation: 1,
  } as Awaited<ReturnType<typeof decodeRawPath>>);
  vi.mocked(probeImageMetadata).mockResolvedValue(emptyProbe);
  vi.mocked(store.importPhotos).mockResolvedValue([1]);
});

// This classification is load-bearing: `store.importPhotos` routes a record
// to the immutable managed-original transaction (`catalog_import_managed_dng`)
// only when `format === "raw:DNG"` exactly (see state/store.ts). A wrong or
// missing classification here silently downgrades a DNG to the ordinary
// mutable-path import, defeating managed preservation before the request
// ever reaches the catalog.
it("classifies a .dng import as raw:DNG so the store routes it through managed import", async () => {
  const count = await importPaths(["/photos/shot.dng"]);
  expect(count).toBe(1);
  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({
      path: "/photos/shot.dng",
      format: "raw:DNG",
      fingerprint: "ab".repeat(32),
      width: 5920,
      height: 3950,
      orientation: 1,
    }),
  ]);
});

it("classifies a .DNG (uppercase extension) import as raw:DNG the same way", async () => {
  await importPaths(["/photos/SHOT.DNG"]);
  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ path: "/photos/SHOT.DNG", format: "raw:DNG" }),
  ]);
});

it("does not classify a non-DNG RAW file as raw:DNG (no managed-import routing)", async () => {
  await importPaths(["/photos/shot.cr3"]);
  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ path: "/photos/shot.cr3", format: "raw:CR3" }),
  ]);
});

it("skips an unreadable file without aborting the rest of the batch", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(readFile)
    .mockRejectedValueOnce(new Error("permission denied"))
    .mockResolvedValueOnce(bytes);
  vi.mocked(store.importPhotos).mockResolvedValue([1]);

  await importPaths(["/photos/broken.dng", "/photos/shot.dng"]);

  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ path: "/photos/shot.dng", format: "raw:DNG" }),
  ]);
});

it("falls back to the browser decoder for a non-RAW image outside Tauri", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(decodeImage).mockResolvedValue({ width: 100, height: 50 } as Awaited<ReturnType<typeof decodeImage>>);

  await importPaths(["/photos/shot.jpg"]);

  expect(decodeRawPath).not.toHaveBeenCalled();
  expect(probeImageMetadata).not.toHaveBeenCalled();
  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ path: "/photos/shot.jpg", format: "jpg", width: 100, height: 50 }),
  ]);
});

it("stores the natively probed EXIF metadata and mtime on the import record", async () => {
  vi.mocked(probeImageMetadata).mockResolvedValue({
    available: true,
    mtime: 1700000000,
    captureTime: 1455540829,
    cameraMake: "SONY",
    cameraModel: "ILCE-7M2",
    lens: "FE 55mm F1.8 ZA",
    iso: 100,
    fNumber: 5.6,
    focalLength: 55,
    exposureTime: 0.004,
    gpsLat: 46.05,
    gpsLon: -14.51,
  });

  await importPaths(["/photos/shot.arw"]);

  expect(probeImageMetadata).toHaveBeenCalledExactlyOnceWith("/photos/shot.arw");
  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({
      mtime: 1700000000,
      captureTime: 1455540829,
      cameraMake: "SONY",
      cameraModel: "ILCE-7M2",
      lens: "FE 55mm F1.8 ZA",
      iso: 100,
      fNumber: 5.6,
      focalLength: 55,
      exposureTime: 0.004,
      gpsLat: 46.05,
      gpsLon: -14.51,
    }),
  ]);
});

it("imports with null metadata when the EXIF probe itself fails", async () => {
  vi.mocked(probeImageMetadata).mockRejectedValue(new Error("probe exploded"));

  const count = await importPaths(["/photos/shot.arw"]);

  expect(count).toBe(1);
  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ captureTime: null, cameraMake: null, mtime: 0 }),
  ]);
});

it("notifies an import summary naming the first skipped file", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(readFile)
    .mockRejectedValueOnce(new Error("permission denied"))
    .mockResolvedValueOnce(bytes);

  await importPaths(["/photos/broken.dng", "/photos/shot.dng"]);

  expect(store.notify).toHaveBeenCalledExactlyOnceWith(
    "Imported 1 photo, skipped 1: broken.dng (permission denied)",
  );
});

it("notifies a plain count when every file imports", async () => {
  vi.mocked(store.importPhotos).mockResolvedValue([1, 2]);

  await importPaths(["/photos/a.dng", "/photos/b.dng"]);

  expect(store.notify).toHaveBeenCalledExactlyOnceWith("Imported 2 photos");
});

it("collapses multiple skips into an 'and N more' suffix", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(readFile)
    .mockRejectedValueOnce(new Error("permission denied"))
    .mockRejectedValueOnce(new Error("disk error"))
    .mockRejectedValueOnce(new Error("gone"));
  vi.mocked(store.importPhotos).mockResolvedValue([]);

  await importPaths(["/photos/a.dng", "/photos/b.dng", "/photos/c.dng"]);

  expect(store.notify).toHaveBeenCalledExactlyOnceWith(
    "Imported 0 photos, skipped 3: a.dng (permission denied) and 2 more",
  );
});

// ── Suspected-duplicate partition (Lightroom's "Don't Import Suspected
// Duplicates"): content fingerprint already in the catalog at another path. ──

const record = (path: string, fp: string): ImportPhoto => ({
  path,
  fingerprint: fp,
  format: "jpg",
  byteSize: 1024,
  mtime: 100,
  width: 100,
  height: 100,
  orientation: 1,
  captureTime: null,
  cameraMake: null,
  cameraModel: null,
  lens: null,
  iso: null,
  fNumber: null,
  focalLength: null,
  exposureTime: null,
  gpsLat: null,
  gpsLon: null,
});

it("partitionDuplicates passes everything through when the skip is off", async () => {
  const records = [record("/a.jpg", "fp-a"), record("/b.jpg", "fp-b")];
  const out = await partitionDuplicates(records, false);
  expect(out.keep).toEqual(records);
  expect(out.dupes).toEqual([]);
  expect(findDuplicate).not.toHaveBeenCalled();
});

it("partitionDuplicates splits duplicates out and keeps the rest in order", async () => {
  vi.mocked(findDuplicate).mockImplementation(async (fp: string) => (fp === "fp-dupe" ? 7 : null));
  const out = await partitionDuplicates(
    [record("/new.jpg", "fp-new"), record("/card/copy.jpg", "fp-dupe"), record("/b.jpg", "fp-b")],
    true,
  );
  expect(out.keep.map((r) => r.path)).toEqual(["/new.jpg", "/b.jpg"]);
  expect(out.dupes).toEqual(["copy.jpg (suspected duplicate)"]);
  expect(findDuplicate).toHaveBeenCalledWith("fp-dupe", "/card/copy.jpg");
});

it("a duplicate-probe failure never blocks an import", async () => {
  vi.mocked(findDuplicate).mockRejectedValueOnce(new Error("db locked"));
  const out = await partitionDuplicates([record("/a.jpg", "fp-a")], true);
  expect(out.keep.map((r) => r.path)).toEqual(["/a.jpg"]);
  expect(out.dupes).toEqual([]);
});

// ── Import-time options: copy plan → disk (second copy, dated destinations)
// and the Apply During Import steps. ──

const copyPlan = { handling: "copy" as const, destDir: "/dest", rename: false, template: "{name}", startNumber: 1 };
const noApply = { keywords: [], metadataPreset: null };

it("writes the second copy of the untouched original alongside the import", async () => {
  await importWithOptions(["/card/shot.dng"], { ...copyPlan, secondCopyDir: "/backup" }, noApply);

  expect(copyFile).toHaveBeenCalledWith("/card/shot.dng", "/dest/shot.dng");
  expect(copyFile).toHaveBeenCalledWith("/card/shot.dng", "/backup/shot.dng");
  expect(mkdir).toHaveBeenCalledWith("/backup", { recursive: true });
  // Only the primary copy is cataloged — the backup is not a second photo.
  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ path: "/dest/shot.dng" }),
  ]);
});

it("a failed second copy is reported but still imports the photo", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(copyFile).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("backup disk full"));

  const count = await importWithOptions(["/card/shot.dng"], { ...copyPlan, secondCopyDir: "/backup" }, noApply);

  expect(count).toBe(1);
  expect(store.notify).toHaveBeenCalledExactlyOnceWith(
    "Imported 1 photo, skipped 1: shot.dng (second copy failed)",
  );
});

it("probes the SOURCE capture date before copying so dated destinations are right", async () => {
  // 1455540829 = 2016-02-15 (TZ-dependent; the plan's own test pins the zone).
  vi.mocked(probeImageMetadata).mockResolvedValue({ ...emptyProbe, captureTime: 1455540829 });

  await importWithOptions(["/card/shot.dng"], { ...copyPlan, organizeByDate: true }, noApply);

  expect(probeImageMetadata).toHaveBeenCalledWith("/card/shot.dng");
  const dest = vi.mocked(copyFile).mock.calls[0][1];
  expect(dest).toMatch(/^\/dest\/\d{4}\/\d{4}-\d{2}-\d{2}\/shot\.dng$/);
});

it("applies the develop preset, collection and previews to every imported photo", async () => {
  vi.mocked(store.importPhotos).mockResolvedValue([7, 8]);
  const row = { id: 7 } as PhotoRow;
  vi.mocked(getPhoto).mockResolvedValue(row);

  await importWithOptions(
    ["/photos/a.dng", "/photos/b.dng"],
    { handling: "add", destDir: null, rename: false, template: "{name}", startNumber: 1 },
    {
      keywords: [],
      metadataPreset: null,
      developPreset: { id: 3, name: "Punchy", recipeJson: "{}", processVersion: null, createdAt: 0 },
      collectionId: 42,
      buildPreviews: true,
    },
  );

  expect(store.applyQuickDevelop).toHaveBeenCalledOnce();
  expect(vi.mocked(store.applyQuickDevelop).mock.calls[0][0]).toEqual([7, 8]);
  expect(addToCollection).toHaveBeenCalledWith(42, 7);
  expect(addToCollection).toHaveBeenCalledWith(42, 8);
  expect(buildPreviews).toHaveBeenCalledExactlyOnceWith([row, row], "standard", 2560);
});

it("a corrupt develop preset recipe never aborts the import", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const count = await importWithOptions(
    ["/photos/a.dng"],
    { handling: "add", destDir: null, rename: false, template: "{name}", startNumber: 1 },
    {
      keywords: [],
      metadataPreset: null,
      developPreset: { id: 3, name: "Broken", recipeJson: "{not json", processVersion: null, createdAt: 0 },
    },
  );

  expect(count).toBe(1);
  expect(store.applyQuickDevelop).not.toHaveBeenCalled();
});
