// ─────────────────────────────────────────────────────────────
// io/import/cdr — CorelDRAW .cdr → Document (RIFF, spec-accurate geometry)
// ─────────────────────────────────────────────────────────────
// Decodes the CorelDRAW RIFF tree per the Kaitai `coreldraw_cdr.ksy` spec:
// walks `obj` lists pairing each `loda` (object data) with its `trfd`
// (transform), reads the loda argument table, decodes the `loda_coords`
// (type 30) point list into relative-handle anchors via the point-type byte
// state machine (op = bits 6-7: move/line/cubic/control; close = bit 2 clear),
// and applies the trfd affine matrix. Fills are defaulted (the fild/fill table
// is not yet resolved). Coordinates: s2/1000 (v<600) or s4/254000, scaled to px.

import {
  type Anchor,
  type Document,
  type Item,
  type Matrix,
  type PathGeometry,
  type Point,
  Query,
  Shapes,
  makeArtboard,
  makeCompound,
  makeDocument,
  makeLayer,
  makePath,
  solid,
} from "../../engine";
import {
  createCdrImportCompatibilityReport,
  mergeCompatibilityWarnings,
} from "../compatibility";
import type { ImportResult } from "./index";
import { inflate } from "./inflate";

const PX = 96; // CDR coord value (≈ inches) → px
const MAX_RIFF_DEPTH = 100;

const fourCC = (b: Uint8Array, o: number): string =>
  o + 4 <= b.length ? String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) : "";

interface CdrObject {
  loda?: Uint8Array;
  trfd?: Uint8Array;
}

/** Walk the RIFF tree, pairing each `obj` list's loda + trfd; also returns vrsn. */
function walk(b: Uint8Array): { objects: CdrObject[]; version: number; depthExceeded: boolean } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const objects: CdrObject[] = [];
  let version = 0;
  let depthExceeded = false;

  const recurse = (start: number, end: number, current: CdrObject | null, depth = 0) => {
    if (depth > MAX_RIFF_DEPTH) {
      depthExceeded = true;
      return;
    }
    let p = start;
    while (p + 8 <= end) {
      const id = fourCC(b, p);
      const size = dv.getUint32(p + 4, true);
      const dataStart = p + 8;
      const dataEnd = Math.min(end, dataStart + size);
      if (dataStart > end || size < 0) break;
      if (id === "RIFF" || id === "LIST") {
        const listType = fourCC(b, dataStart);
        let obj = current;
        if (listType === "obj ") {
          obj = {};
          objects.push(obj);
        }
        recurse(dataStart + 4, dataEnd, obj, depth + 1);
      } else {
        const body = b.subarray(dataStart, dataEnd);
        if (id === "vrsn" && body.length >= 2) version = new DataView(body.buffer, body.byteOffset, 2).getUint16(0, true);
        else if (id === "loda" || id === "lobj") {
          if (!current) {
            const o: CdrObject = { loda: body };
            objects.push(o);
          } else current.loda = body;
        } else if (id === "trfd" && current) current.trfd = body;
      }
      p = dataStart + size + (size & 1); // word alignment
    }
  };
  recurse(0, b.length, null);
  return { objects, version: version || 800, depthExceeded };
}

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;
const anc = (p: Point, hi: Point = { x: 0, y: 0 }, ho: Point = { x: 0, y: 0 }): Anchor => ({
  point: { ...p },
  handleIn: { ...hi },
  handleOut: { ...ho },
});

/** Point-type byte state machine → subpaths with relative handles. */
function pointsToGeometry(pts: Point[], types: number[]): PathGeometry[] {
  const subs: PathGeometry[] = [];
  let anchors: Anchor[] = [];
  let closed = false;
  let controls: Point[] = [];
  const flush = () => {
    if (closed && anchors.length > 1 && near(anchors[anchors.length - 1].point, anchors[0].point)) {
      anchors[0].handleIn = anchors[anchors.length - 1].handleIn;
      anchors.pop();
    }
    if (anchors.length >= 2) subs.push({ anchors, closed });
    anchors = [];
    closed = false;
    controls = [];
  };
  for (let i = 0; i < pts.length; i++) {
    const t = types[i] ?? 0;
    const op = (t >> 6) & 0x3;
    const closing = (t & 0x08) !== 0; // is_closing_path bit (libcdr processPath)
    if (op === 0) {
      // move_to
      flush();
      anchors.push(anc(pts[i]));
      if (closing) closed = true; // rare: subpath flagged closed at its move_to
    } else if (op === 3) {
      // control point
      controls.push(pts[i]);
    } else if (op === 1) {
      // line_to
      if (anchors.length) anchors.push(anc(pts[i]));
      controls = [];
      if (closing) {
        closed = true;
        flush();
      }
    } else {
      // cubic_bezier_to (endpoint; two control points precede)
      if (anchors.length && controls.length >= 2) {
        const c1 = controls[controls.length - 2];
        const c2 = controls[controls.length - 1];
        const last = anchors[anchors.length - 1];
        last.handleOut = { x: c1.x - last.point.x, y: c1.y - last.point.y };
        anchors.push(anc(pts[i], { x: c2.x - pts[i].x, y: c2.y - pts[i].y }));
      } else if (anchors.length) {
        anchors.push(anc(pts[i]));
      }
      controls = [];
      if (closing) {
        closed = true;
        flush();
      }
    }
  }
  flush();
  return subs;
}

const ARG_LODA_COORDS = 30;
const CT_RECTANGLE = 0x01;
const CT_ELLIPSE = 0x02;
const CT_LINE_AND_CURVE = 0x03;
const CT_POLYGON = 0x14;
const CT_PATH = 0x25;

/** Decode a loda chunk → path subpaths (px, CDR y-up) + its chunk/object type. */
function decodeLoda(loda: Uint8Array, p16: boolean): PathGeometry[] {
  const dv = new DataView(loda.buffer, loda.byteOffset, loda.byteLength);
  const W = p16 ? 2 : 4;
  const rdU = (o: number) => (o + W <= loda.length ? (p16 ? dv.getUint16(o, true) : dv.getUint32(o, true)) : 0);
  if (loda.length < W * 5) return [];
  // header: chunk_length, num_of_args, start_of_args, start_of_arg_types, chunk_type
  const numArgs = rdU(W);
  const startOfArgs = rdU(2 * W);
  const startOfArgTypes = rdU(3 * W);
  const chunkType = rdU(4 * W);
  if (numArgs > 1024) return [];

  const argOffsets: number[] = [];
  for (let i = 0; i <= numArgs; i++) argOffsets.push(rdU(startOfArgs + i * W));
  const argTypes: number[] = [];
  for (let i = 0; i < numArgs; i++) argTypes.push(rdU(startOfArgTypes + i * W));

  for (let i = 0; i < numArgs; i++) {
    const type = argTypes[numArgs - 1 - i]; // arg_types are stored in reverse
    if (type !== ARG_LODA_COORDS) continue;
    const ofs = argOffsets[i];
    const len = (argOffsets[i + 1] || loda.length) - ofs;
    if (ofs < 0 || ofs >= loda.length || len <= 0) continue;
    const body = loda.subarray(ofs, Math.min(loda.length, ofs + len));
    const geos = decodeCoords(body, chunkType, p16);
    if (geos.length) return geos;
  }
  return [];
}

function decodeCoords(body: Uint8Array, chunkType: number, p16: boolean): PathGeometry[] {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const cs = p16 ? 2 : 4;
  const coord = (o: number) => (o + cs <= body.length ? (p16 ? dv.getInt16(o, true) : dv.getInt32(o, true)) : 0) / (p16 ? 1000 : 254000) * PX;

  if (chunkType === CT_RECTANGLE) {
    const w = coord(0);
    const h = coord(cs);
    if (!w || !h) return [];
    return [Shapes.rectPath(Math.abs(w), Math.abs(h))];
  }
  if (chunkType === CT_ELLIPSE) {
    const w = coord(0);
    const h = coord(cs);
    if (!w || !h) return [];
    return [Shapes.ellipsePath(Math.abs(w), Math.abs(h))];
  }

  let count = 0;
  let coordStart = 0;
  if (chunkType === CT_LINE_AND_CURVE || chunkType === CT_POLYGON) {
    count = body.length >= 4 ? dv.getUint32(0, true) : 0;
    coordStart = 4;
  } else if (chunkType === CT_PATH) {
    if (body.length < 24) return [];
    count = dv.getUint16(4, true) + dv.getUint16(6, true);
    coordStart = 24;
  } else {
    return [];
  }
  const pointSize = cs * 2;
  const maxN = Math.max(0, Math.floor((body.length - coordStart) / (pointSize + 1)));
  count = Math.min(count, maxN);
  if (count < 2) return [];

  const pts: Point[] = [];
  let o = coordStart;
  for (let i = 0; i < count; i++) {
    pts.push({ x: coord(o), y: coord(o + cs) });
    o += pointSize;
  }
  const types: number[] = [];
  for (let i = 0; i < count; i++) types.push(body[o++] ?? 0);
  return pointsToGeometry(pts, types);
}

/** Decode a trfd chunk → the object's affine matrix (or null). */
function decodeTrfd(trfd: Uint8Array, version: number): Matrix | null {
  const p16 = version < 600;
  const dv = new DataView(trfd.buffer, trfd.byteOffset, trfd.byteLength);
  const W = p16 ? 2 : 4;
  const rdU = (o: number) => (o + W <= trfd.length ? (p16 ? dv.getUint16(o, true) : dv.getUint32(o, true)) : 0);
  if (trfd.length < W * 3) return null;
  const numArgs = rdU(W);
  const startOfArgs = rdU(2 * W);
  if (numArgs < 1 || numArgs > 256) return null;
  for (let i = 0; i < numArgs; i++) {
    const offs = rdU(startOfArgs + i * W);
    const base = offs + (version >= 1300 ? 8 : 0);
    if (base + 2 > trfd.length) continue;
    const tmpType = dv.getUint16(base, true);
    if (tmpType !== 0x08 || version < 500) continue;
    let m = base + 2 + (version >= 600 ? 6 : 0);
    if (m + 48 > trfd.length) continue;
    const f8 = (o: number) => dv.getFloat64(o, true);
    const a = f8(m);
    const c = f8(m + 8);
    const tx = f8(m + 16);
    const b = f8(m + 24);
    const d = f8(m + 32);
    const ty = f8(m + 40);
    const sc = (version < 600 ? 1000 : 254000) / PX;
    return { a, b, c, d, e: tx / sc, f: ty / sc };
  }
  return null;
}

function assemble(items: Item[], warnings: string[]): Document {
  const doc = makeDocument("Imported", 1000, 1000);
  const layer = makeLayer("Imported");
  layer.items = items;
  doc.layers = [layer];
  if (!items.length) {
    warnings.push("No vector geometry could be decoded.");
    return doc;
  }
  // CDR is y-up: flip about the content's vertical centre, then set artboard = bounds.
  const pre = Query.selectionBounds(doc, items.map((i) => i.id));
  if (pre) {
    const flip: Matrix = { a: 1, b: 0, c: 0, d: -1, e: 0, f: pre.y + (pre.y + pre.height) };
    for (const it of items) it.transform = { a: flip.a * it.transform.a + flip.c * it.transform.b, b: flip.b * it.transform.a + flip.d * it.transform.b, c: flip.a * it.transform.c + flip.c * it.transform.d, d: flip.b * it.transform.c + flip.d * it.transform.d, e: flip.a * it.transform.e + flip.c * it.transform.f + flip.e, f: flip.b * it.transform.e + flip.d * it.transform.f + flip.f };
    const b = Query.selectionBounds(doc, items.map((i) => i.id));
    if (b) doc.artboards[0] = makeArtboard("Artboard 1", b.x, b.y, Math.max(1, b.width), Math.max(1, b.height));
  }
  return doc;
}

export async function importCDR(bytes: Uint8Array): Promise<ImportResult> {
  const warnings: string[] = [];
  if (fourCC(bytes, 0) !== "RIFF") {
    warnings.push("Not a RIFF-based CorelDRAW file.");
    const doc = assemble([], warnings);
    const report = createCdrImportCompatibilityReport(undefined, warnings);
    return { doc, warnings: mergeCompatibilityWarnings(warnings, report), report };
  }
  const { objects, version, depthExceeded } = walk(bytes);
  if (depthExceeded) warnings.push(`CorelDRAW RIFF nesting exceeds ${MAX_RIFF_DEPTH} levels; deeper content was ignored.`);
  if (version >= 1600) warnings.push(`CorelDRAW v${version}: newer records may not decode fully.`);
  const p16 = version < 600;
  const items: Item[] = [];
  for (const obj of objects) {
    if (!obj.loda) continue;
    let geos: PathGeometry[] = [];
    try {
      geos = decodeLoda(obj.loda, p16);
    } catch {
      continue;
    }
    if (!geos.length) continue;
    const transform = (obj.trfd && decodeTrfd(obj.trfd, version)) || undefined;
    const opts = { fill: solid({ r: 190, g: 195, b: 205, a: 1 }), transform };
    items.push(geos.length === 1 ? makePath(geos[0], opts) : makeCompound(geos, opts));
  }
  if (!items.length) warnings.push("CorelDRAW import recovered no paths (fills/effects not yet decoded).");
  else warnings.push("CorelDRAW import: geometry recovered; fills/strokes are defaulted.");
  const doc = assemble(items, warnings);
  const report = createCdrImportCompatibilityReport(undefined, warnings);
  return { doc, warnings: mergeCompatibilityWarnings(warnings, report), report };
}

// ── minimal ZIP reader for CorelDRAW X4/X5 containers ──────────
export async function importCDRZip(bytes: Uint8Array): Promise<ImportResult> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  let riff: Uint8Array | null = null;
  while (i + 30 <= bytes.length && dv.getUint32(i, true) === 0x04034b50) {
    const method = dv.getUint16(i + 8, true);
    const compSize = dv.getUint32(i + 18, true);
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const nameStart = i + 30;
    let name = "";
    for (let k = 0; k < nameLen && nameStart + k < bytes.length; k++) name += String.fromCharCode(bytes[nameStart + k]);
    const dataStart = nameStart + nameLen + extraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);
    if (/\.cdr$|riff/i.test(name)) {
      riff = method === 8 ? await inflate(data, true).catch(() => null) : data;
      if (riff && fourCC(riff, 0) === "RIFF") break;
      riff = null;
    }
    i = dataStart + compSize;
  }
  // Fail loudly: every zip that is not a CorelDRAW container lands here (this is
  // the fallback branch of the `PK` sniff), and handing back an empty document
  // would make an unrelated file look like it opened and lost all its content.
  if (!riff) {
    throw new Error("No CorelDRAW RIFF data inside this zip — it is either a CorelDRAW X6+ file (unsupported) or not a CorelDRAW file at all.");
  }
  // Past the RIFF gate this is an ordinary CorelDRAW import; the container added
  // no issues of its own (the only one it could raise is now the throw above).
  return importCDR(riff);
}
