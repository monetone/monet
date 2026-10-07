// store.loadUntil.test — random access into a large catalog: the grid sizes its
// scroll area by the catalog total, so a scrollbar jump asks the store for an
// index far past the loaded prefix. loadUntil must fetch the whole gap in ONE
// keyset call (limit rounded up to PAGE_SIZE), and loadMore must stay a plain
// one-page append on top of it.

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
  listPhotos: vi.fn(),
  countPhotos: vi.fn(),
  duplicatePhotos: vi.fn(async () => []),
  listCollections: vi.fn(async () => []),
  listCollectionPhotos: vi.fn(async () => []),
  listKeywords: vi.fn(async () => []),
  listKeywordPhotos: vi.fn(async () => []),
  listFolders: vi.fn(async () => []),
  listFilterOptions: vi.fn(async () => ({ cameras: [], lenses: [], years: [] })),
  countMissing: vi.fn(async () => 0),
  listSourcePaths: vi.fn(async () => []),
  listStack: vi.fn(async () => []),
}));

import * as cat from "../catalog/catalog";
import type { PhotoRow } from "../catalog/types";
import { CatalogStore, PAGE_SIZE } from "./store";

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

/** Open a store on page 1 = [1, 2] with a live cursor and a 1000-photo total. */
async function openStore(): Promise<CatalogStore> {
  listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2)], next: { sortTime: 2, id: 2 } });
  countPhotos.mockResolvedValueOnce(1000);
  const s = new CatalogStore();
  await s.open("/c.galcat");
  return s;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadUntil", () => {
  it("fetches a far jump's whole gap in one call, limit rounded up to PAGE_SIZE", async () => {
    const s = await openStore();

    // Grid jumped to index 449: gap = 450 - 2 loaded = 448 → one 600-row call.
    listPhotos.mockResolvedValueOnce({
      photos: Array.from({ length: 600 }, (_, i) => row(3 + i)),
      next: { sortTime: 602, id: 602 },
    });
    await s.loadUntil(449);

    expect(listPhotos).toHaveBeenCalledTimes(2); // open + one gap fetch
    const [limit, cursor] = listPhotos.mock.calls[1];
    expect(limit).toBe(600);
    expect(cursor).toEqual({ sortTime: 2, id: 2 });
    expect(s.getState().photos).toHaveLength(602);
    expect(s.getState().hasMore).toBe(true);
  });

  it("is a no-op for an index already inside the loaded prefix", async () => {
    const s = await openStore();
    listPhotos.mockClear();

    await s.loadUntil(1);

    expect(listPhotos).not.toHaveBeenCalled();
    expect(s.getState().photos).toHaveLength(2);
  });

  it("loadMore still appends exactly one PAGE_SIZE page and clears hasMore at the end", async () => {
    const s = await openStore();

    listPhotos.mockResolvedValueOnce({ photos: [row(3)], next: null });
    await s.loadMore();

    const [limit, cursor] = listPhotos.mock.calls[1];
    expect(limit).toBe(PAGE_SIZE);
    expect(cursor).toEqual({ sortTime: 2, id: 2 });
    expect(s.getState().photos.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(s.getState().hasMore).toBe(false);

    // Keyset exhausted: further loadUntil jumps must not hit the bridge.
    listPhotos.mockClear();
    await s.loadUntil(999);
    expect(listPhotos).not.toHaveBeenCalled();
  });
});
