// MetadataPresets.fields.test — GAL-META-05: a metadata preset carries the whole
// IPTC set with a per-field checkbox, not just creator/copyright. Present key =
// the preset writes it ("" clears), absent key = the photo keeps its own value,
// and the preset's keywords ADD to each photo's set.
// Mirrors MetadataPresets.copy.test.ts's mocked catalog bridge.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => 1),
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => true),
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock("../lib/fingerprint", () => ({ fingerprint: vi.fn(async () => "fp-new") }));

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

import { invoke } from "@tauri-apps/api/core";

import * as cat from "../catalog/catalog";
import type { MetadataPresetRow, PhotoMetadata, PhotoRow } from "../catalog/types";
import { CatalogStore, store } from "../state/store";
import {
  applyMetadataPreset,
  presetFields,
  presetSeedFromPhoto,
  saveMetadataPreset,
  type MetadataPresetFields,
} from "./MetadataPresets";

/** A catalog row widened with the IPTC columns beyond the original ten — the
 *  native row carries them, `catalog/types.ts` still only names the ten. */
type WideRow = PhotoRow & Record<string, unknown>;

function row(id: number, meta: Record<string, unknown> = {}): WideRow {
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
  } as WideRow;
}

/** A preset row as the catalog serves it: the field map plus the legacy
 *  creator/copyright projection. */
function preset(name: string, fields: MetadataPresetFields): MetadataPresetRow {
  return {
    id: 1,
    name,
    creator: fields.creator ?? null,
    copyright: fields.copyright ?? null,
    fields,
    createdAt: 0,
  } as MetadataPresetRow;
}

/** The patch as it reaches the IPC layer: PhotoMetadata plus the IPTC columns
 *  `catalog/types.ts` does not name. */
const wide = (m: PhotoMetadata): Record<string, unknown> => m as unknown as Record<string, unknown>;

const listPhotos = vi.mocked(cat.listPhotos);
const countPhotos = vi.mocked(cat.countPhotos);
const setMetadata = vi.mocked(cat.setMetadata);
const addKeyword = vi.mocked(cat.addKeyword);

beforeEach(() => {
  vi.clearAllMocks();
});

async function openWith(s: CatalogStore, rows: PhotoRow[]): Promise<void> {
  listPhotos.mockResolvedValueOnce({ photos: rows, next: null });
  countPhotos.mockResolvedValueOnce(rows.length);
  await s.open("/c.galcat");
}

describe("metadata presets (LR Edit Metadata Presets)", () => {
  it("writes every checked field, clears a checked-but-empty one, and leaves the rest per-photo", async () => {
    await openWith(store, [
      row(1, { creator: "Old", headline: "Keep 1", rightsUsageTerms: "Old terms", city: "Nice" }),
      row(2, { creator: null, headline: "Keep 2", rightsUsageTerms: null, city: null }),
    ]);

    const n = await applyMetadataPreset(
      preset("Studio", {
        creator: "Ada Studio",
        copyright: "© 2026 Ada",
        rightsUsageTerms: "Editorial use only",
        creatorEmail: "", // checked but empty → clears whatever the photo had
      }),
      [1, 2],
    );

    expect(n).toBe(2);
    expect(setMetadata.mock.calls.map(([id]) => id)).toEqual([1, 2]);
    for (const [, meta] of setMetadata.mock.calls) {
      const m = wide(meta);
      expect(m.creator).toBe("Ada Studio");
      expect(m.copyright).toBe("© 2026 Ada");
      expect(m.rightsUsageTerms).toBe("Editorial use only");
      expect(m.creatorEmail).toBeNull();
    }
    // Unchecked fields keep each photo's own value — the whole point of the
    // per-field checkboxes.
    const first = wide(setMetadata.mock.calls[0]![1]);
    const second = wide(setMetadata.mock.calls[1]![1]);
    expect(first.headline).toBe("Keep 1");
    expect(second.headline).toBe("Keep 2");
    expect(first.city).toBe("Nice");
    expect(second.city).toBeNull();
    expect(addKeyword).not.toHaveBeenCalled();
  });

  it("adds the preset's keywords to every photo without touching IPTC when no field is checked", async () => {
    await openWith(store, [row(1, { creator: "Mine" }), row(2)]);

    const n = await applyMetadataPreset(preset("Tagger", { keywords: ["studio", "2026"] }), [1, 2]);

    expect(n).toBe(2);
    expect(setMetadata).not.toHaveBeenCalled();
    expect(addKeyword.mock.calls).toEqual([
      [1, "studio"],
      [1, "2026"],
      [2, "studio"],
      [2, "2026"],
    ]);
  });

  it("saves the whole field map through the catalog command", async () => {
    const fields: MetadataPresetFields = { creator: "Ada", creatorPhone: "", keywords: ["studio"] };
    await saveMetadataPreset("  Studio  ", fields);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["plugin:catalog|catalog_add_metadata_preset", { name: "  Studio  ", fields }],
    ]);
  });

  it("seeds a new preset from the active photo's non-empty fields, minus title/caption", () => {
    const seed = presetSeedFromPhoto(
      row(1, { title: "One photo", caption: "One caption", creator: "Ada", credit: "", country: "SI" }),
    );
    expect(seed).toEqual({ creator: "Ada", country: "SI" });
  });

  it("treats a row with no field map as writing nothing", async () => {
    await openWith(store, [row(1, { creator: "Mine" })]);
    const legacy = { id: 9, name: "Old", creator: "Them", copyright: null, createdAt: 0 } as MetadataPresetRow;

    expect(presetFields(legacy)).toEqual({});
    expect(await applyMetadataPreset(legacy, [1])).toBe(0);
    expect(setMetadata).not.toHaveBeenCalled();
  });
});
