// ─────────────────────────────────────────────────────────────
// io/import/pdf — PDF + Adobe Illustrator (PDF-compatible & legacy PS) import
// ─────────────────────────────────────────────────────────────
// A pragmatic vector importer: scan stream objects, inflate the FlateDecode
// ones, run the PDF content-stream interpreter (path/paint/color/CTM operators)
// on any stream that looks like content, and assemble the painted paths into a
// Document. Modern .ai IS a PDF, so it routes here too; legacy %!PS .ai runs the
// same interpreter on the raw PostScript (shared path operators). Subset tier:
// vectors + solid fills/strokes + transforms; clipping/text/images are skipped.

import {
  BBox,
  type Document,
  type Item,
  Mat,
  type Matrix,
  type Paint,
  type PathGeometry,
  type Point,
  type RGBA,
  Query,
  Shapes,
  defaultStroke,
  makeArtboard,
  makeCompound,
  makeDocument,
  makeGroup,
  makeLayer,
  makePath,
  noPaint,
  solid,
} from "../../engine";
import {
  analyzePdfLikeImportCompatibility,
  createImportCompatibilityReport,
  mergeCompatibilityWarnings,
  type CompatibilityIssue,
} from "../compatibility";
import type { ImportResult } from "./index";
import { inflateAuto, unpredict } from "./inflate";

const latin1 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

const cmykToRgb = (c: number, m: number, y: number, k: number): RGBA => ({
  r: 255 * (1 - c) * (1 - k),
  g: 255 * (1 - m) * (1 - k),
  b: 255 * (1 - y) * (1 - k),
  a: 1,
});

// ── content-stream tokenizer (numbers + operators; skips the rest) ──
type CTok = { n: number } | { op: string };
function tokenizeContent(s: string): CTok[] {
  const out: CTok[] = [];
  let i = 0;
  let steps = 0;
  const n = s.length;
  const ws = (c: string) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
  while (i < n) {
    if (steps++ >= n) throw new Error(`PDF tokenizer stalled at ${i}`);
    const c = s[i];
    if (ws(c)) { i++; continue; }
    if (c === "%") { while (i < n && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
    if (c === "/") { i++; while (i < n && !ws(s[i]) && "/[]<>(){}".indexOf(s[i]) < 0) i++; continue; }
    if (c === "(") { // literal string
      let depth = 1; i++;
      while (i < n && depth > 0) { if (s[i] === "\\") i += 2; else { if (s[i] === "(") depth++; else if (s[i] === ")") depth--; i++; } }
      continue;
    }
    if (c === "<") { if (s[i + 1] === "<") { i += 2; continue; } while (i < n && s[i] !== ">") i++; i++; continue; }
    if (c === ">") { i++; continue; }
    if (c === "[" || c === "]" || c === "{" || c === "}" || c === ")") { i++; continue; }
    if ((c >= "0" && c <= "9") || c === "+" || c === "-" || c === ".") {
      let j = i; if (s[j] === "+" || s[j] === "-") j++;
      while (j < n && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) j++;
      out.push({ n: parseFloat(s.slice(i, j)) });
      i = j; continue;
    }
    // operator (letters + a few symbols)
    let j = i;
    while (j < n && !ws(s[j]) && "/[]<>(){}%".indexOf(s[j]) < 0) j++;
    out.push({ op: s.slice(i, j) });
    i = j;
  }
  return out;
}

interface GState {
  ctm: Matrix;
  fill: RGBA;
  stroke: RGBA;
  lineWidth: number;
}

interface SubCmd {
  k: "M" | "L" | "C";
  pts: Point[]; // absolute, user space
}

function buildGeometry(sub: SubCmd[], closed: boolean, m: Matrix): PathGeometry {
  const tp = (p: Point) => Mat.applyToPoint(m, p);
  const anchors: { point: Point; handleIn: Point; handleOut: Point }[] = [];
  for (const c of sub) {
    if (c.k === "M") anchors.push({ point: tp(c.pts[0]), handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    else if (c.k === "L") anchors.push({ point: tp(c.pts[0]), handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    else {
      const c1 = tp(c.pts[0]);
      const c2 = tp(c.pts[1]);
      const end = tp(c.pts[2]);
      const last = anchors[anchors.length - 1];
      if (last) last.handleOut = { x: c1.x - last.point.x, y: c1.y - last.point.y };
      anchors.push({ point: end, handleIn: { x: c2.x - end.x, y: c2.y - end.y }, handleOut: { x: 0, y: 0 } });
    }
  }
  return { anchors, closed };
}

/** Interpret one content stream, appending painted items (in PDF user space). */
function runContentStream(s: string, items: Item[]): void {
  const toks = tokenizeContent(s);
  let gs: GState = { ctm: Mat.IDENTITY, fill: { r: 0, g: 0, b: 0, a: 1 }, stroke: { r: 0, g: 0, b: 0, a: 1 }, lineWidth: 1 };
  const stack: GState[] = [];
  let subs: { cmds: SubCmd[]; closed: boolean }[] = [];
  let cur: { cmds: SubCmd[]; closed: boolean } | null = null;
  let pt: Point = { x: 0, y: 0 };
  const operands: number[] = [];
  const pop = (k: number) => operands.splice(operands.length - k, k);

  const emit = (doFill: boolean, doStroke: boolean, evenOdd: boolean) => {
    if (cur) subs.push(cur);
    if (subs.length) {
      const geos = subs.map((sp) => buildGeometry(sp.cmds, sp.closed, gs.ctm)).filter((g) => g.anchors.length >= 2);
      if (geos.length) {
        const fill: Paint = doFill ? solid(gs.fill) : noPaint();
        const strokePaint: Paint = doStroke ? solid(gs.stroke) : noPaint();
        const stroke = { ...defaultStroke(strokePaint), width: Math.max(0.1, gs.lineWidth * Mat.meanScale(gs.ctm)) };
        let item: Item;
        if (geos.length === 1) item = makePath(geos[0], { fill, stroke });
        else {
          item = makeCompound(geos, { fill, stroke });
          item.evenOdd = true;
        }
        if (evenOdd) item.evenOdd = true;
        items.push(item);
      }
    }
    subs = [];
    cur = null;
  };

  for (const t of toks) {
    if ("n" in t) {
      operands.push((t as { n: number }).n);
      continue;
    }
    const rawOp = (t as { op: string }).op;
    // Legacy-AI aliases: L/C/V/Y are smooth variants of l/c/v/y; Xa/XA set RGB.
    const op = rawOp === "L" ? "l" : rawOp === "C" ? "c" : rawOp === "V" ? "v" : rawOp === "Y" ? "y" : rawOp === "Xa" ? "rg" : rawOp === "XA" ? "RG" : rawOp;
    switch (op) {
      case "q": stack.push({ ...gs }); break;
      case "Q": if (stack.length) gs = stack.pop()!; break;
      case "cm": {
        const a = pop(6);
        if (a.length === 6) gs.ctm = Mat.mul(gs.ctm, { a: a[0], b: a[1], c: a[2], d: a[3], e: a[4], f: a[5] });
        break;
      }
      case "m": {
        const a = pop(2);
        if (cur) subs.push(cur);
        pt = { x: a[0], y: a[1] };
        cur = { cmds: [{ k: "M", pts: [pt] }], closed: false };
        break;
      }
      case "l": {
        const a = pop(2);
        pt = { x: a[0], y: a[1] };
        cur?.cmds.push({ k: "L", pts: [pt] });
        break;
      }
      case "c": {
        const a = pop(6);
        cur?.cmds.push({ k: "C", pts: [{ x: a[0], y: a[1] }, { x: a[2], y: a[3] }, { x: a[4], y: a[5] }] });
        pt = { x: a[4], y: a[5] };
        break;
      }
      case "v": {
        const a = pop(4);
        cur?.cmds.push({ k: "C", pts: [{ ...pt }, { x: a[0], y: a[1] }, { x: a[2], y: a[3] }] });
        pt = { x: a[2], y: a[3] };
        break;
      }
      case "y": {
        const a = pop(4);
        cur?.cmds.push({ k: "C", pts: [{ x: a[0], y: a[1] }, { x: a[2], y: a[3] }, { x: a[2], y: a[3] }] });
        pt = { x: a[2], y: a[3] };
        break;
      }
      case "re": {
        const a = pop(4);
        const [x, y, w, h] = a;
        if (cur) subs.push(cur);
        cur = { cmds: [{ k: "M", pts: [{ x, y }] }, { k: "L", pts: [{ x: x + w, y }] }, { k: "L", pts: [{ x: x + w, y: y + h }] }, { k: "L", pts: [{ x, y: y + h }] }], closed: true };
        subs.push(cur);
        cur = null;
        pt = { x, y };
        break;
      }
      case "h": if (cur) cur.closed = true; break;
      case "n": if (cur) subs.push(cur); subs = []; cur = null; break;
      case "f": case "F": emit(true, false, false); break;
      case "f*": emit(true, false, true); break;
      case "S": emit(false, true, false); break;
      case "s": if (cur) cur.closed = true; emit(false, true, false); break;
      case "B": case "B*": emit(true, true, op === "B*"); break;
      case "b": case "b*": if (cur) cur.closed = true; emit(true, true, op === "b*"); break;
      case "g": { const a = pop(1); const v = (a[0] ?? 0) * 255; gs.fill = { r: v, g: v, b: v, a: 1 }; break; }
      case "G": { const a = pop(1); const v = (a[0] ?? 0) * 255; gs.stroke = { r: v, g: v, b: v, a: 1 }; break; }
      case "rg": { const a = pop(3); gs.fill = { r: a[0] * 255, g: a[1] * 255, b: a[2] * 255, a: 1 }; break; }
      case "RG": { const a = pop(3); gs.stroke = { r: a[0] * 255, g: a[1] * 255, b: a[2] * 255, a: 1 }; break; }
      case "k": { const a = pop(4); gs.fill = cmykToRgb(a[0], a[1], a[2], a[3]); break; }
      case "K": { const a = pop(4); gs.stroke = cmykToRgb(a[0], a[1], a[2], a[3]); break; }
      case "sc": case "scn": {
        const a = operands.splice(0, operands.length);
        const col = a.length === 1 ? { r: a[0] * 255, g: a[0] * 255, b: a[0] * 255, a: 1 } : a.length === 4 ? cmykToRgb(a[0], a[1], a[2], a[3]) : a.length >= 3 ? { r: a[0] * 255, g: a[1] * 255, b: a[2] * 255, a: 1 } : gs.fill;
        gs.fill = col;
        break;
      }
      case "SC": case "SCN": {
        const a = operands.splice(0, operands.length);
        const col = a.length === 1 ? { r: a[0] * 255, g: a[0] * 255, b: a[0] * 255, a: 1 } : a.length === 4 ? cmykToRgb(a[0], a[1], a[2], a[3]) : a.length >= 3 ? { r: a[0] * 255, g: a[1] * 255, b: a[2] * 255, a: 1 } : gs.stroke;
        gs.stroke = col;
        break;
      }
      case "w": { const a = pop(1); gs.lineWidth = a[0] ?? 1; break; }
      default:
        operands.length = 0; // drop operands for ignored operators (W, gs, Do, BT/ET, etc.)
        break;
    }
    if (op !== "sc" && op !== "scn" && op !== "SC" && op !== "SCN") operands.length = 0;
  }
}

// ── stream extraction ──────────────────────────────────────────
interface RawStream {
  dict: string;
  body: Uint8Array;
}
function findStreams(bytes: Uint8Array, raw: string): RawStream[] {
  const out: RawStream[] = [];
  let idx = 0;
  while (true) {
    const sIdx = raw.indexOf("stream", idx);
    if (sIdx < 0) break;
    // dict is the "<< ... >>" immediately preceding
    const dictEnd = raw.lastIndexOf(">>", sIdx);
    const dictStart = dictEnd >= 0 ? raw.lastIndexOf("<<", dictEnd) : -1;
    const dict = dictStart >= 0 ? raw.slice(dictStart, dictEnd + 2) : "";
    // body starts after "stream" + EOL
    let b = sIdx + 6;
    if (raw[b] === "\r") b++;
    if (raw[b] === "\n") b++;
    const eIdx = raw.indexOf("endstream", b);
    if (eIdx < 0) { idx = sIdx + 6; continue; }
    let bodyEnd = eIdx;
    if (raw[bodyEnd - 1] === "\n") bodyEnd--;
    if (raw[bodyEnd - 1] === "\r") bodyEnd--;
    out.push({ dict, body: bytes.subarray(b, bodyEnd) });
    idx = eIdx + 9;
  }
  return out;
}

const looksLikeContent = (s: string): boolean => /(^|[\s])(re|m|c|l)\s/.test(s) && /[\s](f|F|S|B|b|f\*|s|n)([\s]|$)/.test(s);

async function decodeStream(rs: RawStream): Promise<string | null> {
  let data = rs.body;
  if (/\/FlateDecode|\/Fl\b/.test(rs.dict)) {
    data = await inflateAuto(data);
    if (data.length === 0) return null;
    const pm = /\/Predictor\s+(\d+)/.exec(rs.dict);
    if (pm) {
      const predictor = parseInt(pm[1], 10);
      const cols = parseInt((/\/Columns\s+(\d+)/.exec(rs.dict) ?? [])[1] ?? "1", 10);
      const colors = parseInt((/\/Colors\s+(\d+)/.exec(rs.dict) ?? [])[1] ?? "1", 10);
      const bpc = parseInt((/\/BitsPerComponent\s+(\d+)/.exec(rs.dict) ?? [])[1] ?? "8", 10);
      data = unpredict(data, predictor, colors, bpc, cols);
    }
  } else if (/\/(LZWDecode|DCTDecode|ASCII85Decode|ASCIIHexDecode|RunLengthDecode|JPXDecode|CCITTFaxDecode)/.test(rs.dict)) {
    return null; // unsupported filter
  }
  return latin1(data);
}

// ── orchestration ──────────────────────────────────────────────
function assembleDocument(items: Item[], mediaBox: number[] | null): Document {
  // Flip from PDF y-up to our y-down, and place at the artboard origin.
  let flip: Matrix;
  let abw: number;
  let abh: number;
  if (mediaBox && mediaBox.length === 4) {
    const [x0, y0, x1, y1] = mediaBox;
    flip = { a: 1, b: 0, c: 0, d: -1, e: -x0, f: y1 };
    abw = Math.abs(x1 - x0);
    abh = Math.abs(y1 - y0);
  } else {
    // flip about the content's vertical center; artboard = content bounds
    let bb: { x: number; y: number; width: number; height: number } | null = null;
    for (const it of items) bb = BBox.union(bb, BBox.transform(Shapes.localBounds(it), it.transform));
    const b = bb ?? { x: 0, y: 0, width: 1000, height: 1000 };
    flip = { a: 1, b: 0, c: 0, d: -1, e: -b.x, f: b.y + b.height + b.y };
    abw = b.width;
    abh = b.height;
  }
  for (const it of items) it.transform = Mat.mul(flip, it.transform);

  const doc = makeDocument("Imported", Math.max(1, Math.round(abw)), Math.max(1, Math.round(abh)));
  doc.artboards[0] = makeArtboard("Artboard 1", 0, 0, Math.max(1, abw), Math.max(1, abh));
  const layer = makeLayer("Imported");
  layer.items = items;
  doc.layers = [layer];
  // recompute placement so content sits on the artboard
  const bounds = Query.selectionBounds(doc, items.map((i) => i.id));
  if (bounds) doc.artboards[0] = makeArtboard("Artboard 1", bounds.x, bounds.y, Math.max(1, bounds.width), Math.max(1, bounds.height));
  return doc;
}

export async function importPDForAI(bytes: Uint8Array, fmt: "pdf" | "ai"): Promise<ImportResult> {
  const raw = latin1(bytes);
  const warnings: string[] = [];
  const items: Item[] = [];
  let featureSource = raw;

  const mbMatch = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(raw);
  const mediaBox = mbMatch ? [mbMatch[1], mbMatch[2], mbMatch[3], mbMatch[4]].map(Number) : null;

  const isPdf = raw.startsWith("%PDF");
  let parsedAnyStream = false;
  if (isPdf) {
    const streams = findStreams(bytes, raw);
    for (const rs of streams) {
      const text = await decodeStream(rs);
      if (text) featureSource += `\n${text}`;
      if (text && looksLikeContent(text)) {
        runContentStream(text, items);
        parsedAnyStream = true;
      }
    }
  }
  // Legacy AI / EPS, or a PDF whose content we couldn't isolate: run the raw text.
  if (!parsedAnyStream) {
    if (looksLikeContent(raw)) runContentStream(raw, items);
    else warnings.push("No decodable vector content streams found.");
  }

  if (items.length === 0) warnings.push(`No vector geometry could be extracted from this ${fmt.toUpperCase()} file.`);
  const doc = assembleDocument(items, mediaBox);
  const warningIssues: CompatibilityIssue[] = warnings.map((message, i) => ({
    code: `${fmt}-warning-${i + 1}`,
    severity: "warning",
    feature: "import",
    format: fmt,
    message,
  }));
  const analyzed = analyzePdfLikeImportCompatibility(fmt, featureSource);
  const report = createImportCompatibilityReport(fmt, { issues: [...analyzed.issues, ...warningIssues] });
  return { doc, warnings: mergeCompatibilityWarnings(warnings, report), report };
}
