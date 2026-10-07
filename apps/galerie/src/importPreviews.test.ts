// Build Previews tiers (PERF-10): the LR ladder maps onto the preview cache
// (minimal → grid thumbnails, standard → 2560, 1:1 → native edge), and the
// embedded-preview payload parser guards the native fast path's binary shape.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("./catalog/catalog", () => ({
  addKeyword: vi.fn(),
  addToCollection: vi.fn(),
  findDuplicate: vi.fn(),
  getPhoto: vi.fn(),
}));
vi.mock("./engine", () => ({ decodeImage: vi.fn() }));
vi.mock("./lib/fingerprint", () => ({ fingerprint: vi.fn() }));
vi.mock("./lib/thumbnailLoader", () => ({
  buildPreviews: vi.fn(),
  previewTargetEdge: vi.fn<(...args: unknown[]) => number>(),
}));
vi.mock("./rawDecode", () => ({ decodeRawPath: vi.fn(), probeImageMetadata: vi.fn() }));
vi.mock("./state/store", () => ({
  store: {
    importPhotos: vi.fn(),
    notify: vi.fn(),
    applyMetadataPreset: vi.fn(),
    applyQuickDevelop: vi.fn(),
  },
}));

import { isTauri } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { getPhoto } from "./catalog/catalog";
import type { PhotoRow } from "./catalog/types";
import {
  importWithOptions,
  parseEmbeddedPreview,
  previewBuildPlan,
  type PreviewTier,
} from "./import";
import { fingerprint } from "./lib/fingerprint";
import { buildPreviews, previewTargetEdge } from "./lib/thumbnailLoader";
import { decodeRawPath, probeImageMetadata } from "./rawDecode";
import type { ImageMetadataProbe } from "./rawDecode";
import { store } from "./state/store";

describe("previewBuildPlan", () => {
  it("maps the LR ladder onto the preview cache", () => {
    expect(previewBuildPlan("none")).toBeNull();
    expect(previewBuildPlan(undefined)).toBeNull();
    expect(previewBuildPlan("minimal")).toEqual({ kind: "thumbnail", maxEdge: 256 });
    expect(previewBuildPlan("standard")).toEqual({ kind: "standard", maxEdge: 2560 });
    // 1:1 builds at each photo's own native edge (Loupe's fullEdge request).
    expect(previewBuildPlan("oneToOne")).toEqual({ kind: "standard", maxEdge: previewTargetEdge });
  });
});

describe("parseEmbeddedPreview", () => {
  const packed = (width: number, height: number, extra = 0): Uint8Array => {
    const out = new Uint8Array(8 + width * height * 4 + extra);
    new DataView(out.buffer).setUint32(0, width, true);
    new DataView(out.buffer).setUint32(4, height, true);
    return out;
  };

  it("round-trips a valid payload", () => {
    const body = packed(3, 2);
    body[8] = 0x7f;
    const { width, height, rgba } = parseEmbeddedPreview(body);
    expect([width, height]).toEqual([3, 2]);
    expect(rgba.byteLength).toBe(3 * 2 * 4);
    expect(rgba[0]).toBe(0x7f);
  });

  it("rejects short, mismatched, zero and oversized payloads", () => {
    expect(() => parseEmbeddedPreview(new Uint8Array(4))).toThrow(/short/);
    expect(() => parseEmbeddedPreview(packed(3, 2, 1))).toThrow(/invalid/);
    expect(() => parseEmbeddedPreview(packed(0, 2))).toThrow(/invalid/);
    expect(() => parseEmbeddedPreview(packed(2, 0))).toThrow(/invalid/);
    // 4097 exceeds the decoder's PROXY_MAX_EDGE — claimed dims are hostile.
    const tooBig = new Uint8Array(16);
    new DataView(tooBig.buffer).setUint32(0, 4097, true);
    new DataView(tooBig.buffer).setUint32(4, 1, true);
    expect(() => parseEmbeddedPreview(tooBig)).toThrow(/invalid/);
  });
});

describe("import-time preview build", () => {
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
  const addPlan = { handling: "add" as const, destDir: null, rename: false, template: "{name}", startNumber: 1 };
  const row = { id: 7 } as PhotoRow;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    vi.mocked(fingerprint).mockResolvedValue("ab".repeat(32));
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(decodeRawPath).mockResolvedValue({
      nativeWidth: 5920,
      nativeHeight: 3950,
      orientation: 1,
    } as Awaited<ReturnType<typeof decodeRawPath>>);
    vi.mocked(probeImageMetadata).mockResolvedValue(emptyProbe);
    vi.mocked(store.importPhotos).mockResolvedValue([7]);
    vi.mocked(getPhoto).mockResolvedValue(row);
  });

  const importTier = (tier: PreviewTier) =>
    importWithOptions(["/photos/a.dng"], addPlan, {
      keywords: [],
      metadataPreset: null,
      previewTier: tier,
    });

  it("minimal warms the grid-thumbnail cache", async () => {
    await importTier("minimal");
    expect(buildPreviews).toHaveBeenCalledExactlyOnceWith([row], "thumbnail", 256);
  });

  it("standard warms the 2560px standard-preview cache", async () => {
    await importTier("standard");
    expect(buildPreviews).toHaveBeenCalledExactlyOnceWith([row], "standard", 2560);
  });

  it("1:1 builds standard previews at each photo's native edge", async () => {
    await importTier("oneToOne");
    expect(buildPreviews).toHaveBeenCalledExactlyOnceWith([row], "standard", previewTargetEdge);
  });

  it("none builds nothing", async () => {
    await importTier("none");
    expect(buildPreviews).not.toHaveBeenCalled();
  });

  it("the legacy buildPreviews boolean still means standard", async () => {
    await importWithOptions(["/photos/a.dng"], addPlan, {
      keywords: [],
      metadataPreset: null,
      buildPreviews: true,
    });
    expect(buildPreviews).toHaveBeenCalledExactlyOnceWith([row], "standard", 2560);
  });
});
