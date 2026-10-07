// MetadataPresets.copy.test — GAL-META-04: Copy Metadata snapshots a chosen
// subset of one photo's IPTC + keywords, Paste Metadata overlays exactly that
// subset onto a whole selection, leaving uncopied fields per-photo.
// Mirrors MetadataPanel.batch.test.tsx's mocked catalog bridge.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => true),
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock("../lib/fingerprint", () => ({ fingerprint: vi.fn(async () => "fp-new") }));

// Keep the sidecar machinery inert — this test is about catalog writes only.
vi.mock("../import", () => ({ readSidecarDocument: vi.fn(async () => null) }));
vi.mock("../lib/xmpAutoWrite", () => ({
  queueXmpWrite: vi.fn(),
  recordMetadataRead: vi.fn(async () => {}),
  writeSidecarForPhoto: vi.fn(async () => {}),
  metadataStatusFor: vi.fn(async () => "unknown"),
  hierarchicalPaths: vi.fn((names: string[]) => names),
}));

vi.mock("../catalog/catalog", () => ({
  catalogAvailable: () => true,
  openCatalog: vi.fn(async () => 1),
  closeCatalog: vi.fn(async () => {}),
  importPhoto: vi.fn(async () => 1),
  createVirtualCopy: vi.fn(async () => 1),
  listPhotos: vi.fn(),
  countPhotos: vi.fn(),
  duplicatePhotos: vi.fn(async () => []),
  setFlags: vi.fn(async () => {}),
  setMetadata: vi.fn(async () => {}),
  setRecipe: vi.fn(async () => {}),
  getRecipe: vi.fn(async () => null),
  recordHistory: vi.fn(async () => {}),
  addKeyword: vi.fn(async () => 1),
  removeKeyword: vi.fn(async () => {}),
  replacePhotoKeywords: vi.fn(async () => {}),
  listPhotoKeywords: vi.fn(async () => []),
  onPhotoRecipeChanged: vi.fn(() => () => {}),
  onRecipeChanged: vi.fn(() => () => {}),
  stackPhotos: vi.fn(async () => 1),
  unstack: vi.fn(async () => {}),
  removePhotos: vi.fn(async () => [] as number[]),
  deletePhotosFromDisk: vi.fn(async () => ({ deleted: [] as number[], trashed: [] as string[], failed: [] as string[] })),
  listRejectedIds: vi.fn(async () => [] as number[]),
  setStackCover: vi.fn(async () => {}),
  listStack: vi.fn(async () => []),
  autoStack: vi.fn(async () => 0),
  listSourcePaths: vi.fn(async () => []),
  markMissing: vi.fn(async () => {}),
  relink: vi.fn(async () => {}),
  countMissing: vi.fn(async () => 0),
  recordPreview: vi.fn(async () => 1),
  findPreview: vi.fn(async () => null),
  listCollections: vi.fn(async () => []),
  createCollection: vi.fn(async () => 1),
  deleteCollection: vi.fn(async () => {}),
  renameCollection: vi.fn(async () => {}),
  addToCollection: vi.fn(async () => {}),
  removeFromCollection: vi.fn(async () => {}),
  listCollectionPhotos: vi.fn(async () => []),
  listKeywords: vi.fn(async () => []),
  listFolders: vi.fn(async () => []),
  listFilterOptions: vi.fn(async () => ({ cameras: [], lenses: [], years: [] })),
  setCaptureTime: vi.fn(async () => {}),
  setGps: vi.fn(async () => {}),
  renamePhotoFile: vi.fn(async () => ""),
  renameFolder: vi.fn(async () => 0),
  listKeywordPhotos: vi.fn(async () => []),
  deleteKeyword: vi.fn(async () => {}),
  addMetadataPreset: vi.fn(async () => 1),
  deleteMetadataPreset: vi.fn(async () => {}),
  listMetadataPresets: vi.fn(async () => []),
  findDuplicate: vi.fn(async () => null),
  getPhoto: vi.fn(async () => null),
}));

import { invoke } from "@tauri-apps/api/core";

import * as cat from "../catalog/catalog";
import type { PhotoRow } from "../catalog/types";
import { CatalogStore, store } from "../state/store";
import { copyMetadata, pasteMetadata } from "./MetadataPresets";

function row(id: number, meta: Partial<PhotoRow> = {}): PhotoRow {
  return {
    id,
    sourceAssetId: id,
    path: `/p${id}.cr3`,
    readPath: `/p${id}.cr3`,
    format: "raw:CR3",
    isVirtualCopy: false,
    orientation: 1,
    rating: 0,
    flag: 0,
    colorLabel: null,
    captureTime: id,
    addedTime: id,
    width: 100,
    height: 100,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    iso: null,
    fNumber: null,
    focalLength: null,
    exposureTime: null,
    gpsLat: null,
    gpsLon: null,
    hasRecipe: false,
    processVersion: null,
    copyName: null,
    stackId: null,
    stackOrder: null,
    stackCount: 1,
    missing: false,
    title: null,
    caption: null,
    creator: null,
    copyright: null,
    city: null,
    stateProvince: null,
    country: null,
    jobTitle: null,
    credit: null,
    source: null,
    ...meta,
  };
}

const listPhotos = vi.mocked(cat.listPhotos);
const countPhotos = vi.mocked(cat.countPhotos);
const setMetadata = vi.mocked(cat.setMetadata);
const listPhotoKeywords = vi.mocked(cat.listPhotoKeywords);
const replacePhotoKeywords = vi.mocked(cat.replacePhotoKeywords);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

async function openWith(s: CatalogStore, rows: PhotoRow[]): Promise<void> {
  listPhotos.mockResolvedValueOnce({ photos: rows, next: null });
  countPhotos.mockResolvedValueOnce(rows.length);
  await s.open("/c.galcat");
}

// The clipboard is module-level and session-scoped (LR parity: never
// persisted), so these run in order — the empty-clipboard case must come first.
describe("copyMetadata / pasteMetadata (Metadata ▸ Copy/Paste Metadata)", () => {
  it("writes nothing before anything is copied, and an empty field set copies nothing", async () => {
    await openWith(store, [row(1, { title: "A" }), row(2)]);

    await pasteMetadata([2]);
    await copyMetadata(1, new Set()); // must leave the clipboard empty
    await pasteMetadata([2]);

    expect(setMetadata).not.toHaveBeenCalled();
    expect(replacePhotoKeywords).not.toHaveBeenCalled();
  });

  it("pastes only the copied subset, keeping each target's untouched fields", async () => {
    await openWith(store, [
      row(1, { title: "src title", caption: "Beach day", creator: "Ana", city: "Nice" }),
      row(2, { title: "keep 2", caption: "old", creator: null }),
      row(3, { title: "keep 3" }),
    ]);
    listPhotoKeywords.mockResolvedValueOnce([{ id: 7, name: "beach" }]);

    await copyMetadata(1, new Set(["caption", "creator", "keywords"]));
    setMetadata.mockClear();
    await pasteMetadata([2, 3]);

    expect(setMetadata.mock.calls).toEqual([
      [2, expect.objectContaining({ title: "keep 2", caption: "Beach day", creator: "Ana", city: null })],
      [3, expect.objectContaining({ title: "keep 3", caption: "Beach day", creator: "Ana", city: null })],
    ]);
    // City wasn't copied, so photo 1's "Nice" must not leak onto the targets.
    expect(store.getState().photos.map((p) => p.city)).toEqual(["Nice", null, null]);
    expect(store.getState().photos.map((p) => p.title)).toEqual(["src title", "keep 2", "keep 3"]);
    expect(replacePhotoKeywords.mock.calls).toEqual([
      [2, ["beach"]],
      [3, ["beach"]],
    ]);
  });

  it("copies a blank source field as a clear, and leaves keywords alone when unchecked", async () => {
    await openWith(store, [row(1, { caption: null }), row(2, { caption: "had one" })]);

    await copyMetadata(1, new Set(["caption"]));
    await pasteMetadata([2]);

    expect(setMetadata.mock.calls).toEqual([[2, expect.objectContaining({ caption: null })]]);
    expect(store.getState().photos[1].caption).toBeNull();
    expect(listPhotoKeywords).not.toHaveBeenCalled();
    expect(replacePhotoKeywords).not.toHaveBeenCalled();
  });
});
