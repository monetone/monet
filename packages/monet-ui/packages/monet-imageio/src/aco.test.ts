import { describe, it, expect } from "vitest";
import { MAX_ACO_IMPORT_BYTES, parseAco, buildAco } from "./aco";

/** Build a raw .aco v1 file from [space, w, x, y, z] records. */
function aco(version: number, records: Array<[number, number, number, number, number]>): Uint8Array {
  const bytes = new Uint8Array(4 + records.length * 10);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(0, version);
  dv.setUint16(2, records.length);
  let off = 4;
  for (const [space, w, x, y, z] of records) {
    dv.setUint16(off, space);
    dv.setUint16(off + 2, w); dv.setUint16(off + 4, x); dv.setUint16(off + 6, y); dv.setUint16(off + 8, z);
    off += 10;
  }
  return bytes;
}

describe("parseAco", () => {
  it("decodes RGB records (component = value·257)", () => {
    // pure red, pure green, mid-grey blue channel
    const bytes = aco(1, [[0, 255 * 257, 0, 0, 0], [0, 0, 255 * 257, 0, 0], [0, 128 * 257, 128 * 257, 128 * 257, 0]]);
    expect(parseAco(bytes)).toEqual(["#ff0000", "#00ff00", "#808080"]);
  });

  it("decodes HSB records", () => {
    // H=0 S=1 B=1 → red ; H=120° S=1 B=1 → green
    const red = aco(1, [[1, 0, 65535, 65535, 0]]);
    const green = aco(1, [[1, Math.round((120 / 360) * 65535), 65535, 65535, 0]]);
    expect(parseAco(red)).toEqual(["#ff0000"]);
    expect(parseAco(green)).toEqual(["#00ff00"]);
  });

  it("decodes Grayscale records (0..10000)", () => {
    const bytes = aco(1, [[8, 0, 0, 0, 0], [8, 10000, 0, 0, 0], [8, 5000, 0, 0, 0]]);
    expect(parseAco(bytes)).toEqual(["#000000", "#ffffff", "#808080"]);
  });

  it("decodes CMYK records (Adobe stores ink inverted)", () => {
    // K channel = 0 (full black ink) → black ; all channels 65535 (no ink) → white
    const black = aco(1, [[2, 65535, 65535, 65535, 0]]);
    const white = aco(1, [[2, 65535, 65535, 65535, 65535]]);
    expect(parseAco(black)).toEqual(["#000000"]);
    expect(parseAco(white)).toEqual(["#ffffff"]);
  });

  it("skips unsupported colour spaces (e.g. Lab) but keeps the rest", () => {
    const bytes = aco(1, [[0, 255 * 257, 0, 0, 0], [7, 1, 2, 3, 4], [0, 0, 0, 255 * 257, 0]]);
    expect(parseAco(bytes)).toEqual(["#ff0000", "#0000ff"]);
  });

  it("returns [] for a non-version-1 leading block", () => {
    expect(parseAco(aco(2, [[0, 0, 0, 0, 0]]))).toEqual([]);
  });

  it("returns [] for input shorter than a header", () => {
    expect(parseAco(new Uint8Array([0, 1, 0]))).toEqual([]);
    expect(parseAco(new Uint8Array())).toEqual([]);
  });

  it("stops cleanly on a truncated record (declared count > actual data)", () => {
    const full = aco(1, [[0, 255 * 257, 0, 0, 0], [0, 0, 255 * 257, 0, 0]]);
    const dv = new DataView(full.buffer);
    dv.setUint16(2, 3); // claim 3 colours but only 2 records follow
    const stats = { dropped: 0 };
    expect(parseAco(full, stats)).toEqual(["#ff0000", "#00ff00"]);
    expect(stats.dropped).toBe(1);
  });

  it("reads correctly from a Uint8Array that is a view into a larger buffer", () => {
    const src = aco(1, [[0, 255 * 257, 0, 0, 0]]);
    const padded = new Uint8Array(src.length + 6);
    padded.set(src, 6);
    expect(parseAco(padded.subarray(6))).toEqual(["#ff0000"]);
  });

  it("rejects input above the ACO byte ceiling before creating a DataView", () => {
    const oversized = { length: MAX_ACO_IMPORT_BYTES + 1 } as unknown as Uint8Array;
    expect(parseAco(oversized)).toEqual([]);
  });
});

describe("buildAco", () => {
  it("writes a version-1 RGB header", () => {
    const bytes = buildAco(["#ff0000", "#00ff00"]);
    const dv = new DataView(bytes.buffer);
    expect(dv.getUint16(0)).toBe(1); // version
    expect(dv.getUint16(2)).toBe(2); // count
    expect(dv.getUint16(4)).toBe(0); // first record space = RGB
    expect(dv.getUint16(6)).toBe(255 * 257); // R
    expect(bytes.length).toBe(4 + 2 * 10);
  });

  it("expands #rgb shorthand", () => {
    expect(parseAco(buildAco(["#f00"]))).toEqual(["#ff0000"]);
  });

  it("round-trips an arbitrary swatch set losslessly", () => {
    const hexes = ["#000000", "#ffffff", "#123456", "#abcdef", "#808080", "#ff8800"];
    expect(parseAco(buildAco(hexes))).toEqual(hexes);
  });

  it("reports colours refused by the import cap", () => {
    const stats = { dropped: 0 };
    expect(parseAco(buildAco(Array(4097).fill("#123456")), stats)).toHaveLength(4096);
    expect(stats.dropped).toBe(1);
  });
});
