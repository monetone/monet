import { describe, expect, it } from "vitest";
import {
  buildDNG,
  buildDNG16,
  MAX_DNG_DIMENSION,
  MAX_DNG_XMP_BYTES,
  resolveDNGInputProfile,
  type DNGInputProfile,
} from "./dng";

// buildDNG only reads width/height/data, so a plain object stands in for ImageData
// (which isn't a node global).
function img(w: number, h: number, fill: [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1]; data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
}

function parseIfd(bytes: Uint8Array): Map<number, { type: number; count: number; valueOff: number }> {
  const dv = new DataView(bytes.buffer);
  expect(bytes[0]).toBe(0x49); // "I"
  expect(bytes[1]).toBe(0x49); // "I" — little-endian
  expect(dv.getUint16(2, true)).toBe(42);
  const ifd = dv.getUint32(4, true);
  expect(ifd).toBe(8);
  const n = dv.getUint16(ifd, true);
  const map = new Map<number, { type: number; count: number; valueOff: number }>();
  for (let i = 0; i < n; i++) {
    const p = ifd + 2 + i * 12;
    map.set(dv.getUint16(p, true), { type: dv.getUint16(p + 2, true), count: dv.getUint32(p + 4, true), valueOff: p + 8 });
  }
  return map;
}

type ParsedTag = { type: number; count: number; valueOff: number };
const TIFF_TYPE_BYTES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 };

function tagData(bytes: Uint8Array, tag: ParsedTag): Uint8Array {
  const size = (TIFF_TYPE_BYTES[tag.type] ?? 0) * tag.count;
  expect(size).toBeGreaterThan(0);
  const offset = size <= 4 ? tag.valueOff : new DataView(bytes.buffer).getUint32(tag.valueOff, true);
  return bytes.slice(offset, offset + size);
}

function asciiTag(bytes: Uint8Array, tag: ParsedTag): string {
  const value = tagData(bytes, tag);
  expect(value[value.length - 1]).toBe(0);
  return String.fromCharCode(...value.subarray(0, -1));
}

function signedRationals(bytes: Uint8Array, tag: ParsedTag): number[] {
  const value = tagData(bytes, tag);
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  return Array.from({ length: tag.count }, (_, index) =>
    view.getInt32(index * 8, true) / view.getUint32(index * 8 + 4, true));
}

describe("buildDNG", () => {
  it("writes a little-endian linear DNG with the required tags", () => {
    const bytes = buildDNG(img(3, 2, [128, 64, 200]));
    const dv = new DataView(bytes.buffer);
    const tags = parseIfd(bytes);

    // ascending, non-empty tag set
    expect(tags.size).toBe(18);
    const inlineLong = (t: number) => dv.getUint32(tags.get(t)!.valueOff, true);
    const inlineShort = (t: number) => dv.getUint16(tags.get(t)!.valueOff, true);

    expect(inlineLong(256)).toBe(3); // ImageWidth
    expect(inlineLong(257)).toBe(2); // ImageLength
    expect(inlineShort(259)).toBe(1); // Compression = none
    expect(inlineShort(262)).toBe(34892); // PhotometricInterpretation = LinearRaw
    expect(inlineShort(274)).toBe(1); // Orientation = top-left
    expect(inlineShort(277)).toBe(3); // SamplesPerPixel
    expect(inlineLong(279)).toBe(3 * 2 * 3 * 2); // StripByteCounts = w*h*3*2
    expect(inlineShort(50778)).toBe(21); // CalibrationIlluminant1 = D65

    // DNGVersion 1.4.0.0 lives inline as 4 bytes
    const vOff = tags.get(50706)!.valueOff;
    expect([bytes[vOff], bytes[vOff + 1], bytes[vOff + 2], bytes[vOff + 3]]).toEqual([1, 4, 0, 0]);
    expect(tags.has(50708)).toBe(true); // UniqueCameraModel
    expect(tags.has(50721)).toBe(true); // ColorMatrix1
    expect(tags.has(50728)).toBe(true); // AsShotNeutral
  });

  it("stores linearized 16-bit samples (sRGB → linear light)", () => {
    const bytes = buildDNG(img(1, 1, [128, 0, 255]));
    const dv = new DataView(bytes.buffer);
    const stripOff = dv.getUint32(parseIfd(bytes).get(273)!.valueOff, true);
    const lin = (c: number) => {
      const n = c / 255;
      return Math.round((n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4) * 65535);
    };
    expect(dv.getUint16(stripOff, true)).toBe(lin(128));
    expect(dv.getUint16(stripOff + 2, true)).toBe(0); // black stays 0
    expect(dv.getUint16(stripOff + 4, true)).toBe(65535); // white stays full
    // sRGB 128 is mid-grey but its linear value is well below half.
    expect(lin(128)).toBeLessThan(32768);
  });

  it("rejects invalid dimensions and mismatched RGBA8 buffers", () => {
    const invalid = (width: number, height: number, length: number) => ({
      width, height, data: new Uint8ClampedArray(length), colorSpace: "srgb",
    }) as ImageData;
    expect(() => buildDNG(invalid(0, 1, 0))).toThrow("dimensions");
    expect(() => buildDNG(invalid(1, 1, 3))).toThrow("buffer size");
  });
});

describe("buildDNG16", () => {
  it("retains source RGBA16 RGB samples bit-for-bit and omits alpha", () => {
    const rgba16 = new Uint16Array([
      1, 257, 65_534, 12_345,
      32_768, 4_096, 60_000, 0,
    ]);
    const bytes = buildDNG16(rgba16, 2, 1);
    const tags = parseIfd(bytes);
    const dv = new DataView(bytes.buffer);
    const stripOffset = dv.getUint32(tags.get(273)!.valueOff, true);

    expect(tags.size).toBe(18);
    expect(dv.getUint32(tags.get(279)!.valueOff, true)).toBe(12);
    const bits = tagData(bytes, tags.get(258)!);
    expect(Array.from(bits)).toEqual([16, 0, 16, 0, 16, 0]);
    expect(Array.from({ length: 6 }, (_, i) => dv.getUint16(stripOffset + i * 2, true)))
      .toEqual([1, 257, 65_534, 32_768, 4_096, 60_000]);
  });

  it("linearizes a profile-encoded sRGB16 engine composite without an RGBA8 round-trip", () => {
    const bytes = buildDNG16(new Uint16Array([32_768, 16_384, 257, 65_535]), 1, 1, { inputProfile: "srgb" });
    const tags = parseIfd(bytes);
    const dv = new DataView(bytes.buffer);
    const stripOffset = dv.getUint32(tags.get(273)!.valueOff, true);
    expect(dv.getUint16(stripOffset, true)).toBeCloseTo(14_028, -1);
    expect(dv.getUint16(stripOffset + 2, true)).toBeCloseTo(3_335, -1);
    expect(dv.getUint16(stripOffset + 4, true)).toBe(20);
  });

  it.each([
    ["srgb", 3.2404542, (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4],
    ["display-p3", 2.4934969, (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4],
    ["adobe-rgb", 2.04159, (value: number) => value ** 2.19921875],
    ["rec2020", 1.7166512, (value: number) => value ** 2.4],
  ] satisfies [DNGInputProfile, number, (value: number) => number][])(
    "linearizes %s samples and writes its XYZ color matrix",
    (inputProfile, firstMatrixValue, decode) => {
      const sample = 32_768;
      const bytes = buildDNG16(new Uint16Array([sample, sample, sample, 65_535]), 1, 1, { inputProfile });
      const tags = parseIfd(bytes);
      const dv = new DataView(bytes.buffer);
      const stripOffset = dv.getUint32(tags.get(273)!.valueOff, true);

      expect(dv.getUint16(stripOffset, true)).toBe(Math.round(decode(sample / 65_535) * 65_535));
      expect(signedRationals(bytes, tags.get(50721)!)[0]).toBeCloseTo(firstMatrixValue, 6);
    },
  );

  it("rejects arbitrary custom ICC input instead of silently treating it as sRGB", () => {
    expect(() => buildDNG16(new Uint16Array([1, 2, 3, 65_535]), 1, 1, { inputProfile: "custom" }))
      .toThrow("custom ICC profiles");
    expect(() => resolveDNGInputProfile(0, true)).toThrow("custom ICC profiles");
    expect(resolveDNGInputProfile(0, false)).toBe("srgb");
    expect(resolveDNGInputProfile(3, false)).toBe("rec2020");
    expect(() => resolveDNGInputProfile(4, false)).toThrow("supported RGB working profile");
  });

  it("writes bounded camera identity and embeds UTF-8 XMP in TIFF tag 700", () => {
    const xmp = `<?xpacket begin="\uFEFF"?><mvcr:Recipe>Courbe été</mvcr:Recipe><?xpacket end="w"?>`;
    const xmpBytes = new TextEncoder().encode(xmp);
    const bytes = buildDNG16(new Uint16Array([100, 200, 300, 65_535]), 1, 1, {
      metadata: {
        make: "  Acme\nCameras  ",
        model: "Sensor\0 One",
        serialNumber: "SN-0042",
      },
      xmp,
    });
    const tags = parseIfd(bytes);

    expect(tags.size).toBe(22);
    expect(asciiTag(bytes, tags.get(271)!)).toBe("Acme Cameras");
    expect(asciiTag(bytes, tags.get(272)!)).toBe("Sensor One");
    expect(asciiTag(bytes, tags.get(50708)!)).toBe("Acme Cameras Sensor One");
    expect(asciiTag(bytes, tags.get(50735)!)).toBe("SN-0042");
    expect(tags.get(700)).toMatchObject({ type: 1, count: xmpBytes.length });
    expect(tagData(bytes, tags.get(700)!)).toEqual(xmpBytes);
  });

  it("bounds metadata without changing the fixed sample payload", () => {
    const bytes = buildDNG16(new Uint16Array([1, 2, 3, 4]), 1, 1, {
      metadata: { make: "A".repeat(1_000) },
    });
    const tags = parseIfd(bytes);
    expect(tags.get(271)?.count).toBe(129); // 128 characters + NUL
    expect(asciiTag(bytes, tags.get(271)!)).toBe("A".repeat(128));
  });

  it("round-trips short inline ASCII and byte values", () => {
    const xmp = new TextEncoder().encode("<x/>");
    const bytes = buildDNG16(new Uint16Array([1, 2, 3, 4]), 1, 1, {
      metadata: { make: "A", model: "M", serialNumber: "S" },
      xmp,
    });
    const tags = parseIfd(bytes);
    expect(asciiTag(bytes, tags.get(271)!)).toBe("A");
    expect(asciiTag(bytes, tags.get(272)!)).toBe("M");
    expect(asciiTag(bytes, tags.get(50735)!)).toBe("S");
    expect(tagData(bytes, tags.get(700)!)).toEqual(xmp);
  });

  it("rejects invalid dimensions, buffers, and untrusted XMP", () => {
    const pixel = new Uint16Array(4);
    expect(() => buildDNG16(pixel, 0, 1)).toThrow("dimensions");
    expect(() => buildDNG16(pixel, 1.5, 1)).toThrow("dimensions");
    expect(() => buildDNG16(pixel, MAX_DNG_DIMENSION + 1, 1)).toThrow("dimensions");
    expect(() => buildDNG16(pixel, 10_000, 10_000)).toThrow("pixel limit");
    expect(() => buildDNG16(new Uint16Array(3), 1, 1)).toThrow("buffer size");
    expect(() => buildDNG16(new Uint8Array(4) as unknown as Uint16Array, 1, 1)).toThrow("Uint16Array");
    expect(() => buildDNG16(pixel, 1, 1, { xmp: "x".repeat(MAX_DNG_XMP_BYTES + 1) })).toThrow("too large");
    expect(() => buildDNG16(pixel, 1, 1, { xmp: new Uint8Array([0xff]) })).toThrow("UTF-8");
    expect(() => buildDNG16(pixel, 1, 1, { xmp: "<xmp>\0</xmp>" })).toThrow("invalid");
  });
});
