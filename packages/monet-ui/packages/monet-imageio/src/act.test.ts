import { describe, it, expect } from "vitest";
import { MAX_ACT_IMPORT_BYTES, parseAct, buildAct, isActLength } from "./act";

/** Raw 768-byte table from up to 256 [r,g,b] triplets, rest zero-filled. */
function act768(triples: Array<[number, number, number]>): Uint8Array {
  const b = new Uint8Array(768);
  triples.slice(0, 256).forEach(([r, g, b3], i) => { b[i * 3] = r; b[i * 3 + 1] = g; b[i * 3 + 2] = b3; });
  return b;
}

describe("isActLength", () => {
  it("accepts only the 768 and 772-byte lengths", () => {
    expect(isActLength(768)).toBe(true);
    expect(isActLength(772)).toBe(true);
    expect(isActLength(767)).toBe(false);
    expect(isActLength(770)).toBe(false);
    expect(isActLength(0)).toBe(false);
  });
});

describe("parseAct", () => {
  it("decodes all 256 entries of a plain 768-byte table", () => {
    const hexes = parseAct(act768([[255, 0, 0], [0, 255, 0], [0, 0, 255]]));
    expect(hexes.length).toBe(256);
    expect(hexes.slice(0, 3)).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
    expect(hexes[3]).toBe("#000000"); // zero-padded tail
  });

  it("honours the 772-byte trailer's colour count", () => {
    const b = new Uint8Array(772);
    b[0] = 255; b[3] = 0; b[4] = 255; // red, then green
    const dv = new DataView(b.buffer);
    dv.setUint16(768, 2);      // only 2 colours used
    dv.setUint16(770, 0xffff); // no transparency
    expect(parseAct(b)).toEqual(["#ff0000", "#00ff00"]);
  });

  // (#225) A count of 0 used to be lumped in with "out of range" and fall back
  // to 256; it is a legitimate count and must read back as an empty palette.
  it("falls back to 256 only when the trailer count is out of range", () => {
    const b = new Uint8Array(772);
    new DataView(b.buffer).setUint16(768, 0);
    expect(parseAct(b)).toEqual([]);
    new DataView(b.buffer).setUint16(768, 9999);
    expect(parseAct(b).length).toBe(256);
  });

  it("returns [] for input shorter than a full table", () => {
    expect(parseAct(new Uint8Array(767))).toEqual([]);
    expect(parseAct(new Uint8Array())).toEqual([]);
  });

  it("reads from a Uint8Array that is a view into a larger buffer", () => {
    const src = act768([[1, 2, 3]]);
    const padded = new Uint8Array(src.length + 8);
    padded.set(src, 8);
    expect(parseAct(padded.subarray(8))[0]).toBe("#010203");
  });

  it("rejects input above the exact ACT byte ceiling", () => {
    expect(parseAct(new Uint8Array(MAX_ACT_IMPORT_BYTES + 1))).toEqual([]);
  });
});

describe("buildAct", () => {
  it("writes a plain 768-byte table for exactly 256 colours", () => {
    const hexes = Array.from({ length: 256 }, (_, i) => `#${i.toString(16).padStart(2, "0")}0000`);
    const bytes = buildAct(hexes);
    expect(bytes.length).toBe(768);
    expect(parseAct(bytes)).toEqual(hexes);
  });

  it("appends the 772-byte trailer when fewer than 256 colours (exact round-trip)", () => {
    const hexes = ["#112233", "#445566", "#8899aa"];
    const bytes = buildAct(hexes);
    expect(bytes.length).toBe(772);
    expect(new DataView(bytes.buffer).getUint16(768)).toBe(3); // count
    expect(parseAct(bytes)).toEqual(hexes);
  });

  it("round-trips an empty palette (#225 — 0 is a real count, not 256 blacks)", () => {
    const bytes = buildAct([]);
    expect(bytes.length).toBe(772);
    expect(new DataView(bytes.buffer).getUint16(768)).toBe(0);
    expect(parseAct(bytes)).toEqual([]);
  });

  it("expands #rgb shorthand and caps at 256 colours", () => {
    expect(parseAct(buildAct(["#f00"]))).toEqual(["#ff0000"]);
    const many = Array.from({ length: 300 }, () => "#010101");
    expect(buildAct(many).length).toBe(768); // 256 → no trailer
  });
});
