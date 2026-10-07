// Import-time DAM ingest (GAL-IMP-01): embedded IPTC + .xmp sidecar metadata
// must enter the catalog with the photo instead of being discarded. Covers the
// pure merge (mergeIngestedMetadata) and the end-to-end wiring: an import whose
// probe/sidecar carry metadata lands setMetadata/setFlags/addKeyword calls on
// the freshly imported id.
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
}));
vi.mock("./catalog/catalog", () => ({
  addKeyword: vi.fn(),
  addToCollection: vi.fn(),
  findDuplicate: vi.fn(),
  getPhoto: vi.fn(),
  setFlags: vi.fn(),
  setMetadata: vi.fn(),
}));
vi.mock("./engine", () => ({ decodeImage: vi.fn() }));
vi.mock("./lib/fingerprint", () => ({ fingerprint: vi.fn() }));
vi.mock("./lib/thumbnailLoader", () => ({ buildPreviews: vi.fn() }));
vi.mock("./rawDecode", () => ({ decodeRawPath: vi.fn(), probeImageMetadata: vi.fn() }));
vi.mock("./state/store", () => ({
  store: {
    importPhotos: vi.fn(),
    notify: vi.fn(),
    reload: vi.fn(),
    applyQuickDevelop: vi.fn(),
  },
}));

import { createDefaultRecipe, serializeCameraRawXmp, type DevelopRecipeV2 } from "@monet-ui/monet-photo";
import { isTauri } from "@tauri-apps/api/core";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { addKeyword, setFlags, setMetadata } from "./catalog/catalog";
import { decodeRawPath, probeImageMetadata } from "./rawDecode";
import type { ImageMetadataProbe } from "./rawDecode";
import { fingerprint } from "./lib/fingerprint";
import { importPaths, mergeIngestedMetadata, type EmbeddedIptc } from "./import";
import { store } from "./state/store";

const emptyProbe: ImageMetadataProbe = {
  available: true,
  mtime: null,
  captureTime: null,
  cameraMake: null,
  cameraModel: null,
  lens: null,
  iso: null,
  fNumber: null,
  focalLength: null,
  exposureTime: null,
  gpsLat: null,
  gpsLon: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  vi.mocked(readTextFile).mockRejectedValue(new Error("no sidecar"));
  vi.mocked(fingerprint).mockResolvedValue("ab".repeat(32));
  vi.mocked(decodeRawPath).mockResolvedValue({
    nativeWidth: 5920,
    nativeHeight: 3950,
    orientation: 1,
  } as Awaited<ReturnType<typeof decodeRawPath>>);
  vi.mocked(probeImageMetadata).mockResolvedValue(emptyProbe);
  vi.mocked(store.importPhotos).mockResolvedValue([7]);
});

it("merges embedded IPTC into the ingest state when there is no sidecar", () => {
  const ingest = mergeIngestedMetadata(
    { title: "A title", creator: "Jane", city: " Ljubljana ", keywords: ["alpha", "beta"], rating: 3 },
    null,
  );
  expect(ingest).not.toBeNull();
  expect(ingest!.meta.title).toBe("A title");
  expect(ingest!.meta.creator).toBe("Jane");
  expect(ingest!.meta.city).toBe("Ljubljana");
  expect(ingest!.meta.caption).toBeNull();
  expect(ingest!.keywords).toEqual(["alpha", "beta"]);
  expect(ingest!.rating).toBe(3);
  expect(ingest!.label).toBeNull();
  expect(ingest!.recipe).toBeNull();
});

it("lets the sidecar win per field, unions keywords, and takes hierarchical leaves", () => {
  const patch = { basic: { exposure: 1 } } as Partial<DevelopRecipeV2>;
  const ingest = mergeIngestedMetadata(
    { title: "Embedded title", creator: "Jane", keywords: ["alpha"], rating: 2 },
    {
      metadata: {
        title: "Sidecar title",
        rating: 4,
        label: "Red",
        keywords: ["beta"],
        hierarchical: ["animals|cat"],
      },
      recipe: patch,
      snapshots: [],
    },
  );
  expect(ingest!.meta.title).toBe("Sidecar title"); // sidecar wins
  expect(ingest!.meta.creator).toBe("Jane"); // embedded fills the gap
  expect(ingest!.keywords).toEqual(["alpha", "beta", "cat"]);
  expect(ingest!.rating).toBe(4);
  expect(ingest!.label).toBe("Red");
  expect(ingest!.recipe).toBe(patch); // carried through untouched
});

it("returns null when the file carries no metadata at all", () => {
  expect(mergeIngestedMetadata(emptyProbe as ImageMetadataProbe & EmbeddedIptc, null)).toBeNull();
  expect(mergeIngestedMetadata(null, null)).toBeNull();
  // Blank/zero values are absence, not state.
  expect(mergeIngestedMetadata({ title: "  ", keywords: [], rating: 0 }, null)).toBeNull();
});

it("clamps an out-of-range rating into 0..5", () => {
  expect(mergeIngestedMetadata({ rating: 99 }, null)!.rating).toBe(5);
  expect(mergeIngestedMetadata({ title: "x", rating: -3 }, null)!.rating).toBe(0);
});

it("applies embedded IPTC, rating and keywords to the imported photo", async () => {
  vi.mocked(probeImageMetadata).mockResolvedValue({
    ...emptyProbe,
    title: "A title",
    creator: "Jane",
    keywords: ["alpha", "beta"],
    rating: 3,
  } as ImageMetadataProbe);

  const count = await importPaths(["/card/shot.arw"]);

  expect(count).toBe(1);
  expect(setMetadata).toHaveBeenCalledWith(7, expect.objectContaining({ title: "A title", creator: "Jane" }));
  expect(setFlags).toHaveBeenCalledWith(7, 3, 0, null);
  expect(addKeyword).toHaveBeenCalledWith(7, "alpha");
  expect(addKeyword).toHaveBeenCalledWith(7, "beta");
  expect(store.reload).toHaveBeenCalled();
});

it("reads a real .xmp sidecar beside the source and applies its metadata + recipe", async () => {
  // A genuine shared-dialect sidecar, so the parse path runs for real.
  const developed = createDefaultRecipe();
  developed.basic.exposure = 0.5;
  const xml = serializeCameraRawXmp({
    recipe: developed,
    metadata: {
      rating: 5,
      label: "Blue",
      title: "Sidecar title",
      caption: null,
      creator: "Jane",
      copyright: null,
      city: "Ljubljana",
      keywords: ["cat"],
      hierarchical: ["animals|cat"],
    },
  });
  vi.mocked(readTextFile).mockImplementation(async (p) => {
    if (p !== "/card/shot.xmp") throw new Error(`unexpected sidecar read: ${p}`);
    return xml;
  });

  await importPaths(["/card/shot.arw"]);

  expect(setMetadata).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ title: "Sidecar title", creator: "Jane", city: "Ljubljana" }),
  );
  expect(setFlags).toHaveBeenCalledWith(7, 5, 0, "Blue");
  expect(addKeyword).toHaveBeenCalledWith(7, "cat");
  expect(addKeyword).toHaveBeenCalledTimes(1); // hierarchical leaf deduped
  expect(store.applyQuickDevelop).toHaveBeenCalledWith([7], expect.any(Function));
});

it("touches no metadata APIs when the import carries none", async () => {
  await importPaths(["/card/shot.arw"]);
  expect(setMetadata).not.toHaveBeenCalled();
  expect(setFlags).not.toHaveBeenCalled();
  expect(addKeyword).not.toHaveBeenCalled();
  expect(store.reload).not.toHaveBeenCalled();
});
