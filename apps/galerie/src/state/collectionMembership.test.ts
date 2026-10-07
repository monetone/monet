// collectionMembership.test — GAL-LIB-01: named collections must be reachable
// without the Target-Collection + B accelerator. Covers the drag payload
// helpers (grid/filmstrip → Collections panel) and the store's shared
// add/remove membership path (drop targets + Library menu), incl. undo.

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
import type { CollectionRow, PhotoRow } from "../catalog/types";
import { dragPayloadIds, readPhotoDrag, writePhotoDrag, PHOTO_DRAG_TYPE } from "../lib/photoDrag";
import { CatalogStore } from "./store";

function row(id: number): PhotoRow {
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
    copyName: null,
    stackId: null,
    stackOrder: 0,
    stackCount: 0,
    missing: false,
    width: 100,
    height: 100,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    iso: null,
    fNumber: null,
    exposureTime: null,
    focalLength: null,
    captureTime: null,
    title: null,
    caption: null,
    gpsLat: null,
    gpsLon: null,
    source: null,
  } as unknown as PhotoRow;
}

const portfolio: CollectionRow = {
  id: 5,
  name: "Portfolio",
  kind: "collection",
  parentId: null,
  ruleAst: null,
  sortOrder: 0,
  createdAt: 0,
};

/** Minimal DataTransfer stand-in (jsdom has no constructor for it). */
function fakeDataTransfer(): DataTransfer {
  const data: Record<string, string> = {};
  return {
    setData: (t: string, v: string) => {
      data[t] = v;
    },
    getData: (t: string) => data[t] ?? "",
    get types() {
      return Object.keys(data);
    },
    effectAllowed: "none",
  } as unknown as DataTransfer;
}

async function openedStore(): Promise<CatalogStore> {
  vi.mocked(cat.listPhotos).mockResolvedValue({ photos: [row(1), row(2), row(3)], next: null });
  vi.mocked(cat.countPhotos).mockResolvedValue(3);
  vi.mocked(cat.listCollections).mockResolvedValue([portfolio]);
  const s = new CatalogStore();
  await s.open("/c.galcat");
  return s;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("photoDrag payload", () => {
  it("drags the whole selection when the grabbed photo is part of it", () => {
    expect(dragPayloadIds([1, 2, 3], 2)).toEqual([1, 2, 3]);
  });

  it("drags just the grabbed photo when it is outside the selection", () => {
    expect(dragPayloadIds([1, 2], 9)).toEqual([9]);
  });

  it("round-trips ids through a DataTransfer", () => {
    const dt = fakeDataTransfer();
    writePhotoDrag(dt, [4, 5]);
    expect(dt.types.includes(PHOTO_DRAG_TYPE)).toBe(true);
    expect(readPhotoDrag(dt)).toEqual([4, 5]);
  });

  it("rejects foreign and malformed drops", () => {
    expect(readPhotoDrag(fakeDataTransfer())).toEqual([]); // Finder file drop etc.
    const dt = fakeDataTransfer();
    dt.setData(PHOTO_DRAG_TYPE, '{"evil":1}');
    expect(readPhotoDrag(dt)).toEqual([]);
    dt.setData(PHOTO_DRAG_TYPE, '[1,"x",2.5,3]');
    expect(readPhotoDrag(dt)).toEqual([1, 3]);
  });
});

describe("store collection membership (drop targets / Library menu)", () => {
  it("adds only non-members, toasts, and undo removes exactly what was added", async () => {
    const s = await openedStore();
    vi.mocked(cat.listCollectionPhotos).mockResolvedValue([row(2)]); // 2 already in Portfolio

    await s.addToCollection(5, [1, 2]);

    expect(vi.mocked(cat.addToCollection).mock.calls).toEqual([[5, 1]]);
    expect(s.getState().notice).toBe("Added to Portfolio (1)");
    expect(s.getState().undoLabel).toBe("Add to Portfolio");

    await s.undo();
    expect(vi.mocked(cat.removeFromCollection).mock.calls).toEqual([[5, 1]]);
  });

  it("removes only actual members and reloads when the collection is on screen", async () => {
    const s = await openedStore();
    await s.setActiveCollection(5);
    vi.mocked(cat.listCollectionPhotos)
      .mockResolvedValueOnce([row(1), row(3)]) // membership plan fetch
      .mockResolvedValueOnce([]); // grid reload after the removal

    await s.removeFromCollection(5, [1, 2, 3]);

    expect(vi.mocked(cat.removeFromCollection).mock.calls).toEqual([[5, 1], [5, 3]]);
    expect(s.getState().notice).toBe("Removed from Portfolio (2)");
    expect(s.getState().photos).toEqual([]); // active source reloaded
  });

  it("is a no-op (no toast, no undo entry) when nothing would change", async () => {
    const s = await openedStore();
    vi.mocked(cat.listCollectionPhotos).mockResolvedValue([row(1)]);

    await s.addToCollection(5, [1]);

    expect(vi.mocked(cat.addToCollection)).not.toHaveBeenCalled();
    expect(s.getState().notice).toBeNull();
    expect(s.getState().undoLabel).toBeNull();
  });
});
