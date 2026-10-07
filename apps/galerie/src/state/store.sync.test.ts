// store.sync.test — GAL-DEV-19: Sync Settings (scoped), Auto Sync's remembered
// scope, Match Total Exposures, and the prevActiveId that feeds Develop's
// Previous button. The catalog bridge is mocked; what's proven here is which
// recipe bytes land on which ids.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  isTauri: () => false,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => true),
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock("../lib/fingerprint", () => ({ fingerprint: vi.fn(async () => "fp") }));

vi.mock("../catalog/catalog", () => ({
  catalogAvailable: () => true,
  openCatalog: vi.fn(async () => 1),
  closeCatalog: vi.fn(async () => {}),
  importPhoto: vi.fn(async () => 1),
  createVirtualCopy: vi.fn(async () => 1),
  setCopyName: vi.fn(async () => {}),
  listPhotos: vi.fn(),
  countPhotos: vi.fn(),
  duplicatePhotos: vi.fn(async () => []),
  setFlags: vi.fn(async () => {}),
  setMetadata: vi.fn(async () => {}),
  setRecipe: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  getRecipe: vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => null),
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
  onRecipeChanged: vi.fn(() => () => {}),
}));

import { createDefaultRecipe, normalizeRecipe, type DevelopRecipeV2 } from "@monet-ui/monet-photo";

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

async function openStore(photos: PhotoRow[]): Promise<CatalogStore> {
  vi.mocked(cat.listPhotos).mockResolvedValue({ photos, next: null });
  vi.mocked(cat.countPhotos).mockResolvedValue(photos.length);
  const s = new CatalogStore();
  await s.open("/c.galcat");
  return s;
}

/** Seed the mocked catalog so each id reads back its own recipe. */
function seedRecipes(recipes: Record<number, DevelopRecipeV2>): void {
  vi.mocked(cat.getRecipe).mockImplementation(async (...args: unknown[]) => {
    const r = recipes[args[0] as number];
    return r ? JSON.stringify(r) : null;
  });
}

/** The recipe last written for `id` by cat.setRecipe. */
function written(id: number): DevelopRecipeV2 {
  const calls = vi.mocked(cat.setRecipe).mock.calls.filter((c) => c[0] === id);
  expect(calls.length).toBeGreaterThan(0);
  return JSON.parse(calls[calls.length - 1][1] as string) as DevelopRecipeV2;
}

function withBasic(patch: Partial<DevelopRecipeV2["basic"]>): DevelopRecipeV2 {
  const d = createDefaultRecipe();
  return normalizeRecipe({ ...d, basic: { ...d.basic, ...patch } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Sync Settings", () => {
  it("pushes only the scoped panels, leaving each target's other panels intact", async () => {
    const s = await openStore([row(1), row(2)]);
    const source = normalizeRecipe({ ...withBasic({ exposure: 1.5 }), effects: { ...createDefaultRecipe().effects, vignetteAmount: -40 } });
    const target = normalizeRecipe({ ...createDefaultRecipe(), effects: { ...createDefaultRecipe().effects, vignetteAmount: 25 } });
    seedRecipes({ 1: source, 2: target });

    await s.syncDevelop(1, [1, 2], { scope: ["basic"] });

    const out = written(2);
    expect(out.basic.exposure).toBeCloseTo(1.5, 5);
    expect(out.effects.vignetteAmount).toBeCloseTo(25, 5); // unscoped panel survived
    expect(vi.mocked(cat.setRecipe).mock.calls.some((c) => c[0] === 1)).toBe(false); // never writes the source
  });

  it("remembers the dialog's scope so a later Auto Sync mirrors the same panels, quietly", async () => {
    const s = await openStore([row(1), row(2), row(3)]);
    const source = normalizeRecipe({ ...withBasic({ exposure: 1.5 }), effects: { ...createDefaultRecipe().effects, vignetteAmount: -40 } });
    const target = normalizeRecipe({ ...createDefaultRecipe(), effects: { ...createDefaultRecipe().effects, vignetteAmount: 25 } });
    seedRecipes({ 1: source, 2: target, 3: target });

    await s.syncDevelop(1, [1, 2], { scope: ["basic"] });
    const notice = s.getState().notice;
    expect(notice).toContain("Synced settings to 1 photo");

    // Auto Sync's call: no scope, quiet — reuses the remembered ["basic"].
    await s.syncDevelop(1, [1, 3], { quiet: true });

    const out = written(3);
    expect(out.basic.exposure).toBeCloseTo(1.5, 5);
    expect(out.effects.vignetteAmount).toBeCloseTo(25, 5);
    expect(s.getState().notice).toBe(notice); // quiet: no new toast
  });

  it("does nothing when the source is the only photo selected", async () => {
    const s = await openStore([row(1)]);
    seedRecipes({ 1: withBasic({ exposure: 1 }) });

    await s.syncDevelop(1, [1]);

    expect(cat.setRecipe).not.toHaveBeenCalled();
  });
});

describe("Match Total Exposures", () => {
  // f/2 @ 1/100 ISO 100 → EV 8.64; f/4 @ 1/100 ISO 100 → EV 10.64 (2 stops darker).
  const bright = { iso: 100, fNumber: 2, exposureTime: 0.01 };
  const dark = { iso: 100, fNumber: 4, exposureTime: 0.01 };

  it("carries the capture-EV delta onto each target's Exposure", async () => {
    const s = await openStore([row(1, bright), row(2, dark), row(3)]);
    seedRecipes({ 1: withBasic({ exposure: 0.25 }) });

    await s.matchTotalExposures(1, [1, 2, 3]);

    expect(written(2).basic.exposure).toBeCloseTo(2.25, 4); // 0.25 + (10.64 − 8.64)
    // Photo 3 has no exposure triad — skipped rather than guessed at.
    expect(vi.mocked(cat.setRecipe).mock.calls.some((c) => c[0] === 3)).toBe(false);
    expect(s.getState().notice).toContain("Matched exposures on 1 photo");
  });

  it("refuses when the source photo has no exposure metadata", async () => {
    const s = await openStore([row(1), row(2, dark)]);

    await s.matchTotalExposures(1, [1, 2]);

    expect(cat.setRecipe).not.toHaveBeenCalled();
    expect(s.getState().notice).toContain("needs ISO, aperture and shutter speed");
  });
});

describe("Previous (prevActiveId)", () => {
  it("remembers the photo we left, from any activeId move", async () => {
    const s = await openStore([row(1), row(2), row(3)]);
    expect(s.getState().prevActiveId).toBeNull();

    s.setActive(1);
    expect(s.getState().prevActiveId).toBeNull(); // nothing was active before

    s.setActive(2);
    expect(s.getState().prevActiveId).toBe(1);

    // Not only setActive: moveActive walks the buffer through the same setter.
    s.moveActive(1);
    expect(s.getState().activeId).toBe(3);
    expect(s.getState().prevActiveId).toBe(2);
  });
});
