// store.test — the view store's real logic (page accumulation, cull reconcile,
// selection) against a mocked catalog bridge. The SQL/pagination correctness
// itself is covered by the Rust unit tests (src-tauri/src/catalog.rs); here we
// prove the store threads pages/filters/culls correctly on top of it.

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
  updateCollection: vi.fn(async () => {}),
  addToCollection: vi.fn(async () => {}),
  removeFromCollection: vi.fn(async () => {}),
  replaceCollectionMembers: vi.fn(async () => {}),
  moveCollectionMembers: vi.fn(async () => {}),
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
import { exists } from "@tauri-apps/plugin-fs";
import { createDefaultRecipe } from "@monet-ui/monet-photo";
import type { PhotoRow } from "../catalog/types";
import { quickStep } from "../lib/quickDevelop";
import { QUICK_COLLECTION_NAME } from "../lib/quickCollection";
import {
  CatalogStore,
  PREVIOUS_IMPORT_MARKER,
  PREVIOUS_IMPORT_NAME,
  cullUndoLabel,
  store,
} from "./store";
import { handleCullingKey } from "../ui/culling";

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

const listPhotos = vi.mocked(cat.listPhotos);
const countPhotos = vi.mocked(cat.countPhotos);
const setFlags = vi.mocked(cat.setFlags);
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockResolvedValue(undefined);
});

describe("CatalogStore", () => {
  it("publishes the successful catalog-open reset payload", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);

    const s = new CatalogStore();
    await s.open("/c.galcat");

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("plugin:secondary|set_shared_selection", {
      catalogId: "/c.galcat",
      activePhotoId: null,
      selection: [],
    });
  });

  it("never forwards selection without a catalog", async () => {
    const s = new CatalogStore();
    s.select(7);

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("plugin:secondary|set_shared_selection", {
      catalogId: null,
      activePhotoId: null,
      selection: [],
    });
  });

  it("publishes ordered selection and Duplicates-clear payloads", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    invokeMock.mockClear();

    s.select(1);
    s.select(2);
    vi.mocked(cat.duplicatePhotos).mockResolvedValueOnce([]);
    await s.showDuplicates();

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(3));
    expect(invokeMock.mock.calls).toEqual([
      ["plugin:secondary|set_shared_selection", {
        catalogId: "/c.galcat",
        activePhotoId: 1,
        selection: [1],
      }],
      ["plugin:secondary|set_shared_selection", {
        catalogId: "/c.galcat",
        activePhotoId: 2,
        selection: [2],
      }],
      ["plugin:secondary|set_shared_selection", {
        catalogId: "/c.galcat",
        activePhotoId: null,
        selection: [],
      }],
    ]);
  });

  it("publishes cull-driven active-photo advance", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(5, 5), row(6, 5)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    listPhotos.mockResolvedValueOnce({ photos: [row(5, 5), row(6, 5)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    await s.setFilter(3);
    s.setActive(5);
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    invokeMock.mockClear();

    await s.cull(5, 1, 0, null);

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("plugin:secondary|set_shared_selection", {
      catalogId: "/c.galcat",
      activePhotoId: 6,
      selection: [6],
    });
  });

  it("surfaces one publication failure without recursively retrying", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [], next: null });
    countPhotos.mockResolvedValueOnce(0);
    invokeMock.mockRejectedValueOnce(new Error("bridge down"));
    const s = new CatalogStore();

    await s.open("/c.galcat");

    await vi.waitFor(() => expect(s.getState().error).toContain("bridge down"));
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("plugin:secondary|set_shared_selection", {
      catalogId: "/c.galcat",
      activePhotoId: null,
      selection: [],
    });
  });

  it("open loads the first page + total", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(3), row(2)], next: { sortTime: 2, id: 2 } });
    countPhotos.mockResolvedValueOnce(3);

    const s = new CatalogStore();
    await s.open("/c.galcat");

    expect(s.getState().ready).toBe(true);
    expect(s.getState().catalogPath).toBe("/c.galcat");
    expect(s.getState().photos.map((p) => p.id)).toEqual([3, 2]);
    expect(s.getState().hasMore).toBe(true);
    expect(s.getState().total).toBe(3);
  });

  it("loadMore appends the next page and clears hasMore at the end", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(3), row(2)], next: { sortTime: 2, id: 2 } });
    countPhotos.mockResolvedValueOnce(3);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    await s.loadMore();

    expect(s.getState().photos.map((p) => p.id)).toEqual([3, 2, 1]);
    expect(s.getState().hasMore).toBe(false);

    // No further pages: loadMore is a no-op (bridge not called again).
    listPhotos.mockClear();
    await s.loadMore();
    expect(listPhotos).not.toHaveBeenCalled();
  });

  it("cull persists flags and drops a row that falls below the filter", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(5, 5)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    // Raise the rating filter to 3 (triggers a reload).
    listPhotos.mockResolvedValueOnce({ photos: [row(5, 5)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setFilter(3);
    expect(s.getState().photos).toHaveLength(1);

    // Cull photo 5 down to rating 1 (< filter 3) → persisted + dropped.
    await s.cull(5, 1, 0, null);
    expect(setFlags).toHaveBeenCalledWith(5, 1, 0, null);
    expect(s.getState().photos).toHaveLength(0);
    expect(s.getState().total).toBe(0);
  });

  it("cull updates a row in place when it still matches the filter", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(7, 2)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    await s.cull(7, 4, 1, "green");
    const p = s.getState().photos.find((x) => x.id === 7)!;
    expect(p.rating).toBe(4);
    expect(p.flag).toBe(1);
    expect(p.colorLabel).toBe("green");
    expect(s.getState().total).toBe(1);
  });

  it("select replaces; additive toggles", () => {
    const s = new CatalogStore();
    s.select(1);
    expect(s.getState().selection).toEqual([1]);
    expect(s.getState().activeId).toBe(1);

    s.select(2, true);
    expect(s.getState().selection).toEqual([1, 2]);
    expect(s.getState().activeId).toBe(2);

    s.select(1, true); // toggle 1 back out
    expect(s.getState().selection).toEqual([2]);

    s.select(3); // non-additive replaces
    expect(s.getState().selection).toEqual([3]);
    expect(s.getState().activeId).toBe(3);
  });

  it("additive toggle-off never leaves activeId on a deselected photo", () => {
    const s = new CatalogStore();
    s.select(42);
    s.select(43, true); // [42,43], active 43
    s.select(43, true); // toggle 43 out
    expect(s.getState().selection).toEqual([42]);
    expect(s.getState().activeId).toBe(42); // NOT 43 (the deselected id)
    s.select(42, true); // toggle out the last → empty
    expect(s.getState().selection).toEqual([]);
    expect(s.getState().activeId).toBeNull();
  });

  it("discards an in-flight loadMore superseded by a filter change (epoch guard)", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(3), row(2)], next: { sortTime: 2, id: 2 } });
    countPhotos.mockResolvedValueOnce(3);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    expect(s.getState().photos.map((p) => p.id)).toEqual([3, 2]);

    // loadMore hangs (pending)…
    let releaseLoadMore!: (v: { photos: PhotoRow[]; next: null }) => void;
    listPhotos.mockReturnValueOnce(new Promise((r) => (releaseLoadMore = r)));
    const loadMorePromise = s.loadMore();

    // …then a filter change reloads (resolves immediately, new generation).
    listPhotos.mockResolvedValueOnce({ photos: [row(5, 5)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setFilter(3);
    expect(s.getState().photos.map((p) => p.id)).toEqual([5]);

    // The stale loadMore now resolves — it must be discarded, not appended.
    releaseLoadMore({ photos: [row(1)], next: null });
    await loadMorePromise;
    expect(s.getState().photos.map((p) => p.id)).toEqual([5]);
  });

  it("cull under-filter drops once, advances active, and never under-counts total", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(5, 5), row(6, 5)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    listPhotos.mockResolvedValueOnce({ photos: [row(5, 5), row(6, 5)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    await s.setFilter(3);
    s.setActive(5);

    await s.cull(5, 1, 0, null); // rating 1 < filter 3 → dropped
    expect(s.getState().photos.map((p) => p.id)).toEqual([6]);
    expect(s.getState().total).toBe(1);
    expect(s.getState().activeId).toBe(6); // advanced to neighbour

    await s.cull(5, 0, 0, null); // 5 no longer buffered → no-op, no under-count
    expect(s.getState().total).toBe(1);
    expect(s.getState().photos.map((p) => p.id)).toEqual([6]);
  });

  it("copies a develop recipe and pastes it across ids, updating badges", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2), row(3)], next: null });
    countPhotos.mockResolvedValueOnce(3);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    vi.mocked(cat.getRecipe).mockResolvedValueOnce('{"version":2,"processVersion":6}');
    await s.copyDevelop(1);
    expect(s.getState().hasDevelopClip).toBe(true);

    await s.pasteDevelop([2, 3]);
    expect(cat.setRecipe).toHaveBeenCalledWith(2, '{"version":2,"processVersion":6}', 6);
    expect(cat.setRecipe).toHaveBeenCalledWith(3, '{"version":2,"processVersion":6}', 6);
    const st = s.getState();
    expect(st.photos.find((p) => p.id === 2)!.hasRecipe).toBe(true);
    expect(st.photos.find((p) => p.id === 2)!.processVersion).toBe(6);
    expect(st.photos.find((p) => p.id === 3)!.hasRecipe).toBe(true);
    expect(st.photos.find((p) => p.id === 1)!.hasRecipe).toBe(false); // source untouched
  });

  it("syncDevelop pushes the source recipe to the rest of the selection, source excluded, clipboard untouched", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2), row(3)], next: null });
    countPhotos.mockResolvedValueOnce(3);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    vi.mocked(cat.getRecipe).mockResolvedValueOnce('{"version":2,"processVersion":6}');
    await s.syncDevelop(1, [1, 2, 3]); // source id is included in the selection

    expect(cat.setRecipe).toHaveBeenCalledWith(2, '{"version":2,"processVersion":6}', 6);
    expect(cat.setRecipe).toHaveBeenCalledWith(3, '{"version":2,"processVersion":6}', 6);
    // Source is excluded from its own sync targets, and Sync never touches the clipboard.
    expect(cat.setRecipe).not.toHaveBeenCalledWith(1, expect.anything(), expect.anything());
    const st = s.getState();
    expect(st.photos.find((p) => p.id === 2)!.hasRecipe).toBe(true);
    expect(st.photos.find((p) => p.id === 3)!.hasRecipe).toBe(true);
    expect(st.photos.find((p) => p.id === 1)!.hasRecipe).toBe(false);
    expect(st.hasDevelopClip).toBe(false);
  });

  it("syncDevelop is a no-op when the source has no recipe", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    vi.mocked(cat.getRecipe).mockResolvedValueOnce(null); // never developed
    await s.syncDevelop(1, [1, 2]);
    expect(cat.setRecipe).not.toHaveBeenCalled();
  });

  it("scoped pasteDevelop copies only the chosen panels, preserving the target's unscoped ones", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    // Copy only Basic from the source (exposure 0.5). Target has a distinct
    // Effects panel that must survive the scoped paste.
    vi.mocked(cat.getRecipe).mockResolvedValueOnce(
      JSON.stringify({ version: 2, processVersion: 6, basic: { exposure: 0.5 } }),
    );
    await s.copyDevelop(1, ["basic"]);

    vi.mocked(cat.getRecipe).mockResolvedValueOnce(
      JSON.stringify({ version: 2, processVersion: 6, effects: { grainAmount: 0.7 } }),
    );
    await s.pasteDevelop([2]);

    const call = vi.mocked(cat.setRecipe).mock.calls.find((c) => c[0] === 2);
    expect(call).toBeTruthy();
    const written = JSON.parse(call![1] as string) as {
      basic: { exposure: number };
      effects: { grainAmount: number };
    };
    expect(written.basic.exposure).toBeCloseTo(0.5, 6); // copied panel
    expect(written.effects.grainAmount).toBeCloseTo(0.7, 6); // target's unscoped panel preserved
  });

  it("stacks a selection, expands the stack as a grid source, and unstacks", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2), row(3)], next: null });
    countPhotos.mockResolvedValueOnce(3);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    // Stacking fewer than 2 is a guarded no-op.
    s.select(1);
    expect(await s.stackSelection()).toBeNull();
    expect(cat.stackPhotos).not.toHaveBeenCalled();

    // Stack 1+2; store reloads (collapsed source: cover only).
    s.select(2, true);
    vi.mocked(cat.stackPhotos).mockResolvedValueOnce(9);
    listPhotos.mockResolvedValueOnce({ photos: [{ ...row(1), stackId: 9, stackOrder: 0, stackCount: 2 }, row(3)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    expect(await s.stackSelection()).toBe(9);
    expect(cat.stackPhotos).toHaveBeenCalledWith([1, 2]);
    expect(s.getState().photos.map((p) => p.id)).toEqual([1, 3]);

    // Expand stack 9 → grid source is its members (uncollapsed).
    vi.mocked(cat.listStack).mockResolvedValueOnce([
      { ...row(1), stackId: 9, stackOrder: 0, stackCount: 2 },
      { ...row(2), stackId: 9, stackOrder: 1, stackCount: 2 },
    ]);
    await s.expandStack(9);
    expect(cat.listStack).toHaveBeenCalledWith(9, {
      key: "capture",
      ascending: false,
    });
    expect(s.getState().expandedStackId).toBe(9);
    expect(s.getState().photos.map((p) => p.id)).toEqual([1, 2]);

    // Unstack from within the expanded view returns to the library.
    s.setActive(1);
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2), row(3)], next: null });
    countPhotos.mockResolvedValueOnce(3);
    await s.unstackActive();
    expect(cat.unstack).toHaveBeenCalledWith(9);
    expect(s.getState().expandedStackId).toBeNull();
  });

  it("folder sync flags a gone file missing and relinks a matching file", async () => {
    listPhotos.mockResolvedValue({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValue(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    // Two sources: /a present (not yet flagged), /b gone (not yet flagged).
    vi.mocked(cat.listSourcePaths).mockResolvedValueOnce([
      { sourceAssetId: 10, path: "/a.cr3", missing: false },
      { sourceAssetId: 11, path: "/b.cr3", missing: false },
    ]);
    vi.mocked(exists).mockImplementation(async (p) => p === "/a.cr3");
    vi.mocked(cat.countMissing).mockResolvedValueOnce(1);

    const missing = await s.syncMissing();
    expect(missing).toBe(1);
    // Only the disagreeing source is written: /b gets flagged missing.
    expect(cat.markMissing).toHaveBeenCalledExactlyOnceWith(11, true);

    // Relink /b to a new path; fingerprint (mocked "fp-new") is passed to Rust.
    const ok = await s.relinkPhoto(11, "/moved/b.cr3");
    expect(ok).toBe(true);
    expect(cat.relink).toHaveBeenCalledExactlyOnceWith(11, "/moved/b.cr3", "fp-new");
  });

  it("reference view pins, toggles, and resets on catalog open", async () => {
    const s = new CatalogStore();
    expect(s.getState().referencePhotoId).toBeNull();
    s.toggleReference(); // no-op until pinned
    expect(s.getState().referenceActive).toBe(false);

    s.setReference(7);
    expect(s.getState().referencePhotoId).toBe(7);
    expect(s.getState().referenceActive).toBe(true); // pinning shows the view
    s.toggleReference();
    expect(s.getState().referenceActive).toBe(false);
    s.toggleReference();
    expect(s.getState().referenceActive).toBe(true);

    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.open("/c.galcat");
    expect(s.getState().referencePhotoId).toBeNull(); // reference is per-catalog
    expect(s.getState().referenceActive).toBe(false);
  });

  it("painter sprays and toggles rating/flag/label, preserving the other fields", async () => {
    listPhotos.mockResolvedValueOnce({
      photos: [{ ...row(1), rating: 2, flag: 1, colorLabel: "red" }],
      next: null,
    });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    // Different rating → set it, others preserved.
    s.setPainter({ kind: "rating", value: 4 });
    await s.paint(1);
    expect(cat.setFlags).toHaveBeenLastCalledWith(1, 4, 1, "red");

    // Same rating again → toggles back to 0.
    await s.paint(1);
    expect(cat.setFlags).toHaveBeenLastCalledWith(1, 0, 1, "red");

    // Same label → clears it (rating is now 0 in the buffer).
    s.setPainter({ kind: "label", value: "red" });
    await s.paint(1);
    expect(cat.setFlags).toHaveBeenLastCalledWith(1, 0, 1, null);

    // Disarmed → no-op.
    s.setPainter(null);
    vi.mocked(cat.setFlags).mockClear();
    await s.paint(1);
    expect(cat.setFlags).not.toHaveBeenCalled();
  });

  it("painter keyword toggles vocabulary membership", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    s.setPainter({ kind: "keyword", value: "travel" });

    vi.mocked(cat.listPhotoKeywords).mockResolvedValueOnce([]);
    await s.paint(1);
    expect(cat.addKeyword).toHaveBeenCalledExactlyOnceWith(1, "travel");

    vi.mocked(cat.listPhotoKeywords).mockResolvedValueOnce([
      { id: 7, name: "travel" } as Awaited<ReturnType<typeof cat.listPhotoKeywords>>[number],
    ]);
    await s.paint(1);
    expect(cat.removeKeyword).toHaveBeenCalledExactlyOnceWith(1, 7);
  });

  it("quick develop steps every target from its own baseline and updates badges", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2), row(3)], next: null });
    countPhotos.mockResolvedValueOnce(3);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    // Photo 1 already has contrast int 40; photo 2 has never been developed.
    vi.mocked(cat.getRecipe).mockImplementation(async (id: number) =>
      id === 1 ? JSON.stringify({ ...createDefaultRecipe(), basic: { ...createDefaultRecipe().basic, contrast: 0.4 } }) : null,
    );
    vi.mocked(cat.setRecipe).mockImplementation(
      async (_id: number, json: string) => json as never,
    );

    await s.applyQuickDevelop([1, 2], (r) => quickStep(r, "contrast", 1, false));

    const persisted = vi.mocked(cat.setRecipe).mock.calls.map(([id, json]) => ({
      id,
      contrast: (JSON.parse(json) as { basic: { contrast: number } }).basic.contrast,
    }));
    // Relative: each stepped from its OWN baseline (0.40→0.45, 0→0.05).
    expect(persisted).toEqual([
      { id: 1, contrast: expect.closeTo(0.45, 10) },
      { id: 2, contrast: expect.closeTo(0.05, 10) },
    ]);
    const st = s.getState();
    expect(st.photos.find((p) => p.id === 1)!.hasRecipe).toBe(true);
    expect(st.photos.find((p) => p.id === 2)!.hasRecipe).toBe(true);
    expect(st.photos.find((p) => p.id === 3)!.hasRecipe).toBe(false); // not a target
  });

  it("a normalized-space no-op quick develop migrates the recipe without a spurious history step", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    // A recipe persisted before the heal field existed: normalize now fills
    // heal, so the canonical bytes differ from the raw baseline even when the
    // quick-develop transform changes nothing.
    const preHeal = JSON.parse(JSON.stringify(createDefaultRecipe())) as Record<string, unknown>;
    delete preHeal.heal;
    vi.mocked(cat.getRecipe).mockResolvedValueOnce(JSON.stringify(preHeal));
    vi.mocked(cat.setRecipe).mockClear();
    vi.mocked(cat.setRecipe).mockImplementation(async (_id: number, json: string) => json as never);
    vi.mocked(cat.recordHistory).mockClear();

    await s.applyQuickDevelop([1], (r) => r); // identity transform

    expect(cat.setRecipe).toHaveBeenCalledTimes(1); // the migration write still lands
    expect(cat.recordHistory).not.toHaveBeenCalled(); // no spurious "Heal" step
  });

  it("copyDevelop is a no-op when the source has no recipe; paste then does nothing", async () => {
    const s = new CatalogStore();
    vi.mocked(cat.getRecipe).mockResolvedValueOnce(null);
    await s.copyDevelop(1);
    expect(s.getState().hasDevelopClip).toBe(false);
    await s.pasteDevelop([2]);
    expect(cat.setRecipe).not.toHaveBeenCalled();
  });

  it("a collection drives the grid; the rating filter applies client-side; All Photos resumes the library query", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(3), row(2)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    // Activate a collection whose result is [10(★5), 11(★1)] — loaded in one shot.
    vi.mocked(cat.listCollectionPhotos).mockResolvedValueOnce([row(10, 5), row(11, 1)]);
    await s.setActiveCollection(99);
    expect(cat.listCollectionPhotos).toHaveBeenCalledWith(99, 2000, 0, {
      key: "capture",
      ascending: false,
    });
    expect(s.getState().photos.map((p) => p.id)).toEqual([10, 11]);
    expect(s.getState().hasMore).toBe(false);
    expect(s.getState().total).toBe(2);

    // Raise the rating filter → re-query the collection, keep only ★≥3 client-side.
    vi.mocked(cat.listCollectionPhotos).mockResolvedValueOnce([row(10, 5), row(11, 1)]);
    await s.setFilter(3);
    expect(s.getState().photos.map((p) => p.id)).toEqual([10]);
    expect(s.getState().total).toBe(1);

    // Back to All Photos → the keyset library query resumes (not the collection).
    listPhotos.mockResolvedValueOnce({ photos: [row(3, 5)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setActiveCollection(null);
    expect(s.getState().activeCollectionId).toBeNull();
    expect(s.getState().photos.map((p) => p.id)).toEqual([3]);
  });

  it("flag filter drops a culled photo that no longer matches (buffer reconcile)", async () => {
    const a = { ...row(1), flag: 1 };
    const b = { ...row(2), flag: 1 };
    listPhotos.mockResolvedValueOnce({ photos: [a, b], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    // Enter "picks only" (reloads).
    listPhotos.mockResolvedValueOnce({ photos: [a, b], next: null });
    countPhotos.mockResolvedValueOnce(2);
    await s.setFlagFilter(1);
    expect(s.getState().filterFlag).toBe(1);

    // Unflag photo 1 → no longer a pick → drops from the buffer.
    await s.cull(1, 0, 0, null);
    expect(s.getState().photos.map((p) => p.id)).toEqual([2]);
    expect(s.getState().total).toBe(1);
  });

  it("setPhotoMetadata persists and reconciles the buffer, normalizing blanks to null", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(7)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    const blankSix = { city: null, stateProvince: null, country: null, jobTitle: null, credit: null, source: null };
    await s.setPhotoMetadata(7, { title: "Sunset", caption: "  ", creator: null, copyright: "© Me", ...blankSix });
    expect(cat.setMetadata).toHaveBeenCalledWith(7, {
      title: "Sunset",
      caption: "  ",
      creator: null,
      copyright: "© Me",
      ...blankSix,
    });
    const p = s.getState().photos.find((x) => x.id === 7)!;
    expect(p.title).toBe("Sunset");
    expect(p.caption).toBeNull(); // blank normalized to null
    expect(p.copyright).toBe("© Me");
  });

  it("applyMetadataPreset sets creator/copyright across ids, preserving title/caption", async () => {
    const a = { ...row(1), title: "Keep A", caption: "cap A" };
    const b = { ...row(2), title: "Keep B", caption: null };
    listPhotos.mockResolvedValueOnce({ photos: [a, b], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    const preset = { id: 9, name: "Studio", creator: "Me", copyright: "© 2026", createdAt: 0 };
    const n = await s.applyMetadataPreset(preset, [1, 2]);
    expect(n).toBe(2);
    // Each photo keeps its own title/caption; creator/copyright come from the preset.
    const keptSix = { city: null, stateProvince: null, country: null, jobTitle: null, credit: null, source: null };
    expect(cat.setMetadata).toHaveBeenCalledWith(1, {
      title: "Keep A",
      caption: "cap A",
      creator: "Me",
      copyright: "© 2026",
      ...keptSix, // the preset owns only creator/copyright — the rest is the photo's
    });
    expect(cat.setMetadata).toHaveBeenCalledWith(2, {
      title: "Keep B",
      caption: null,
      creator: "Me",
      copyright: "© 2026",
      ...keptSix,
    });
    const buf = s.getState().photos;
    expect(buf.find((p) => p.id === 1)!.creator).toBe("Me");
    expect(buf.find((p) => p.id === 1)!.title).toBe("Keep A"); // preserved in buffer
    expect(buf.find((p) => p.id === 2)!.copyright).toBe("© 2026");
  });

  it("createVirtualCopy reloads and focuses the new copy in the whole-catalog view", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    vi.mocked(cat.createVirtualCopy).mockResolvedValueOnce(2);
    listPhotos.mockResolvedValueOnce({ photos: [row(2), row(1)], next: null }); // reload sees the copy
    countPhotos.mockResolvedValueOnce(2);
    const id = await s.createVirtualCopy(1);

    expect(cat.createVirtualCopy).toHaveBeenCalledWith(1);
    expect(id).toBe(2);
    expect(s.getState().photos.map((p) => p.id)).toEqual([2, 1]);
    expect(s.getState().activeId).toBe(2); // the new copy is focused
  });

  it("showDuplicates drives the grid from duplicate photos; All Photos clears it", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    vi.mocked(cat.duplicatePhotos).mockResolvedValueOnce([row(10), row(11)]);
    await s.showDuplicates();
    expect(s.getState().duplicatesActive).toBe(true);
    expect(s.getState().photos.map((p) => p.id)).toEqual([10, 11]);
    expect(s.getState().total).toBe(2);

    // Back to All Photos clears the duplicates source.
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setActiveCollection(null);
    expect(s.getState().duplicatesActive).toBe(false);
    expect(s.getState().photos.map((p) => p.id)).toEqual([1]);
  });

  it("removing the active collection falls back to All Photos", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    vi.mocked(cat.listCollectionPhotos).mockResolvedValueOnce([row(10)]);
    await s.setActiveCollection(5);
    expect(s.getState().activeCollectionId).toBe(5);

    // Delete it → grid source returns to the library query.
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.removeCollection(5);
    expect(cat.deleteCollection).toHaveBeenCalledWith(5);
    expect(s.getState().activeCollectionId).toBeNull();
    expect(s.getState().photos.map((p) => p.id)).toEqual([1]);
  });

  it("creates nested nodes and atomically edits name, parent, and smart rule", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [], next: null });
    countPhotos.mockResolvedValueOnce(0);
    vi.mocked(cat.listCollections).mockResolvedValue([]);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    vi.mocked(cat.createCollection).mockResolvedValueOnce(12);
    expect(await s.createCollection("Nested", "collection", null, 7)).toBe(12);
    expect(cat.createCollection).toHaveBeenCalledWith("Nested", "collection", 7, null);

    const ast = '{"match":"all","rules":[]}';
    expect(await s.updateCollection(12, "Renamed", 8, ast)).toBe(true);
    expect(cat.updateCollection).toHaveBeenCalledWith(12, "Renamed", 8, ast);
  });

  it("persists selected-photo User Order through the native transaction", async () => {
    const manual = {
      id: 5,
      name: "Sequence",
      kind: "collection",
      parentId: null,
      ruleAst: null,
      sortOrder: 0,
      createdAt: 0,
    };
    listPhotos.mockResolvedValueOnce({ photos: [], next: null });
    countPhotos.mockResolvedValueOnce(0);
    vi.mocked(cat.listCollections).mockResolvedValue([manual]);
    vi.mocked(cat.listCollectionPhotos).mockResolvedValue([row(1), row(2), row(3)]);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    await s.setActiveCollection(5);
    await s.setSort({ key: "user", ascending: true });
    s.select(2);

    await s.moveUserOrder(-1);

    expect(cat.moveCollectionMembers).toHaveBeenCalledWith(5, [2], -1);
    expect(cat.listCollectionPhotos).toHaveBeenLastCalledWith(5, 2000, 0, {
      key: "user",
      ascending: true,
    });
  });
});

describe("CatalogStore — Quick / Target Collection", () => {
  const QUICK_ID = 9;
  const listCollections = vi.mocked(cat.listCollections);
  const listCollectionPhotos = vi.mocked(cat.listCollectionPhotos);
  const createCollection = vi.mocked(cat.createCollection);
  const addToCollection = vi.mocked(cat.addToCollection);
  const removeFromCollection = vi.mocked(cat.removeFromCollection);
  const renameCollection = vi.mocked(cat.renameCollection);

  const col = (id: number, name: string, kind = "collection") => ({
    id,
    name,
    kind,
    parentId: null,
    ruleAst: null,
    sortOrder: 0,
    createdAt: 0,
  });

  /** Open a store seeded with `collections` and `quickMembers` in the Quick Collection. */
  async function openWith(collections: ReturnType<typeof col>[], quickMembers: number[] = []) {
    listPhotos.mockResolvedValue({ photos: [], next: null });
    countPhotos.mockResolvedValue(0);
    listCollections.mockResolvedValue(collections);
    listCollectionPhotos.mockImplementation(async (colId: number) =>
      colId === QUICK_ID ? quickMembers.map((id) => row(id)) : [],
    );
    const s = new CatalogStore();
    await s.open("/c.galcat");
    return s;
  }

  it("B toggle adds only the missing photos to the Quick Collection", async () => {
    const s = await openWith([col(QUICK_ID, QUICK_COLLECTION_NAME)], [5]);
    s.select(6); // 6 not a member
    await s.toggleQuickMembership();
    expect(addToCollection).toHaveBeenCalledWith(QUICK_ID, 6);
    expect(removeFromCollection).not.toHaveBeenCalled();
  });

  it("B toggle removes when every selected photo is already a member", async () => {
    const s = await openWith([col(QUICK_ID, QUICK_COLLECTION_NAME)], [5]);
    s.select(5);
    await s.toggleQuickMembership();
    expect(removeFromCollection).toHaveBeenCalledWith(QUICK_ID, 5);
    expect(addToCollection).not.toHaveBeenCalled();
  });

  it("B toggle targets the explicit Target Collection, not the Quick Collection", async () => {
    const s = await openWith([col(QUICK_ID, QUICK_COLLECTION_NAME), col(1, "Trip")], []);
    s.setTargetCollection(1);
    s.select(5);
    // Target 1 has no members → add 5 to the target, never to Quick.
    listCollectionPhotos.mockImplementation(async () => []);
    await s.toggleQuickMembership();
    expect(addToCollection).toHaveBeenCalledWith(1, 5);
    expect(addToCollection).not.toHaveBeenCalledWith(QUICK_ID, 5);
  });

  it("saveQuickCollection renames the reserved collection and clears a matching target", async () => {
    const s = await openWith([col(QUICK_ID, QUICK_COLLECTION_NAME)], [5]);
    s.setTargetCollection(QUICK_ID);
    await s.saveQuickCollection("Trip 2026");
    expect(renameCollection).toHaveBeenCalledWith(QUICK_ID, "Trip 2026");
    expect(s.getState().targetCollectionId).toBeNull();
  });

  it("saveQuickCollection rejects a blank or the reserved name", async () => {
    const s = await openWith([col(QUICK_ID, QUICK_COLLECTION_NAME)], []);
    await s.saveQuickCollection("   ");
    await s.saveQuickCollection(QUICK_COLLECTION_NAME);
    expect(renameCollection).not.toHaveBeenCalled();
  });

  it("clearQuickCollection removes every cached member", async () => {
    const s = await openWith([col(QUICK_ID, QUICK_COLLECTION_NAME)], [5, 6]);
    await s.clearQuickCollection();
    expect(removeFromCollection).toHaveBeenCalledWith(QUICK_ID, 5);
    expect(removeFromCollection).toHaveBeenCalledWith(QUICK_ID, 6);
  });

  it("concurrent first-use B presses create only one Quick Collection", async () => {
    listPhotos.mockResolvedValue({ photos: [], next: null });
    countPhotos.mockResolvedValue(0);
    let created = false;
    listCollections.mockImplementation(async () => (created ? [col(QUICK_ID, QUICK_COLLECTION_NAME)] : []));
    createCollection.mockImplementation(async () => {
      created = true;
      return QUICK_ID;
    });
    listCollectionPhotos.mockResolvedValue([]);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    s.select(5);
    await Promise.all([s.toggleQuickMembership(), s.toggleQuickMembership()]);
    expect(createCollection).toHaveBeenCalledTimes(1);
  });
});

describe("CatalogStore — Previous Import", () => {
  it("preserves a same-named user collection and atomically replaces the marked collection", async () => {
    const userId = 66;
    const previousId = 77;
    let created = false;
    listPhotos.mockResolvedValue({ photos: [], next: null });
    countPhotos.mockResolvedValue(0);
    vi.mocked(cat.listCollections).mockImplementation(async () => {
      const user = {
        id: userId,
        name: PREVIOUS_IMPORT_NAME,
        kind: "collection",
        parentId: null,
        ruleAst: null,
        sortOrder: 0,
        createdAt: 0,
      };
      return created
        ? [user, {
            id: previousId,
            name: PREVIOUS_IMPORT_NAME,
            kind: "collection",
            parentId: null,
            ruleAst: PREVIOUS_IMPORT_MARKER,
            sortOrder: 0,
            createdAt: 0,
          }]
        : [user];
    });
    vi.mocked(cat.createCollection).mockImplementation(async () => {
      created = true;
      return previousId;
    });
    vi.mocked(cat.importPhoto).mockResolvedValueOnce(11).mockResolvedValueOnce(12);
    vi.mocked(cat.listCollectionPhotos).mockImplementation(async (id) =>
      id === previousId ? [row(11), row(12)] : [row(9)],
    );

    const s = new CatalogStore();
    await s.open("/c.galcat");
    await s.importPhotos([
      { path: "/11.jpg", fingerprint: "11", format: "jpeg", byteSize: 1, mtime: 1, width: 1, height: 1 },
      { path: "/12.jpg", fingerprint: "12", format: "jpeg", byteSize: 1, mtime: 1, width: 1, height: 1 },
    ]);

    expect(cat.createCollection).toHaveBeenCalledWith(
      PREVIOUS_IMPORT_NAME,
      "collection",
      null,
      PREVIOUS_IMPORT_MARKER,
    );
    expect(cat.replaceCollectionMembers).toHaveBeenCalledWith(previousId, [11, 12]);
    expect(cat.replaceCollectionMembers).not.toHaveBeenCalledWith(userId, expect.anything());
    expect(s.getState().activeCollectionId).toBe(previousId);
    expect(s.getState().photos.map((p) => p.id)).toEqual([11, 12]);
  });
});

describe("CatalogStore — range / select-all / clear selection", () => {
  const SYNC = "plugin:secondary|set_shared_selection";
  const lastSync = () => invokeMock.mock.calls.filter((c) => c[0] === SYNC).at(-1)?.[1];
  const opened = async (...ids: number[]) => {
    listPhotos.mockResolvedValueOnce({ photos: ids.map((id) => row(id)), next: null });
    countPhotos.mockResolvedValueOnce(ids.length);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
    return s;
  };
  const expectSync = (selection: number[], activePhotoId: number | null) =>
    vi.waitFor(() => expect(lastSync()).toEqual({ catalogId: "/c.galcat", activePhotoId, selection }));

  it("selectRange selects the inclusive forward range from the active anchor", async () => {
    const s = await opened(1, 2, 3, 4, 5);
    s.select(2);
    s.selectRange(4);
    await expectSync([2, 3, 4], 4);
  });

  it("selectRange normalizes a backward range (target before anchor)", async () => {
    const s = await opened(1, 2, 3, 4, 5);
    s.select(4);
    s.selectRange(2);
    await expectSync([2, 3, 4], 2);
  });

  it("selectRange with anchor === target selects just that photo", async () => {
    const s = await opened(1, 2, 3);
    s.select(2);
    s.selectRange(2);
    await expectSync([2], 2);
  });

  it("selectRange with no anchor falls back to a single select", async () => {
    const s = await opened(1, 2, 3); // no prior select → activeId null
    s.selectRange(3);
    await expectSync([3], 3);
  });

  it("selectAll selects every loaded photo, keeping the active photo", async () => {
    const s = await opened(1, 2, 3);
    s.select(2);
    s.selectAll();
    await expectSync([1, 2, 3], 2);
  });

  it("selectAll with no prior active anchors on the last photo", async () => {
    const s = await opened(1, 2, 3);
    s.selectAll();
    await expectSync([1, 2, 3], 3);
  });

  it("clearSelection empties the selection and active photo", async () => {
    const s = await opened(1, 2, 3);
    s.select(2);
    s.clearSelection();
    await expectSync([], null);
  });
});

describe("CatalogStore — text (filename) filter", () => {
  const openWith = async (...ids: number[]) => {
    listPhotos.mockResolvedValueOnce({ photos: ids.map((id) => row(id)), next: null });
    countPhotos.mockResolvedValueOnce(ids.length);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    return s;
  };

  it("threads the trimmed text into the list + count queries", async () => {
    const s = await openWith(1, 2);
    listPhotos.mockClear();
    countPhotos.mockClear();
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setTextFilter("  Beach  ");
    expect(listPhotos.mock.calls.at(-1)?.[2]).toMatchObject({ text: "Beach" });
    expect(countPhotos.mock.calls.at(-1)?.[0]).toMatchObject({ text: "Beach" });
  });

  it("sends blank text as null (no filter)", async () => {
    const s = await openWith(1, 2);
    listPhotos.mockClear();
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    await s.setTextFilter("   ");
    expect(listPhotos.mock.calls.at(-1)?.[2]).toMatchObject({ text: null });
  });

  it("re-setting the same raw text does not reload", async () => {
    const s = await openWith(1, 2);
    listPhotos.mockClear();
    await s.setTextFilter(""); // unchanged from the default ""
    expect(listPhotos).not.toHaveBeenCalled();
  });
});

describe("CatalogStore — removePhotos", () => {
  const removePhotos = vi.mocked(cat.removePhotos);

  async function openPhotos(...ids: number[]) {
    listPhotos.mockResolvedValueOnce({ photos: ids.map((id) => row(id)), next: null });
    countPhotos.mockResolvedValueOnce(ids.length);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    return s;
  }

  it("removes cascaded virtual copies and keeps a surviving active photo", async () => {
    const s = await openPhotos(1, 2, 3, 4);
    s.select(2);
    s.select(3, true); // selection [2,3], active 3
    // Removing 2 also cascades a virtual copy (id 5) that never sat in the buffer.
    removePhotos.mockResolvedValueOnce([2, 5]);
    countPhotos.mockResolvedValueOnce(3);

    await s.removePhotos([2]);

    expect(removePhotos).toHaveBeenCalledWith([2]);
    expect(s.getState().photos.map((p) => p.id)).toEqual([1, 3, 4]);
    expect(s.getState().selection).toEqual([3]);
    expect(s.getState().activeId).toBe(3);
    expect(s.getState().total).toBe(3);
  });

  it("advances active off a removed photo and refreshes the main-grid total", async () => {
    const s = await openPhotos(1, 2, 3);
    s.select(2); // selection [2], active 2
    removePhotos.mockResolvedValueOnce([2]);
    countPhotos.mockResolvedValueOnce(2);

    await s.removePhotos([2]);

    expect(s.getState().photos.map((p) => p.id)).toEqual([1, 3]);
    expect(s.getState().selection).toEqual([]); // 2 was the only selected id
    expect(s.getState().activeId).toBe(3); // falls back to the last buffered photo
    expect(s.getState().total).toBe(2);
  });

  it("is a no-op for an empty id list", async () => {
    const s = await openPhotos(1, 2);
    removePhotos.mockClear();

    await s.removePhotos([]);

    expect(removePhotos).not.toHaveBeenCalled();
    expect(s.getState().photos.map((p) => p.id)).toEqual([1, 2]);
  });

  it("surfaces a bridge failure and leaves the buffer intact", async () => {
    const s = await openPhotos(1, 2, 3);
    removePhotos.mockRejectedValueOnce(new Error("db locked"));

    await s.removePhotos([2]);

    expect(s.getState().error).toContain("db locked");
    expect(s.getState().photos.map((p) => p.id)).toEqual([1, 2, 3]);
  });
});

describe("CatalogStore — deleteFromDisk", () => {
  const deleteFromDisk = vi.mocked(cat.deletePhotosFromDisk);

  async function openPhotos(...ids: number[]) {
    listPhotos.mockResolvedValueOnce({ photos: ids.map((id) => row(id)), next: null });
    countPhotos.mockResolvedValueOnce(ids.length);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    return s;
  }

  it("reconciles like removePhotos and notices the Trash move", async () => {
    const s = await openPhotos(1, 2, 3);
    s.select(2);
    deleteFromDisk.mockResolvedValueOnce({ deleted: [2, 5], trashed: ["/a.cr3"], failed: [] });
    countPhotos.mockResolvedValueOnce(2);

    await s.deleteFromDisk([2]);

    expect(deleteFromDisk).toHaveBeenCalledWith([2]);
    expect(s.getState().photos.map((p) => p.id)).toEqual([1, 3]);
    expect(s.getState().notice).toContain("moved to Trash");
    expect(s.getState().error).toBeNull();
  });

  it("surfaces files the OS refused to trash while still dropping their rows", async () => {
    const s = await openPhotos(1, 2);
    deleteFromDisk.mockResolvedValueOnce({ deleted: [2], trashed: [], failed: ["/b.cr3: locked"] });
    countPhotos.mockResolvedValueOnce(1);

    await s.deleteFromDisk([2]);

    expect(s.getState().photos.map((p) => p.id)).toEqual([1]);
    expect(s.getState().error).toContain("/b.cr3: locked");
  });

  it("surfaces a bridge failure and leaves the buffer intact", async () => {
    const s = await openPhotos(1, 2);
    deleteFromDisk.mockRejectedValueOnce(new Error("db locked"));

    await s.deleteFromDisk([2]);

    expect(s.getState().error).toContain("db locked");
    expect(s.getState().photos.map((p) => p.id)).toEqual([1, 2]);
  });

  it("is a no-op for an empty id list", async () => {
    const s = await openPhotos(1);
    deleteFromDisk.mockClear();

    await s.deleteFromDisk([]);

    expect(deleteFromDisk).not.toHaveBeenCalled();
  });
});

describe("CatalogStore — Compare view", () => {
  async function openInstance(...ids: number[]) {
    listPhotos.mockResolvedValueOnce({ photos: ids.map((id) => row(id)), next: null });
    countPhotos.mockResolvedValueOnce(ids.length);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    return s;
  }

  it("seeds the Candidate to the photo after the Select on entering Compare", async () => {
    const s = await openInstance(1, 2, 3);
    s.setActive(2);
    s.setModule("compare");
    expect(s.getState().compareCandidateId).toBe(3);
  });

  it("seeds the Candidate to the prior photo when the Select is last", async () => {
    const s = await openInstance(1, 2, 3);
    s.setActive(3);
    s.setModule("compare");
    expect(s.getState().compareCandidateId).toBe(2);
  });

  it("keeps a still-valid pinned Candidate when re-entering Compare", async () => {
    const s = await openInstance(1, 2, 3, 4);
    s.setActive(1);
    s.setModule("compare"); // seeds Candidate 2
    s.moveCompareCandidate(2); // 2 → 4
    expect(s.getState().compareCandidateId).toBe(4);
    s.setModule("grid");
    s.setModule("compare"); // 4 still valid → not reseeded
    expect(s.getState().compareCandidateId).toBe(4);
  });

  it("steps the Candidate past the Select instead of landing on it", async () => {
    const s = await openInstance(1, 2, 3);
    s.setActive(2); // Select in the middle
    s.setModule("compare"); // Candidate 3
    s.moveCompareCandidate(-1); // would hit the Select (2) → hops to 1
    expect(s.getState().compareCandidateId).toBe(1);
    expect(s.getState().activeId).toBe(2); // Select stays pinned
  });

  it("holds the Candidate when the Select sits against the end of the set", async () => {
    const s = await openInstance(1, 2);
    s.setActive(1); // Select first
    s.setModule("compare"); // Candidate 2
    s.moveCompareCandidate(-1); // only slot left is the Select → no move
    expect(s.getState().compareCandidateId).toBe(2);
  });

  it("swaps the Select and Candidate", async () => {
    const s = await openInstance(1, 2, 3);
    s.setActive(1);
    s.setModule("compare"); // Candidate 2
    s.swapCompare();
    expect(s.getState().activeId).toBe(2);
    expect(s.getState().compareCandidateId).toBe(1);
    expect(s.getState().selection).toEqual([2]);
  });

  it("promotes a Candidate to Select and re-seeds its neighbour", async () => {
    const s = await openInstance(1, 2, 3);
    s.setActive(1);
    s.setModule("compare");
    s.makeCompareSelect(3);
    expect(s.getState().activeId).toBe(3);
    expect(s.getState().selection).toEqual([3]);
    expect(s.getState().compareCandidateId).toBe(2); // neighbour of the last photo
  });

  it("moveCompareCandidate is a no-op on an empty buffer", () => {
    const s = new CatalogStore();
    s.moveCompareCandidate(1);
    expect(s.getState().compareCandidateId).toBeNull();
  });
});

describe("CatalogStore — Delete Rejected", () => {
  const listRejectedIds = vi.mocked(cat.listRejectedIds);

  it("queries the catalog for the paginated main library", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2), row(3)], next: { sortTime: 3, id: 3 } });
    countPhotos.mockResolvedValueOnce(3);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    listRejectedIds.mockResolvedValueOnce([2, 3]);
    const ids = await s.collectRejectedIds();

    expect(ids).toEqual([2, 3]);
    expect(listRejectedIds).toHaveBeenCalledTimes(1);
  });

  it("reads buffer rejects for a special source, without a catalog query", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    // The Duplicates source loads its whole set into the buffer (mixed flags).
    vi.mocked(cat.duplicatePhotos).mockResolvedValueOnce([
      row(1),
      { ...row(2), flag: -1 },
      { ...row(3), flag: -1 },
      { ...row(4), flag: 1 },
    ]);
    await s.showDuplicates();
    listRejectedIds.mockClear();

    const ids = await s.collectRejectedIds();

    expect(ids).toEqual([2, 3]);
    expect(listRejectedIds).not.toHaveBeenCalled();
  });

  it("surfaces a catalog failure as an error and returns no ids", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    listRejectedIds.mockRejectedValueOnce(new Error("db locked"));
    const ids = await s.collectRejectedIds();

    expect(ids).toEqual([]);
    expect(s.getState().error).toContain("db locked");
  });

  it("routes ←/→ to the Candidate in Compare, the active photo elsewhere", async () => {
    // Drives the real store singleton through handleCullingKey (the App keydown path).
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2), row(3)], next: null });
    countPhotos.mockResolvedValueOnce(3);
    await store.open("/c.galcat");
    store.setActive(2); // Select = 2
    store.setModule("compare"); // Candidate = 3

    handleCullingKey({ key: "ArrowLeft" }); // Compare: move Candidate (hops the Select) → 1
    expect(store.getState().compareCandidateId).toBe(1);
    expect(store.getState().activeId).toBe(2); // Select pinned

    store.setModule("grid");
    handleCullingKey({ key: "ArrowRight" }); // Grid: move the active photo → 3
    expect(store.getState().activeId).toBe(3);
  });
});

describe("CatalogStore — grid sort", () => {
  async function openMain(...ids: number[]) {
    listPhotos.mockResolvedValueOnce({ photos: ids.map((id) => row(id)), next: null });
    countPhotos.mockResolvedValueOnce(ids.length);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    return s;
  }

  it("defaults to capture-desc and passes it to the initial page load", async () => {
    const s = await openMain(1, 2);
    expect(s.getState().sort).toEqual({ key: "capture", ascending: false });
    expect(listPhotos).toHaveBeenLastCalledWith(expect.any(Number), null, expect.anything(), {
      key: "capture",
      ascending: false,
    });
  });

  it("setSort reloads the first page in the new order", async () => {
    const s = await openMain(1, 2, 3);
    listPhotos.mockResolvedValueOnce({ photos: [row(3), row(2), row(1)], next: null });
    countPhotos.mockResolvedValueOnce(3);

    await s.setSort({ key: "rating", ascending: true });

    expect(s.getState().sort).toEqual({ key: "rating", ascending: true });
    // Reloaded from page 1 (after = null) carrying the new sort.
    expect(listPhotos).toHaveBeenLastCalledWith(expect.any(Number), null, expect.anything(), {
      key: "rating",
      ascending: true,
    });
  });

  it("threads the active sort through loadMore", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2)], next: { sortTime: 2, id: 2 } });
    countPhotos.mockResolvedValueOnce(5);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    // Re-sort; the reload's page still has a next cursor so loadMore can proceed.
    listPhotos.mockResolvedValueOnce({ photos: [row(3), row(2)], next: { sortTime: 2, id: 2 } });
    countPhotos.mockResolvedValueOnce(5);
    await s.setSort({ key: "added", ascending: false });

    listPhotos.mockClear();
    listPhotos.mockResolvedValueOnce({ photos: [row(4)], next: null });
    await s.loadMore();

    // loadMore fetches the next page with a non-null cursor and the same sort.
    expect(listPhotos).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.objectContaining({ id: expect.any(Number) }),
      expect.anything(),
      { key: "added", ascending: false },
    );
  });

  it("setSort is a no-op when the order is unchanged", async () => {
    const s = await openMain(1, 2);
    listPhotos.mockClear();
    await s.setSort({ key: "capture", ascending: false }); // same as the default
    expect(listPhotos).not.toHaveBeenCalled();
  });

  it("threads the filename sort key through to the page load", async () => {
    const s = await openMain(1, 2);
    listPhotos.mockResolvedValueOnce({ photos: [row(2), row(1)], next: null });
    countPhotos.mockResolvedValueOnce(2);

    await s.setSort({ key: "filename", ascending: true });

    expect(s.getState().sort).toEqual({ key: "filename", ascending: true });
    expect(listPhotos).toHaveBeenLastCalledWith(expect.any(Number), null, expect.anything(), {
      key: "filename",
      ascending: true,
    });
  });
});

describe("CatalogStore — grid cell size", () => {
  it("defaults to 200 and clamps + rounds to the supported range", () => {
    const s = new CatalogStore();
    expect(s.getState().gridCellSize).toBe(200);
    s.setGridCellSize(50);
    expect(s.getState().gridCellSize).toBe(120); // GRID_CELL_MIN floor
    s.setGridCellSize(9999);
    expect(s.getState().gridCellSize).toBe(320); // GRID_CELL_MAX ceiling
    s.setGridCellSize(237.6);
    expect(s.getState().gridCellSize).toBe(238); // rounded, in range
  });

  it("is a no-op when the size is unchanged", () => {
    const s = new CatalogStore();
    s.setGridCellSize(200); // same as the default
    expect(s.getState().gridCellSize).toBe(200);
  });
});

describe("CatalogStore — grid style cycle", () => {
  it("J cycles compact → expanded → clean → compact", () => {
    const s = new CatalogStore();
    expect(s.getState().gridStyle).toBe("compact");
    s.cycleGridStyle();
    expect(s.getState().gridStyle).toBe("expanded");
    s.cycleGridStyle();
    expect(s.getState().gridStyle).toBe("clean");
    s.cycleGridStyle();
    expect(s.getState().gridStyle).toBe("compact");
  });
});

describe("CatalogStore — library undo/redo", () => {
  async function openPhotos(...ids: number[]) {
    listPhotos.mockResolvedValueOnce({ photos: ids.map((id) => row(id)), next: null });
    countPhotos.mockResolvedValueOnce(ids.length);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    return s;
  }

  it("undo restores a cull's prior flag state and redo replays it", async () => {
    const s = await openPhotos(1);
    await s.cull(1, 3, 1, "red");
    expect(s.getState().undoLabel).toBe("Rate 3★");
    expect(setFlags).toHaveBeenLastCalledWith(1, 3, 1, "red");

    await s.undo();
    expect(setFlags).toHaveBeenLastCalledWith(1, 0, 0, null); // row() defaults
    expect(s.getState().undoLabel).toBeNull();
    expect(s.getState().redoLabel).toBe("Rate 3★");

    await s.redo();
    expect(setFlags).toHaveBeenLastCalledWith(1, 3, 1, "red");
    expect(s.getState().undoLabel).toBe("Rate 3★");
    expect(s.getState().redoLabel).toBeNull();
  });

  it("a no-op cull records nothing and a new edit clears the redo branch", async () => {
    const s = await openPhotos(1, 2);
    await s.cull(1, 0, 0, null); // identical to row() defaults
    expect(s.getState().undoLabel).toBeNull();

    await s.cull(1, 2, 0, null);
    await s.undo();
    expect(s.getState().redoLabel).toBe("Rate 2★");
    await s.cull(2, 0, 1, null); // new edit → redo branch gone
    expect(s.getState().redoLabel).toBeNull();
    expect(s.getState().undoLabel).toBe("Pick");
  });

  it("cullUndoLabel names the changed field", () => {
    const base = { rating: 0, flag: 0, colorLabel: null };
    expect(cullUndoLabel(base, { ...base, rating: 4 })).toBe("Rate 4★");
    expect(cullUndoLabel({ ...base, rating: 4 }, base)).toBe("Clear Rating");
    expect(cullUndoLabel(base, { ...base, flag: -1 })).toBe("Reject");
    expect(cullUndoLabel(base, { ...base, colorLabel: "red" })).toBe("Label red");
    expect(cullUndoLabel(base, base)).toBe("Edit Photo");
  });
});

describe("CatalogStore — background export job", () => {
  it("tracks begin → tick → end and exposes cancellation to the loop", () => {
    const s = new CatalogStore();
    expect(s.getState().exportJob).toBeNull();

    s.beginExportJob(3);
    expect(s.getState().exportJob).toEqual({ done: 0, total: 3 });
    expect(s.exportCancelled()).toBe(false);

    s.tickExportJob();
    s.tickExportJob();
    expect(s.getState().exportJob).toEqual({ done: 2, total: 3 });

    s.cancelExportJob();
    expect(s.exportCancelled()).toBe(true);

    s.endExportJob();
    expect(s.getState().exportJob).toBeNull();

    // A new job resets the cancel flag.
    s.beginExportJob(1);
    expect(s.exportCancelled()).toBe(false);
  });

  it("ticks are no-ops without a job", () => {
    const s = new CatalogStore();
    s.tickExportJob();
    expect(s.getState().exportJob).toBeNull();
  });
});

describe("CatalogStore — keyword browse source", () => {
  it("setActiveKeyword loads the keyword's photos as a one-shot source", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    vi.mocked(cat.listKeywordPhotos).mockResolvedValueOnce([row(2)]);
    await s.setActiveKeyword(7);

    expect(cat.listKeywordPhotos).toHaveBeenCalledWith(7, 2000, 0, {
      key: "capture",
      ascending: false,
    });
    expect(s.getState().activeKeywordId).toBe(7);
    expect(s.getState().photos.map((p) => p.id)).toEqual([2]);
    expect(s.getState().total).toBe(1);

    // Switching to a collection clears the keyword source (mutual exclusion).
    vi.mocked(cat.listCollectionPhotos).mockResolvedValueOnce([row(1)]);
    await s.setActiveCollection(3);
    expect(s.getState().activeKeywordId).toBeNull();
  });

  it("deleteKeyword refreshes the vocabulary and exits its own source", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    vi.mocked(cat.listKeywordPhotos).mockResolvedValueOnce([row(1)]);
    await s.setActiveKeyword(7);

    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    vi.mocked(cat.listKeywords).mockResolvedValueOnce([{ id: 9, name: "sunset", count: 1 }]);
    await s.deleteKeyword(7);

    expect(cat.deleteKeyword).toHaveBeenCalledWith(7);
    expect(s.getState().activeKeywordId).toBeNull(); // back to the library
    expect(s.getState().keywords).toEqual([{ id: 9, name: "sunset", count: 1 }]);
  });
});

describe("CatalogStore — Edit Capture Time", () => {
  it("updates the buffer row and is undoable back to the prior instant", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    await s.setCaptureTime(1, 500); // row(1) starts at captureTime 1
    expect(cat.setCaptureTime).toHaveBeenLastCalledWith(1, 500);
    expect(s.getState().photos[0].captureTime).toBe(500);
    expect(s.getState().undoLabel).toBe("Edit Capture Time");

    await s.undo();
    expect(cat.setCaptureTime).toHaveBeenLastCalledWith(1, 1);
    expect(s.getState().photos[0].captureTime).toBe(1);

    await s.redo();
    expect(cat.setCaptureTime).toHaveBeenLastCalledWith(1, 500);
    expect(s.getState().photos[0].captureTime).toBe(500);
  });
});

describe("CatalogStore — geotag", () => {
  it("writes both halves, clears them, and undoes back to the prior coordinate", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    await s.setGps(1, 46.05, 14.51); // row(1) starts with no GPS
    expect(cat.setGps).toHaveBeenLastCalledWith(1, 46.05, 14.51);
    expect(s.getState().photos[0].gpsLat).toBe(46.05);
    expect(s.getState().undoLabel).toBe("Edit GPS Location");

    await s.setGps(1, null, null); // Delete GPS Location
    expect(s.getState().photos[0].gpsLon).toBe(null);
    expect(s.getState().undoLabel).toBe("Delete GPS Location");

    await s.undo();
    expect(cat.setGps).toHaveBeenLastCalledWith(1, 46.05, 14.51);
    expect([s.getState().photos[0].gpsLat, s.getState().photos[0].gpsLon]).toEqual([46.05, 14.51]);

    await s.redo();
    expect(cat.setGps).toHaveBeenLastCalledWith(1, null, null);
    expect(s.getState().photos[0].gpsLat).toBe(null);
  });
});

describe("CatalogStore — batch rename", () => {
  it("renames, reconciles paths, and undoes as one inverse batch", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    await s.renamePhotos([
      { id: 1, from: "/p1.cr3", to: "/new1.cr3" },
      { id: 2, from: "/p2.cr3", to: "/new2.cr3" },
    ]);
    expect(cat.renamePhotoFile).toHaveBeenCalledTimes(2);
    expect(s.getState().photos.map((p) => p.path)).toEqual(["/new1.cr3", "/new2.cr3"]);
    expect(s.getState().photos[0].readPath).toBe("/new1.cr3"); // unmanaged mirrors path
    expect(s.getState().undoLabel).toBe("Rename 2 Photos");

    await s.undo();
    expect(cat.renamePhotoFile).toHaveBeenLastCalledWith(2, "/p2.cr3");
    expect(s.getState().photos.map((p) => p.path)).toEqual(["/p1.cr3", "/p2.cr3"]);
  });

  it("collects per-file failures without aborting the batch", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    vi.mocked(cat.renamePhotoFile)
      .mockRejectedValueOnce(new Error("file exists"))
      .mockResolvedValueOnce("");
    await s.renamePhotos([
      { id: 1, from: "/p1.cr3", to: "/x.cr3" },
      { id: 2, from: "/p2.cr3", to: "/y.cr3" },
    ]);
    expect(s.getState().photos.map((p) => p.path)).toEqual(["/p1.cr3", "/y.cr3"]);
    expect(s.getState().notice).toContain("failed 1");
  });
});

describe("CatalogStore — folder filter", () => {
  it("setActiveFolder threads the folder into the paginated query and excludes other sources", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setActiveFolder("/shoot");

    expect(s.getState().activeFolderPath).toBe("/shoot");
    const filterArg = listPhotos.mock.calls.at(-1)![2] as { folder?: string | null };
    expect(filterArg.folder).toBe("/shoot");

    // Selecting a keyword source clears the folder filter (source semantics).
    vi.mocked(cat.listKeywordPhotos).mockResolvedValueOnce([row(2)]);
    await s.setActiveKeyword(5);
    expect(s.getState().activeFolderPath).toBeNull();
  });

  it("matchesFilter honors the folder prefix without matching same-prefix siblings", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setActiveFolder("/p1-dir");

    // cull() reconciles via matchesFilter: a photo outside the folder drops.
    // row(1).path is "/p1.cr3" — NOT under "/p1-dir/" despite the shared prefix.
    await s.cull(1, 0, 1, null);
    expect(s.getState().photos).toHaveLength(0); // dropped: fails the folder filter
  });
});

describe("CatalogStore — metadata filters", () => {
  it("threads camera/lens/year into the paginated query and reconciles culls", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1), row(2)], next: null });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setMetadataFilter({ camera: "X100V", year: 2026 });

    const filterArg = listPhotos.mock.calls.at(-1)![2] as { camera?: string | null; year?: number | null };
    expect(filterArg.camera).toBe("X100V");
    expect(filterArg.year).toBe(2026);

    // row(1) has cameraModel null → a cull drops it under the camera filter.
    await s.cull(1, 0, 1, null);
    expect(s.getState().photos).toHaveLength(0);

    // Clearing one dimension keeps the other.
    listPhotos.mockResolvedValueOnce({ photos: [], next: null });
    countPhotos.mockResolvedValueOnce(0);
    await s.setMetadataFilter({ camera: null });
    expect(s.getState().filterCamera).toBeNull();
    expect(s.getState().filterYear).toBe(2026);
  });
});

describe("CatalogStore — text targets + rating ops", () => {
  it("threads target and op into the query and reconciles title-target culls", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setTextFilter("beach");
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setTextTarget("title");

    const filterArg = listPhotos.mock.calls.at(-1)![2] as { textTarget?: string; ratingOp?: string };
    expect(filterArg.textTarget).toBe("title");
    expect(filterArg.ratingOp).toBe(">=");

    // row(1).title is null → a cull under a title-target text filter drops it.
    await s.cull(1, 0, 1, null);
    expect(s.getState().photos).toHaveLength(0);
  });

  it("rating '=' mode reconciles exact matches only", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1, 3)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    listPhotos.mockResolvedValueOnce({ photos: [row(1, 3)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setFilter(3);
    listPhotos.mockResolvedValueOnce({ photos: [row(1, 3)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.setRatingOp("=");

    // Re-rating to 4 breaks the "= 3" filter → the photo drops from the buffer.
    countPhotos.mockResolvedValueOnce(0);
    await s.cull(1, 4, 0, null);
    expect(s.getState().photos).toHaveLength(0);
  });
});

describe("CatalogStore — filter presets + lock", () => {
  it("snapshot capture/apply round-trips every dimension", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    listPhotos.mockResolvedValueOnce({ photos: [], next: null });
    countPhotos.mockResolvedValueOnce(0);
    await s.applyFilterSnapshot({
      minRating: 3, ratingOp: "=", flag: 1, label: "red",
      text: "beach", textTarget: "any", camera: "X100V", lens: null, year: 2026,
    });
    expect(s.captureFilterSnapshot()).toEqual({
      minRating: 3, ratingOp: "=", flag: 1, label: "red",
      text: "beach", textTarget: "any", camera: "X100V", lens: null, year: 2026,
    });
  });

  it("unlocked source switches clear the filter; locked keeps it", async () => {
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    listPhotos.mockResolvedValueOnce({ photos: [], next: null });
    countPhotos.mockResolvedValueOnce(0);
    await s.setFilter(3);

    // Unlocked (default): switching to a keyword source resets the filter.
    vi.mocked(cat.listKeywordPhotos).mockResolvedValueOnce([row(1)]);
    await s.setActiveKeyword(7);
    expect(s.getState().filterMinRating).toBe(0);

    // Locked: the filter survives the switch back to the library and onward.
    listPhotos.mockResolvedValueOnce({ photos: [], next: null });
    countPhotos.mockResolvedValueOnce(0);
    await s.setFilter(2);
    s.setFilterLocked(true);
    vi.mocked(cat.listKeywordPhotos).mockResolvedValueOnce([]);
    await s.setActiveKeyword(9);
    expect(s.getState().filterMinRating).toBe(2);
  });
});

describe("CatalogStore — Painter preset sprays", () => {
  async function openOne() {
    // Earlier tests can leave queued one-shot pages; reset so THIS open() gets
    // exactly the page below (leftovers otherwise shift the whole queue).
    listPhotos.mockReset();
    countPhotos.mockReset();
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    return s;
  }

  it("Target Collection spray toggles membership per clicked photo", async () => {
    const s = await openOne();
    // An earlier test's queued mockResolvedValueOnce would otherwise feed this
    // loadCollections a stray row — reset to a clean persistent implementation.
    vi.mocked(cat.listCollections).mockReset();
    vi.mocked(cat.listCollections).mockResolvedValue([
      { id: 5, name: QUICK_COLLECTION_NAME, kind: "collection", parentId: null, count: 0 },
    ] as never);
    await s.loadCollections();
    s.setPainter({ kind: "quick" });

    await s.paint(1);
    expect(cat.addToCollection).toHaveBeenCalledWith(5, 1);
  });

  it("metadata-preset spray applies the preset to the clicked photo", async () => {
    const s = await openOne();
    s.setPainter({
      kind: "metadataPreset",
      value: { id: 9, name: "Studio", creator: "Me", copyright: "©", createdAt: 0 },
    });
    await s.paint(1);
    expect(cat.setMetadata).toHaveBeenCalledWith(1, expect.objectContaining({ creator: "Me", copyright: "©" }));
  });

  it("develop-preset spray persists the preset recipe via quick develop", async () => {
    const s = await openOne();
    vi.mocked(cat.getRecipe).mockResolvedValueOnce(null);
    vi.mocked(cat.setRecipe).mockImplementation(async (_id: number, json: string) => json as never);
    const recipe = createDefaultRecipe();
    recipe.basic.exposure = 1.5;
    s.setPainter({
      kind: "preset",
      value: { id: 3, name: "Punchy", recipeJson: JSON.stringify(recipe), processVersion: null, createdAt: 0 },
    });

    await s.paint(1);
    const persisted = JSON.parse(vi.mocked(cat.setRecipe).mock.calls.at(-1)![1] as string) as {
      basic: { exposure: number };
    };
    expect(persisted.basic.exposure).toBe(1.5);
    expect(s.getState().photos[0].hasRecipe).toBe(true);
  });
});

describe("CatalogStore — rename folder", () => {
  it("repoints loaded paths, rewrites the folder filter, and undoes", async () => {
    listPhotos.mockReset();
    countPhotos.mockReset();
    listPhotos.mockResolvedValueOnce({
      photos: [
        { ...row(1), path: "/shoot/a.cr3", readPath: "/shoot/a.cr3" },
        { ...row(2), path: "/other/b.cr3", readPath: "/other/b.cr3" },
      ],
      next: null,
    });
    countPhotos.mockResolvedValueOnce(2);
    const s = new CatalogStore();
    await s.open("/c.galcat");
    listPhotos.mockResolvedValueOnce({
      photos: [
        { ...row(1), path: "/shoot/a.cr3", readPath: "/shoot/a.cr3" },
        { ...row(3), path: "/shootout/c.cr3", readPath: "/shootout/c.cr3" },
      ],
      next: null,
    });
    countPhotos.mockResolvedValueOnce(2);
    await s.setActiveFolder("/shoot");

    vi.mocked(cat.renameFolder).mockResolvedValueOnce(1);
    listPhotos.mockResolvedValueOnce({
      photos: [{ ...row(1), path: "/trip/a.cr3", readPath: "/trip/a.cr3" }],
      next: null,
    });
    countPhotos.mockResolvedValueOnce(1);
    await s.renameFolder("/shoot", "/trip");

    expect(cat.renameFolder).toHaveBeenCalledWith("/shoot", "/trip");
    expect(s.getState().activeFolderPath).toBe("/trip");
    expect(s.getState().photos.map((p) => p.path)).toEqual(["/trip/a.cr3"]);
    expect(s.getState().undoLabel).toBe("Rename Folder");

    vi.mocked(cat.renameFolder).mockResolvedValueOnce(1);
    listPhotos.mockResolvedValueOnce({
      photos: [{ ...row(1), path: "/shoot/a.cr3", readPath: "/shoot/a.cr3" }],
      next: null,
    });
    countPhotos.mockResolvedValueOnce(1);
    await s.undo();
    expect(cat.renameFolder).toHaveBeenLastCalledWith("/trip", "/shoot");
    expect(s.getState().activeFolderPath).toBe("/shoot");
    expect(s.getState().photos[0].path).toBe("/shoot/a.cr3");
  });

  it("a failed undo replay keeps the entry on the undo stack", async () => {
    listPhotos.mockReset();
    countPhotos.mockReset();
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    vi.mocked(cat.renameFolder).mockResolvedValueOnce(1);
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    await s.renameFolder("/shoot", "/trip");
    expect(s.getState().undoLabel).toBe("Rename Folder");

    vi.mocked(cat.renameFolder).mockRejectedValueOnce(new Error("a folder already exists at /shoot"));
    await s.undo();
    expect(s.getState().undoLabel).toBe("Rename Folder"); // entry NOT migrated
    expect(s.getState().redoLabel).toBe(null);
    expect(s.getState().error).toContain("already exists");
  });

  it("failed capture-time and photo-rename replays also keep their entries", async () => {
    listPhotos.mockReset();
    countPhotos.mockReset();
    listPhotos.mockResolvedValueOnce({ photos: [row(1)], next: null });
    countPhotos.mockResolvedValueOnce(1);
    const s = new CatalogStore();
    await s.open("/c.galcat");

    await s.setCaptureTime(1, 12345);
    expect(s.getState().undoLabel).toBe("Edit Capture Time");
    vi.mocked(cat.setCaptureTime).mockRejectedValueOnce(new Error("db locked"));
    await s.undo();
    expect(s.getState().undoLabel).toBe("Edit Capture Time"); // entry NOT migrated

    vi.mocked(cat.setCaptureTime).mockResolvedValueOnce(undefined);
    await s.undo(); // now it succeeds and migrates
    expect(s.getState().undoLabel).toBe(null);
    expect(s.getState().redoLabel).toBe("Edit Capture Time");

    await s.renamePhotos([{ id: 1, from: "/a/x.cr3", to: "/a/y.cr3" }]);
    expect(s.getState().undoLabel).toBe("Rename 1 Photo");
    vi.mocked(cat.renamePhotoFile).mockRejectedValueOnce(new Error("file busy"));
    await s.undo();
    expect(s.getState().undoLabel).toBe("Rename 1 Photo"); // entry NOT migrated
  });
});
