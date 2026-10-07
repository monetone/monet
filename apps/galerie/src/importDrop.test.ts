// Drag-and-drop import (importDroppedPaths): the sink useFileDrop calls in
// App. What matters is what reaches the catalog — only photo files, folders
// expanded — and that a drop carrying nothing importable says so instead of
// looking like a no-op.

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
  listSourcePaths: vi.fn(),
}));
vi.mock("./engine", () => ({ decodeImage: vi.fn() }));
vi.mock("./lib/fingerprint", () => ({ fingerprint: vi.fn() }));
vi.mock("./lib/thumbnailLoader", () => ({ buildPreviews: vi.fn() }));
vi.mock("./rawDecode", () => ({ decodeRawPath: vi.fn(), probeImageMetadata: vi.fn() }));
vi.mock("./state/store", () => ({
  store: { importPhotos: vi.fn(), notify: vi.fn(), applyMetadataPreset: vi.fn(), applyQuickDevelop: vi.fn() },
}));

import { isTauri } from "@tauri-apps/api/core";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { findDuplicate } from "./catalog/catalog";
import { decodeImage } from "./engine";
import { importDroppedPaths } from "./import";
import { fingerprint } from "./lib/fingerprint";
import { decodeRawPath, probeImageMetadata } from "./rawDecode";
import { store } from "./state/store";

const bytes = new Uint8Array([1, 2, 3, 4]);

const dirEntry = (name: string, isDirectory = false) =>
  ({ name, isDirectory, isFile: !isDirectory, isSymlink: false }) as Awaited<ReturnType<typeof readDir>>[number];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(readFile).mockResolvedValue(bytes);
  vi.mocked(fingerprint).mockResolvedValue("ab".repeat(32));
  vi.mocked(findDuplicate).mockResolvedValue(null);
  vi.mocked(probeImageMetadata).mockResolvedValue(null as never);
  vi.mocked(decodeImage).mockResolvedValue({ width: 100, height: 50 } as Awaited<ReturnType<typeof decodeImage>>);
  vi.mocked(decodeRawPath).mockResolvedValue({
    nativeWidth: 100,
    nativeHeight: 50,
    orientation: 1,
  } as Awaited<ReturnType<typeof decodeRawPath>>);
  // Default: every dropped path is a plain file (readDir refuses non-directories).
  vi.mocked(readDir).mockRejectedValue(new Error("not a directory"));
  vi.mocked(store.importPhotos).mockImplementation(async (records) => records.map((_, i) => i + 1));
});

it("imports the photos out of a drop and ignores non-photo files", async () => {
  const count = await importDroppedPaths(["/drop/shot.dng", "/drop/notes.txt", "/drop/scan.JPG"]);

  expect(count).toBe(2);
  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ path: "/drop/shot.dng" }),
    expect.objectContaining({ path: "/drop/scan.JPG" }),
  ]);
});

it("expands a dropped folder into its photo files", async () => {
  vi.mocked(readDir).mockImplementation(async (path) => {
    if (path !== "/drop/card") throw new Error("not a directory");
    return [dirEntry("a.arw"), dirEntry("readme.txt"), dirEntry("sub", true)];
  });

  await importDroppedPaths(["/drop/card"]);

  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ path: "/drop/card/a.arw" }),
  ]);
});

it("reports a drop with nothing importable instead of failing silently", async () => {
  const count = await importDroppedPaths(["/drop/notes.txt"]);

  expect(count).toBe(0);
  expect(store.importPhotos).not.toHaveBeenCalled();
  expect(store.notify).toHaveBeenCalledExactlyOnceWith(
    "Nothing to import — drop photos or a folder of photos.",
  );
});
