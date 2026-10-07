// culling.batch.test — GAL-LIB-02: rating/flag/label keystrokes hit the WHOLE
// selection (LR: select N, press P / 3 / 6 — all N flip), collapsing into one
// undo entry. Mirrors store.test.ts's mocked catalog bridge.

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
  listPhotoKeywords: vi.fn(async () => []),
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
}));

import * as cat from "../catalog/catalog";
import { invoke } from "@tauri-apps/api/core";
import type { PhotoRow } from "../catalog/types";
import { CatalogStore, store } from "../state/store";
import { handleCullingKey } from "./culling";

function row(id: number, rating = 0, flag = 0, colorLabel: string | null = null): PhotoRow {
  return {
    id,
    sourceAssetId: id,
    path: `/p${id}.cr3`,
    readPath: `/p${id}.cr3`,
    format: "raw:CR3",
    isVirtualCopy: false,
    orientation: 1,
    rating,
    flag,
    colorLabel,
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
  };
}

const listPhotos = vi.mocked(cat.listPhotos);
const countPhotos = vi.mocked(cat.countPhotos);
const setFlags = vi.mocked(cat.setFlags);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

async function openWith(s: CatalogStore, rows: PhotoRow[]): Promise<void> {
  listPhotos.mockResolvedValueOnce({ photos: rows, next: null });
  countPhotos.mockResolvedValueOnce(rows.length);
  await s.open("/c.galcat");
}

describe("cullMany (batch cull)", () => {
  it("applies one field to every id, preserving per-photo other fields", async () => {
    const s = new CatalogStore();
    await openWith(s, [row(1, 2, 1, "red"), row(2, 0, -1, null), row(3, 5)]);

    await s.cullMany([1, 2], { rating: 3 });

    // Flag/label stay per-photo; photo 3 untouched.
    expect(setFlags.mock.calls).toEqual([
      [1, 3, 1, "red"],
      [2, 3, -1, null],
    ]);
    expect(s.getState().photos.map((p) => p.rating)).toEqual([3, 3, 5]);
  });

  it("skips no-op photos and records ONE undo entry for the batch", async () => {
    const s = new CatalogStore();
    await openWith(s, [row(1, 3), row(2, 0), row(3, 0)]);

    await s.cullMany([1, 2, 3], { rating: 3 });
    expect(setFlags).toHaveBeenCalledTimes(2); // photo 1 already rated 3
    expect(s.getState().undoLabel).toBe("Rate 3★ (2 photos)");

    setFlags.mockClear();
    await s.undo();
    expect(setFlags.mock.calls).toEqual([
      [2, 0, 0, null],
      [3, 0, 0, null],
    ]);
    expect(s.getState().photos.map((p) => p.rating)).toEqual([3, 0, 0]);
    expect(s.getState().undoLabel).toBeNull(); // the batch was a single entry
  });

  it("clears labels with an explicit null (?? must not eat it)", async () => {
    const s = new CatalogStore();
    await openWith(s, [row(1, 0, 0, "red"), row(2, 0, 0, "blue")]);

    await s.cullMany([1, 2], { colorLabel: null });
    expect(setFlags.mock.calls).toEqual([
      [1, 0, 0, null],
      [2, 0, 0, null],
    ]);
  });
});

describe("culling keystrokes hit the whole selection", () => {
  it("P flags every selected photo, not just the active one", async () => {
    await openWith(store, [row(1), row(2), row(3)]);
    store.select(1);
    store.select(2, true);

    handleCullingKey({ key: "p" });
    await vi.waitFor(() => expect(setFlags).toHaveBeenCalledTimes(2));
    expect(setFlags.mock.calls).toEqual([
      [1, 0, 1, null],
      [2, 0, 1, null],
    ]);
    const flags = Object.fromEntries(store.getState().photos.map((p) => [p.id, p.flag]));
    expect(flags).toEqual({ 1: 1, 2: 1, 3: 0 });
  });

  it("falls back to the active photo when nothing is multi-selected", async () => {
    await openWith(store, [row(1), row(2)]);
    store.setActive(2);

    handleCullingKey({ key: "6" }); // red label
    await vi.waitFor(() => expect(setFlags).toHaveBeenCalledTimes(1));
    expect(setFlags).toHaveBeenCalledWith(2, 0, 0, "red");
  });
});
