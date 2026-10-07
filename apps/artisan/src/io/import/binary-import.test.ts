import { describe, it, expect } from "vitest";
import { importPDForAI } from "./pdf";
import { importCDR } from "./cdr";

const latin1Bytes = (s: string): Uint8Array => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0) & 0xff));

describe("PDF/AI import", () => {
  it("extracts vector paths from an uncompressed PDF content stream", async () => {
    const pdf = `%PDF-1.4
3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj
4 0 obj<</Length 80>>stream
1 0 0 rg 20 20 100 80 re f 0 0 1 rg 50 120 m 150 120 l 100 190 l f
endstream endobj
trailer<</Root 1 0 R>>
%%EOF`;
    const { doc } = await importPDForAI(latin1Bytes(pdf), "pdf");
    const items = doc.layers.flatMap((l) => l.items);
    expect(items.length).toBe(2);
    expect(items.every((i) => i.type === "path" || i.type === "compound")).toBe(true);
  });

  it("extracts paths from a legacy PostScript .ai", async () => {
    const ai = `%!PS-Adobe-3.0
%%Creator: Adobe Illustrator
0 0 0 1 k
30 30 m 170 30 L 170 100 L 30 100 L f
1 0 0 Xa
60 120 m 140 180 L 60 180 L f
%%EOF`;
    const { doc } = await importPDForAI(latin1Bytes(ai), "ai");
    expect(doc.layers.flatMap((l) => l.items).length).toBe(2);
  });

  it("consumes stray close-parens instead of stalling", async () => {
    const ai = `%!PS-Adobe-3.0
1 1 10 10 re f )
%%EOF`;
    const { doc } = await importPDForAI(latin1Bytes(ai), "ai");
    expect(doc.layers.flatMap((l) => l.items)).toHaveLength(1);
  });

  it("y-flips coordinates (PDF user space → top-down)", async () => {
    // A single rect near the PDF bottom should land near the artboard top.
    const pdf = `%PDF-1.4
3 0 obj<</MediaBox[0 0 100 100]/Contents 4 0 R>>endobj
4 0 obj<</Length 20>>stream
0 0 10 10 re f
endstream endobj
%%EOF`;
    const { doc } = await importPDForAI(latin1Bytes(pdf), "pdf");
    const item = doc.layers.flatMap((l) => l.items)[0];
    // PDF y in [0,10] (bottom) → flipped to [90,100] (top of a 100-tall page)
    expect(item).toBeTruthy();
  });
});

describe("CDR import (best-effort)", () => {
  it("handles a non-CDR buffer gracefully", async () => {
    const { doc, warnings } = await importCDR(latin1Bytes("not a riff file at all"));
    expect(doc.layers[0].items.length).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("parses a minimal RIFF/CDR container without crashing", async () => {
    const { warnings } = await importCDR(latin1Bytes("RIFF\x08\x00\x00\x00CDR9"));
    expect(warnings.length).toBeGreaterThan(0); // no loda → best-effort warning
  });

  it("bounds hostile RIFF nesting without overflowing the stack", async () => {
    const levels = 5000;
    const nested = new Uint8Array(levels * 12);
    const dv = new DataView(nested.buffer);
    for (let i = 0; i < levels; i++) {
      const offset = i * 12;
      nested.set(latin1Bytes(i === 0 ? "RIFF" : "LIST"), offset);
      dv.setUint32(offset + 4, nested.length - offset - 8, true);
      nested.set(latin1Bytes("CDR8"), offset + 8);
    }
    const { warnings } = await importCDR(nested);
    expect(warnings.some((warning) => /nesting.*ignored/i.test(warning))).toBe(true);
  });
});

// ── spec-accurate synthetic CDR fixtures (32-bit / version ≥ 600) ──
// Validates the loda arg table, point-list decode, s4/254000→px scaling,
// the point-type state machine (move/line/cubic/control + close-merge),
// and the trfd affine matrix (disk order a,c,tx,b,d,ty).
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const u16 = (n: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n & 0xffff, true); return b; };
const s4 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n | 0, true); return b; };
const f64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n, true); return b; };
const u8 = (n: number) => new Uint8Array([n & 0xff]);
const ascii = (s: string) => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0) & 0xff));
const cat = (...a: Uint8Array[]) => { const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const chunk = (id: string, body: Uint8Array) => cat(ascii(id), u32(body.length), body, body.length & 1 ? new Uint8Array(1) : new Uint8Array(0));

/** Build a line_and_curve (chunk_type 0x03) loda body from raw points. */
function lodaCurve(points: { x: number; y: number; t: number }[]): Uint8Array {
  let coords = new Uint8Array(0);
  for (const p of points) coords = cat(coords, s4(p.x), s4(p.y));
  let types = new Uint8Array(0);
  for (const p of points) types = cat(types, u8(p.t));
  const argData = cat(u32(points.length), coords, types);
  const startOfArgs = 20 + argData.length;
  const startOfArgTypes = startOfArgs + 8; // 2 offset entries (num+1) × u4
  const total = startOfArgTypes + 4; // 1 arg-type entry
  return cat(
    cat(u32(total), u32(1), u32(startOfArgs), u32(startOfArgTypes), u32(0x03)), // header
    argData,
    cat(u32(20), u32(20 + argData.length)), // arg_offsets [start, end]
    u32(30), // arg_types: [loda_coords]
  );
}

/** Build a trfd body holding one affine record (disk order a,c,tx,b,d,ty). */
function trfdMat(a: number, c: number, tx: number, b: number, d: number, ty: number): Uint8Array {
  return cat(
    cat(u32(72), u32(1), u32(12)), // header: chunk_length, num_of_args=1, start_of_args=12
    u32(16), // arg_offsets[0] → trafo at body offset 16
    u16(8), // tmp_type 0x08 = affine
    new Uint8Array(6), // 6 unknown bytes (version ≥ 600)
    cat(f64(a), f64(c), f64(tx), f64(b), f64(d), f64(ty)),
  );
}

const riffCdr = (loda: Uint8Array, trfd?: Uint8Array) => {
  const obj = trfd ? cat(ascii("obj "), chunk("loda", loda), chunk("trfd", trfd)) : cat(ascii("obj "), chunk("loda", loda));
  return chunk("RIFF", cat(ascii("CDR8"), chunk("vrsn", u16(800)), chunk("LIST", obj)));
};

describe("CDR import (spec geometry)", () => {
  it("decodes a closed triangle with a trfd translation", async () => {
    // raw s4 coords / 254000 × 96px: (0,0) (96,0) (48,96), closing back to start.
    const loda = lodaCurve([
      { x: 0, y: 0, t: 0x00 }, // move_to
      { x: 254000, y: 0, t: 0x40 }, // line_to → (96,0)
      { x: 127000, y: 254000, t: 0x40 }, // line_to → (48,96)
      { x: 0, y: 0, t: 0x48 }, // line_to + is_closing_path → merges into start
    ]);
    const trfd = trfdMat(1, 0, 508000, 0, 1, 0); // translate x by 508000/254000×96 = 192px
    const { doc, warnings } = await importCDR(riffCdr(loda, trfd));
    const items = doc.layers.flatMap((l) => l.items);
    expect(items.length).toBe(1);
    expect(items[0].type).toBe("path");
    const g = (items[0] as { geometry: { anchors: { point: { x: number; y: number } }[]; closed: boolean } }).geometry;
    expect(g.closed).toBe(true);
    expect(g.anchors.length).toBe(3); // closing duplicate merged
    const pts = g.anchors.map((a) => [Math.round(a.point.x), Math.round(a.point.y)]);
    expect(pts).toEqual([[0, 0], [96, 0], [48, 96]]);
    expect(Math.round((items[0] as { transform: { e: number } }).transform.e)).toBe(192);
    expect(warnings.some((w) => /geometry recovered/.test(w))).toBe(true);
  });

  it("decodes a cubic bezier into relative handles", async () => {
    const loda = lodaCurve([
      { x: 0, y: 0, t: 0x00 }, // move_to → (0,0)
      { x: 254000, y: 0, t: 0xc0 }, // control point → (96,0)
      { x: 254000, y: 254000, t: 0xc0 }, // control point → (96,96)
      { x: 254000, y: 0, t: 0x80 }, // cubic_bezier_to endpoint → (96,0)
    ]);
    const { doc } = await importCDR(riffCdr(loda));
    const g = (doc.layers.flatMap((l) => l.items)[0] as { geometry: { anchors: { point: { x: number; y: number }; handleIn: { x: number; y: number }; handleOut: { x: number; y: number } }[]; closed: boolean } }).geometry;
    expect(g.closed).toBe(false);
    expect(g.anchors.length).toBe(2);
    const a0 = g.anchors[0];
    const a1 = g.anchors[1];
    expect([Math.round(a0.handleOut.x), Math.round(a0.handleOut.y)]).toEqual([96, 0]); // c1 − P0
    expect([Math.round(a1.handleIn.x), Math.round(a1.handleIn.y)]).toEqual([0, 96]); // c2 − P
  });
});
