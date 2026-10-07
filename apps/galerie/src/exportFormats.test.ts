// exportFormats — the widened GAL-OUT-11 format set: 8-bit TIFF (None/ZIP),
// flattened PSD, "Original" byte-for-byte passthrough, and the JPEG
// Limit File Size search. Encoder assertions parse the produced bytes.

import { inflateSync } from "node:zlib";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => false),
  mkdir: vi.fn(),
  readFile: vi.fn<(...args: unknown[]) => Promise<Uint8Array>>(),
  writeFile: vi.fn<(...args: unknown[]) => Promise<void>>(),
  writeTextFile: vi.fn(),
}));
vi.mock("./catalog/catalog", () => ({
  getDevelopExportIdentity: vi.fn(),
  getRecipe: vi.fn(),
  listPhotoKeywords: vi.fn(async () => []),
  onRecipeChanged: vi.fn(() => () => {}),
  catalogAvailable: () => true,
}));

import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import type { PhotoRow } from "./catalog/types";
import { encodePsd, encodeTiff8, encodeUnderLimit, outputFilename, runExport, type ExportOptions } from "./export";

const photo = {
  id: 7,
  sourceAssetId: 3,
  path: "/photos/selected.CR3",
  format: "raw:CR3",
  copyName: null,
} as PhotoRow;

const opts = (over: Partial<ExportOptions>): ExportOptions => ({ format: "jpeg", quality: 1, longEdge: null, ...over });

// 2×2 RGBA test image: red, green, blue, white.
const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);

/** Parse the (little-endian, single-IFD) TIFF our encoder writes: tag → value. */
function parseTiff(bytes: Uint8Array): Map<number, number> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(bytes[0]).toBe(0x49); // "II"
  expect(bytes[1]).toBe(0x49);
  expect(dv.getUint16(2, true)).toBe(42);
  const ifd = dv.getUint32(4, true);
  const n = dv.getUint16(ifd, true);
  const tags = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const at = ifd + 2 + i * 12;
    const type = dv.getUint16(at + 2, true);
    tags.set(dv.getUint16(at, true), type === 3 ? dv.getUint16(at + 8, true) : dv.getUint32(at + 8, true));
  }
  expect(dv.getUint32(ifd + 2 + n * 12, true)).toBe(0); // no next IFD
  return tags;
}

beforeEach(() => vi.clearAllMocks());

it("encodes an uncompressed 8-bit RGB baseline TIFF", async () => {
  const bytes = await encodeTiff8(rgba, 2, 2, "none");
  const tags = parseTiff(bytes);
  expect(tags.get(256)).toBe(2); // width
  expect(tags.get(257)).toBe(2); // height
  expect(tags.get(259)).toBe(1); // Compression: none
  expect(tags.get(262)).toBe(2); // Photometric: RGB
  expect(tags.get(277)).toBe(3);
  expect(tags.get(279)).toBe(12);
  expect(tags.has(282)).toBe(false); // no ppi → untagged
  const strip = bytes.subarray(tags.get(273)!, tags.get(273)! + tags.get(279)!);
  expect(Array.from(strip)).toEqual(Array.from(rgb));
});

it("encodes ZIP TIFF as Adobe Deflate (tag 8, zlib strip) and tags ppi", async () => {
  const bytes = await encodeTiff8(rgba, 2, 2, "zip", 300);
  const tags = parseTiff(bytes);
  expect(tags.get(259)).toBe(8); // Adobe Deflate
  expect(tags.get(296)).toBe(2); // ResolutionUnit: inch
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(dv.getUint32(tags.get(282)!, true) / dv.getUint32(tags.get(282)! + 4, true)).toBe(300);
  const strip = bytes.subarray(tags.get(273)!, tags.get(273)! + tags.get(279)!);
  expect(Array.from(inflateSync(strip))).toEqual(Array.from(rgb));
});

it("encodes a flattened raw planar PSD and refuses > 30000 px", () => {
  const bytes = encodePsd(rgba, 2, 2);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("8BPS");
  expect(dv.getUint16(4)).toBe(1); // version
  expect(dv.getUint16(12)).toBe(3); // channels
  expect(dv.getUint32(14)).toBe(2); // height
  expect(dv.getUint32(18)).toBe(2); // width
  expect(dv.getUint16(22)).toBe(8); // depth
  expect(dv.getUint16(24)).toBe(3); // mode: RGB
  expect(dv.getUint16(38)).toBe(0); // raw image data
  // Planar: R plane, then G, then B.
  expect(Array.from(bytes.subarray(40))).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  expect(() => encodePsd(new Uint8Array(4), 30001, 1)).toThrow(/30000/);
});

it("limit-size search returns the largest encode under the cap, or the floor", async () => {
  // Fake encoder: size grows linearly with quality (100 KB at quality 1).
  const encode = vi.fn(async (q: number) => new Blob([new Uint8Array(Math.round(q * 100 * 1024))]));
  const under = await encodeUnderLimit(encode, 50);
  expect(under.size).toBeLessThanOrEqual(50 * 1024);
  expect(under.size).toBeGreaterThan(45 * 1024); // bisection actually climbed toward the cap
  const floor = await encodeUnderLimit(encode, 1); // even quality 0.05 (~5 KB) exceeds 1 KB
  expect(floor.size).toBe(Math.round(0.05 * 100 * 1024));
});

it("names outputs across the widened format set, Original keeping the source ext", () => {
  expect(outputFilename(photo, 0, opts({ format: "tiff8" }))).toBe("selected.tiff");
  expect(outputFilename(photo, 0, opts({ format: "psd" }))).toBe("selected.psd");
  expect(outputFilename(photo, 0, opts({ format: "original" }))).toBe("selected.CR3");
  expect(outputFilename(photo, 0, opts({ format: "jpeg" }))).toBe("selected.jpg");
  expect(outputFilename({ ...photo, copyName: "Copy 1" } as PhotoRow, 0, opts({ format: "original" }))).toBe("selected-Copy1.CR3");
});

it("Original export copies the source byte-for-byte", async () => {
  const source = new Uint8Array([9, 8, 7, 6, 5]);
  vi.mocked(readFile).mockResolvedValue(source);
  const res = await runExport([photo], "/exports", opts({ format: "original" }));
  expect(res).toEqual({ written: 1, committed: 0, failed: 0, durabilityWarnings: [], failureMessages: [] });
  const [target, bytes] = vi.mocked(writeFile).mock.calls[0] as unknown as [string, Uint8Array];
  expect(target).toBe("/exports/selected.CR3");
  expect(Array.from(bytes)).toEqual(Array.from(source)); // untouched — no develop, no re-encode
});
