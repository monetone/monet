import { describe, it, expect } from "vitest";
import { MAX_ASE_IMPORT_BYTES, parseAse, parseAseSwatches, buildAse, buildAseSwatches, type AseSwatch } from "./ase";

/** Build a raw .ase colour block for a given name + model + float components. */
function namedColourBlock(name: string, model: string, floats: number[], colorType = 2): Uint8Array {
  const bodyLen = 2 + (name.length + 1) * 2 /* name + null terminator */ + 4 + floats.length * 4 + 2;
  const b = new Uint8Array(6 + bodyLen);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, 0x0001);
  dv.setUint32(2, bodyLen);
  let p = 6;
  dv.setUint16(p, name.length + 1); p += 2; // name length (UTF-16 units incl. null)
  for (let i = 0; i < name.length; i++) { dv.setUint16(p, name.charCodeAt(i)); p += 2; }
  dv.setUint16(p, 0); p += 2;          // null terminator
  for (let i = 0; i < 4; i++) b[p + i] = model.charCodeAt(i);
  p += 4;
  for (const f of floats) { dv.setFloat32(p, f); p += 4; }
  dv.setUint16(p, colorType);           // 0 global · 1 spot · 2 normal
  return b;
}

const colourBlock = (model: string, floats: number[]): Uint8Array => namedColourBlock("", model, floats);

/** Assemble a full .ase file from raw block byte-arrays. */
function aseFile(blocks: Uint8Array[]): Uint8Array {
  const total = 12 + blocks.reduce((n, x) => n + x.length, 0);
  const b = new Uint8Array(total);
  const dv = new DataView(b.buffer);
  b[0] = 0x41; b[1] = 0x53; b[2] = 0x45; b[3] = 0x46; // "ASEF"
  dv.setUint16(4, 1); dv.setUint16(6, 0);
  dv.setUint32(8, blocks.length);
  let off = 12;
  for (const blk of blocks) { b.set(blk, off); off += blk.length; }
  return b;
}

/** A group-start block carrying a name (should be ignored by the parser). */
function groupStart(): Uint8Array {
  const bodyLen = 2 + 3 * 2; // nameLen + 2 chars + null
  const b = new Uint8Array(6 + bodyLen);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, 0xc001);
  dv.setUint32(2, bodyLen);
  dv.setUint16(6, 3);        // "Gr" + null
  dv.setUint16(8, 0x47); dv.setUint16(10, 0x72); dv.setUint16(12, 0);
  return b;
}
function groupEnd(): Uint8Array {
  const b = new Uint8Array(6);
  new DataView(b.buffer).setUint16(0, 0xc002); // length 0
  return b;
}

describe("parseAse", () => {
  it("decodes RGB colour blocks", () => {
    const f = aseFile([colourBlock("RGB ", [1, 0, 0]), colourBlock("RGB ", [0, 1, 0]), colourBlock("RGB ", [0.5019608, 0.5019608, 0.5019608])]);
    expect(parseAse(f)).toEqual(["#ff0000", "#00ff00", "#808080"]);
  });

  it("decodes Gray colour blocks", () => {
    expect(parseAse(aseFile([colourBlock("GRAY", [0]), colourBlock("GRAY", [1])]))).toEqual(["#000000", "#ffffff"]);
  });

  it("decodes CMYK colour blocks (0=no ink → white, k=1 → black)", () => {
    expect(parseAse(aseFile([colourBlock("CMYK", [0, 0, 0, 0]), colourBlock("CMYK", [0, 0, 0, 1])]))).toEqual(["#ffffff", "#000000"]);
  });

  it("decodes Lab blocks (L normalised 0..1, a/b in Lab units)", () => {
    // Neutral Lab (a=b=0) maps onto the grey axis: L=1 → white, L=0 → black,
    // L≈0.5356 → mid grey. Lab is what Illustrator writes for spot books.
    expect(parseAse(aseFile([colourBlock("LAB ", [1, 0, 0]), colourBlock("LAB ", [0, 0, 0]), colourBlock("LAB ", [0.53585, 0, 0])])))
      .toEqual(["#ffffff", "#000000", "#808080"]);
    // A chromatic Lab swatch must not collapse to grey.
    const [red] = parseAse(aseFile([colourBlock("LAB ", [0.5445, 79.5, 66.4])]));
    expect(red).not.toBe("#000000");
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(red.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(200);
    expect(r).toBeGreaterThan(g + 80);
    expect(r).toBeGreaterThan(b + 80);
  });

  it("keeps the model, ink components and swatch type — not just the hex", () => {
    const f = aseFile([colourBlock("CMYK", [0, 1, 1, 0]), colourBlock("LAB ", [0.5, 20, -30])]);
    const [cmyk, lab] = parseAseSwatches(f);
    expect(cmyk.model).toBe("CMYK");
    expect(cmyk.components).toEqual([0, 1, 1, 0]);
    expect(cmyk.colorType).toBe(2);
    expect(lab.model).toBe("LAB");
    expect(lab.components).toEqual([0.5, 20, -30]);
  });

  it("reads the swatch name", () => {
    const f = aseFile([namedColourBlock("Pantone 485 C", "CMYK", [0, 0.95, 1, 0])]);
    expect(parseAseSwatches(f)[0].name).toBe("Pantone 485 C");
  });

  it("flattens groups (ignores group-start/end markers)", () => {
    const f = aseFile([groupStart(), colourBlock("RGB ", [1, 0, 0]), colourBlock("RGB ", [0, 1, 0]), groupEnd()]);
    // block count is 4 (group markers included), only 2 colours emerge
    expect(parseAse(f)).toEqual(["#ff0000", "#00ff00"]);
  });

  it("returns [] for a bad signature or too-short input", () => {
    expect(parseAse(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual([]); // "PK.." (zip)
    expect(parseAse(new Uint8Array([0x41, 0x53, 0x45]))).toEqual([]);
    expect(parseAse(new Uint8Array())).toEqual([]);
  });

  it("stops cleanly when a block overruns the file", () => {
    const f = aseFile([colourBlock("RGB ", [1, 0, 0])]);
    const dv = new DataView(f.buffer);
    dv.setUint32(8, 5); // claim 5 blocks but only 1 follows
    expect(parseAse(f)).toEqual(["#ff0000"]);
  });

  it("does not throw on a colour block whose body is shorter than its name field (#93)", () => {
    // Colour block declaring bodyLen 0/1 at EOF: bodyStart lands at (or just
    // before) byteLength, so the unguarded getUint16 threw a RangeError and the
    // whole library was discarded instead of returning what parsed.
    for (const bodyLen of [0, 1]) {
      const stub = new Uint8Array(6 + bodyLen);
      const dv = new DataView(stub.buffer);
      dv.setUint16(0, 0x0001);
      dv.setUint32(2, bodyLen);
      expect(parseAse(aseFile([stub]))).toEqual([]);
      expect(parseAse(aseFile([colourBlock("RGB ", [1, 0, 0]), stub]))).toEqual(["#ff0000"]);
    }
  });

  it("reads from a Uint8Array that is a view into a larger buffer", () => {
    const src = aseFile([colourBlock("RGB ", [1, 0, 0])]);
    const padded = new Uint8Array(src.length + 5);
    padded.set(src, 5);
    expect(parseAse(padded.subarray(5))).toEqual(["#ff0000"]);
  });

  it("rejects input above the ASE byte ceiling before creating a DataView", () => {
    const oversized = { length: MAX_ASE_IMPORT_BYTES + 1 } as unknown as Uint8Array;
    expect(parseAse(oversized)).toEqual([]);
  });
});

describe("buildAse", () => {
  it("writes an ASEF header with one block per colour", () => {
    const bytes = buildAse(["#ff0000", "#00ff00"]);
    const dv = new DataView(bytes.buffer);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("ASEF");
    expect(dv.getUint16(4)).toBe(1); // major version
    expect(dv.getUint32(8)).toBe(2); // block count
    expect(dv.getUint16(12)).toBe(0x0001); // first block = colour
  });

  it("expands #rgb shorthand", () => {
    expect(parseAse(buildAse(["#f00"]))).toEqual(["#ff0000"]);
  });

  it("round-trips a swatch set losslessly", () => {
    const hexes = ["#000000", "#ffffff", "#123456", "#abcdef", "#808080", "#ff8800"];
    expect(parseAse(buildAse(hexes))).toEqual(hexes);
  });

  it("reports colours refused by the import cap", () => {
    const stats = { dropped: 0 };
    expect(parseAse(buildAse(Array(4097).fill("#123456")), stats)).toHaveLength(4096);
    expect(stats.dropped).toBe(1);
  });

  it("does not misreport unknown truncated group blocks as colours", () => {
    const bytes = aseFile([colourBlock("RGB ", [1, 0, 0]), groupStart()]);
    new DataView(bytes.buffer).setUint32(8, 3);
    const stats: { dropped: number; partial?: boolean } = { dropped: 0 };
    expect(parseAse(bytes, stats)).toEqual(["#ff0000"]);
    expect(stats).toEqual({ dropped: 0, partial: true });
  });
});

describe("buildAseSwatches", () => {
  // The ink identity, not the hex, is what an illustration app has to keep: a
  // CMYK/Lab/spot library imported from Illustrator must leave as the same ink.
  // Components are float32-exact so a round trip compares by value.
  const library: AseSwatch[] = parseAseSwatches(aseFile([
    namedColourBlock("Rich Black", "CMYK", [0.5, 0.25, 0.25, 1]),
    namedColourBlock("Pantone 485 C", "LAB ", [0.5, 62.5, 48.25], 1), // spot
    namedColourBlock("Paper", "GRAY", [1], 0), // global
    namedColourBlock("Sky", "RGB ", [0.25, 0.5, 1]),
  ]));

  it("re-emits every model, its components and its swatch type unchanged", () => {
    expect(library.map((s) => s.model)).toEqual(["CMYK", "LAB", "GRAY", "RGB"]);
    expect(library[0].components).toEqual([0.5, 0.25, 0.25, 1]);
    expect(parseAseSwatches(buildAseSwatches(library))).toEqual(library);
  });

  it("survives a second round trip (import → export → import)", () => {
    const once = parseAseSwatches(buildAseSwatches(library));
    expect(parseAseSwatches(buildAseSwatches(once))).toEqual(once);
  });
});
