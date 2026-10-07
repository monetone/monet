// Move handling (LR's third Import mode): the same planned copy as "copy",
// then the source is deleted — but only once the copy provably landed, so no
// failure path can leave the user without the file.

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  remove: vi.fn(),
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
import { copyFile, exists, readFile, readTextFile, remove } from "@tauri-apps/plugin-fs";

import { findDuplicate } from "./catalog/catalog";
import { importWithOptions } from "./import";
import { fingerprint } from "./lib/fingerprint";
import { planImport } from "./lib/importPlan";
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
const movePlan = {
  handling: "move" as const,
  destDir: "/dest",
  rename: false,
  template: "{name}",
  startNumber: 1,
};
const noApply = { keywords: [], metadataPreset: null };

beforeEach(() => {
  // reset, not clear: every mock's implementation is re-established right below,
  // so a per-test override (a rejecting copyFile) must not leak into the next.
  vi.resetAllMocks();
  vi.mocked(readFile).mockResolvedValue(bytes);
  vi.mocked(readTextFile).mockRejectedValue(new Error("no sidecar"));
  vi.mocked(fingerprint).mockResolvedValue("ab".repeat(32));
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(findDuplicate).mockResolvedValue(null);
  vi.mocked(decodeRawPath).mockResolvedValue({
    nativeWidth: 5920,
    nativeHeight: 3950,
    orientation: 1,
  } as Awaited<ReturnType<typeof decodeRawPath>>);
  vi.mocked(probeImageMetadata).mockResolvedValue(emptyProbe);
  vi.mocked(store.importPhotos).mockResolvedValue([1]);
  // Nothing pre-exists at the destination, and no .xmp sidecar beside anything.
  vi.mocked(exists).mockResolvedValue(false);
});

it("plans a move exactly like a copy, and never a second copy", () => {
  expect(planImport(["/card/shot.dng"], { ...movePlan, secondCopyDir: "/backup" })).toEqual([
    { src: "/card/shot.dng", dest: "/dest/shot.dng", second: null },
  ]);
});

it("copies to the destination, then deletes the source, and catalogs the destination", async () => {
  const count = await importWithOptions(["/card/shot.dng"], movePlan, noApply);

  expect(count).toBe(1);
  expect(copyFile).toHaveBeenCalledExactlyOnceWith("/card/shot.dng", "/dest/shot.dng");
  expect(remove).toHaveBeenCalledExactlyOnceWith("/card/shot.dng");
  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ path: "/dest/shot.dng" }),
  ]);
});

it("moves the .xmp sidecar too — copied across, then removed with its photo", async () => {
  // Only the sidecar beside the source exists; the destination is still free.
  vi.mocked(exists).mockImplementation(async (p) => p === "/card/shot.xmp");

  await importWithOptions(["/card/shot.dng"], movePlan, noApply);

  expect(copyFile).toHaveBeenCalledWith("/card/shot.xmp", "/dest/shot.xmp");
  expect(remove).toHaveBeenCalledWith("/card/shot.dng");
  expect(remove).toHaveBeenCalledWith("/card/shot.xmp");
});

// The whole point of copy-then-delete ordering: a destination that rejects the
// copy must leave the original exactly where it is.
it("never deletes the source when the copy fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(copyFile).mockRejectedValue(new Error("disk full"));
  vi.mocked(store.importPhotos).mockResolvedValue([]);

  const count = await importWithOptions(["/card/shot.dng"], movePlan, noApply);

  expect(count).toBe(0);
  expect(remove).not.toHaveBeenCalled();
  expect(store.notify).toHaveBeenCalledExactlyOnceWith("Imported 0 photos, skipped 1: shot.dng (copy failed)");
});

it("never deletes the source when the destination is already occupied", async () => {
  vi.mocked(exists).mockResolvedValue(true); // something already sits at /dest/shot.dng
  vi.mocked(store.importPhotos).mockResolvedValue([]);

  await importWithOptions(["/card/shot.dng"], movePlan, noApply);

  expect(copyFile).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it("still imports the photo when the source cannot be removed, and says so", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(remove).mockRejectedValue(new Error("read-only volume"));

  const count = await importWithOptions(["/card/shot.dng"], movePlan, noApply);

  expect(count).toBe(1);
  expect(store.notify).toHaveBeenCalledExactlyOnceWith(
    "Imported 1 photo, skipped 1: shot.dng (moved, original not removed)",
  );
});

it("leaves the source alone when the destination resolves back onto it", async () => {
  await importWithOptions(["/card/shot.dng"], { ...movePlan, destDir: "/card" }, noApply);

  expect(copyFile).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ path: "/card/shot.dng" }),
  ]);
});
