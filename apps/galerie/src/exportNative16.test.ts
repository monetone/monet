// The native 16-bit finish pass — GAL-OUT-14. The Rust develop-export writes a
// full-frame RGB16 TIFF / linear DNG; everything after develop (crop+straighten,
// output sizing, sharpening, watermark, XMP metadata) is applied app-side here,
// so a cropped or watermarked photo is exportable at 16 bits instead of refused.

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => false),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("./catalog/catalog", () => ({
  getDevelopExportIdentity: vi.fn(),
  getRecipe: vi.fn(),
  listPhotoKeywords: vi.fn(async () => []),
  onRecipeChanged: vi.fn(() => () => {}),
  catalogAvailable: () => true,
}));

import { invoke } from "@tauri-apps/api/core";
import { readFile, remove, writeFile } from "@tauri-apps/plugin-fs";

import { getDevelopExportIdentity } from "./catalog/catalog";
import type { PhotoRow } from "./catalog/types";
import { runExport, type ExportOptions } from "./export";

const photo = {
  id: 7,
  sourceAssetId: 3,
  path: "/photos/selected.cr3",
  format: "raw:CR3",
  copyName: null,
  title: "Harbour at dawn",
} as PhotoRow;

const nativeResult = {
  jobId: "job-1",
  sourceDigest: "ab".repeat(32),
  recipeDigest: "cd".repeat(32),
  output: {
    width: 4, height: 2, bitsPerSample: 16, samplesPerPixel: 3, orientation: 1,
    profile: "srgb", intent: "relativeColorimetric", blackPointCompensation: false,
    iccDigest: "ef".repeat(32), outputDigest: "12".repeat(32), bytes: 1234,
  },
  provenance: {},
  timings: [{ stage: "finalize", milliseconds: 1 }],
  state: "completed",
  durabilityError: null,
};

const dngResult = {
  ...nativeResult,
  output: {
    width: 4, height: 2, bitsPerSample: 16, samplesPerPixel: 3, orientation: 1,
    photometric: 34892, outputDigest: "12".repeat(32), expectedPixelDigest: "34".repeat(32), bytes: 1234,
  },
};

const IDENTITY_CROP = '"crop":{"rect":{"left":0,"top":0,"right":1,"bottom":1},"angle":0}';
const LEFT_HALF_CROP = '"crop":{"rect":{"left":0,"top":0,"right":0.5,"bottom":1},"angle":0}';

function mockIdentity(recipeBody: string): void {
  vi.mocked(getDevelopExportIdentity).mockResolvedValue({
    catalogId: "/catalogs/current.galcat",
    photo,
    sourceDigest: "ab".repeat(32),
    canonicalRecipeJson: `{"processVersion":6,${recipeBody},"masks":{"masks":[]}}`,
  });
}

const opts = (over: Partial<ExportOptions> = {}): ExportOptions =>
  ({ format: "tiff16", quality: 1, longEdge: null, profile: "srgb", ...over });

// ── A stand-in for the file the Rust writer publishes ─────────────────────────

const ICC = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

/** 4×2 sample ramp: each pixel is (x*1000, y*1000, x+y) — distinct 16-bit
 *  values so a crop can be checked sample-exactly. */
const SAMPLES = (() => {
  const out = new Uint16Array(4 * 2 * 3);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 3;
      out[i] = x * 1000; out[i + 1] = y * 1000; out[i + 2] = x + y;
    }
  }
  return out;
})();

interface Entry { tag: number; type: number; count: number; value?: number; data?: Uint8Array }

/** Build the little-endian, uncompressed, MULTI-strip RGB16 TIFF the native
 *  writer emits (independent of export.ts's own writer, on purpose). */
function nativeTiff(width: number, height: number, samples: Uint16Array, rowsPerStrip: number): Uint8Array<ArrayBuffer> {
  const stripCount = Math.ceil(height / rowsPerStrip);
  const offsets = new Uint8Array(stripCount * 4);
  const counts = new Uint8Array(stripCount * 4);
  const shorts = (v: number[]): Uint8Array => {
    const out = new Uint8Array(v.length * 2);
    const dv = new DataView(out.buffer);
    v.forEach((n, i) => dv.setUint16(i * 2, n, true));
    return out;
  };
  const entries: Entry[] = [
    { tag: 256, type: 4, count: 1, value: width },
    { tag: 257, type: 4, count: 1, value: height },
    { tag: 258, type: 3, count: 3, data: shorts([16, 16, 16]) },
    { tag: 259, type: 3, count: 1, value: 1 },
    { tag: 262, type: 3, count: 1, value: 2 },
    { tag: 273, type: 4, count: stripCount, data: offsets },
    { tag: 274, type: 3, count: 1, value: 1 },
    { tag: 277, type: 3, count: 1, value: 3 },
    { tag: 278, type: 4, count: 1, value: rowsPerStrip },
    { tag: 279, type: 4, count: stripCount, data: counts },
    { tag: 34675, type: 7, count: ICC.length, data: ICC },
  ];
  let at = 8 + 2 + entries.length * 12 + 4;
  for (const e of entries) {
    if (e.data && e.data.length > 4) { at += at % 2; e.value = at; at += e.data.length; }
  }
  at += at % 2;
  const pixelStart = at;
  const od = new DataView(offsets.buffer);
  const cd = new DataView(counts.buffer);
  for (let s = 0; s < stripCount; s++) {
    const rows = Math.min(rowsPerStrip, height - s * rowsPerStrip);
    od.setUint32(s * 4, at, true);
    cd.setUint32(s * 4, rows * width * 3 * 2, true);
    at += rows * width * 3 * 2;
  }
  const out = new Uint8Array(at);
  const dv = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, entries.length, true);
  entries.forEach((e, i) => {
    const p = 10 + i * 12;
    dv.setUint16(p, e.tag, true); dv.setUint16(p + 2, e.type, true); dv.setUint32(p + 4, e.count, true);
    if (e.data && e.data.length > 4) { dv.setUint32(p + 8, e.value!, true); out.set(e.data, e.value!); }
    else if (e.data) out.set(e.data, p + 8);
    else if (e.type === 3) dv.setUint16(p + 8, e.value!, true);
    else dv.setUint32(p + 8, e.value!, true);
  });
  dv.setUint32(10 + entries.length * 12, 0, true);
  out.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), pixelStart);
  return out;
}

// ── Reading what the finish pass wrote ────────────────────────────────────────

interface ReadTiff {
  first: number;
  tags: Map<number, { type: number; count: number; at: number }>;
  block(tag: number): Uint8Array;
  num(tag: number): number;
  samples(): Uint16Array;
}

function readTiff(bytes: Uint8Array): ReadTiff {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(bytes[0]).toBe(0x49);
  const first = dv.getUint32(4, true);
  const n = dv.getUint16(first, true);
  const tags = new Map<number, { type: number; count: number; at: number }>();
  for (let i = 0; i < n; i++) {
    const at = first + 2 + i * 12;
    tags.set(dv.getUint16(at, true), { type: dv.getUint16(at + 2, true), count: dv.getUint32(at + 4, true), at: at + 8 });
  }
  const SIZE: Record<number, number> = { 1: 1, 3: 2, 4: 4, 7: 1 };
  const base = (tag: number): number => {
    const e = tags.get(tag)!;
    return SIZE[e.type] * e.count <= 4 ? e.at : dv.getUint32(e.at, true);
  };
  const num = (tag: number): number => {
    const e = tags.get(tag)!;
    return e.type === 3 ? dv.getUint16(base(tag), true) : dv.getUint32(base(tag), true);
  };
  return {
    first,
    tags,
    num,
    block: (tag) => {
      const e = tags.get(tag)!;
      return bytes.slice(base(tag), base(tag) + e.count * SIZE[e.type]);
    },
    samples: () => {
      const count = num(279) / 2;
      const out = new Uint16Array(count);
      for (let i = 0; i < count; i++) out[i] = dv.getUint16(num(273) + i * 2, true);
      return out;
    },
  };
}

/** The bytes the batch actually published, and where. */
const written = (): { path: string; bytes: Uint8Array } => {
  const call = vi.mocked(writeFile).mock.calls[0] as unknown as [string, Uint8Array];
  return { path: call[0], bytes: call[1] };
};

const nativePath = (): string =>
  ((vi.mocked(invoke).mock.calls[0][1] as { request: { output: { path: string } } }).request.output.path);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(nativeResult);
  vi.mocked(readFile).mockResolvedValue(nativeTiff(4, 2, SAMPLES, 1));
});

it("crops the native 16-bit TIFF and carries its ICC + catalog metadata", async () => {
  mockIdentity(LEFT_HALF_CROP);

  await expect(runExport([photo], "/exports", opts())).resolves.toMatchObject({ written: 1, failed: 0 });

  // The native writer publishes to a part-file; the finished file is the one
  // that lands on the target path, and the part-file is cleaned up.
  expect(nativePath()).toBe("/exports/selected.tiff.monetpart");
  expect(remove).toHaveBeenCalledWith("/exports/selected.tiff.monetpart");
  const out = written();
  expect(out.path).toBe("/exports/selected.tiff");

  const tiff = readTiff(out.bytes);
  expect(tiff.num(256)).toBe(2); // cropped to the left half
  expect(tiff.num(257)).toBe(2);
  expect(tiff.num(259)).toBe(1); // uncompressed
  expect(tiff.num(262)).toBe(2); // RGB
  expect(Array.from(tiff.block(258))).toEqual([16, 0, 16, 0, 16, 0]);
  expect(Array.from(tiff.block(34675))).toEqual(Array.from(ICC)); // the output profile survives
  expect(new TextDecoder().decode(tiff.block(700))).toContain("Harbour at dawn");
  // A 1:1 crop samples pixel centres exactly — the left half, sample for sample.
  expect(Array.from(tiff.samples())).toEqual([
    0, 0, 0, 1000, 0, 1,
    0, 1000, 1, 1000, 1000, 2,
  ]);
});

it("resizes and sharpens the 16-bit route the way the JPEG route does", async () => {
  mockIdentity(IDENTITY_CROP);

  await expect(runExport([photo], "/exports", opts({
    resize: { mode: "longEdge", value: 2, dontEnlarge: true },
    ppi: 300,
    sharpen: { media: "screen", amount: "high" },
  }))).resolves.toMatchObject({ written: 1, failed: 0 });

  const tiff = readTiff(written().bytes);
  expect(tiff.num(256)).toBe(2); // long edge 4 → 2
  expect(tiff.num(257)).toBe(1);
  expect(tiff.num(296)).toBe(2); // ResolutionUnit: inch
  expect(tiff.num(282)).toBeGreaterThan(0);
  // Sharpening pushed the bright side of the ramp above what a plain resize
  // would have produced (bilinear of x=0,1 and x=2,3 → 500 and 2500).
  const red = tiff.samples()[3];
  expect(red).toBeGreaterThan(2500);
});

it("burns the watermark into the 16-bit samples", async () => {
  mockIdentity(IDENTITY_CROP);
  // The overlay is an 8-bit canvas render everywhere in the app; stub the canvas
  // so the node test can check the 16-bit source-over blend itself.
  const overlay = new Uint8ClampedArray(4 * 2 * 4);
  overlay[0] = 255; overlay[1] = 255; overlay[2] = 255; overlay[3] = 255; // opaque white on pixel 0
  const ctx = {
    save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {}, fillText: () => {},
    measureText: () => ({ width: 1 }),
    getImageData: () => ({ data: overlay }),
  };
  vi.stubGlobal("OffscreenCanvas", class { getContext() { return ctx; } });

  await expect(runExport([photo], "/exports", opts({
    watermark: { mode: "text", text: "© Monet", anchor: "bottom-right", opacity: 1, sizePct: 10, insetPct: 2 },
  }))).resolves.toMatchObject({ written: 1, failed: 0 });

  const samples = readTiff(written().bytes).samples();
  expect(Array.from(samples.subarray(0, 3))).toEqual([65535, 65535, 65535]); // fully covered
  expect(Array.from(samples.subarray(3, 6))).toEqual([1000, 0, 1]);          // untouched
  vi.unstubAllGlobals();
});

it("embeds metadata in a linear DNG without moving a byte the native writer wrote", async () => {
  mockIdentity(IDENTITY_CROP);
  vi.mocked(invoke).mockResolvedValue(dngResult);
  const source = nativeTiff(4, 2, SAMPLES, 1); // a DNG is the same container
  vi.mocked(readFile).mockResolvedValue(source);

  await expect(runExport([photo], "/exports", opts({ format: "linearDng16" }))).resolves.toMatchObject({ written: 1, failed: 0 });

  const out = written();
  expect(out.path).toBe("/exports/selected.dng");
  // Everything the native writer validated is byte-identical; the packet and a
  // rewritten IFD are appended and the header re-pointed.
  expect(Array.from(out.bytes.subarray(0, source.length)).slice(8)).toEqual(Array.from(source).slice(8));
  const tiff = readTiff(out.bytes);
  expect(tiff.first).toBeGreaterThan(source.length);
  expect(new TextDecoder().decode(tiff.block(700))).toContain("Harbour at dawn");
  expect(Array.from(tiff.block(34675))).toEqual(Array.from(ICC)); // untouched offsets still resolve
  expect(tiff.samples().length).toBe(4 * 3); // one strip's worth, still readable
});

it("refuses only what the pipeline genuinely cannot render", async () => {
  // Linear DNG is a raw deliverable: LR disables sizing/sharpening/watermarking
  // for it, and rewriting its samples would void the writer's pixel proof.
  mockIdentity(LEFT_HALF_CROP);
  const dng = await runExport([photo], "/exports", opts({ format: "linearDng16" }));
  expect(dng).toMatchObject({ written: 0, failed: 1 });
  expect(dng.failureMessages[0]).toMatch(/raw deliverable/);

  // Local masks composite out of extra develop passes the Rust pipeline has no
  // way to render — still refused rather than silently written unmasked.
  vi.mocked(getDevelopExportIdentity).mockResolvedValue({
    catalogId: "/catalogs/current.galcat",
    photo,
    sourceDigest: "ab".repeat(32),
    canonicalRecipeJson: `{"processVersion":6,${IDENTITY_CROP},"masks":{"masks":[{"id":"m1","enabled":true,"components":[{"kind":"linear"}],"adjustments":{"exposure":1}}]}}`,
  });
  const masked = await runExport([photo], "/exports", opts());
  expect(masked).toMatchObject({ written: 0, failed: 1 });
  expect(masked.failureMessages[0]).toMatch(/local masks/);
});

it("publishes the native file untouched when there is nothing to finish", async () => {
  mockIdentity(IDENTITY_CROP);

  await expect(runExport([{ ...photo, title: null } as PhotoRow], "/exports", opts()))
    .resolves.toMatchObject({ written: 1, failed: 0 });

  // No crop, no metadata: the Rust writer's own atomically published file IS the
  // deliverable — no read-back, no re-encode, digests intact.
  expect(nativePath()).toBe("/exports/selected.tiff");
  expect(writeFile).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
