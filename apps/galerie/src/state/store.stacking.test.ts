// store.stacking.test — the stack-curation ops (Move to Top of Stack, Split
// Stack, Move Up/Down in Stack, Expand/Collapse All Stacks) against a mocked
// catalog bridge. The SQL semantics themselves are covered by the Rust unit
// tests (src-tauri/src/catalog.rs); here we prove the store targets the right
// photo, refuses invalid targets, and threads the expand-all flag into queries.

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
  splitStack: vi.fn(async () => {}),
  moveInStack: vi.fn(async () => {}),
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
import type { PhotoRow } from "../catalog/types";
import { CatalogStore } from "./store";

function row(id: number, extra: Partial<PhotoRow> = {}): PhotoRow {
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
    ...extra,
  };
}

const listPhotos = vi.mocked(cat.listPhotos);
const countPhotos = vi.mocked(cat.countPhotos);

/** Open a store over a fixed photo buffer (mocks stay live for reloads). */
async function openStore(photos: PhotoRow[]): Promise<CatalogStore> {
  listPhotos.mockResolvedValue({ photos, next: null });
  countPhotos.mockResolvedValue(photos.length);
  const s = new CatalogStore();
  await s.open("/c.galcat");
  return s;
}

// A 3-photo stack: 1 is the cover, 2 and 3 sit below it.
const stacked = () => [
  row(1, { stackId: 5, stackOrder: 0, stackCount: 3 }),
  row(2, { stackId: 5, stackOrder: 1, stackCount: 3 }),
  row(3, { stackId: 5, stackOrder: 2, stackCount: 3 }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stack curation", () => {
  it("Expand/Collapse All Stacks threads expandStacks into list + count", async () => {
    const s = await openStore(stacked());
    listPhotos.mockClear();
    countPhotos.mockClear();

    await s.setStacksExpanded(true);
    expect(s.getState().stacksExpanded).toBe(true);
    expect(listPhotos).toHaveBeenCalledWith(
      expect.any(Number), null, expect.objectContaining({ expandStacks: true }), expect.anything(),
    );
    expect(countPhotos).toHaveBeenCalledWith(expect.objectContaining({ expandStacks: true }));

    await s.setStacksExpanded(false);
    expect(listPhotos).toHaveBeenLastCalledWith(
      expect.any(Number), null, expect.objectContaining({ expandStacks: false }), expect.anything(),
    );
  });

  it("Move to Top of Stack targets the active photo; refuses unstacked", async () => {
    const s = await openStore([...stacked(), row(9)]);
    s.select(2);
    await s.setStackCoverActive();
    expect(cat.setStackCover).toHaveBeenCalledWith(2);

    s.select(9); // not in any stack
    await s.setStackCoverActive();
    expect(cat.setStackCover).toHaveBeenCalledTimes(1);
  });

  it("Move Up/Down in Stack forwards the delta for the active photo", async () => {
    const s = await openStore(stacked());
    s.select(2);
    await s.moveInStackActive(-1);
    await s.moveInStackActive(1);
    expect(vi.mocked(cat.moveInStack).mock.calls).toEqual([[2, -1], [2, 1]]);
  });

  it("Split Stack refuses the cover and splits below it", async () => {
    const s = await openStore(stacked());
    s.select(1); // the cover — nothing above it to split from
    await s.splitStackActive();
    expect(cat.splitStack).not.toHaveBeenCalled();

    s.select(3);
    await s.splitStackActive();
    expect(cat.splitStack).toHaveBeenCalledWith(3);
  });

  it("exits the expanded stack view when a split dissolves the stack", async () => {
    const members = [
      row(1, { stackId: 5, stackOrder: 0, stackCount: 2 }),
      row(2, { stackId: 5, stackOrder: 1, stackCount: 2 }),
    ];
    const s = await openStore(members);
    vi.mocked(cat.listStack).mockResolvedValueOnce(members);
    await s.expandStack(5);
    expect(s.getState().expandedStackId).toBe(5);

    s.select(2);
    // Splitting a 2-stack dissolves both halves — the expanded source is empty.
    vi.mocked(cat.listStack).mockResolvedValueOnce([]);
    await s.splitStackActive();
    expect(s.getState().expandedStackId).toBe(null);
  });
});
