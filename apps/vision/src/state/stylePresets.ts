// ─────────────────────────────────────────────────────────────
// Layer-style presets — pure helpers for the Styles panel (Photoshop's Window ▸
// Styles). A preset captures a layer's full advanced-blending state: its effect
// instances (the engine allows up to FX_MAX_INSTANCES of each type — stacked
// strokes, layered shadows), the blend-if band, and the fill opacity — the same
// shape the Copy/Paste Layer Style clipboard uses. Engine-free so it unit-tests
// in node; the Store snapshots the active layer into one and re-applies it via
// the existing set_layer_effect_at / set_layer_blend_if / set_layer_fill_opacity
// ops.
// ─────────────────────────────────────────────────────────────
import { FX, FX_DEFS, FX_MAX_INSTANCES, blendIfIsDefault, defaultBlendIf } from "./effects";
import { BLEND_ORDER, blendIndex } from "./engineContracts";

/** localStorage key for the Styles library (the Store persists/loads it here). */
export const STYLE_PRESETS_KEY = "mv.stylePresets";

/** One effect instance: an explicit fx id (not a fixed array slot) plus its
 *  param vector — the engine addresses instances the same way, through
 *  `set_layer_effect_at` / `layer_effect_params_at`. Multiple entries may share
 *  `fx` (a stacked stroke, layered shadows), in render order (bottom→top). */
export interface StyleEffect { fx: number; params: number[] }

/** The full layer-style state (mirrors the Store's private `styleClip`). */
export interface StyleData {
  effects: StyleEffect[];
  blendIf: number[];
  fillOpacity: number; // 0..100
}

export interface StylePreset {
  name: string;
  style: StyleData;
}

/** The default (enabled) param vector for an effect id — the same vector the
 *  Blending Options dialog uses, so a built-in style renders identically. */
const fxDefault = (id: number): number[] => FX_DEFS.find((d) => d.id === id)!.def;

/** Build a StyleData from a map of effect-id → param vector (one instance per
 *  id); blend-if is the neutral default, fill opacity is full. */
function styleWith(slots: Record<number, number[]>): StyleData {
  const effects = Object.entries(slots).map(([fx, params]) => ({ fx: Number(fx), params: [...params] }));
  return { effects, blendIf: defaultBlendIf(), fillOpacity: 100 };
}

/** Effect ids the engine actually understands (see FX in effects.ts) — anything
 *  else is untrusted data (corrupt storage, a hostile project/.asl file) that
 *  must never reach set_layer_effect_at. */
const VALID_FX_IDS = new Set(FX_DEFS.map((d) => d.id));
const isNumArray = (a: unknown): a is number[] => Array.isArray(a) && a.every((n) => typeof n === "number" && Number.isFinite(n));

/** Filter untrusted effect-instance data down to what's safe to hand the
 *  engine: a real fx id, a non-empty finite-number params array (an engine
 *  instance is never stored with empty params — that's how one is removed),
 *  and at most FX_MAX_INSTANCES per fx id (extras beyond the cap are dropped,
 *  keeping render order — set_layer_effect_at enforces the same cap, so
 *  untrusted data must never carry more into it). */
export function sanitizeStyleEffects(value: unknown, maxParams = 256): StyleEffect[] {
  if (!Array.isArray(value)) return [];
  const counts = new Map<number, number>();
  const out: StyleEffect[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { fx, params } = item as Record<string, unknown>;
    if (typeof fx !== "number" || !VALID_FX_IDS.has(fx)) continue;
    if (!isNumArray(params) || params.length === 0 || params.length > maxParams) continue;
    const n = counts.get(fx) ?? 0;
    if (n >= FX_MAX_INSTANCES) continue;
    counts.set(fx, n + 1);
    out.push({ fx, params: [...params] });
  }
  return out;
}

/** Built-in starter styles, mirroring Photoshop's default Styles library. Each
 *  is composed from the engine's own effect defaults, so they apply cleanly. */
export const DEFAULT_STYLE_PRESETS: StylePreset[] = [
  { name: "Drop Shadow", style: styleWith({ [FX.DROP_SHADOW]: fxDefault(FX.DROP_SHADOW) }) },
  { name: "Outer Glow", style: styleWith({ [FX.OUTER_GLOW]: fxDefault(FX.OUTER_GLOW) }) },
  { name: "Stroke", style: styleWith({ [FX.STROKE]: fxDefault(FX.STROKE) }) },
  { name: "Bevel & Emboss", style: styleWith({ [FX.BEVEL]: fxDefault(FX.BEVEL) }) },
  { name: "Button", style: styleWith({ [FX.COLOR_OVERLAY]: fxDefault(FX.COLOR_OVERLAY), [FX.BEVEL]: fxDefault(FX.BEVEL), [FX.DROP_SHADOW]: fxDefault(FX.DROP_SHADOW) }) },
];

/** The next "Style N" auto-name, one past the highest existing "Style <int>". */
export function defaultStylePresetName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Style (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Style ${max + 1}`;
}

/** Append a preset; a preset whose name is already present is a same-ref no-op. */
export function addStylePresetTo(list: StylePreset[], preset: StylePreset): StylePreset[] {
  if (list.some((p) => p.name === preset.name)) return list;
  return [...list, preset];
}

/** `base`, or the first free "base 2", "base 3"… — imported libraries routinely
 *  collide with names already in the panel, and dropping them loses the style. */
export function uniqueStylePresetName(names: string[], base: string): string {
  if (!names.includes(base)) return base;
  for (let n = 2; ; n++) if (!names.includes(`${base} ${n}`)) return `${base} ${n}`;
}

/** Append an imported library, renaming collisions instead of discarding them. */
export function mergeStylePresets(list: StylePreset[], imported: StylePreset[]): StylePreset[] {
  const out = [...list];
  for (const p of imported) out.push({ ...p, name: uniqueStylePresetName(out.map((q) => q.name), p.name) });
  return out;
}

/** Remove the preset at index `i`; out-of-range is a same-ref no-op. */
export function removeStylePresetAt(list: StylePreset[], i: number): StylePreset[] {
  if (i < 0 || i >= list.length) return list;
  return list.filter((_, j) => j !== i);
}

/** Parse a persisted style library (localStorage JSON) → the list (possibly
 *  empty), or null when the payload is missing/malformed. Validates each
 *  preset's name + style shape so a corrupt store can't break boot. */
export function parseStylePresets(json: string | null): StylePreset[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    // An empty array is a legitimately empty library, not a corrupt payload
    // (#146) — rejecting it made "delete every preset" resurrect the built-ins
    // on the next launch, since the loader only applies a non-null parse.
    if (!Array.isArray(v)) return null;
    const okStyle = (s: unknown): boolean => {
      if (!s || typeof s !== "object") return false;
      const st = s as Record<string, unknown>;
      if (!Array.isArray(st.effects)) return false;
      // Any entry sanitizeStyleEffects had to drop (bad fx id, non-numeric or
      // over-cap params) means the payload is corrupt — reject the whole thing
      // rather than silently loading a truncated style.
      if (sanitizeStyleEffects(st.effects).length !== st.effects.length) return false;
      // Reuse the finite-number predicate and pin the blend-if length (#143):
      // `typeof n === "number"` let ±Infinity (`1e999`) through, and a 32-entry
      // ±Infinity blend-if makes `blend_if_factor` return 0 (the layer
      // composites invisibly), while any non-32 length hard-fails PSD export.
      if (!isNumArray(st.blendIf) || (st.blendIf.length !== 0 && st.blendIf.length !== 32)) return false;
      return Number.isFinite(st.fillOpacity);
    };
    if (!v.every((p) => p && typeof p.name === "string" && okStyle(p.style))) return null;
    return v as StylePreset[];
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
// Adobe .asl (Photoshop Styles) interop — the format the Styles panel's
// Import/Export use, so a Vision library opens in Photoshop and vice versa.
//
// Layout (big-endian): u16 version(2) · "8BSL" · u16 patterns sub-version(3) ·
// u32 patterns-byte-count + patterns · u32 style count · per style two
// descriptors, each prefixed by u32 16 — the first carries `Nm  `/`Idnt`, the
// second the layer effects under `Lefx` (the same descriptor PSD stores in
// `lfx2`). Descriptors are the standard Adobe action-descriptor tree.
//   https://tonton-pixel.codeberg.page/photoshop-file-formats/styles-file-format.html
// ─────────────────────────────────────────────────────────────

export const MAX_ASL_IMPORT_BYTES = 4 * 1024 * 1024; // libraries are KBs; cap the untrusted read
const MAX_ASL_STYLES = 512;
const MAX_DESC_ITEMS = 4096;
const MAX_DESC_DEPTH = 24;

/** Photoshop blend-mode key → the engine's kebab name (BLEND_ORDER index). */
const PS_BLEND: Record<string, string> = {
  Nrml: "normal", Dslv: "dissolve", Drkn: "darken", Mltp: "multiply", CBrn: "color-burn",
  linearBurn: "linear-burn", darkerColor: "darker-color", Lghn: "lighten", Scrn: "screen",
  CDdg: "color-dodge", linearDodge: "linear-dodge", lighterColor: "lighter-color",
  Ovrl: "overlay", SftL: "soft-light", HrdL: "hard-light", vividLight: "vivid-light",
  linearLight: "linear-light", pinLight: "pin-light", hardMix: "hard-mix",
  Dfrn: "difference", Xclu: "exclusion", blendSubtraction: "subtract", blendDivide: "divide",
  "H   ": "hue", Strt: "saturation", "Clr ": "color", Lmns: "luminosity",
};
const BLEND_PS: Record<string, string> = Object.fromEntries(Object.entries(PS_BLEND).map(([k, v]) => [v, k]));

// A decoded descriptor value. Only the OSTypes layer effects actually use are
// modelled; anything else decodes to `raw` (skipped, but still consumed).
type Val =
  | { t: "num"; v: number }
  | { t: "int"; v: number }
  | { t: "unit"; u: string; v: number }
  | { t: "bool"; v: boolean }
  | { t: "text"; v: string }
  | { t: "enum"; v: string }
  | { t: "ref"; v: string }
  | { t: "desc"; v: Desc; c?: string }
  | { t: "list"; v: Val[] }
  | { t: "raw" };
type Desc = Record<string, Val>;

/** Big-endian cursor over the .asl bytes; every read is bounds-checked so a
 *  truncated or hostile file throws instead of reading past the buffer. */
class AslReader {
  p = 0;
  private view: DataView;
  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  private need(n: number) {
    if (n < 0 || this.p + n > this.buf.length) throw new Error("Style file is truncated");
  }
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
}

/** One item of an Adobe `obj ` reference. Blend ranges identify their channel
 *  with an `Enmr` reference; the other forms are consumed so unrelated standard
 *  style fields cannot desynchronise the descriptor cursor. */
function readRef(r: AslReader): string | null {
  const form = r.ascii(4);
  switch (form) {
    case "prop": r.ustr(); r.key(); r.key(); return null;
    case "Clss": r.ustr(); r.key(); return null;
    case "Enmr": {
      r.ustr();
      const desired = r.key(), type = r.key(), value = r.key();
      return desired === "Chnl" && type === "Chnl" ? value : null;
    }
    case "rele": r.ustr(); r.key(); r.i32(); return null;
    case "Idnt": case "indx": r.ustr(); r.key(); r.u32(); return null;
    case "name": r.ustr(); r.key(); r.ustr(); return null;
    default: throw new Error(`Unsupported style reference (${form})`);
  }
}

function readVal(r: AslReader, depth: number): Val {
  const os = r.ascii(4);
  switch (os) {
    case "Objc": case "GlbO": return { t: "desc", v: readDesc(r, depth) };
    case "VlLs": {
      const n = r.u32();
      if (n > MAX_DESC_ITEMS) throw new Error("Style file list is too long");
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
    case "obj ": {
      const n = r.u32();
      if (n > MAX_DESC_ITEMS) throw new Error("Style reference is too long");
      let value: string | null = null;
      for (let i = 0; i < n; i++) value = readRef(r) ?? value;
      return value ? { t: "ref", v: value } : { t: "raw" };
    }
    case "tdta": case "alis": { r.skip(r.u32()); return { t: "raw" }; }
    case "type": case "GlbC": { r.ustr(); r.key(); return { t: "raw" }; }
    case "UnFl": { r.ascii(4); r.skip(r.u32() * 8); return { t: "raw" }; }
    default: throw new Error(`Unsupported style data (${os})`);
  }
}

function readDesc(r: AslReader, depth = 0): Desc {
  if (depth > MAX_DESC_DEPTH) throw new Error("Style file nests too deeply");
  r.ustr(); // class display name (usually empty)
  r.key(); // classID
  const n = r.u32();
  if (n > MAX_DESC_ITEMS) throw new Error("Style descriptor is too large");
  const out: Desc = {};
  for (let i = 0; i < n; i++) out[r.key()] = readVal(r, depth + 1);
  return out;
}

// ── Lefx ↔ engine effect params ───────────────────────────────
// One row per engine field: `n` scales the Photoshop number into the engine's
// unit (0.01 for a percentage), `blend`/`color`/`flag`/`opts` pick the decoder.
// `u` is the unit tag written back out.
type Fld =
  | { k: string; i: number; n: number; u: "#Prc" | "#Pxl" | "#Ang" }
  | { k: string; i: number; blend: true }
  | { k: string; i: number; color: true }
  | { k: string; i: number; flag: true }
  | { k: string; i: number; opts: string[] };

const SHADOW_FIELDS: Fld[] = [
  { k: "Md  ", i: 1, blend: true }, { k: "Opct", i: 2, n: 0.01, u: "#Prc" }, { k: "Clr ", i: 3, color: true },
  { k: "lagl", i: 6, n: 1, u: "#Ang" }, { k: "Dstn", i: 7, n: 1, u: "#Pxl" },
  { k: "Ckmt", i: 8, n: 0.01, u: "#Prc" }, { k: "blur", i: 9, n: 1, u: "#Pxl" },
];
const GLOW_FIELDS: Fld[] = [
  { k: "Md  ", i: 1, blend: true }, { k: "Opct", i: 2, n: 0.01, u: "#Prc" }, { k: "Clr ", i: 3, color: true },
  { k: "Ckmt", i: 6, n: 0.01, u: "#Prc" }, { k: "blur", i: 7, n: 1, u: "#Pxl" },
];

/** The effects Vision renders, keyed by every Lefx name Photoshop writes for
 *  them (CC's multi-effect lists reuse the `…Multi` keys). */
const ASL_FX: { keys: string[]; fx: number; fields: Fld[] }[] = [
  { keys: ["DrSh", "dropShadowMulti"], fx: FX.DROP_SHADOW, fields: SHADOW_FIELDS },
  { keys: ["IrSh", "innerShadowMulti"], fx: FX.INNER_SHADOW, fields: SHADOW_FIELDS },
  { keys: ["OrGl"], fx: FX.OUTER_GLOW, fields: GLOW_FIELDS },
  {
    keys: ["IrGl"], fx: FX.INNER_GLOW,
    fields: [...GLOW_FIELDS, { k: "glwS", i: 8, opts: ["SrcE", "SrcC"] }],
  },
  {
    keys: ["ebbl"], fx: FX.BEVEL,
    fields: [
      { k: "hglM", i: 1, blend: true }, { k: "hglO", i: 2, n: 0.01, u: "#Prc" }, { k: "hglC", i: 3, color: true },
      { k: "sdwM", i: 6, blend: true }, { k: "sdwO", i: 7, n: 0.01, u: "#Prc" }, { k: "sdwC", i: 8, color: true },
      { k: "lagl", i: 11, n: 1, u: "#Ang" }, { k: "Lald", i: 12, n: 1, u: "#Ang" },
      { k: "srgR", i: 13, n: 0.01, u: "#Prc" }, { k: "blur", i: 14, n: 1, u: "#Pxl" },
      { k: "Sftn", i: 15, n: 1, u: "#Pxl" },
      { k: "bvlS", i: 16, opts: ["InrB", "OtrB", "Embs", "PlEb", "strokeEmboss"] },
      { k: "bvlT", i: 17, opts: ["SfBL", "PrBL", "Slmt"] },
      { k: "bvlD", i: 18, opts: ["In  ", "Out "] },
    ],
  },
  {
    keys: ["ChFX"], fx: FX.SATIN,
    fields: [
      { k: "Md  ", i: 1, blend: true }, { k: "Opct", i: 2, n: 0.01, u: "#Prc" }, { k: "Clr ", i: 3, color: true },
      { k: "lagl", i: 6, n: 1, u: "#Ang" }, { k: "Dstn", i: 7, n: 1, u: "#Pxl" },
      { k: "blur", i: 8, n: 1, u: "#Pxl" }, { k: "Invr", i: 9, flag: true },
    ],
  },
  {
    keys: ["SoFi", "solidFillMulti"], fx: FX.COLOR_OVERLAY,
    fields: [{ k: "Md  ", i: 1, blend: true }, { k: "Opct", i: 2, n: 0.01, u: "#Prc" }, { k: "Clr ", i: 3, color: true }],
  },
  {
    keys: ["GrFl", "gradientFillMulti"], fx: FX.GRADIENT_OVERLAY,
    fields: [
      { k: "Md  ", i: 1, blend: true }, { k: "Opct", i: 2, n: 0.01, u: "#Prc" },
      { k: "Angl", i: 3, n: 1, u: "#Ang" }, { k: "Scl ", i: 4, n: 0.01, u: "#Prc" },
      // All five engine kinds (#142) — the two-entry list silently exported
      // Angle/Reflected/Diamond overlays as Linear.
      { k: "Type", i: 5, opts: ["Lnr ", "Rdl ", "Angl", "Rflc", "Dmnd"] }, { k: "Rvrs", i: 6, flag: true },
    ],
  },
  {
    keys: ["patternFill", "PtFl", "patternFillMulti"], fx: FX.PATTERN_OVERLAY,
    // Photoshop's pattern scale is a percentage of an arbitrary tile; Vision's
    // is a pixel period, so 100% maps to the engine default of 16px.
    fields: [
      { k: "Md  ", i: 1, blend: true }, { k: "Opct", i: 2, n: 0.01, u: "#Prc" },
      { k: "Scl ", i: 3, n: 0.16, u: "#Prc" },
    ],
  },
  {
    keys: ["FrFX", "frameFXMulti"], fx: FX.STROKE,
    fields: [
      { k: "Md  ", i: 1, blend: true }, { k: "Opct", i: 2, n: 0.01, u: "#Prc" }, { k: "Clr ", i: 3, color: true },
      { k: "Sz  ", i: 6, n: 1, u: "#Pxl" }, { k: "Style", i: 7, opts: ["OutF", "InsF", "CtrF"] },
      { k: "PntT", i: 8, opts: ["SClr", "GrFl", "Ptrn"] },
    ],
  },
];

const numOf = (v: Val | undefined): number | null => (v?.t === "num" || v?.t === "int" || v?.t === "unit" ? v.v : null);
/** An `Objc`, or the first descriptor of a `VlLs` (Photoshop CC's multi-effect lists). */
function descOf(v: Val | undefined): Desc | null {
  if (v?.t === "desc") return v.v;
  if (v?.t === "list" && v.v[0]?.t === "desc") return v.v[0].v;
  return null;
}
/** An `Objc` as a one-element list, or every descriptor of a `VlLs` — Photoshop
 *  CC writes a stacked stroke/shadow/fill as a `…Multi` list, one descriptor per
 *  instance, in the same bottom→top order the engine stores them in. */
function descsOf(v: Val | undefined): Desc[] {
  if (v?.t === "desc") return [v.v];
  if (v?.t === "list") return v.v.filter((x): x is Val & { t: "desc" } => x.t === "desc").map((x) => x.v);
  return [];
}
/** `RGBC` descriptor (components 0..255) → the engine's 0..1 triple. */
function rgbOf(v: Val | undefined): [number, number, number] | null {
  const d = descOf(v);
  if (!d) return null;
  const c = [numOf(d["Rd  "]), numOf(d["Grn "]), numOf(d["Bl  "])];
  if (c.some((x) => x === null)) return null;
  return c.map((x) => Math.min(1, Math.max(0, x! / 255))) as [number, number, number];
}

/** One Lefx sub-descriptor → the engine's flat param vector for `fx`. Unmapped
 *  slots keep the engine default, so a partially-understood effect still renders.
 *  ponytail: contour curves and real pattern tiles are dropped (Vision has no
 *  contour/pattern library yet) — map them here once those exist. */
function effectFromDesc(fx: number, fields: Fld[], d: Desc): number[] {
  const p = [...fxDefault(fx)];
  p[0] = d.enab?.t === "bool" ? (d.enab.v ? 1 : 0) : 1;
  for (const f of fields) {
    const v = d[f.k];
    if (!v) continue;
    if ("n" in f) { const x = numOf(v); if (x !== null) p[f.i] = x * f.n; }
    else if ("blend" in f) { if (v.t === "enum") p[f.i] = blendIndex(PS_BLEND[v.v] ?? "normal"); }
    else if ("color" in f) { const c = rgbOf(v); if (c) [p[f.i], p[f.i + 1], p[f.i + 2]] = c; }
    else if ("flag" in f) { if (v.t === "bool") p[f.i] = v.v ? 1 : 0; }
    else if (v.t === "enum") { const j = f.opts.indexOf(v.v); if (j >= 0) p[f.i] = j; }
  }
  if (fx === FX.GRADIENT_OVERLAY) {
    const stops = descOf(d.Grad)?.Clrs;
    if (stops?.t === "list" && stops.v.length) {
      const first = rgbOf(descOf(stops.v[0])?.["Clr "]);
      const last = rgbOf(descOf(stops.v[stops.v.length - 1])?.["Clr "]);
      if (first) [p[7], p[8], p[9]] = first;
      if (last) [p[10], p[11], p[12]] = last;
    }
  }
  return p;
}

function styleFromDesc(style: Desc): StyleData {
  const lefx = descOf(style.Lefx) ?? {};
  const effects: StyleEffect[] = [];
  for (const e of ASL_FX) {
    // First key actually present wins (legacy singular vs. CC's …Multi list);
    // descsOf turns either shape into one descriptor per stacked instance.
    const key = e.keys.find((k) => lefx[k]);
    if (!key) continue;
    for (const d of descsOf(lefx[key]).slice(0, FX_MAX_INSTANCES)) {
      effects.push({ fx: e.fx, params: effectFromDesc(e.fx, e.fields, d) });
    }
  }
  const blendOptions = descOf(style.blendOptions);
  const blendIf = defaultBlendIf();
  const ranges = blendOptions?.Blnd;
  if (ranges?.t === "list") {
    const channels = ["Gry ", "Rd  ", "Grn ", "Bl  "];
    const keys = ["SrcB", "Srcl", "SrcW", "Srcm", "DstB", "Dstl", "DstW", "Dstt"];
    for (const range of ranges.v) {
      const d = descOf(range);
      const channel = d?.Chnl;
      const index = channel?.t === "ref" ? channels.indexOf(channel.v) : -1;
      if (!d || index < 0) continue;
      keys.forEach((key, i) => {
        const value = numOf(d[key]);
        if (value !== null) blendIf[index * 8 + i] = Math.min(255, Math.max(0, value)) / 255;
      });
    }
  }
  const fill = numOf(blendOptions?.fillOpacity ?? style.fillOpacity);
  return { effects, blendIf, fillOpacity: fill === null ? 100 : Math.min(100, Math.max(0, fill)) };
}

/** Parse an Adobe .asl library. Throws on a non-.asl or unreadable header;
 *  a style that trips on data we can't decode ends the scan but keeps the ones
 *  already read, since a partial library still beats none. */
export function parseAsl(bytes: Uint8Array, stats?: { dropped: number }): StylePreset[] {
  if (bytes.length > MAX_ASL_IMPORT_BYTES) throw new Error("Style file is too large");
  const r = new AslReader(bytes);
  r.u16(); // styles-file version (2)
  if (r.ascii(4) !== "8BSL") throw new Error("Not an Adobe .asl style file");
  r.u16(); // patterns sub-version (3)
  r.skip(r.u32()); // embedded pattern tiles — Vision has no pattern library yet
  const declared = r.u32();
  const count = Math.min(declared, MAX_ASL_STYLES);
  if (stats) stats.dropped += declared - count;
  const out: StylePreset[] = [];
  try {
    for (let i = 0; i < count; i++) {
      r.u32(); // descriptor version (16)
      const ident = readDesc(r);
      r.u32();
      const style = readDesc(r);
      const nm = ident["Nm  "];
      out.push({ name: (nm?.t === "text" && nm.v.trim()) || `Style ${out.length + 1}`, style: styleFromDesc(style) });
    }
  } catch (e) {
    if (!out.length) throw e;
    if (stats) stats.dropped += count - out.length;
  }
  return out;
}

// ── writer ────────────────────────────────────────────────────

/** Growable big-endian byte sink. ponytail: a plain array — style libraries are
 *  kilobytes; swap for a chunked buffer only if that stops being true. */
class AslWriter {
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

const enumVal = (v: string): Val => ({ t: "enum", v });
const unitVal = (u: string, v: number): Val => ({ t: "unit", u, v });
const descVal = (v: Desc, c?: string): Val => ({ t: "desc", v, ...(c ? { c } : {}) });
const rgbVal = (p: number[], i: number): Val =>
  descVal({ "Rd  ": { t: "num", v: p[i] * 255 }, "Grn ": { t: "num", v: p[i + 1] * 255 }, "Bl  ": { t: "num", v: p[i + 2] * 255 } });

function writeVal(w: AslWriter, v: Val, cls = "null") {
  switch (v.t) {
    case "num": w.ascii("doub"); w.f64(v.v); break;
    case "int": w.ascii("long"); w.u32(v.v >>> 0); break;
    case "unit": w.ascii("UntF"); w.ascii(v.u); w.f64(v.v); break;
    case "bool": w.ascii("bool"); w.u8(v.v ? 1 : 0); break;
    case "text": w.ascii("TEXT"); w.ustr(v.v); break;
    case "enum": w.ascii("enum"); w.key(enumType(v.v)); w.key(v.v); break;
    case "ref":
      w.ascii("obj "); w.u32(1); w.ascii("Enmr"); w.ustr("");
      w.key("Chnl"); w.key("Chnl"); w.key(v.v);
      break;
    case "list": w.ascii("VlLs"); w.u32(v.v.length); for (const x of v.v) writeVal(w, x); break;
    case "desc": w.ascii("Objc"); writeDesc(w, v.c ?? cls, v.v); break;
    default: w.ascii("bool"); w.u8(0); break; // never produced by the writer
  }
}

/** The typeID an enum value belongs to — Photoshop keys enums by both. */
function enumType(v: string): string {
  if (v in BLEND_PS || v in PS_BLEND) return "BlnM";
  if (v === "SrcE" || v === "SrcC") return "IGSr";
  if (v === "InrB" || v === "OtrB" || v === "Embs" || v === "PlEb" || v === "strokeEmboss") return "BESl";
  if (v === "SfBL" || v === "PrBL" || v === "Slmt") return "bvlT";
  if (v === "In  " || v === "Out ") return "BESs";
  // Every gradient kind, not just the two Vision used to write (#142) — an
  // unlisted value would be typed "FStl" and Photoshop would misread it.
  if (v === "Lnr " || v === "Rdl " || v === "Angl" || v === "Rflc" || v === "Dmnd") return "GrdT";
  if (v === "SClr" || v === "GrFl" || v === "Ptrn") return "FrFl"; // stroke fill type
  return "FStl"; // stroke position (OutF/InsF/CtrF)
}

function writeDesc(w: AslWriter, cls: string, d: Desc) {
  const items = Object.entries(d);
  w.ustr("");
  w.key(cls);
  w.u32(items.length);
  for (const [k, v] of items) { w.key(k); writeVal(w, v, k === "Clr " || k === "hglC" || k === "sdwC" ? "RGBC" : "null"); }
}

function effectToDesc(fx: number, fields: Fld[], p: number[]): Desc {
  const d: Desc = { enab: { t: "bool", v: p[0] === 1 }, present: { t: "bool", v: true }, showInDialog: { t: "bool", v: true } };
  for (const f of fields) {
    if ("n" in f) d[f.k] = unitVal(f.u, p[f.i] / f.n);
    else if ("blend" in f) d[f.k] = enumVal(BLEND_PS[BLEND_ORDER[Math.round(p[f.i])] ?? "normal"] ?? "Nrml");
    else if ("color" in f) d[f.k] = rgbVal(p, f.i);
    else if ("flag" in f) d[f.k] = { t: "bool", v: p[f.i] === 1 };
    else d[f.k] = enumVal(f.opts[Math.round(p[f.i])] ?? f.opts[0]);
  }
  if (fx === FX.GRADIENT_OVERLAY) {
    const stop = (i: number, loc: number): Val => descVal({ "Clr ": rgbVal(p, i), Type: enumVal("UsrS"), Lctn: { t: "num", v: loc }, Mdpn: { t: "num", v: 50 } });
    d.Grad = descVal({ GrdF: enumVal("CstS"), Intr: { t: "num", v: 4096 }, Clrs: { t: "list", v: [stop(7, 0), stop(10, 4096)] } });
  }
  return d;
}

/** Serialise the Styles library as an Adobe .asl file. Pattern tiles and the
 *  document-mode hint stay omitted; effects and advanced blending use Adobe's
 *  native descriptors. */
export function buildAsl(presets: StylePreset[]): Uint8Array {
  const w = new AslWriter();
  w.u16(2);
  w.ascii("8BSL");
  w.u16(3);
  w.u32(0); // no embedded patterns
  w.u32(presets.length);
  presets.forEach((preset, i) => {
    w.u32(16);
    writeDesc(w, "null", {
      "Nm  ": { t: "text", v: preset.name },
      Idnt: { t: "text", v: globalThis.crypto?.randomUUID?.() ?? `monet-style-${i}` },
    });
    const lefx: Desc = { "Scl ": unitVal("#Prc", 100), masterFXSwitch: { t: "bool", v: true } };
    for (const e of ASL_FX) {
      const instances = preset.style.effects.filter((x) => x.fx === e.fx).slice(0, FX_MAX_INSTANCES);
      if (!instances.length) continue;
      // A single instance writes under the legacy singular key (Photoshop pre-CC
      // compatible); a stack writes as a `…Multi` list, one descriptor per
      // instance — the same shape descsOf reads back.
      if (instances.length === 1) {
        lefx[e.keys[0]] = descVal(effectToDesc(e.fx, e.fields, instances[0].params));
      } else {
        const multiKey = e.keys.find((k) => k.endsWith("Multi")) ?? e.keys[0];
        lefx[multiKey] = { t: "list", v: instances.map((x) => descVal(effectToDesc(e.fx, e.fields, x.params))) };
      }
    }
    const style: Desc = { Lefx: descVal(lefx), fillOpacity: unitVal("#Prc", preset.style.fillOpacity) };
    if (preset.style.blendIf.length === 32 && !blendIfIsDefault(preset.style.blendIf)) {
      const channels = ["Gry ", "Rd  ", "Grn ", "Bl  "];
      const keys = ["SrcB", "Srcl", "SrcW", "Srcm", "DstB", "Dstl", "DstW", "Dstt"];
      const ranges = channels.map((channel, channelIndex) => {
        const range: Desc = { Chnl: { t: "ref", v: channel } };
        keys.forEach((key, i) => {
          range[key] = { t: "int", v: Math.round(Math.min(1, Math.max(0, preset.style.blendIf[channelIndex * 8 + i])) * 255) };
        });
        return descVal(range, "Blnd");
      });
      style.blendOptions = descVal({
        fillOpacity: unitVal("#Prc", preset.style.fillOpacity),
        Blnd: { t: "list", v: ranges },
      }, "blendOptions");
    }
    w.u32(16);
    writeDesc(w, "null", style);
  });
  return w.bytes();
}

// ── panel thumbnails ──────────────────────────────────────────

/** A CSS approximation of the effect stack, drawn on the panel's swatch button.
 *  ponytail: CSS gradients + box-shadows, not an engine render — it reads the
 *  same params the compositor does and costs no engine round trip. Swap for an
 *  offscreen `render_style_swatch` once the engine can rasterise a stack without
 *  a live layer. Contours, satin and pattern tiles have no CSS analogue. */
export interface StylePreview { background: string; boxShadow: string }

const SWATCH_BG = "linear-gradient(135deg, var(--bg-2), var(--bg-1))";
const PREVIEW_SCALE = 0.35; // the swatch is ~48px; Photoshop sizes target full-size art

// Offsets are signed (a shadow falls left as readily as right); only the
// magnitude is clamped, so the swatch can't grow a 100px halo.
const previewPx = (v: number) => `${Math.min(24, Math.max(-24, v * PREVIEW_SCALE)).toFixed(1)}px`;
const previewRgba = (p: number[], i: number, a: number) =>
  `rgba(${Math.round(p[i] * 255)}, ${Math.round(p[i + 1] * 255)}, ${Math.round(p[i + 2] * 255)}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const fxOn = (p: number[] | undefined): p is number[] => !!p && p.length > 0 && p[0] === 1;
/** Photoshop's angle is the light direction, so the shadow falls the other way. */
const offset = (angle: number, distance: number): [number, number] => {
  const rad = (angle * Math.PI) / 180;
  return [-Math.cos(rad) * distance, Math.sin(rad) * distance];
};

export function stylePreviewCss(style: StyleData): StylePreview {
  // The swatch approximates the stack, not a full render — one (the first)
  // instance per effect type is enough to read as "this style has a stroke".
  const at = (id: number): number[] | undefined => style.effects?.find((e) => e.fx === id)?.params;
  const grad = at(FX.GRADIENT_OVERLAY), fill = at(FX.COLOR_OVERLAY);
  let background = SWATCH_BG;
  if (fxOn(grad)) {
    const [a, b] = grad[6] === 1 ? [previewRgba(grad, 10, 1), previewRgba(grad, 7, 1)] : [previewRgba(grad, 7, 1), previewRgba(grad, 10, 1)];
    background = grad[5] === 1 ? `radial-gradient(circle, ${a}, ${b})` : `linear-gradient(${(90 - grad[3]).toFixed(0)}deg, ${a}, ${b})`;
  } else if (fxOn(fill)) {
    background = previewRgba(fill, 3, fill[2]);
  }

  const parts: string[] = [];
  const stroke = at(FX.STROKE);
  if (fxOn(stroke)) {
    const ring = `0 0 0 ${previewPx(stroke[6])} ${previewRgba(stroke, 3, stroke[2])}`;
    parts.push(stroke[7] === 0 ? ring : `inset ${ring}`);
  }
  const innerGlow = at(FX.INNER_GLOW);
  if (fxOn(innerGlow)) parts.push(`inset 0 0 ${previewPx(innerGlow[7])} ${previewRgba(innerGlow, 3, innerGlow[2])}`);
  const innerShadow = at(FX.INNER_SHADOW);
  if (fxOn(innerShadow)) {
    const [dx, dy] = offset(innerShadow[6], innerShadow[7]);
    parts.push(`inset ${previewPx(dx)} ${previewPx(dy)} ${previewPx(innerShadow[9])} ${previewRgba(innerShadow, 3, innerShadow[2])}`);
  }
  const bevel = at(FX.BEVEL);
  if (fxOn(bevel)) {
    const [dx, dy] = offset(bevel[11], bevel[14]);
    parts.push(`inset ${previewPx(dx)} ${previewPx(dy)} ${previewPx(bevel[14])} ${previewRgba(bevel, 3, bevel[2])}`);
    parts.push(`inset ${previewPx(-dx)} ${previewPx(-dy)} ${previewPx(bevel[14])} ${previewRgba(bevel, 8, bevel[7])}`);
  }
  const outerGlow = at(FX.OUTER_GLOW);
  if (fxOn(outerGlow)) parts.push(`0 0 ${previewPx(outerGlow[7])} ${previewPx(outerGlow[6] * 20)} ${previewRgba(outerGlow, 3, outerGlow[2])}`);
  const dropShadow = at(FX.DROP_SHADOW);
  if (fxOn(dropShadow)) {
    const [dx, dy] = offset(dropShadow[6], dropShadow[7]);
    parts.push(`${previewPx(dx)} ${previewPx(dy)} ${previewPx(dropShadow[9])} ${previewPx(dropShadow[8] * 20)} ${previewRgba(dropShadow, 3, dropShadow[2])}`);
  }
  return { background, boxShadow: parts.join(", ") };
}
