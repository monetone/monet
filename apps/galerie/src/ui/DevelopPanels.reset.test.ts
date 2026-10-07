// DevelopPanels.reset.test — GAL-DEV-20: Reset Adjustments must actually reset.
// Covers both routes: an open DevelopView claims the cancelable event (no store
// write — the view owns the recipe), otherwise the store persists the default
// recipe onto every target photo, recording a History step for photos whose
// recipe differed and none for already-default ones.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  // The develop persist path returns the canonical recipe JSON the native side
  // accepted — echo the input so history diffing sees real bytes.
  setRecipe: vi.fn(async (_id: number, json: string) => json),
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

import { createDefaultRecipe } from "@monet-ui/monet-photo";
import { invoke } from "@tauri-apps/api/core";

import * as cat from "../catalog/catalog";
import type { PhotoRow } from "../catalog/types";
import { store } from "../state/store";
import { DEVELOP_RESET_EVENT, resetDevelopAdjustments } from "./DevelopPanels";

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
    hasRecipe: true,
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
const getRecipe = vi.mocked(cat.getRecipe);
const setRecipe = vi.mocked(cat.setRecipe);
const recordHistory = vi.mocked(cat.recordHistory);

/** An edited (non-default) recipe JSON — what a developed photo would carry. */
function editedJson(): string {
  const r = createDefaultRecipe();
  return JSON.stringify({ ...r, basic: { ...r.basic, exposure: 0.5 } });
}

async function openWith(rows: PhotoRow[]): Promise<void> {
  listPhotos.mockResolvedValueOnce({ photos: rows, next: null });
  countPhotos.mockResolvedValueOnce(rows.length);
  await store.open("/c.galcat");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
  setRecipe.mockImplementation(async (_id: number, json: string) => json);
  // Node test env has no window; the dispatch only needs an EventTarget.
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resetDevelopAdjustments (GAL-DEV-20)", () => {
  it("an open DevelopView claims the event: no store write", async () => {
    await openWith([row(1)]);
    store.select(1);
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener(DEVELOP_RESET_EVENT, claim);

    resetDevelopAdjustments();
    await Promise.resolve();

    window.removeEventListener(DEVELOP_RESET_EVENT, claim);
    expect(setRecipe).not.toHaveBeenCalled();
    expect(recordHistory).not.toHaveBeenCalled();
  });

  it("unclaimed: persists the default recipe to every selected photo with a History step", async () => {
    await openWith([row(1), row(2), row(3)]);
    store.select(1);
    store.select(2, true);
    getRecipe.mockResolvedValue(editedJson());

    resetDevelopAdjustments();
    await vi.waitFor(() => expect(setRecipe).toHaveBeenCalledTimes(2));

    const defaults = JSON.stringify(createDefaultRecipe());
    expect(setRecipe.mock.calls.map(([id, json]) => [id, json])).toEqual([
      [1, defaults],
      [2, defaults],
    ]);
    // The reset differs from each photo's baseline → one History entry each.
    await vi.waitFor(() => expect(recordHistory).toHaveBeenCalledTimes(2));
  });

  it("unclaimed with no selection: resets the active photo only", async () => {
    await openWith([row(1), row(2)]);
    store.setActive(2);
    getRecipe.mockResolvedValue(editedJson());

    resetDevelopAdjustments();
    await vi.waitFor(() => expect(setRecipe).toHaveBeenCalledTimes(1));
    expect(setRecipe.mock.calls[0][0]).toBe(2);
  });

  it("an already-default photo records no History step", async () => {
    await openWith([row(1)]);
    store.select(1);
    getRecipe.mockResolvedValue(JSON.stringify(createDefaultRecipe()));

    resetDevelopAdjustments();
    await vi.waitFor(() => expect(setRecipe).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(recordHistory).not.toHaveBeenCalled();
  });
});
