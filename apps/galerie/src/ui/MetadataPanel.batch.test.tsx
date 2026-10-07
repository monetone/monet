// MetadataPanel.batch.test — GAL-LIB-06: the IPTC field editors hit the WHOLE
// selection (LR: N selected, differing fields show `<mixed>`, typing writes to
// all N), and Sync Metadata pushes the active photo's fields to the selection.
// Mirrors culling.batch.test.ts's mocked catalog bridge.

import { renderToStaticMarkup } from "react-dom/server";
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

// Keep the sidecar machinery inert — this test is about catalog writes only.
vi.mock("../import", () => ({ readSidecarDocument: vi.fn(async () => null) }));
vi.mock("../lib/xmpAutoWrite", () => ({
  queueXmpWrite: vi.fn(),
  recordMetadataRead: vi.fn(async () => {}),
  writeSidecarForPhoto: vi.fn(async () => {}),
  metadataStatusFor: vi.fn(async () => "unknown"),
  hierarchicalPaths: vi.fn((names: string[]) => names),
}));

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
  listSnapshots: vi.fn(async () => []),
  addSnapshot: vi.fn(async () => 1),
  recordHistory: vi.fn(async () => {}),
  addKeyword: vi.fn(async () => 1),
  removeKeyword: vi.fn(async () => {}),
  replacePhotoKeywords: vi.fn(async () => {}),
  listPhotoKeywords: vi.fn(async () => []),
  onPhotoRecipeChanged: vi.fn(() => () => {}),
  onRecipeChanged: vi.fn(() => () => {}),
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
  addMetadataPreset: vi.fn(async () => 1),
  deleteMetadataPreset: vi.fn(async () => {}),
  listMetadataPresets: vi.fn(async () => []),
  findDuplicate: vi.fn(async () => null),
  getPhoto: vi.fn(async () => null),
}));

import * as cat from "../catalog/catalog";
import { readSidecarDocument } from "../import";
import { invoke } from "@tauri-apps/api/core";
import type { PhotoRow } from "../catalog/types";
import { CatalogStore, store } from "../state/store";
import { IptcFields, commitIptcEdits, mixedIptcKeys, readMetadataFromFiles, syncMetadata } from "./MetadataPanel";

function row(id: number, meta: Partial<PhotoRow> = {}): PhotoRow {
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
    ...meta,
  };
}

const listPhotos = vi.mocked(cat.listPhotos);
const countPhotos = vi.mocked(cat.countPhotos);
const setMetadata = vi.mocked(cat.setMetadata);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

async function openWith(s: CatalogStore, rows: PhotoRow[]): Promise<void> {
  listPhotos.mockResolvedValueOnce({ photos: rows, next: null });
  countPhotos.mockResolvedValueOnce(rows.length);
  await s.open("/c.galcat");
}

describe("mixedIptcKeys", () => {
  it("names exactly the fields where the selection disagrees", () => {
    const keys = mixedIptcKeys([
      row(1, { title: "A", city: "Paris" }),
      row(2, { title: "B", city: "Paris" }),
    ]);
    expect(keys).toEqual(new Set(["title"]));
  });

  it("treats null and empty the same photo count as uniform for one photo", () => {
    expect(mixedIptcKeys([row(1, { title: "A" })]).size).toBe(0);
  });
});

describe("commitIptcEdits (multi-photo field commit)", () => {
  it("writes only the edited fields to every target, preserving per-photo values", async () => {
    await openWith(store, [
      row(1, { title: "A", city: "Paris" }),
      row(2, { title: "B", city: "Lyon" }),
    ]);
    const photos = store.getState().photos;

    await commitIptcEdits(photos, { caption: "hello" });

    expect(setMetadata.mock.calls).toEqual([
      [1, expect.objectContaining({ title: "A", caption: "hello", city: "Paris" })],
      [2, expect.objectContaining({ title: "B", caption: "hello", city: "Lyon" })],
    ]);
    expect(store.getState().photos.map((p) => p.caption)).toEqual(["hello", "hello"]);
    expect(store.getState().photos.map((p) => p.title)).toEqual(["A", "B"]);
  });

  it("normalizes a cleared field to null and skips empty edit sets", async () => {
    await openWith(store, [row(1, { title: "A" }), row(2, { title: "B" })]);

    await commitIptcEdits(store.getState().photos, {});
    expect(setMetadata).not.toHaveBeenCalled();

    await commitIptcEdits(store.getState().photos, { title: "" });
    expect(setMetadata.mock.calls.map(([, m]) => m.title)).toEqual([null, null]);
    expect(store.getState().photos.map((p) => p.title)).toEqual([null, null]);
  });
});

describe("syncMetadata (Metadata ▸ Sync Metadata)", () => {
  it("pushes the active photo's IPTC fields to the rest of the selection", async () => {
    await openWith(store, [
      row(1, { title: "keep", creator: "Ana", copyright: "© Ana" }),
      row(2, { title: "other" }),
      row(3),
    ]);
    // Additive select keeps the last-clicked photo active: selection [2,3,1], active 1.
    store.select(2);
    store.select(3, true);
    store.select(1, true);

    await syncMetadata(1);

    expect(setMetadata.mock.calls).toEqual([
      [2, expect.objectContaining({ title: "keep", creator: "Ana", copyright: "© Ana" })],
      [3, expect.objectContaining({ title: "keep", creator: "Ana", copyright: "© Ana" })],
    ]);
    expect(store.getState().photos.map((p) => p.creator)).toEqual(["Ana", "Ana", "Ana"]);
  });

  it("writes nothing without a multi-selection", async () => {
    await openWith(store, [row(1, { title: "solo" }), row(2)]);
    store.select(1);

    await syncMetadata(1);
    expect(setMetadata).not.toHaveBeenCalled();
  });
});

describe("IptcFields render", () => {
  it("shows <mixed> as placeholder for differing fields, values for uniform ones", () => {
    const html = renderToStaticMarkup(
      <IptcFields photos={[row(1, { title: "A", city: "Paris" }), row(2, { title: "B", city: "Paris" })]} />,
    );
    expect(html).toContain("&lt;mixed&gt;");
    expect(html).toContain("Paris");
    expect(html).not.toContain('value="A"');
  });
});

describe("readMetadataFromFiles (Metadata ▸ Read Metadata from File)", () => {
  const sidecar = (snapshots: { name: string; recipe: unknown }[]) => ({
    metadata: { keywords: [], hierarchical: [] },
    recipe: null,
    snapshots,
  });

  it("restores the sidecar's snapshots, skipping names the catalog already has", async () => {
    await openWith(store, [row(1)]);
    store.select(1);
    vi.mocked(cat.listSnapshots).mockResolvedValue([
      { id: 7, name: "Punchy", recipeJson: "{}", processVersion: null },
    ] as never);
    vi.mocked(readSidecarDocument).mockResolvedValue(
      sidecar([{ name: "Punchy", recipe: { exposure: 1 } }, { name: "Flat", recipe: { exposure: -1 } }]) as never,
    );

    await readMetadataFromFiles(1);

    // "Punchy" already exists — the catalog's copy wins, so only "Flat" is added.
    expect(vi.mocked(cat.addSnapshot).mock.calls).toEqual([
      [1, "Flat", JSON.stringify({ exposure: -1 })],
    ]);
  });

  it("adds nothing when the sidecar carries no snapshots", async () => {
    await openWith(store, [row(1)]);
    store.select(1);
    vi.mocked(cat.listSnapshots).mockResolvedValue([] as never);
    vi.mocked(readSidecarDocument).mockResolvedValue(sidecar([]) as never);

    await readMetadataFromFiles(1);
    expect(cat.addSnapshot).not.toHaveBeenCalled();
  });
});
