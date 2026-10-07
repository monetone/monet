// importProgress.test — an import is a cancellable StatusBar job: it reports the
// real file count (a dropped folder is one path but N files), ticks per file, and
// stops on the next file when Cancel is clicked. Everything cataloged before the
// cancel stays cataloged.

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: vi.fn(),
  exists: vi.fn(async () => false),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("./catalog/catalog", () => ({
  addKeyword: vi.fn(),
  addToCollection: vi.fn(),
  findDuplicate: vi.fn(async () => null),
  getPhoto: vi.fn(),
  listSourcePaths: vi.fn(),
}));
vi.mock("./engine", () => ({ decodeImage: vi.fn(async () => ({ width: 100, height: 80 })) }));
vi.mock("./lib/fingerprint", () => ({ fingerprint: vi.fn(async () => "fp") }));
vi.mock("./lib/thumbnailLoader", () => ({ buildPreviews: vi.fn() }));
vi.mock("./rawDecode", () => ({ decodeRawPath: vi.fn(), probeImageMetadata: vi.fn() }));
vi.mock("./state/store", () => ({
  store: { importPhotos: vi.fn(), notify: vi.fn(), applyMetadataPreset: vi.fn(), applyQuickDevelop: vi.fn() },
}));

import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { importDroppedPaths, importPaths } from "./import";
import { store } from "./state/store";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  vi.mocked(store.importPhotos).mockImplementation(async (recs) => recs.map((_, i) => i + 1));
});

it("ticks once per file imported", async () => {
  const ticks: string[] = [];
  await importPaths(["/a.jpg", "/b.jpg", "/c.jpg"], {
    onTick: () => ticks.push("."),
  });
  expect(ticks).toHaveLength(3);
});

it("reports the expanded file count of a dropped folder", async () => {
  vi.mocked(readDir).mockImplementation(async (p) =>
    p === "/card"
      ? ([{ name: "1.jpg", isDirectory: false }, { name: "2.jpg", isDirectory: false }] as never)
      : Promise.reject(new Error("not a dir")),
  );
  const totals: number[] = [];
  await importDroppedPaths(["/card"], { onTotal: (n) => totals.push(n) });
  expect(totals).toEqual([2]); // one dropped path, two importable files
});

it("stops on the next file once cancelled and keeps what it already read", async () => {
  const read: string[] = [];
  let cancelled = false;
  vi.mocked(readFile).mockImplementation(async (path) => {
    read.push(String(path));
    if (read.length === 2) cancelled = true; // Cancel clicked mid-import
    return new Uint8Array([1, 2, 3, 4]);
  });

  const count = await importPaths(["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg"], {
    isCancelled: () => cancelled,
    skipDuplicates: false,
  });

  expect(read).toEqual(["/a.jpg", "/b.jpg"]);
  expect(count).toBe(2); // the two that made it are cataloged, not rolled back
});
