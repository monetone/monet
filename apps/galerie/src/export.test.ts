import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => false),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
vi.mock("./catalog/catalog", () => ({
  getDevelopExportIdentity: vi.fn(),
  getRecipe: vi.fn(),
  listPhotoKeywords: vi.fn(async () => []),
  onRecipeChanged: vi.fn(() => () => {}),
  // formatExportResult lives in ExportDialog, which imports the store — these
  // are the exports the store module touches at load.
  catalogAvailable: () => true,
}));

import { invoke } from "@tauri-apps/api/core";
import { getDevelopExportIdentity } from "./catalog/catalog";
import type { PhotoRow } from "./catalog/types";
import { outputFilename, runExport } from "./export";
import { formatExportResult } from "./ui/ExportDialog";

const photo = {
  id: 7,
  sourceAssetId: 3,
  path: "/photos/selected.cr3",
  format: "raw:CR3",
  copyName: null,
} as PhotoRow;

const nativeResult = (terminal: Record<string, unknown> = { state: "completed", durabilityError: null }) => ({
  jobId: "job-1",
  sourceDigest: "ab".repeat(32),
  recipeDigest: "cd".repeat(32),
  output: {
    width: 100,
    height: 50,
    bitsPerSample: 16,
    samplesPerPixel: 3,
    orientation: 1,
    profile: "displayP3",
    intent: "relativeColorimetric",
    blackPointCompensation: false,
    iccDigest: "ef".repeat(32),
    outputDigest: "12".repeat(32),
    bytes: 1234,
  },
  provenance: {},
  timings: [{ stage: "finalize", milliseconds: 1 }],
  ...terminal,
});

function mockIdentity() {
  vi.mocked(getDevelopExportIdentity).mockResolvedValue({
    catalogId: "/catalogs/current.galcat",
    photo,
    sourceDigest: "ab".repeat(32),
    canonicalRecipeJson: '{"processVersion":6}',
  });
}

beforeEach(() => vi.clearAllMocks());

it("binds native TIFF export to one catalog-owned identity and recipe snapshot", async () => {
  mockIdentity();
  vi.mocked(invoke).mockResolvedValue(nativeResult());

  await expect(
    runExport([photo], "/exports", {
      format: "tiff16",
      quality: 1,
      longEdge: null,
      profile: "displayP3",
    }),
  ).resolves.toEqual({ written: 1, committed: 0, failed: 0, durabilityWarnings: [], failureMessages: [] });

  expect(invoke).toHaveBeenCalledExactlyOnceWith("plugin:develop-job|run_develop_export", {
    request: {
      jobId: expect.any(String),
      source: {
        path: photo.path,
        catalogId: "/catalogs/current.galcat",
        photoId: photo.id,
        expectedDigest: "ab".repeat(32),
      },
      canonicalRecipeJson: '{"processVersion":6}',
      output: { path: "/exports/selected.tiff", profile: "displayP3" },
      interactive: false,
    },
  });
});

it("sends the immutable managed read path, not the display path, for a managed DNG", async () => {
  const managedPhoto = {
    id: 9,
    sourceAssetId: 5,
    path: "/photos/original.dng",
    readPath: "/catalogs/current-assets/managed-originals/sha256/ab/abcdef.dng",
    format: "raw:DNG",
    copyName: null,
  } as PhotoRow;
  vi.mocked(getDevelopExportIdentity).mockResolvedValue({
    catalogId: "/catalogs/current.galcat",
    photo: managedPhoto,
    sourceDigest: "ab".repeat(32),
    canonicalRecipeJson: '{"processVersion":6}',
  });
  vi.mocked(invoke).mockResolvedValue(nativeResult());

  await expect(
    runExport([managedPhoto], "/exports", {
      format: "tiff16",
      quality: 1,
      longEdge: null,
      profile: "displayP3",
    }),
  ).resolves.toEqual({ written: 1, committed: 0, failed: 0, durabilityWarnings: [], failureMessages: [] });

  expect(invoke).toHaveBeenCalledExactlyOnceWith("plugin:develop-job|run_develop_export", {
    request: {
      jobId: expect.any(String),
      source: {
        // path != readPath for a managed DNG — the request must carry the
        // immutable managed copy, never the mutable display path.
        path: managedPhoto.readPath,
        catalogId: "/catalogs/current.galcat",
        photoId: managedPhoto.id,
        expectedDigest: "ab".repeat(32),
      },
      canonicalRecipeJson: '{"processVersion":6}',
      output: { path: "/exports/original.tiff", profile: "displayP3" },
      interactive: false,
    },
  });
});

it("preserves a committed result and its durability warning without counting a durable write", async () => {
  mockIdentity();
  vi.mocked(invoke).mockResolvedValue(nativeResult({
    state: "committed",
    durabilityError: "parent directory sync failed",
  }));

  await expect(runExport([photo], "/exports", {
    format: "tiff16",
    quality: 1,
    longEdge: null,
    profile: "displayP3",
  })).resolves.toEqual({
    written: 0,
    committed: 1,
    failed: 0,
    durabilityWarnings: ["parent directory sync failed"],
    failureMessages: [],
  });
});

it.each([
  ["malformed", {}],
  ["unknown", nativeResult({ state: "mystery", durabilityError: null })],
  ["failed", nativeResult({ state: "failed", durabilityError: null })],
])("rejects a %s native terminal payload", async (_label, result) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockIdentity();
  vi.mocked(invoke).mockResolvedValue(result);
  await expect(runExport([photo], "/exports", {
    format: "tiff16",
    quality: 1,
    longEdge: null,
  })).resolves.toMatchObject({ written: 0, committed: 0, failed: 1, durabilityWarnings: [] });
});

it("renders retained-partial and replacement failures visibly", () => {
  expect(formatExportResult({
    written: 0,
    committed: 0,
    failed: 2,
    durabilityWarnings: [],
    failureMessages: [
      "partial requires manual removal",
      "replacement was left untouched",
    ],
  })).toBe("Exported 0 · 2 failed: partial requires manual removal; replacement was left untouched.");
});

it.each([
  ["completed/error", { state: "completed", durabilityError: "sync failed" }],
  ["committed/null", { state: "committed", durabilityError: null }],
])("rejects the %s terminal mismatch", async (_label, terminal) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockIdentity();
  vi.mocked(invoke).mockResolvedValue(nativeResult(terminal));
  await expect(runExport([photo], "/exports", {
    format: "tiff16",
    quality: 1,
    longEdge: null,
  })).resolves.toMatchObject({ written: 0, committed: 0, failed: 1, durabilityWarnings: [] });
});

it("refuses a stale selected row before invoking the native command", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getDevelopExportIdentity).mockResolvedValue({
    catalogId: "/catalogs/current.galcat",
    photo: { ...photo, path: "/photos/replaced.cr3" },
    sourceDigest: "ab".repeat(32),
    canonicalRecipeJson: '{"processVersion":6}',
  });

  await expect(
    runExport([photo], "/exports", {
      format: "tiff16",
      quality: 1,
      longEdge: null,
    }),
  ).resolves.toMatchObject({ written: 0, committed: 0, failed: 1, durabilityWarnings: [] });
  expect(invoke).not.toHaveBeenCalled();
});

it.each([
  ["collision", "exclusively create output destination: File exists"],
  ["retained partial", "incomplete output remains at destination with mode 0600 and requires manual removal or replacement"],
  ["replacement", "output destination changed or was removed; any replacement was left untouched"],
])("returns the visible %s failure message", async (_label, message) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockIdentity();
  vi.mocked(invoke).mockRejectedValue(new Error(message));
  await expect(runExport([photo], "/exports", {
    format: "tiff16",
    quality: 1,
    longEdge: null,
  })).resolves.toEqual({
    written: 0,
    committed: 0,
    failed: 1,
    durabilityWarnings: [],
    failureMessages: [`${photo.path}: Error: ${message}`],
  });
});

it("outputFilename: naming=null keeps the source stem", () => {
  expect(outputFilename(photo, 0, { format: "jpeg", quality: 1, longEdge: null, naming: null })).toBe("selected.jpg");
});

it("outputFilename: sequence = startNumber + index, zero-padded", () => {
  const opts = {
    format: "jpeg" as const,
    quality: 1,
    longEdge: null,
    naming: { template: "{name}-{sequence:3}", customText: "", startNumber: 1 },
  };
  expect(outputFilename(photo, 0, opts)).toBe("selected-001.jpg");
  expect(outputFilename(photo, 2, opts)).toBe("selected-003.jpg");
});

it("outputFilename: naming applies to the native tiff16 route too", () => {
  const name = outputFilename(photo, 0, {
    format: "tiff16",
    quality: 1,
    longEdge: null,
    naming: { template: "{customtext}-{sequence:2}", customText: "Shot", startNumber: 5 },
  });
  expect(name).toBe("Shot-05.tiff");
});

it("refuses a wide-gamut color space on the native 16-bit route", async () => {
  mockIdentity();
  const res = await runExport([photo], "/exports", {
    format: "tiff16",
    quality: 1,
    longEdge: null,
    profile: "adobeRGB",
  });
  expect(res.failed).toBe(1);
  expect(res.failureMessages[0]).toContain("sRGB and Display P3 only");
  // The refusal must land before the plugin call — never a half-run native job.
  expect(invoke).not.toHaveBeenCalled();
});
