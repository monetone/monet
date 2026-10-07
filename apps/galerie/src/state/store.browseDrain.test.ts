// store.browseDrain.test — PERF-06: collection / keyword / duplicate browse
// sources must drain their FULL result through offset-windowed chunks. A
// source larger than one chunk used to be silently truncated (photo 2001
// invisible, the toolbar total wrong); the drain loop keeps fetching until a
// short chunk and applies the Library filter across the whole set.

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
import { CatalogStore } from "./store";

/** The drain's chunk size (store-internal; a fetch shorter than this ends it). */
const CHUNK = 2000;

function row(id: number, rating = 0): PhotoRow {
  return {
    id,
    sourceAssetId: id,
    path: `/p${id}.cr3`,
    readPath: `/p${id}.cr3`,
    format: "raw:CR3",
    isVirtualCopy: false,
    orientation: 1,
    rating,
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

function rows(from: number, count: number, rating = 0): PhotoRow[] {
  return Array.from({ length: count }, (_, i) => row(from + i, rating));
}

async function openStore(): Promise<CatalogStore> {
  vi.mocked(cat.listPhotos).mockResolvedValueOnce({ photos: [row(1)], next: null });
  vi.mocked(cat.countPhotos).mockResolvedValueOnce(1);
  const s = new CatalogStore();
  await s.open("/c.galcat");
  return s;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("browse-source drain (PERF-06)", () => {
  it("a collection larger than one chunk loads completely and reports the true total", async () => {
    const s = await openStore();
    const list = vi.mocked(cat.listCollectionPhotos);
    list.mockResolvedValueOnce(rows(1000, CHUNK)).mockResolvedValueOnce(rows(1000 + CHUNK, 500));

    await s.setActiveCollection(99);

    expect(list).toHaveBeenNthCalledWith(1, 99, CHUNK, 0, {
      key: "capture",
      ascending: false,
    });
    expect(list).toHaveBeenNthCalledWith(2, 99, CHUNK, CHUNK, {
      key: "capture",
      ascending: false,
    });
    expect(list).toHaveBeenCalledTimes(2);
    const st = s.getState();
    expect(st.photos).toHaveLength(CHUNK + 500); // photo 2001 exists
    expect(st.total).toBe(CHUNK + 500); // toolbar count is the true count
    expect(st.hasMore).toBe(false);
    expect(st.loading).toBe(false);
  });

  it("a chunk of exactly CHUNK rows fetches once more and stops on the empty tail", async () => {
    const s = await openStore();
    const list = vi.mocked(cat.listKeywordPhotos);
    list.mockResolvedValueOnce(rows(1000, CHUNK)).mockResolvedValueOnce([]);

    await s.setActiveKeyword(7);

    expect(list).toHaveBeenNthCalledWith(1, 7, CHUNK, 0, {
      key: "capture",
      ascending: false,
    });
    expect(list).toHaveBeenNthCalledWith(2, 7, CHUNK, CHUNK, {
      key: "capture",
      ascending: false,
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(s.getState().photos).toHaveLength(CHUNK);
    expect(s.getState().total).toBe(CHUNK);
  });

  it("the rating filter applies across ALL chunks, not just the first", async () => {
    const s = await openStore();
    const list = vi.mocked(cat.listCollectionPhotos);
    list.mockResolvedValueOnce(rows(1000, CHUNK)).mockResolvedValueOnce(rows(1000 + CHUNK, 500));
    await s.setActiveCollection(99);

    // ★5 photos live in BOTH chunks; the filtered view must keep each.
    const starredFirst = [row(1, 5), ...rows(2, CHUNK - 1)];
    const starredSecond = [...rows(1 + CHUNK, 499), row(9000, 5)];
    list.mockResolvedValueOnce(starredFirst).mockResolvedValueOnce(starredSecond);
    await s.setFilter(3);

    expect(s.getState().photos.map((p) => p.id)).toEqual([1, 9000]);
    expect(s.getState().total).toBe(2);
  });

  it("duplicates browse drains beyond the first chunk too", async () => {
    const s = await openStore();
    const dup = vi.mocked(cat.duplicatePhotos);
    dup.mockResolvedValueOnce(rows(1, CHUNK)).mockResolvedValueOnce(rows(1 + CHUNK, 3));

    await s.showDuplicates();

    expect(dup).toHaveBeenNthCalledWith(1, CHUNK, 0, {
      key: "capture",
      ascending: false,
    });
    expect(dup).toHaveBeenNthCalledWith(2, CHUNK, CHUNK, {
      key: "capture",
      ascending: false,
    });
    expect(s.getState().photos).toHaveLength(CHUNK + 3);
    expect(s.getState().total).toBe(CHUNK + 3);
  });

  it("threads a changed sort through every special-source chunk", async () => {
    const s = await openStore();
    const list = vi.mocked(cat.listKeywordPhotos);
    list.mockResolvedValueOnce(rows(1, CHUNK)).mockResolvedValueOnce([]);
    await s.setActiveKeyword(7);

    list.mockClear();
    list.mockResolvedValueOnce(rows(1, CHUNK)).mockResolvedValueOnce([]);
    await s.setSort({ key: "label", ascending: true });

    expect(list).toHaveBeenNthCalledWith(1, 7, CHUNK, 0, {
      key: "label",
      ascending: true,
    });
    expect(list).toHaveBeenNthCalledWith(2, 7, CHUNK, CHUNK, {
      key: "label",
      ascending: true,
    });
  });
});
