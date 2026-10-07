// store.bufferWindow.test — the bounded photo buffer (PERF-07). A deep scroll
// over a large catalog must trim the loaded window to BUFFER_CAP instead of
// accumulating every row visited, and scrolling back up must refill through the
// recorded cursor ladder — a bounded fetch, never a whole-prefix re-walk.

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
import { BUFFER_CAP, CatalogStore, PAGE_SIZE } from "./store";

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

/** Endless synthetic catalog: absolute index i holds photo id i+1, and the
 *  keyset cursor is the last returned row's (sortTime=id, id). */
function mockEndlessCatalog(): void {
  listPhotos.mockImplementation(async (limit, after = null) => {
    const start = (after?.id ?? 0) + 1;
    const photos = Array.from({ length: limit }, (_, i) => row(start + i));
    const last = start + limit - 1;
    return { photos, next: { sortTime: last, id: last } };
  });
  countPhotos.mockResolvedValue(100_000);
}

/** Open on page 1 (ids 1..PAGE_SIZE), then jump deep so the front is trimmed:
 *  buffer = BUFFER_CAP rows ending at absolute index 7999 (ids 2001..8000). */
async function openTrimmedDeep(): Promise<CatalogStore> {
  mockEndlessCatalog();
  const s = new CatalogStore();
  await s.open("/c.galcat");
  await s.loadUntil(7999);
  return s;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bounded photo buffer", () => {
  it("trims the front past BUFFER_CAP on a deep forward scroll", async () => {
    const s = await openTrimmedDeep();

    const st = s.getState();
    expect(st.photos.length).toBe(BUFFER_CAP); // NOT 8000 — the session stays flat
    expect(st.photosStart).toBe(8000 - BUFFER_CAP);
    expect(st.photos[0].id).toBe(8000 - BUFFER_CAP + 1);
    expect(st.photos[st.photos.length - 1].id).toBe(8000);
    expect(st.hasMore).toBe(true);
    // open + two forward chunks (6000 then the 1800 remainder), no per-page churn
    expect(listPhotos).toHaveBeenCalledTimes(3);
  });

  it("loadMore keeps appending (and trimming) after a front trim", async () => {
    const s = await openTrimmedDeep();

    await s.loadMore();

    const st = s.getState();
    const [limit, cursor] = listPhotos.mock.calls[3];
    expect(limit).toBe(PAGE_SIZE);
    expect(cursor).toEqual({ sortTime: 8000, id: 8000 }); // resumes at the tail
    expect(st.photos.length).toBe(BUFFER_CAP);
    expect(st.photos[st.photos.length - 1].id).toBe(8000 + PAGE_SIZE);
    expect(st.photosStart).toBe(8000 + PAGE_SIZE - BUFFER_CAP);
  });

  it("refills a small backward gap from the cursor ladder and merges", async () => {
    const s = await openTrimmedDeep(); // photosStart 2000; ladder keys 0/200/6200/8000

    await s.loadUntil(1999); // one row above the trimmed front

    const st = s.getState();
    // ONE bounded fetch from the ladder boundary at 200 — not a 0-based re-walk.
    expect(listPhotos).toHaveBeenCalledTimes(4);
    const [limit, cursor] = listPhotos.mock.calls[3];
    expect(limit).toBe(1800);
    expect(cursor).toEqual({ sortTime: 200, id: 200 });
    // Merged, then tail-trimmed back to the ladder boundary at 6200.
    expect(st.photosStart).toBe(200);
    expect(st.photos.length).toBe(BUFFER_CAP);
    expect(st.photos[0].id).toBe(201);
    expect(st.photos[st.photos.length - 1].id).toBe(6200);
    expect(st.next).toEqual({ sortTime: 6200, id: 6200 }); // tail cursor restored
    expect(st.hasMore).toBe(true);
  });

  it("replaces the buffer on a far backward jump instead of hauling the gap", async () => {
    const s = await openTrimmedDeep(); // photosStart 2000

    await s.loadUntil(100); // scrollbar jump far above the loaded window

    const st = s.getState();
    expect(listPhotos).toHaveBeenCalledTimes(4);
    const [limit, cursor] = listPhotos.mock.calls[3];
    expect(cursor).toBeNull(); // nearest ladder boundary ≤ 100 is the start
    expect(limit).toBe(400); // window + a page of read-ahead, not the 2000 gap
    expect(st.photosStart).toBe(0);
    expect(st.photos.length).toBe(400);
    expect(st.photos[0].id).toBe(1);
    expect(st.hasMore).toBe(true);
    expect(st.next).toEqual({ sortTime: 400, id: 400 });
  });

  it("reload resets the window and the ladder to the first page", async () => {
    const s = await openTrimmedDeep();

    await s.reload();

    const st = s.getState();
    expect(st.photosStart).toBe(0);
    expect(st.photos.length).toBe(PAGE_SIZE);
    expect(st.photos[0].id).toBe(1);
  });
});
