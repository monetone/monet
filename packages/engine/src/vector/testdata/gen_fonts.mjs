#!/usr/bin/env node
// Regenerate the vector engine's TrueType test fixtures — pure Node, no deps.
//
//   node gen_fonts.mjs
//
// Writes:
//   two_glyph.ttf  — glyphA (box) + glyphB (triangle), mapped to Latin A/B and
//                    Hebrew alef/bet, so glyph-order changes (bidi reordering,
//                    guessed RTL direction) are observable in rendered pixels.
//   kern_font.ttf  — the same two glyphs plus a legacy `kern` pair pulling glyphB
//                    300 units closer after glyphA (only A->B), to prove the
//                    per-run coverage fallback shapes a covered run as a unit.
//   curve_font.ttf — glyphA + glyphC (a "D": straight stem, quadratic bowl via an
//                    off-curve point) mapped to Latin A/C, so glyph outlines with
//                    real bezier handles are observable (Type ▸ Create Work Path).
//   named_font.ttf — two_glyph plus a `name` table shaped like Apple's system
//                    fonts: Macintosh (Mac Roman) records FIRST, one of them
//                    holding a high-half byte, and a Windows English family name
//                    after them. Pins that face inspection reads both encodings.
//   stack_font.ttf — the same Apple shape, but named for a family Vision's own
//                    default font stacks target ("Verdana"). Pins the seam the
//                    "Untitled Font N" defect fell through: the parser has to
//                    return the name the provisioner matches its stacks on.
//
// Only the tables ttf-parser / rustybuzz need for outlines, mapping, advances,
// and kerning are emitted (head, hhea, maxp, cmap, hmtx, loca, glyf, [kern]).
// Table checksums are left zero — the readers do not validate them.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const UPM = 1000;
const ADV = 600;
const ASCENT = 800;
const DESCENT = -200;

// Glyphs as lists of contours; each contour is a list of [x, y] points, on-curve
// unless a third element `false` marks a TrueType off-curve (quadratic) control.
const GLYPHS = {
  notdef: [],
  glyphA: [[[80, 0], [80, 700], [380, 700], [380, 0]]], // left box
  glyphB: [[[520, 0], [220, 0], [520, 700]]], // right triangle
  glyphC: [[[80, 0], [80, 700], [300, 700], [560, 350, false], [300, 0]]], // "D" bowl
};
const ORDER = ["notdef", "glyphA", "glyphB"]; // glyph indices 0, 1, 2
const CURVE_ORDER = ["notdef", "glyphA", "glyphC"]; // glyph indices 0, 1, 2
const LSB = { notdef: 0, glyphA: 80, glyphB: 220, glyphC: 80 };

// Mac Roman's upper half (0x80-0xFF), in order; 0xF0 is Apple's logo (U+F8FF).
const MAC_ROMAN = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\u00A0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uF8FFÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff, 0); return b; };
const i16 = (v) => { const b = Buffer.alloc(2); b.writeInt16BE(v, 0); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0, 0); return b; };
const cat = (bufs) => Buffer.concat(bufs);
const pad4 = (buf) => (buf.length % 4 ? cat([buf, Buffer.alloc(4 - (buf.length % 4))]) : buf);
const log2floor = (n) => Math.floor(Math.log2(n));

function buildGlyf(contours) {
  if (contours.length === 0) return Buffer.alloc(0);
  const pts = [];
  const endPts = [];
  for (const c of contours) {
    for (const p of c) pts.push(p);
    endPts.push(pts.length - 1);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const parts = [
    i16(contours.length),
    i16(Math.min(...xs)), i16(Math.min(...ys)), i16(Math.max(...xs)), i16(Math.max(...ys)),
    ...endPts.map(u16),
    u16(0), // instructionLength
    ...pts.map((p) => Buffer.from([p[2] === false ? 0x00 : 0x01])), // ON_CURVE_POINT flag; x/y are int16 deltas
  ];
  let px = 0;
  for (const p of pts) { parts.push(i16(p[0] - px)); px = p[0]; }
  let py = 0;
  for (const p of pts) { parts.push(i16(p[1] - py)); py = p[1]; }
  return pad4(cat(parts)); // keep loca offsets even for the short format
}

function glyfAndLoca(order) {
  const glyfs = order.map((n) => buildGlyf(GLYPHS[n]));
  const offsets = [];
  let off = 0;
  for (const g of glyfs) { offsets.push(off); off += g.length; }
  offsets.push(off);
  const all = order.flatMap((n) => GLYPHS[n]).flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  return {
    glyf: cat(glyfs),
    loca: cat(offsets.map((o) => u16(o / 2))),
    bbox: { xMin: Math.min(...xs), yMin: Math.min(...ys), xMax: Math.max(...xs), yMax: Math.max(...ys) },
  };
}

function buildCmap(segments) {
  // segments: [[startCode, endCode, idDelta], ...] sorted, ending with 0xFFFF.
  const n = segments.length;
  const es = log2floor(n);
  const sr = 2 * 2 ** es;
  const body = [
    u16(4), u16(0) /* length, patched below */, u16(0),
    u16(n * 2), u16(sr), u16(es), u16(n * 2 - sr),
    ...segments.map((s) => u16(s[1])), u16(0),
    ...segments.map((s) => u16(s[0])),
    ...segments.map((s) => i16(s[2])),
    ...segments.map(() => u16(0)),
  ];
  const sub = cat(body);
  sub.writeUInt16BE(sub.length, 2);
  const header = cat([u16(0), u16(1), u16(3), u16(1), u32(12)]); // Windows Unicode BMP at offset 12
  return cat([header, sub]);
}

function buildHmtx(order) {
  return cat(order.flatMap((n) => [u16(ADV), i16(LSB[n])]));
}

function buildHead(bbox) {
  const b = Buffer.alloc(54);
  b.writeUInt32BE(0x00010000, 0); // version 1.0
  b.writeUInt32BE(0x5f0f3cf5, 12); // magic number
  b.writeUInt16BE(UPM, 18);
  b.writeInt16BE(bbox.xMin, 36);
  b.writeInt16BE(bbox.yMin, 38);
  b.writeInt16BE(bbox.xMax, 40);
  b.writeInt16BE(bbox.yMax, 42);
  b.writeUInt16BE(8, 46); // lowestRecPPEM
  b.writeInt16BE(2, 48); // fontDirectionHint
  b.writeInt16BE(0, 50); // indexToLocFormat: short
  b.writeInt16BE(0, 52); // glyphDataFormat
  return b;
}

function buildHhea(order) {
  const b = Buffer.alloc(36);
  b.writeUInt32BE(0x00010000, 0);
  b.writeInt16BE(ASCENT, 4);
  b.writeInt16BE(DESCENT, 6);
  b.writeUInt16BE(ADV, 10); // advanceWidthMax
  b.writeInt16BE(520, 16); // xMaxExtent
  b.writeInt16BE(1, 18); // caretSlopeRise
  b.writeUInt16BE(order.length, 34); // numberOfHMetrics
  return b;
}

function buildMaxp(order) {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(0x00010000, 0); // version 1.0
  b.writeUInt16BE(order.length, 4); // numGlyphs
  b.writeUInt16BE(Math.max(...order.map((n) => GLYPHS[n].flat().length)), 6); // maxPoints
  b.writeUInt16BE(1, 8); // maxContours
  b.writeUInt16BE(1, 14); // maxZones
  return b;
}

function buildKern(pairs) {
  const n = pairs.length;
  const es = log2floor(n);
  const sr = 6 * 2 ** es;
  const length = 6 + 8 + n * 6;
  const parts = [
    u16(0), u16(length), u16(0x0001), // subtable: version, length, coverage (horizontal, format 0)
    u16(n), u16(sr), u16(es), u16(6 * n - sr),
    ...pairs.flatMap((p) => [u16(p[0]), u16(p[1]), i16(p[2])]),
  ];
  return cat([u16(0), u16(1), cat(parts)]); // kern table: version, nTables, subtable
}

// A `name` table. Records are [platformID, encodingID, languageID, nameID, text];
// platform 1 (Macintosh) stores one byte per char (Mac Roman), platform 0/3 store
// UTF-16BE. The spec sorts records by platform/encoding/language/name, which is
// what puts Apple's Macintosh records ahead of the Windows ones.
function buildName(records) {
  const sorted = [...records].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  const encoded = sorted.map(([platform, , , , text]) => (platform === 1
    ? Buffer.from(text.split("").map((c) => MAC_ROMAN.indexOf(c) >= 0 ? 0x80 + MAC_ROMAN.indexOf(c) : c.charCodeAt(0)))
    : Buffer.from(text, "utf16le").swap16()));
  const storage = cat(encoded);
  const dir = [u16(0), u16(sorted.length), u16(6 + sorted.length * 12)];
  let offset = 0;
  sorted.forEach(([platform, encoding, language, nameId], i) => {
    dir.push(u16(platform), u16(encoding), u16(language), u16(nameId), u16(encoded[i].length), u16(offset));
    offset += encoded[i].length;
  });
  return cat([...dir, storage]);
}

function assemble(tables) {
  const tags = Object.keys(tables).sort();
  const es = log2floor(tags.length);
  const sr = 16 * 2 ** es;
  const header = cat([u32(0x00010000), u16(tags.length), u16(sr), u16(es), u16(tags.length * 16 - sr)]);
  let offset = header.length + tags.length * 16;
  const dir = [];
  const data = [];
  for (const tag of tags) {
    const padded = pad4(tables[tag]);
    dir.push(cat([Buffer.from(tag, "ascii"), u32(0), u32(offset), u32(tables[tag].length)]));
    data.push(padded);
    offset += padded.length;
  }
  return cat([header, ...dir, ...data]);
}

function buildFont({ cmapSegments, kernPairs, nameRecords, order = ORDER }) {
  const { glyf, loca, bbox } = glyfAndLoca(order);
  const tables = {
    head: buildHead(bbox),
    hhea: buildHhea(order),
    maxp: buildMaxp(order),
    hmtx: buildHmtx(order),
    cmap: buildCmap(cmapSegments),
    loca,
    glyf,
  };
  if (kernPairs) tables.kern = buildKern(kernPairs);
  if (nameRecords) tables.name = buildName(nameRecords);
  return assemble(tables);
}

// idDelta maps a contiguous code range to glyph ids: glyph = (code + idDelta) & 0xFFFF.
// A(0x41)->1, B(0x42)->2 share delta -64; alef(0x5D0)->1, bet(0x5D1)->2 share -1487.
const twoGlyph = buildFont({
  cmapSegments: [[0x41, 0x42, -64], [0x5d0, 0x5d1, -1487], [0xffff, 0xffff, 1]],
});
const kernFont = buildFont({
  cmapSegments: [[0x41, 0x42, -64], [0xffff, 0xffff, 1]],
  kernPairs: [[1, 2, -300]],
});
// A(0x41)->1 (delta -64), C(0x43)->2 (delta -65).
const curveFont = buildFont({
  cmapSegments: [[0x41, 0x41, -64], [0x43, 0x43, -65], [0xffff, 0xffff, 1]],
  order: CURVE_ORDER,
});

// Apple's system fonts (Arial, Helvetica Neue, Menlo, Georgia…) lead their name
// table with Macintosh records, and some carry their family name ONLY there.
// "Café Mac" holds a Mac Roman high-half byte (0x8E = é) so a decoder that only
// passes ASCII through is visibly wrong.
const namedFont = buildFont({
  cmapSegments: [[0x41, 0x42, -64], [0xffff, 0xffff, 1]],
  nameRecords: [
    [1, 0, 0, 1, "Mac Family"], // Macintosh, Roman, English
    [1, 0, 0, 4, "Café Mac"],
    [1, 0, 0, 6, "MacOnlyPS"],
    [3, 1, 0x409, 1, "Windows Family"], // Windows, Unicode BMP, en-US
  ],
});

writeFileSync(join(HERE, "two_glyph.ttf"), twoGlyph);
writeFileSync(join(HERE, "kern_font.ttf"), kernFont);
writeFileSync(join(HERE, "curve_font.ttf"), curveFont);
// Apple's shape again, but under a name Vision's DEFAULT_VECTOR_FONT_STACKS ask
// for: if the parser cannot read this table, provisioning never registers the
// family and the Style picker silently falls back to the generic four.
const stackFont = buildFont({
  cmapSegments: [[0x41, 0x42, -64], [0xffff, 0xffff, 1]],
  nameRecords: [
    [1, 0, 0, 1, "Verdana"], // Macintosh, Roman, English — first, as Apple ships
    [1, 0, 0, 2, "Regular"],
    [3, 1, 0x409, 1, "Verdana"], // Windows, Unicode BMP, en-US
    [3, 1, 0x409, 2, "Regular"],
  ],
});

writeFileSync(join(HERE, "named_font.ttf"), namedFont);
writeFileSync(join(HERE, "stack_font.ttf"), stackFont);
console.log(`wrote two_glyph.ttf (${twoGlyph.length} bytes), kern_font.ttf (${kernFont.length} bytes), curve_font.ttf (${curveFont.length} bytes), named_font.ttf (${namedFont.length} bytes) and stack_font.ttf (${stackFont.length} bytes)`);
