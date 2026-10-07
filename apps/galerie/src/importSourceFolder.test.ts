// Source-folder import (GAL-IMP-02): the Import dialog's Choose Folder… scan
// (listImportableFiles) and the drop path that now shares it. What matters is
// that a folder tree yields its photo files — recursively when asked, one
// level when not — with unreadable subdirs skipped, and that a dropped nested
// tree imports the whole tree.

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
import { readDir, readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { findDuplicate } from "./catalog/catalog";
import { decodeImage } from "./engine";
import { importDroppedPaths, isImportablePath, isRawPath, listImportableFiles } from "./import";
import { fingerprint } from "./lib/fingerprint";
import { decodeRawPath, probeImageMetadata } from "./rawDecode";
import { store } from "./state/store";

const dirEntry = (name: string, isDirectory = false) =>
  ({ name, isDirectory, isFile: !isDirectory, isSymlink: false }) as Awaited<ReturnType<typeof readDir>>[number];

/** A card-shaped tree: photos at the root, in DCIM, and in a nested subfolder,
 *  plus junk files and an unreadable directory. */
const TREE: Record<string, ReturnType<typeof dirEntry>[]> = {
  "/card": [dirEntry("DCIM", true), dirEntry("top.jpg"), dirEntry("notes.txt"), dirEntry("BAD", true)],
  "/card/DCIM": [dirEntry("b.ARW"), dirEntry("sub", true), dirEntry("thumbs.db")],
  "/card/DCIM/sub": [dirEntry("c.png")],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  vi.mocked(readTextFile).mockRejectedValue(new Error("no sidecar"));
  vi.mocked(fingerprint).mockResolvedValue("ab".repeat(32));
  vi.mocked(findDuplicate).mockResolvedValue(null);
  vi.mocked(probeImageMetadata).mockResolvedValue(null as never);
  vi.mocked(decodeImage).mockResolvedValue({ width: 100, height: 50 } as Awaited<ReturnType<typeof decodeImage>>);
  vi.mocked(decodeRawPath).mockResolvedValue({
    nativeWidth: 100,
    nativeHeight: 50,
    orientation: 1,
  } as Awaited<ReturnType<typeof decodeRawPath>>);
  vi.mocked(readDir).mockImplementation(async (path) => {
    const entries = TREE[path as string];
    if (!entries) throw new Error("not a directory");
    return entries;
  });
  vi.mocked(store.importPhotos).mockImplementation(async (records) => records.map((_, i) => i + 1));
});

it("walks the whole tree, keeps only importable extensions, skips unreadable dirs, sorts", async () => {
  expect(await listImportableFiles("/card", true)).toEqual([
    "/card/DCIM/b.ARW",
    "/card/DCIM/sub/c.png",
    "/card/top.jpg",
  ]);
});

it("lists only the folder itself when Include Subfolders is off", async () => {
  expect(await listImportableFiles("/card", false)).toEqual(["/card/top.jpg"]);
});

it("returns nothing for an unreadable folder", async () => {
  expect(await listImportableFiles("/card/BAD", true)).toEqual([]);
});

it("imports the whole tree out of a dropped nested folder", async () => {
  const count = await importDroppedPaths(["/card"]);

  expect(count).toBe(3);
  expect(store.importPhotos).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ path: "/card/DCIM/b.ARW" }),
    expect.objectContaining({ path: "/card/DCIM/sub/c.png" }),
    expect.objectContaining({ path: "/card/top.jpg" }),
  ]);
});

it("classifies paths by extension for the dialog's review grid", () => {
  expect(isImportablePath("/x/a.NEF")).toBe(true);
  expect(isImportablePath("/x/a.txt")).toBe(false);
  expect(isRawPath("/x/a.NEF")).toBe(true);
  expect(isRawPath("/x/a.jpg")).toBe(false);
});
