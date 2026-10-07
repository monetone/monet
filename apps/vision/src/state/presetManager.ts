// presetManager.ts — pure list ops + preset-file interop for the Preset Manager
// (Edit ▸ Presets ▸ Presets), Photoshop's dialog for reordering/renaming/deleting
// saved presets and for Load… / Save Set…
// Engine-free; shared by the swatch / brush / tool-preset stores.

import { uniqueStylePresetName } from "./stylePresets";
import type { BrushPreset } from "./brushPresets";
import type { GradientPreset } from "./gradientPresets";
import type { GradientStop } from "./store";

/** The libraries the Preset Manager lists, in tab order.
 *  ponytail: Photoshop also manages Patterns and Contours — Vision has neither as
 *  a preset collection yet (Define Pattern goes straight into the engine), so they
 *  join this list when those libraries exist. */
// Photoshop's Preset Manager set. Patterns are a real library here (Edit ▸ Define
// Pattern fills it, and Fill / Pattern Stamp / Pattern Overlay all read it), so it
// belongs alongside the rest rather than being pick-and-delete only in its picker.
export const PRESET_CATEGORIES = ["swatches", "brushes", "tools", "patterns", "gradients", "styles", "shapes"] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

/** Move the item at `index` by `delta` positions (immutable). Returns the SAME
 *  array reference when the move is a no-op — bad index, delta 0, or a target
 *  clamped back onto `index` — so callers can skip a state update. */
export function moveItem<T>(arr: readonly T[], index: number, delta: number): T[] {
  if (index < 0 || index >= arr.length || delta === 0) return arr as T[];
  const target = Math.max(0, Math.min(arr.length - 1, index + delta));
  if (target === index) return arr as T[];
  const next = arr.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** Rename the named preset at `index` (trimmed). A blank/unchanged name or an
 *  out-of-range index returns the same array reference. */
export function renamePresetAt<T extends { name: string }>(arr: readonly T[], index: number, name: string): T[] {
  const trimmed = name.trim();
  if (index < 0 || index >= arr.length || !trimmed || arr[index].name === trimmed) return arr as T[];
  const next = arr.slice();
  next[index] = { ...next[index], name: trimmed };
  return next;
}

/** Append an imported library, renaming collisions instead of discarding them —
 *  Photoshop's Load…, which never silently drops a preset.
 *  ponytail: stylePresets.mergeStylePresets is this specialised to StylePreset;
 *  point it here once that file can be touched. */
export function mergeNamed<T extends { name: string }>(list: readonly T[], imported: readonly T[]): T[] {
  const out = [...list];
  for (const p of imported) out.push({ ...p, name: uniqueStylePresetName(out.map((q) => q.name), p.name) });
  return out;
}

// ── Vision preset sets (.mvpresets) ──────────────────────────────────────────
// Save Set… for the categories Adobe has a file format for but Vision cannot
// author (Brushes, Tool Presets, Custom Shapes), and Edit ▸ Export/Import Presets
// for all of them. The payload is the library verbatim, so the category's own
// persisted-shape validator (parseBrushPresets and friends) checks it on load and
// no second schema exists to drift.

export const PRESET_SET_EXT = "mvpresets";
export const MAX_PRESET_SET_BYTES = 4 * 1024 * 1024;

interface PresetSetFile {
  format: "mvpresets";
  version: 1;
  category: PresetCategory;
  items: unknown[];
}

export function buildPresetSet(category: PresetCategory, items: readonly unknown[]): string {
  const file: PresetSetFile = { format: "mvpresets", version: 1, category, items: [...items] };
  return JSON.stringify(file, null, 2);
}

/** The `items` of a `.mvpresets` file, re-serialised so the category's existing
 *  validator does the shape checking. Throws when the text is not a set file for
 *  `category` — this is an untrusted local file, so nothing is trusted but the
 *  envelope. */
export function presetSetItems(text: string, category: PresetCategory): string {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("Not a Monet preset set file"); }
  const file = raw as Partial<PresetSetFile> | null;
  if (!file || file.format !== "mvpresets" || !Array.isArray(file.items)) throw new Error("Not a Monet preset set file");
  if (file.category !== category) throw new Error(`That set holds ${String(file.category)} presets, not ${category}`);
  return JSON.stringify(file.items);
}

// ── Adobe descriptor codec ───────────────────────────────────────────────────
// Photoshop ships its libraries as Adobe action-descriptor trees: .grd (Gradients,
// file version 5) and the `desc` block of .abr (Brushes, file version 6/7/10)
// carry the same OSType tree .asl stores, so one bounded reader serves both.
//
// ponytail: this is the third copy of the descriptor codec (stylePresets.ts does
// .asl, actionSets.ts does .atn) — those two files belonged to other changes when
// this landed. Fold all three onto this one and delete the copies.

export const MAX_GRD_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_ABR_IMPORT_BYTES = 64 * 1024 * 1024; // .abr packs embed tip bitmaps we skip
const MAX_DESC_ITEMS = 4096;
const MAX_DESC_DEPTH = 24;
const MAX_PRESETS_PER_FILE = 1024;

type Val =
  | { t: "num"; v: number }
  | { t: "int"; v: number }
  | { t: "unit"; u: string; v: number }
  | { t: "bool"; v: boolean }
  | { t: "text"; v: string }
  | { t: "enum"; v: string }
  | { t: "desc"; v: Desc }
  | { t: "list"; v: Val[] }
  | { t: "raw" };
type Desc = Record<string, Val>;

/** Big-endian cursor; every read is bounds-checked so a truncated or hostile
 *  preset file throws instead of reading past the buffer. */
class DescReader {
  p = 0;
  private view: DataView;
  constructor(private buf: Uint8Array, private what: string) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  private need(n: number) {
    if (n < 0 || this.p + n > this.buf.length) throw new Error(`${this.what} is truncated`);
  }
  left() { return this.buf.length - this.p; }
  seek(p: number) { if (p < 0 || p > this.buf.length) throw new Error(`${this.what} is truncated`); this.p = p; }
  u8() { this.need(1); return this.buf[this.p++]; }
  u16() { this.need(2); const v = this.view.getUint16(this.p); this.p += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.p); this.p += 4; return v; }
  i32() { this.need(4); const v = this.view.getInt32(this.p); this.p += 4; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.p); this.p += 8; return v; }
  skip(n: number) { this.need(n); this.p += n; }
  ascii(n: number) {
    this.need(n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.buf[this.p + i]);
    this.p += n;
    return s;
  }
  /** Adobe key: u32 length, where 0 means the classic 4-character key. */
  key() { const n = this.u32(); return this.ascii(n === 0 ? 4 : n); }
  /** Adobe Unicode string: u32 UTF-16 code-unit count then UTF-16BE (NUL-terminated). */
  ustr() {
    const n = this.u32();
    this.need(n * 2);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u16());
    return s.replace(/\0+$/, "");
  }
  /** Consume the `u32 16` descriptor-version prefix when it is there — Photoshop
   *  writes it before top-level descriptors, some third-party writers do not. */
  descVersion() { const at = this.p; if (this.u32() !== 16) this.seek(at); }
}

function readVal(r: DescReader, depth: number): Val {
  const os = r.ascii(4);
  switch (os) {
    case "Objc": case "GlbO": return { t: "desc", v: readDesc(r, depth) };
    case "VlLs": {
      const n = r.u32();
      if (n > MAX_DESC_ITEMS) throw new Error("Preset file list is too long");
      const v: Val[] = [];
      for (let i = 0; i < n; i++) v.push(readVal(r, depth + 1));
      return { t: "list", v };
    }
    case "doub": return { t: "num", v: r.f64() };
    case "UntF": { const u = r.ascii(4); return { t: "unit", u, v: r.f64() }; }
    case "long": return { t: "int", v: r.i32() };
    case "comp": { r.skip(8); return { t: "raw" }; }
    case "bool": return { t: "bool", v: r.u8() !== 0 };
    case "TEXT": return { t: "text", v: r.ustr() };
    case "enum": { r.key(); return { t: "enum", v: r.key() }; }
    case "tdta": case "alis": { r.skip(r.u32()); return { t: "raw" }; }
    case "type": case "GlbC": { r.ustr(); r.key(); return { t: "raw" }; }
    case "UnFl": { r.ascii(4); r.skip(r.u32() * 8); return { t: "raw" }; }
    default: throw new Error(`Unsupported preset data (${os})`);
  }
}

function readDesc(r: DescReader, depth = 0): Desc {
  if (depth > MAX_DESC_DEPTH) throw new Error("Preset file nests too deeply");
  r.ustr(); // class display name (usually empty)
  r.key(); // classID
  const n = r.u32();
  if (n > MAX_DESC_ITEMS) throw new Error("Preset descriptor is too large");
  const out: Desc = {};
  for (let i = 0; i < n; i++) out[r.key()] = readVal(r, depth + 1);
  return out;
}

/** Growable big-endian sink. ponytail: a plain array, mirroring AslWriter —
 *  preset libraries are kilobytes. */
class DescWriter {
  private out: number[] = [];
  private scratch = new DataView(new ArrayBuffer(8));
  u8(v: number) { this.out.push(v & 0xff); }
  u16(v: number) { this.out.push((v >> 8) & 0xff, v & 0xff); }
  u32(v: number) { this.out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); }
  f64(v: number) {
    this.scratch.setFloat64(0, v);
    for (let i = 0; i < 8; i++) this.out.push(this.scratch.getUint8(i));
  }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.out.push(s.charCodeAt(i) & 0xff); }
  key(k: string) { this.u32(k.length === 4 ? 0 : k.length); this.ascii(k); }
  ustr(s: string) {
    this.u32(s.length + 1); // Photoshop counts the trailing NUL
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
    this.u16(0);
  }
  bytes(): Uint8Array { return Uint8Array.from(this.out); }
}

/** Enum typeIDs for the handful of gradient enums the writer emits. */
const ENUM_TYPE: Record<string, string> = { CstS: "GrdF", ClNs: "GrdF", UsrS: "Clry", BckC: "Clry", FrgC: "Clry" };

function writeVal(w: DescWriter, v: Val, cls: string) {
  switch (v.t) {
    case "num": w.ascii("doub"); w.f64(v.v); break;
    case "int": w.ascii("long"); w.u32(v.v | 0); break;
    case "unit": w.ascii("UntF"); w.ascii(v.u); w.f64(v.v); break;
    case "bool": w.ascii("bool"); w.u8(v.v ? 1 : 0); break;
    case "text": w.ascii("TEXT"); w.ustr(v.v); break;
    case "enum": w.ascii("enum"); w.key(ENUM_TYPE[v.v] ?? "null"); w.key(v.v); break;
    case "list": w.ascii("VlLs"); w.u32(v.v.length); for (const x of v.v) writeVal(w, x, cls); break;
    case "desc": w.ascii("Objc"); writeDesc(w, cls, v.v); break;
    default: w.ascii("bool"); w.u8(0); break; // never produced by the writer
  }
}

/** Photoshop keys a nested descriptor by its own class; these are the ones the
 *  gradient tree uses. Anything else rides as the generic `null` class. */
const DESC_CLASS: Record<string, string> = { "Clr ": "RGBC", Grad: "Grdn", Clrs: "Clrt", Trns: "TrnS", Grdn: "Grdn" };

function writeDesc(w: DescWriter, cls: string, d: Desc) {
  const items = Object.entries(d);
  w.ustr("");
  w.key(cls);
  w.u32(items.length);
  for (const [k, v] of items) writeKeyed(w, k, v);
}

function writeKeyed(w: DescWriter, k: string, v: Val) {
  w.key(k);
  writeVal(w, v, DESC_CLASS[k] ?? "null");
}

// ── value coercion ───────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A descriptor value as a plain number (doub / long / UntF alike), or null. */
function numOf(v: Val | undefined): number | null {
  if (!v) return null;
  if (v.t === "num" || v.t === "int" || v.t === "unit") return Number.isFinite(v.v) ? v.v : null;
  return null;
}

const numOr = (v: Val | undefined, fallback: number): number => numOf(v) ?? fallback;

/** A gradient stop location: Photoshop's 0..4096 ramp coordinate → 0..1. */
const locOf = (v: Val | undefined): number => clamp(numOr(v, 0) / 4096, 0, 1);

/** An `RGBC` colour descriptor → 0..255 channels. Non-RGB colour spaces (HSB,
 *  CMYK, Lab) land on black. ponytail: convert them here once a shared colour
 *  converter exists — .grd packs are overwhelmingly RGB. */
function rgb255(v: Val | undefined): [number, number, number] {
  if (v?.t !== "desc") return [0, 0, 0];
  return [
    Math.round(clamp(numOr(v.v["Rd  "], 0), 0, 255)),
    Math.round(clamp(numOr(v.v["Grn "], 0), 0, 255)),
    Math.round(clamp(numOr(v.v["Bl  "], 0), 0, 255)),
  ];
}

const textOf = (v: Val | undefined): string => (v?.t === "text" ? v.v.trim() : "");

// ── Adobe .grd (Gradients) ───────────────────────────────────────────────────

/** Sample the opacity ramp at `pos` (linear between stops, flat outside). */
function alphaAt(ramp: { pos: number; a: number }[], pos: number): number {
  if (!ramp.length) return 255;
  if (pos <= ramp[0].pos) return ramp[0].a;
  const last = ramp[ramp.length - 1];
  if (pos >= last.pos) return last.a;
  for (let i = 1; i < ramp.length; i++) {
    const b = ramp[i];
    if (pos > b.pos) continue;
    const a = ramp[i - 1];
    const span = b.pos - a.pos;
    return Math.round(span <= 0 ? b.a : a.a + ((pos - a.pos) / span) * (b.a - a.a));
  }
  return last.a;
}

/** One `Grad` descriptor → Vision's ramp. Photoshop keeps colour and opacity on
 *  two independent ramps and Vision's stop carries both, so each colour stop
 *  samples the transparency ramp at its own position.
 *  ponytail: an opacity stop that sits between two colour stops is therefore
 *  flattened into the interpolation — give GradientStop its own opacity ramp if
 *  that loss ever shows. Noise gradients (`GrdF` = ClNs) carry no `Clrs` and are
 *  skipped by the caller's stop-count check. */
function gradientStopsOf(g: Desc): GradientStop[] {
  const clrs = g["Clrs"];
  if (clrs?.t !== "list") return [];
  const trnsVal = g["Trns"];
  const ramp = (trnsVal?.t === "list" ? trnsVal.v : [])
    .filter((v): v is { t: "desc"; v: Desc } => v.t === "desc")
    .map((v) => ({ pos: locOf(v.v["Lctn"]), a: Math.round(clamp(numOr(v.v["Opct"], 100), 0, 100) * 2.55) }))
    .sort((a, b) => a.pos - b.pos);
  const stops: GradientStop[] = [];
  for (const v of clrs.v) {
    if (v.t !== "desc") continue;
    const pos = locOf(v.v["Lctn"]);
    const [r, g2, b] = rgb255(v.v["Clr "]);
    const stop: GradientStop = { pos, r, g: g2, b, a: alphaAt(ramp, pos) };
    const mid = numOf(v.v["Mdpn"]);
    if (mid !== null && Math.round(mid) !== 50) stop.midpoint = clamp(mid / 100, 0, 1);
    stops.push(stop);
  }
  return stops.sort((a, b) => a.pos - b.pos);
}

/** Collect every gradient in the descriptor tree. Walking for `Grad` rather than
 *  assuming one list key keeps us readable across the `Grdn`/`GrdL` spellings
 *  different Photoshop versions use for the top-level list. */
function collectGradients(d: Desc, out: GradientPreset[], depth: number) {
  if (out.length >= MAX_PRESETS_PER_FILE || depth > MAX_DESC_DEPTH) return;
  const grad = d["Grad"];
  if (grad?.t === "desc") {
    const stops = gradientStopsOf(grad.v);
    if (stops.length >= 2) {
      out.push({ name: textOf(d["Nm  "]) || textOf(grad.v["Nm  "]) || `Gradient ${out.length + 1}`, stops });
      return; // a gradient descriptor never nests another
    }
  }
  for (const v of Object.values(d)) {
    if (v.t === "desc") collectGradients(v.v, out, depth + 1);
    else if (v.t === "list") for (const item of v.v) if (item.t === "desc") collectGradients(item.v, out, depth + 1);
  }
}

/** Parse an Adobe .grd gradient library. Throws on a non-.grd or unreadable
 *  header; unknown extras inside are skipped, not fatal.
 *  ponytail: version 5 only (everything Photoshop CS and later writes) — the
 *  Photoshop 5/6 version-3 layout is a different, undocumented binary and gets a
 *  clear error instead of a guessed parse. */
export function parseGrd(bytes: Uint8Array): GradientPreset[] {
  if (bytes.length > MAX_GRD_IMPORT_BYTES) throw new Error("Gradient file is too large");
  const r = new DescReader(bytes, "Gradient file");
  if (r.ascii(4) !== "8BGR") throw new Error("Not an Adobe .grd gradient file");
  const version = r.u16();
  if (version !== 5) throw new Error(`Unsupported .grd version ${version} — re-save it from Photoshop CS or later`);
  r.descVersion();
  const root = readDesc(r);
  const out: GradientPreset[] = [];
  collectGradients(root, out, 0);
  const empty = [root.Grdn, root.GrdL].some((v) => v?.t === "list" && v.v.length === 0);
  if (!out.length && !empty) throw new Error("No gradients in this .grd file");
  return out;
}

const gradStopDesc = (s: GradientStop): Val => ({
  t: "desc",
  v: {
    "Clr ": { t: "desc", v: { "Rd  ": { t: "num", v: s.r }, "Grn ": { t: "num", v: s.g }, "Bl  ": { t: "num", v: s.b } } },
    Type: { t: "enum", v: "UsrS" },
    Lctn: { t: "int", v: Math.round(clamp(s.pos, 0, 1) * 4096) },
    Mdpn: { t: "int", v: Math.round(clamp(s.midpoint ?? 0.5, 0, 1) * 100) },
  },
});

const gradTransDesc = (s: GradientStop): Val => ({
  t: "desc",
  v: {
    Opct: { t: "unit", u: "#Prc", v: clamp(s.a, 0, 255) / 2.55 },
    Lctn: { t: "int", v: Math.round(clamp(s.pos, 0, 1) * 4096) },
    Mdpn: { t: "int", v: 50 },
  },
});

/** Serialise the Gradients library as an Adobe .grd file (version 5).
 *  ponytail: solid ramps only — no noise gradients and no smoothness authoring,
 *  because Vision's ramp has neither. Its own parseGrd reads this back. */
export function buildGrd(presets: readonly GradientPreset[]): Uint8Array {
  const w = new DescWriter();
  w.ascii("8BGR");
  w.u16(5);
  w.u32(16); // descriptor version
  writeDesc(w, "null", {
    Grdn: {
      t: "list",
      v: presets.map((p): Val => ({
        t: "desc",
        v: {
          "Nm  ": { t: "text", v: p.name },
          Grad: {
            t: "desc",
            v: {
              GrdF: { t: "enum", v: "CstS" },
              Intr: { t: "num", v: 4096 },
              Clrs: { t: "list", v: p.stops.map(gradStopDesc) },
              Trns: { t: "list", v: p.stops.map(gradTransDesc) },
            },
          },
        },
      })),
    },
  });
  return w.bytes();
}

// ── Adobe .abr (Brushes) ─────────────────────────────────────────────────────

/** One computed-brush descriptor → a Vision brush-settings preset. Photoshop
 *  keeps hardness/roundness/spacing as percentages and diameter in pixels. */
function brushFromDesc(d: Desc, name: string): BrushPreset {
  return {
    name,
    brush: {
      size: Math.round(clamp(numOr(d["Dmtr"], 20), 1, 5000)),
      hardness: clamp(numOr(d["Hrdn"], 100) / 100, 0, 1),
      spacing: clamp(numOr(d["Spcn"], 25) / 100, 0.01, 10),
      angle: clamp(numOr(d["Angl"], 0), -180, 180),
      roundness: clamp(numOr(d["Rndn"], 100) / 100, 0.01, 1),
    },
  };
}

/** Walk the `desc` block for computed brushes, carrying the nearest enclosing
 *  `Nm  ` down as the preset name (Photoshop parks it one level above `Brsh`). */
function collectBrushes(d: Desc, out: BrushPreset[], name: string, depth: number) {
  if (out.length >= MAX_PRESETS_PER_FILE || depth > MAX_DESC_DEPTH) return;
  const label = textOf(d["Nm  "]) || name;
  if (d["Dmtr"]) { out.push(brushFromDesc(d, label || `Brush ${out.length + 1}`)); return; }
  for (const v of Object.values(d)) {
    if (v.t === "desc") collectBrushes(v.v, out, label, depth + 1);
    else if (v.t === "list") for (const item of v.v) if (item.t === "desc") collectBrushes(item.v, out, label, depth + 1);
  }
}

/** Parse an Adobe .abr brush library into brush-settings presets.
 *  ponytail: computed (procedural) brushes only — a sampled tip lives in the
 *  `samp` block as an RLE bitmap, and a BrushPreset has no tip slot to put it in.
 *  Decode `samp` into the brushTips library when tip import is wanted. Versions
 *  below 6 (Photoshop 5-era) use a different undocumented record layout and get a
 *  clear error rather than a guessed parse. */
export function parseAbr(bytes: Uint8Array, stats?: { dropped: number; partial?: boolean }): BrushPreset[] {
  if (bytes.length > MAX_ABR_IMPORT_BYTES) throw new Error("Brush file is too large");
  const r = new DescReader(bytes, "Brush file");
  const version = r.u16();
  r.u16(); // sub-version
  if (version < 6) throw new Error(`Unsupported .abr version ${version} — re-save it from Photoshop 6 or later`);
  const out: BrushPreset[] = [];
  while (r.left() >= 12) {
    if (r.ascii(4) !== "8BIM") {
      if (stats) stats.partial = true;
      break;
    } // trailing padding, or a block we cannot walk past
    const key = r.ascii(4);
    const len = r.u32();
    const end = r.p + len;
    if (end > bytes.length) throw new Error("Brush file is truncated");
    if (key === "desc") {
      r.descVersion();
      collectBrushes(readDesc(r), out, "", 0);
    }
    r.seek(end);
  }
  if (!out.length) throw new Error("No procedural brushes in this .abr (sampled tips are not imported yet)");
  return out;
}
