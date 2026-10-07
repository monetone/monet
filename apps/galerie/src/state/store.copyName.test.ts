// store.copyName.test — Set Copy Name… and batch Create Virtual Copy against a
// mocked catalog bridge. The SQL semantics (masters have no copy name, blank
// clears, copyName is text-searchable) live in the Rust unit tests; here we
// prove the store writes the right ids, reconciles the loaded buffer, and that
// ⌘' / the context menu act on the whole selection.

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
  createVirtualCopy: vi.fn<(...args: unknown[]) => Promise<number>>(async () => 1),
  setCopyName: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  makeMasterPhoto: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
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
  // Pulled in by the context-menu import chain (thumbnail loader).
  onRecipeChanged: vi.fn(() => () => {}),
}));

import * as cat from "../catalog/catalog";
import type { PhotoRow } from "../catalog/types";
import { photoContextItems, type PhotoContextDeps } from "../ui/PhotoContextMenu";
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

async function openStore(photos: PhotoRow[]): Promise<CatalogStore> {
  listPhotos.mockResolvedValue({ photos, next: null });
  countPhotos.mockResolvedValue(photos.length);
  const s = new CatalogStore();
  await s.open("/c.galcat");
  return s;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("virtual copies", () => {
  it("creates one copy per selected photo and focuses the last", async () => {
    const s = await openStore([row(1), row(2), row(3)]);
    vi.mocked(cat.createVirtualCopy).mockResolvedValueOnce(11).mockResolvedValueOnce(12);

    const last = await s.createVirtualCopy([1, 2]);

    expect(vi.mocked(cat.createVirtualCopy).mock.calls).toEqual([[1], [2]]);
    expect(last).toBe(12);
    expect(s.getState().activeId).toBe(12);
    expect(s.getState().notice).toContain("2 virtual copies");
  });

  it("still takes a single id (menu/Develop callers)", async () => {
    const s = await openStore([row(1)]);
    vi.mocked(cat.createVirtualCopy).mockResolvedValueOnce(11);

    expect(await s.createVirtualCopy(1)).toBe(11);
    expect(cat.createVirtualCopy).toHaveBeenCalledWith(1);
  });

  it("keeps the copies made before a mid-batch failure", async () => {
    const s = await openStore([row(1), row(2)]);
    vi.mocked(cat.createVirtualCopy)
      .mockResolvedValueOnce(11)
      .mockRejectedValueOnce(new Error("disk full"));

    expect(await s.createVirtualCopy([1, 2])).toBe(11);
    expect(s.getState().error).toContain("disk full");
  });
});

describe("set copy name", () => {
  it("trims the name and patches the loaded copy", async () => {
    const s = await openStore([row(1), row(2, { isVirtualCopy: true, copyName: "Copy 1" })]);

    await s.setCopyName(2, "  Black & White  ");

    expect(cat.setCopyName).toHaveBeenCalledWith(2, "Black & White");
    expect(s.getState().photos.find((p) => p.id === 2)!.copyName).toBe("Black & White");
  });

  it("clears a blank name to null and never names a master", async () => {
    const s = await openStore([row(1), row(2, { isVirtualCopy: true, copyName: "Copy 1" })]);

    await s.setCopyName(2, "   ");
    expect(cat.setCopyName).toHaveBeenCalledWith(2, null);
    expect(s.getState().photos.find((p) => p.id === 2)!.copyName).toBeNull();

    await s.setCopyName(1, "Nope");
    expect(s.getState().photos.find((p) => p.id === 1)!.copyName).toBeNull();
  });
});

describe("make master photo", () => {
  it("promotes the copy and reloads", async () => {
    const s = await openStore([row(1), row(2, { isVirtualCopy: true, copyName: "Copy 1" })]);

    await s.makeMasterPhoto(2);

    expect(cat.makeMasterPhoto).toHaveBeenCalledWith(2);
    expect(listPhotos).toHaveBeenCalledTimes(2); // open + the reload
    expect(s.getState().notice).toBe("Made master photo.");
  });

  it("reports a rejected promotion without reloading", async () => {
    const s = await openStore([row(1), row(2, { isVirtualCopy: true, copyName: "Copy 1" })]);
    vi.mocked(cat.makeMasterPhoto).mockRejectedValueOnce(new Error("photo 2 is not a virtual copy"));

    await s.makeMasterPhoto(2);

    // A rejected promotion changed nothing — don't reload a lie over the grid.
    expect(listPhotos).toHaveBeenCalledTimes(1); // open only
    expect(s.getState().notice).toContain("not a virtual copy");
  });
});

describe("context menu gating", () => {
  const deps = (targets: PhotoRow[]): PhotoContextDeps => ({
    targets,
    collections: [],
    activeCollectionId: null,
    quickMemberIds: [],
    folderPaths: [],
    labels: {},
    onRemove: () => {},
  });
  const item = (targets: PhotoRow[], id: string) => {
    const found = photoContextItems(deps(targets)).find((i) => i.id === id);
    if (!found) throw new Error(`missing menu item ${id}`);
    return found;
  };

  it("enables Set Copy Name… only for a single virtual copy", () => {
    const copy = row(2, { isVirtualCopy: true, copyName: "Copy 1" });
    expect(item([copy], "copyname").disabled).toBe(false);
    expect(item([row(1)], "copyname").disabled).toBe(true);
    expect(item([copy, row(3, { isVirtualCopy: true })], "copyname").disabled).toBe(true);
  });

  it("Create Virtual Copy stays enabled for a multi-photo selection", () => {
    expect(item([row(1), row(2)], "vcopy").disabled).toBe(false);
  });
});
