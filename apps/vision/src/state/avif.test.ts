import { describe, it, expect, vi, beforeEach } from "vitest";
import { inflateSync } from "node:zlib";
import { AVIF_RE, imageDataToPng, avifToPng } from "./avif";

// The wasm-bound decoder is isolated in ./avifDecoder; mock it so the unit test
// needs no WASM decoder (the real decode is exercised in e2e/avif-import.spec).
const { decodeAvifMock } = vi.hoisted(() => ({ decodeAvifMock: vi.fn() }));
vi.mock("./avifDecoder", () => ({ decodeAvif: decodeAvifMock }));

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Minimal PNG reader for the exact shape imageDataToPng writes: 8-bit RGBA,
 *  non-interlaced, filter-0 rows in a single IDAT. */
function readPng(png: Uint8Array): { w: number; h: number; px: Uint8Array } {
  expect(Array.from(png.subarray(0, 8))).toEqual(PNG_SIG);
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  const idat: Buffer[] = [];
  let w = 0, h = 0, at = 8;
  while (at < png.length) {
    const len = dv.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + len);
    types.push(type);
    if (type === "IHDR") {
      w = dv.getUint32(at + 8);
      h = dv.getUint32(at + 12);
      expect(body[8]).toBe(8); // bit depth
      expect(body[9]).toBe(6); // colour type 6 = RGBA
      expect(Array.from(body.subarray(10))).toEqual([0, 0, 0]); // deflate / filter / no interlace
    }
    if (type === "IDAT") idat.push(Buffer.from(body));
    at += 12 + len;
  }
  expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
  const rows = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const at0 = y * (w * 4 + 1);
    expect(rows[at0]).toBe(0); // filter None
    px.set(rows.subarray(at0 + 1, at0 + 1 + w * 4), y * w * 4);
  }
  return { w, h, px };
}

const imageData = (w: number, h: number, px: number[]): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(px) }) as ImageData;

describe("AVIF_RE", () => {
  it("matches .avif case-insensitively and nothing else", () => {
    expect(AVIF_RE.test("photo.avif")).toBe(true);
    expect(AVIF_RE.test("PHOTO.AVIF")).toBe(true);
    expect(AVIF_RE.test("my.holiday.avif")).toBe(true);
    expect(AVIF_RE.test("photo.png")).toBe(false);
    expect(AVIF_RE.test("photo.avifx")).toBe(false);
    expect(AVIF_RE.test("avif")).toBe(false);
  });
});

describe("imageDataToPng", () => {
  it("writes a valid 8-bit RGBA PNG with the pixels in row order", async () => {
    const src = [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255];
    const { w, h, px } = readPng(await imageDataToPng(imageData(2, 2, src)));
    expect([w, h]).toEqual([2, 2]);
    expect(Array.from(px)).toEqual(src);
  });

  it("keeps semi-transparent pixels byte-exact (no canvas premultiplication) (#63)", async () => {
    // A 2D-canvas round-trip quantizes exactly these: (200,100,50,3) comes back
    // (170,85,85,3) and (200,100,50,1) collapses to (255,0,0,1). Straight alpha
    // from a 32-bit TGA / HEIC / AVIF decode must survive untouched.
    const src = [200, 100, 50, 3, 200, 100, 50, 1, 90, 180, 30, 16, 10, 20, 30, 255];
    const { px } = readPng(await imageDataToPng(imageData(4, 1, src)));
    expect(Array.from(px)).toEqual(src);
  });

  it("rejects an empty image instead of writing a zero-sized PNG", async () => {
    await expect(imageDataToPng(imageData(0, 0, []))).rejects.toThrow();
  });
});

describe("avifToPng", () => {
  beforeEach(() => decodeAvifMock.mockReset());

  it("decodes AVIF bytes and re-encodes the RGBA to PNG", async () => {
    const src = [9, 9, 9, 128, 1, 2, 3, 4];
    decodeAvifMock.mockResolvedValue(imageData(2, 1, src));
    const { px } = readPng(await avifToPng(new Uint8Array([0, 1, 2, 3, 4])));
    expect(decodeAvifMock).toHaveBeenCalledOnce();
    expect(Array.from(px)).toEqual(src);
  });
});
