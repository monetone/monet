// Export ▸ Metadata, keyword side: the packet an export embeds honors LR's
// per-keyword export flags (Include On Export / Export Containing Keywords /
// Export Synonyms, applied by exportKeywords) and the "Write Keywords as
// Lightroom Hierarchy" toggle. The native (tiff16) route is used throughout:
// it needs no engine, and its finish pass builds the same packet the JPEG/PNG
// route embeds.

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => false),
  mkdir: vi.fn(),
  // The part-file the finish pass reads back: the smallest legal little-endian
  // TIFF (header + an empty IFD), which is all insertXmpTiff needs to patch.
  readFile: vi.fn(async () => new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
  remove: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
vi.mock("./catalog/catalog", () => ({
  getDevelopExportIdentity: vi.fn(),
  getRecipe: vi.fn(),
  listPhotoKeywords: vi.fn(async () => []),
  listKeywords: vi.fn(async () => []),
  onRecipeChanged: vi.fn(() => () => {}),
  catalogAvailable: () => true,
}));
vi.mock("./import", () => ({ importPathsWithIds: vi.fn(async () => [42]) }));
vi.mock("./lib/xmpSidecar", () => ({ buildXmpSidecar: vi.fn(() => "<x:xmpmeta/>") }));

import { invoke } from "@tauri-apps/api/core";

import { listKeywords, listPhotoKeywords, getDevelopExportIdentity } from "./catalog/catalog";
import type { PhotoRow } from "./catalog/types";
import type { KeywordVocabRow } from "./lib/xmpAutoWrite";
import { buildXmpSidecar } from "./lib/xmpSidecar";
import { runExport, type ExportOptions } from "./export";

const photo = {
  id: 7,
  sourceAssetId: 3,
  path: "/photos/selected.cr3",
  format: "raw:CR3",
  copyName: null,
  rating: 0,
} as PhotoRow;

const opts: ExportOptions = { format: "tiff16", quality: 1, longEdge: null, profile: "srgb" };

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

/** "dog" under "animal", plus a work-in-progress branch kept out of exports. */
const vocab: KeywordVocabRow[] = [
  { id: 1, name: "animal", parentId: null, synonyms: "", includeOnExport: true, exportContaining: true, exportSynonyms: true },
  { id: 2, name: "dog", parentId: 1, synonyms: "puppy", includeOnExport: true, exportContaining: true, exportSynonyms: true },
  { id: 3, name: "wip", parentId: null, synonyms: "", includeOnExport: false, exportContaining: true, exportSynonyms: true },
];

/** The metadata the export handed to the sidecar builder. */
const writtenMeta = () => vi.mocked(buildXmpSidecar).mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDevelopExportIdentity).mockResolvedValue({
    catalogId: "/catalogs/current.galcat",
    photo,
    sourceDigest: "ab".repeat(32),
    canonicalRecipeJson: '{"processVersion":6}',
  });
  vi.mocked(invoke).mockResolvedValue(nativeResult);
  vi.mocked(listPhotoKeywords).mockResolvedValue([
    { id: 2, name: "dog" },
    { id: 3, name: "wip" },
  ]);
  vi.mocked(listKeywords).mockResolvedValue(vocab as never);
});

it("applies the per-keyword export flags to the embedded packet", async () => {
  await runExport([photo], "/exports", opts);
  // "wip" is Include On Export = off, "animal" rides in as a containing
  // keyword, "puppy" as a synonym.
  expect(writtenMeta().keywords).toEqual(["dog", "puppy", "animal"]);
  expect(writtenMeta().hierarchical).toEqual(["animal|dog"]);
});

it("writes dc:subject only when Write Keywords as Lightroom Hierarchy is off", async () => {
  await runExport([photo], "/exports", { ...opts, writeKeywordHierarchy: false });
  expect(writtenMeta().keywords).toEqual(["dog", "puppy", "animal"]);
  expect(writtenMeta().hierarchical).toEqual([]);
});

it("writes the hierarchy by default, matching LR's checked-by-default box", async () => {
  await runExport([photo], "/exports", { ...opts, writeKeywordHierarchy: true });
  expect(writtenMeta().hierarchical).toEqual(["animal|dog"]);
});

it("skips the vocabulary lookup when the scope carries no keywords", async () => {
  await runExport([photo], "/exports", { ...opts, metadata: { include: "copyright", removeLocation: false } });
  expect(listKeywords).not.toHaveBeenCalled();
  expect(listPhotoKeywords).not.toHaveBeenCalled();
});
