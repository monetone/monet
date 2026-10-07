// Export Location — LR's destination + "Put in Subfolder" + Existing Files.
// The native (tiff16) route is used throughout: it needs no engine, and the
// destination it is handed is the same path the JPEG/PNG route writes.

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => false),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
vi.mock("./catalog/catalog", () => ({
  getDevelopExportIdentity: vi.fn(),
  getRecipe: vi.fn(),
  listPhotoKeywords: vi.fn(async () => []),
  onRecipeChanged: vi.fn(() => () => {}),
  stackPhotos: vi.fn(async () => 1),
  catalogAvailable: () => true,
}));
vi.mock("./import", () => ({ importPathsWithIds: vi.fn(async () => [42]) }));

import { invoke } from "@tauri-apps/api/core";
import { exists, mkdir } from "@tauri-apps/plugin-fs";

import { getDevelopExportIdentity, stackPhotos } from "./catalog/catalog";
import type { PhotoRow } from "./catalog/types";
import { importPathsWithIds } from "./import";
import { runExport, type ExportLocation } from "./export";

const photo = {
  id: 7,
  sourceAssetId: 3,
  path: "/photos/selected.cr3",
  format: "raw:CR3",
  copyName: null,
} as PhotoRow;

const opts = { format: "tiff16" as const, quality: 1, longEdge: null, profile: "srgb" as const };

const nativeResult = {
  jobId: "job-1",
  sourceDigest: "ab".repeat(32),
  recipeDigest: "cd".repeat(32),
  output: {
    width: 100, height: 50, bitsPerSample: 16, samplesPerPixel: 3, orientation: 1,
    profile: "srgb", intent: "relativeColorimetric", blackPointCompensation: false,
    iccDigest: "ef".repeat(32), outputDigest: "12".repeat(32), bytes: 1234,
  },
  provenance: {},
  timings: [{ stage: "finalize", milliseconds: 1 }],
  state: "completed",
  durabilityError: null,
};

/** The output path the batch actually targeted. */
const targetPath = (): string =>
  (vi.mocked(invoke).mock.calls[0][1] as { request: { output: { path: string } } }).request.output.path;

/** `taken` already exists on disk; nothing else does. */
function onDisk(...taken: string[]) {
  vi.mocked(exists).mockImplementation(async (p) => taken.includes(String(p)));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDevelopExportIdentity).mockResolvedValue({
    catalogId: "/catalogs/current.galcat",
    photo,
    sourceDigest: "ab".repeat(32),
    canonicalRecipeJson: '{"processVersion":6}',
  });
  vi.mocked(invoke).mockResolvedValue(nativeResult);
  vi.mocked(exists).mockImplementation(async () => false);
});

const run = (loc: string | ExportLocation) => runExport([photo], loc, opts);

it("a free destination keeps the plain name", async () => {
  await expect(run("/exports")).resolves.toMatchObject({ written: 1 });
  expect(targetPath()).toBe("/exports/selected.tiff");
});

it("never overwrites an existing file when nobody answers the prompt", async () => {
  onDisk("/exports/selected.tiff");
  await expect(run("/exports")).resolves.toMatchObject({ written: 1, failed: 0 });
  expect(targetPath()).toBe("/exports/selected-2.tiff");
});

it("renames past every taken suffix", async () => {
  onDisk("/exports/selected.tiff", "/exports/selected-2.tiff", "/exports/selected-3.tiff");
  await run("/exports");
  expect(targetPath()).toBe("/exports/selected-4.tiff");
});

it("asks the resolver, and overwrite means the original path", async () => {
  onDisk("/exports/selected.tiff");
  const onExisting = vi.fn(async () => "overwrite" as const);
  await run({ dir: "/exports", onExisting });
  expect(onExisting).toHaveBeenCalledWith("/exports/selected.tiff");
  expect(targetPath()).toBe("/exports/selected.tiff");
});

it("skip leaves the file alone and counts it", async () => {
  onDisk("/exports/selected.tiff");
  await expect(run({ dir: "/exports", existingFiles: "skip" })).resolves.toEqual({
    written: 0, committed: 0, failed: 0, skipped: 1, durabilityWarnings: [], failureMessages: [],
  });
  expect(invoke).not.toHaveBeenCalled();
});

it("rename is available without a prompt", async () => {
  onDisk("/exports/selected.tiff");
  await run({ dir: "/exports", existingFiles: "rename" });
  expect(targetPath()).toBe("/exports/selected-2.tiff");
});

it("puts the export in a subfolder, creating it", async () => {
  await run({ dir: "/exports", subfolder: " Web " });
  expect(mkdir).toHaveBeenCalledWith("/exports/Web", { recursive: true });
  expect(targetPath()).toBe("/exports/Web/selected.tiff");
});

it.each(["../escape", "a/b", "a\\b", ".."])("refuses the traversing subfolder %s", async (sub) => {
  await expect(run({ dir: "/exports", subfolder: sub })).rejects.toThrow("invalid export subfolder");
  expect(mkdir).not.toHaveBeenCalled();
});

it("adds the exported file to the catalog and stacks it with its source", async () => {
  await run({ dir: "/exports", addToCatalog: true, addToStack: true });
  expect(importPathsWithIds).toHaveBeenCalledWith(["/exports/selected.tiff"], { skipDuplicates: false });
  expect(stackPhotos).toHaveBeenCalledWith([photo.id, 42]);
});

it("leaves the catalog alone unless asked", async () => {
  await run("/exports");
  expect(importPathsWithIds).not.toHaveBeenCalled();
});

it("reports a failed re-import without losing the written export", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(importPathsWithIds).mockRejectedValueOnce(new Error("catalog closed"));
  await expect(run({ dir: "/exports", addToCatalog: true })).resolves.toMatchObject({
    written: 1,
    failed: 0,
    failureMessages: ["add to catalog: Error: catalog closed"],
  });
});
