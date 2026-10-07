// catalogInterchange.test — the store half of "Export as Catalog…" /
// "Import from Another Catalog…". The merge itself is SQL and is proven in Rust
// (src-tauri/src/catalog.rs, catalog::tests::import_from_catalog_*); what is
// checked here is the part a user meets: the dry run does NOT touch the
// library, a real merge reloads it, and a native failure is said out loud
// instead of reported as success.

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => true),
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock("../catalog/catalog", () => ({
  catalogAvailable: () => true,
  openCatalog: vi.fn(async () => 1),
  listPhotos: vi.fn(async () => ({ photos: [], next: null })),
  countPhotos: vi.fn(async () => 0),
  listCollections: vi.fn(async () => []),
  listCollectionPhotos: vi.fn(async () => []),
  listKeywords: vi.fn(async () => []),
  listFolders: vi.fn(async () => []),
  listFilterOptions: vi.fn(async () => ({ cameras: [], lenses: [], years: [] })),
}));

import { invoke } from "@tauri-apps/api/core";
import * as cat from "../catalog/catalog";
import { CatalogStore, mergeSummary, type CatalogMergeReport } from "./store";

const report = (over: Partial<CatalogMergeReport> = {}): CatalogMergeReport => ({
  photosAdded: 12,
  photosUpdated: 0,
  photosSkipped: 3,
  collectionsAdded: 1,
  keywordsAdded: 4,
  ...over,
});

/** A store pointed at an open catalog (`open` is what makes it `ready`). */
async function openStore(): Promise<CatalogStore> {
  const store = new CatalogStore();
  await store.open("/photos/main.galcat");
  return store;
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.mocked(cat.listCollections).mockClear();
});

it("says what a merge did, counting only the outcomes that happened", () => {
  expect(mergeSummary(report({ photosSkipped: 0, collectionsAdded: 0, keywordsAdded: 0 }))).toBe(
    "12 new photos.",
  );
  const full = mergeSummary(report({ photosUpdated: 2 }));
  expect(full).toContain("12 new photos");
  expect(full).toContain("2 updated");
  expect(full).toContain("3 already here, left alone");
  expect(full).toContain("1 new collections");
  expect(full).toContain("4 new keywords");
});

it("previews a merge without writing anything or disturbing the library", async () => {
  const store = await openStore();
  vi.mocked(cat.listCollections).mockClear();
  vi.mocked(invoke).mockResolvedValue(report());

  expect(await store.importFromCatalog("/trip/laptop.galcat", false, true)).toEqual(report());
  expect(invoke).toHaveBeenCalledWith("plugin:catalog|catalog_import_from_catalog", {
    source: "/trip/laptop.galcat",
    replaceExisting: false,
    dryRun: true,
  });
  // A dry run is a preview: no reload, and nothing on screen claiming a merge.
  expect(cat.listCollections).not.toHaveBeenCalled();
  expect(store.getState().notice ?? "").not.toContain("Merged");
});

it("commits a merge, reports it, and reloads the library it just changed", async () => {
  const store = await openStore();
  vi.mocked(cat.listCollections).mockClear();
  vi.mocked(invoke).mockResolvedValue(report({ photosUpdated: 3, photosSkipped: 0 }));

  await store.importFromCatalog("/trip/laptop.galcat", true);
  expect(invoke).toHaveBeenCalledWith("plugin:catalog|catalog_import_from_catalog", {
    source: "/trip/laptop.galcat",
    replaceExisting: true,
    dryRun: false,
  });
  expect(store.getState().notice).toContain("laptop.galcat");
  expect(store.getState().notice).toContain("12 new photos");
  // The incoming collections and keywords are new rows — the panels must refetch.
  expect(cat.listCollections).toHaveBeenCalled();
  expect(cat.listKeywords).toHaveBeenCalled();
});

it("surfaces a native merge failure instead of reporting success", async () => {
  const store = await openStore();
  vi.mocked(invoke).mockRejectedValue(new Error("that catalog is already open"));

  expect(await store.importFromCatalog("/photos/main.galcat", false)).toBeNull();
  expect(store.getState().notice).toContain("that catalog is already open");
});

it("refuses to merge or export with no catalog open, and says so", async () => {
  const store = new CatalogStore();
  expect(await store.importFromCatalog("/trip/laptop.galcat", false)).toBeNull();
  expect(store.getState().notice).toContain("Open a catalog");
  expect(await store.exportAsCatalog("/out/subset.galcat", [1, 2])).toBe(false);
  expect(invoke).not.toHaveBeenCalledWith(
    "plugin:catalog|catalog_export_as_catalog",
    expect.anything(),
  );
});

it("exports the ids it was handed and names the count it wrote", async () => {
  const store = await openStore();
  vi.mocked(invoke).mockResolvedValue(2);

  expect(await store.exportAsCatalog("/out/subset.galcat", [7, 9])).toBe(true);
  expect(invoke).toHaveBeenCalledWith("plugin:catalog|catalog_export_as_catalog", {
    ids: [7, 9],
    dest: "/out/subset.galcat",
  });
  expect(store.getState().notice).toContain("2 photos");
  expect(store.getState().notice).toContain("subset.galcat");
});

it("surfaces a native export failure instead of reporting success", async () => {
  const store = await openStore();
  vi.mocked(invoke).mockRejectedValue(new Error("disk full"));

  expect(await store.exportAsCatalog("/out/subset.galcat", [7])).toBe(false);
  expect(store.getState().notice).toContain("disk full");
});
