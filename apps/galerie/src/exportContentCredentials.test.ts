// Export ▸ Content Credentials (Beta) — the C2PA manifest the catalog assembles
// (`catalog_content_credentials`) has to land beside the exported file, and an
// export must never lose a written image over a provenance detail. The native
// (tiff16) route throughout: it needs no engine and takes the same destination
// the JPEG/PNG route writes.

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => false),
  mkdir: vi.fn(),
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
  writeFile: vi.fn(),
  writeTextFile: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));
vi.mock("./catalog/catalog", () => ({
  getDevelopExportIdentity: vi.fn(),
  getRecipe: vi.fn(),
  listPhotoKeywords: vi.fn(async () => []),
  onRecipeChanged: vi.fn(() => () => {}),
  catalogAvailable: () => true,
}));

import { invoke } from "@tauri-apps/api/core";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { getDevelopExportIdentity } from "./catalog/catalog";
import type { PhotoRow } from "./catalog/types";
import { type ExportOptions, runExport } from "./export";

const photo = {
  id: 7,
  sourceAssetId: 3,
  path: "/photos/selected.cr3",
  readPath: "/photos/selected.cr3",
  format: "raw:CR3",
  copyName: null,
} as PhotoRow;

const opts: ExportOptions = { format: "tiff16", quality: 1, longEdge: null, profile: "srgb", contentCredentials: true };

const MANIFEST = '{"claim_generator_info":[{"name":"Monet Galerie","version":"0.1.0"}]}';

const nativeResult = {
  jobId: "job-1",
  sourceDigest: "ab".repeat(32),
  recipeDigest: "cd".repeat(32),
  output: {
    width: 100, height: 50, bitsPerSample: 16, samplesPerPixel: 3, orientation: 1,
    profile: "srgb", intent: "relativeColorimetric", blackPointCompensation: false,
    iccDigest: "ef".repeat(32), outputDigest: "12".repeat(32), bytes: 1234,
  },
  provenance: {},
  timings: [{ stage: "finalize", milliseconds: 1 }],
  state: "completed",
  durabilityError: null,
};

/** Credentials come back per command name — everything else is the develop
 *  job, except the signer-info probe `runExport` makes once per batch (see
 *  `signerConfigured`), which defaults to "nothing imported" so these tests
 *  exercise the unsigned-sidecar path unless a test opts into a signer. */
function mockBackend(credentials: () => Promise<unknown>, signerInfo: unknown = null) {
  vi.mocked(invoke).mockImplementation(async (cmd: unknown) => {
    if (cmd === "plugin:catalog|catalog_content_credentials") return credentials();
    if (cmd === "plugin:c2pa|c2pa_signer_info") return signerInfo;
    return nativeResult;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDevelopExportIdentity).mockResolvedValue({
    catalogId: "/catalogs/current.galcat",
    photo,
    sourceDigest: "ab".repeat(32),
    canonicalRecipeJson: '{"processVersion":6}',
  });
  mockBackend(async () => ({ manifestJson: MANIFEST, parentPath: photo.path }));
});

it("writes the catalog's manifest beside each exported file, keyed on the photo", async () => {
  await expect(runExport([photo], "/exports", opts)).resolves.toMatchObject({ written: 1, failureMessages: [] });
  expect(invoke).toHaveBeenCalledWith("plugin:catalog|catalog_content_credentials", { id: 7 });
  // Full output name, not the stem: a JPEG and a TIFF of one photo keep both.
  expect(writeTextFile).toHaveBeenCalledWith("/exports/selected.tiff.c2pa.json", MANIFEST);
});

it("attaches nothing unless the export asks for it", async () => {
  await expect(runExport([photo], "/exports", { ...opts, contentCredentials: false })).resolves.toMatchObject({ written: 1 });
  expect(writeTextFile).not.toHaveBeenCalled();
  expect(vi.mocked(invoke).mock.calls.map((c) => c[0])).not.toContain("plugin:catalog|catalog_content_credentials");
});

it("claims nothing over an untouched Original copy", async () => {
  await expect(runExport([photo], "/exports", { ...opts, format: "original" })).resolves.toMatchObject({ written: 1 });
  expect(writeTextFile).not.toHaveBeenCalled();
});

it("keeps the written image when the manifest cannot be assembled", async () => {
  mockBackend(async () => { throw new Error("no catalog open"); });
  const res = await runExport([photo], "/exports", opts);
  // The file is on disk — a missing sidecar is a warning, never a failed export.
  expect(res).toMatchObject({ written: 1, failed: 0 });
  expect(res.failureMessages[0]).toContain("content credentials");
});

it("signs and embeds the manifest instead of writing the sidecar once a signer is configured", async () => {
  const signedBytes = new Uint8Array([9, 9, 9]).buffer;
  vi.mocked(invoke).mockImplementation(async (cmd: unknown) => {
    if (cmd === "plugin:catalog|catalog_content_credentials") return { manifestJson: MANIFEST, parentPath: photo.path };
    if (cmd === "plugin:c2pa|c2pa_signer_info") return { issuer: "Test CA", certSerial: "1", alg: "es256", tsaUrl: null };
    if (cmd === "plugin:c2pa|sign_content_credentials") return signedBytes;
    return nativeResult;
  });

  const res = await runExport([photo], "/exports", opts);
  expect(res).toMatchObject({ written: 1, failureMessages: [] });
  // The already-written native TIFF is read back and re-signed — TIFF is a
  // signable container (`signableMime`), same as Vision's `SIGNABLE_MIMES`.
  expect(invoke).toHaveBeenCalledWith(
    "plugin:c2pa|sign_content_credentials",
    new Uint8Array([1, 2, 3]),
    { headers: { "x-c2pa-mime": "image/tiff", "x-c2pa-photo-id": "7" } },
  );
  expect(writeFile).toHaveBeenCalledWith("/exports/selected.tiff", new Uint8Array(signedBytes));
  expect(writeTextFile).not.toHaveBeenCalled(); // embedded, not sidecar
});

it("tells the caller once when Content Credentials falls back to the sidecar for lack of a signer", async () => {
  let unsigned = 0;
  await runExport([photo], "/exports", opts, { onUnsignedCredentials: () => { unsigned++; } });
  expect(unsigned).toBe(1);
  expect(writeTextFile).toHaveBeenCalledWith("/exports/selected.tiff.c2pa.json", MANIFEST);
});

it("never warns about an unsigned fallback when Content Credentials wasn't requested", async () => {
  let unsigned = 0;
  await runExport([photo], "/exports", { ...opts, contentCredentials: false }, { onUnsignedCredentials: () => { unsigned++; } });
  expect(unsigned).toBe(0);
});
