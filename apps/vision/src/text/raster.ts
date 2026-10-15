// ─────────────────────────────────────────────────────────────
// Text rasterizer — turns a TextSpec into an RGBA bitmap using the
// browser's Canvas 2D text engine (real font metrics, shaping, kerning,
// fallback). Handles point & paragraph (wrapping) layout, per-run rich
// formatting, alignment/justify, hyphenation, Adobe-style justification
// (word/letter spacing + glyph scaling), single/every-line composition,
// Roman hanging punctuation, leading, indents, paragraph spacing,
// faux bold/italic, caps/small-caps, super/subscript, baseline shift,
// H/V scale, Unicode grapheme clusters, underline/strike, stroke + drop-shadow
// effects, the five anti-alias modes, vertical type, and finally the warp
// envelope.
//
// Returns the bitmap plus the document-space top-left at which the engine
// should place it (placeX/placeY), computed so the text block stays
// visually anchored even as effects/warp grow the bitmap.
// ─────────────────────────────────────────────────────────────

import {
  resolveStyle, cssFont, renderFontFamily, mergedFeatures, variationSettings, hyphenationOf, justificationOf,
  DEFAULT_HYPHENATION, DEFAULT_JUSTIFICATION,
  type TextSpec, type RGBA, type AntiAlias, type Kerning,
  type Hyphenation, type Justification, type LineComposer,
} from "./spec";
// The composition settings live on TextSpec (spec.ts) now; re-exported here so
// the layout module stays the single import for composition types + defaults.
export { hyphenationOf, justificationOf, DEFAULT_HYPHENATION, DEFAULT_JUSTIFICATION };
export type { Hyphenation, Justification, LineComposer };
import { warpBitmap, type Bitmap } from "./warp";

export interface RasterResult { w: number; h: number; data: Uint8ClampedArray; placeX: number; placeY: number; }

export interface Cell {
  glyph: string;
  baseGlyph: string;
  markGlyph: string;
  bidi: BidiDir;
  diacriticX: number;
  diacriticY: number;
  font: string;
  fontFamily?: string;
  fontWeight?: number;
  fontItalic?: boolean;
  drawSize: number;
  baseShift: number;
  advance: number;
  wRaw: number;
  ascent: number;
  descent: number;
  nominalSize: number;
  isSpace: boolean;
  isBreak: boolean;
  color: RGBA;
  underline: boolean;
  strike: boolean;
  kerning: Kerning;
  tracking: number;
  hScale: number;
  vScale: number;
  fauxBold: boolean;
  fauxItalic: boolean;
  features: string; // CSS font-feature-settings for this cell's run ("" = none)
  // CSS font-variation-settings for this cell's run ("" = none). Optional so
  // hand-built Cells (tests, callers) stay valid.
  variations?: string;
  // Character ▸ No Break. Optional so hand-built Cells (tests, callers) stay valid.
  noBreak?: boolean;
}

export interface Placement { cell: Cell; x: number; y: number; angle?: number; centerOffset?: number; }
export interface Layout { placements: Placement[]; blockW: number; blockH: number; }
type BidiDir = "ltr" | "rtl" | "neutral";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rgba = (c: RGBA) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(c[3] ?? 255) / 255})`;
const isRtl = (spec: TextSpec) => spec.direction === "rtl";

let _scratch: CanvasRenderingContext2D | null = null;
function scratchCtx(): CanvasRenderingContext2D {
  if (!_scratch) {
    const c = document.createElement("canvas");
    c.width = 8; c.height = 8;
    _scratch = c.getContext("2d")!;
  }
  return _scratch;
}

// ── OpenType feature settings (Gap 9) ──────────────────────────────
// Chromium applies CSS `font-feature-settings` to canvas measureText/fillText
// ONLY from the element's *computed* style, which requires the canvas to be in
// the document (the Gap-9 spike proved detached canvases never receive it — the
// path all Vision text canvases used before this). So when a run carries feature
// tags, mount the measurement/paint canvases on one shared hidden host and force
// a style recalc before drawing. Text with no active features keeps its canvas
// detached — byte-identical to the prior render path (zero regression).
let _featureHost: HTMLElement | null = null;
function featureHost(): HTMLElement | null {
  if (_featureHost) return _featureHost;
  if (typeof document === "undefined" || !document.body) return null;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  // Off-screen + hidden, but with the canvas laid out at its natural size so
  // Chromium resolves its computed font-feature-settings (the Gap-9 spike used
  // exactly this attached-hidden shape; no size/containment constraints).
  host.style.cssText = "position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;";
  document.body.appendChild(host);
  _featureHost = host;
  return host;
}

type FeatureCanvas = HTMLCanvasElement & { __mvFeat?: string };

/** A valid-but-never-real font, poked through the `ctx.font` setter whenever the
 *  element's feature settings change. WebKit ignores `ctx.font = s` when `s`
 *  equals the value already stored, so a context that once resolved this exact
 *  font string keeps the PREVIOUS computed `font-feature-settings`: features
 *  never turn on, and a featured cell leaks its tags onto every feature-free
 *  cell measured or painted after it. Changing the stored value first makes the
 *  caller's next (identical) assignment a real, re-resolving one. (#16) */
const FONT_FLUSH = "1px __mv_feature_flush";

/** Apply `font-feature-settings` + `font-variation-settings` to a canvas element
 *  so its 2D context honors them. Neither is part of the `ctx.font` shorthand,
 *  so both reach canvas text only through the element's *computed* style — the
 *  same attach-to-the-hidden-host + recalc dance serves either. No-op fast-path
 *  when both are unchanged, and never attaches (nor reflows) for text that asks
 *  for neither. Every caller assigns the real `ctx.font` immediately after. */
function applyCanvasFeatures(ctx: CanvasRenderingContext2D, css: string, variations = ""): void {
  const c = ctx.canvas as FeatureCanvas;
  const key = `${css} | ${variations}`;
  if (c.__mvFeat === key) return;
  c.__mvFeat = key;
  c.style.setProperty("font-feature-settings", css || "normal");
  c.style.setProperty("-webkit-font-feature-settings", css || "normal");
  c.style.setProperty("font-variation-settings", variations || "normal");
  if (css || variations) {
    const host = featureHost();
    if (host && c.parentNode !== host) host.appendChild(c);
    void c.offsetWidth; // force layout so the context reads the new computed value
    void getComputedStyle(c).getPropertyValue("font-feature-settings");
  }
  ctx.font = FONT_FLUSH; // (#16) force the next real assignment to re-resolve
}

/** Detach a per-render paint canvas from the shared host (if features mounted it). */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
}

// ── Type ▸ Glyphs: font repertoire + per-glyph alternates ──────────────────
// Photoshop reads the face's cmap (which codepoints exist) and its GSUB
// alternate lookups (which stylistic forms a glyph has). A webview can't open
// the font file, so probe the renderer instead: a codepoint is in the font when
// it paints something other than the notdef box, and a feature tag yields an
// alternate for a glyph when switching the tag on repaints that glyph
// differently. Both reuse the feature-canvas plumbing above.
//
// ponytail: this reports what the font *stack* draws — canvas never says which
// face served a glyph — and it can't see two alternates hiding behind one tag
// (`aalt` index selection). Read cmap + GSUB with ttf-parser in the engine if
// true per-face repertoire or numbered alternates are ever needed.
const PROBE_PX = 22;
const PROBE_W = 44;
const PROBE_H = 36;
/** A permanent Unicode noncharacter: no font has a glyph for it, so it always
 *  paints whatever this renderer uses for "missing" (a box, or nothing). */
const NOTDEF_CHAR = "\u{10FFFE}";

let _probe: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null | undefined;
function probeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (_probe !== undefined) return _probe;
  _probe = null;
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = PROBE_W; canvas.height = PROBE_H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) _probe = { canvas, ctx };
    } catch { /* no 2d context (headless/node) — callers degrade gracefully */ }
  }
  return _probe;
}

/** FNV-1a over the painted alpha — a cheap exact-enough signature of one glyph
 *  as this font renders it. `null` when there is no canvas to paint on. */
function paintSignature(family: string, ch: string, features: string): number | null {
  const p = probeCanvas();
  if (!p) return null;
  const { ctx } = p;
  applyCanvasFeatures(ctx, features);
  ctx.font = `${PROBE_PX}px ${family}`;
  setFontKerning(ctx, "none");
  ctx.clearRect(0, 0, PROBE_W, PROBE_H);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(ch, 4, PROBE_H - 8);
  let px: Uint8ClampedArray;
  try { px = ctx.getImageData(0, 0, PROBE_W, PROBE_H).data; } catch { return null; }
  let h = 0x811c9dc5;
  for (let i = 3; i < px.length; i += 4) { h = Math.imul(h ^ px[i], 0x01000193); }
  return h | 0;
}

const _sigCache = new Map<string, number | null>();
function signature(family: string, ch: string, features: string): number | null {
  const key = `${family}\u0000${features}\u0000${ch}`;
  const hit = _sigCache.get(key);
  if (hit !== undefined) return hit;
  const sig = paintSignature(family, ch, features);
  // ponytail: flush-all instead of LRU, same as the ink cache below.
  if (_sigCache.size > 8192) _sigCache.clear();
  _sigCache.set(key, sig);
  return sig;
}

/** The subset of `chars` this font actually draws — anything that renders the
 *  same as the notdef box (or paints nothing) is dropped. With no canvas
 *  (node unit env) every candidate is kept, so the panel still lists something. */
export function fontCoverage(family: string, chars: string[]): string[] {
  const notdef = signature(family, NOTDEF_CHAR, "");
  if (notdef === null) return chars;
  return chars.filter((ch) => signature(family, ch, "") !== notdef);
}

/** The OpenType feature tags that give `ch` a different form in this font — the
 *  alternates strip for one glyph, in the order the tags were passed. Empty
 *  with no canvas to probe. */
export function glyphAlternates(family: string, ch: string, tags: string[]): string[] {
  const base = signature(family, ch, "");
  if (base === null) return [];
  return tags.filter((tag) => signature(family, ch, `"${tag}" 1`) !== base);
}

function breakCell(size: number): Cell {
  return {
    glyph: "", baseGlyph: "", markGlyph: "", bidi: "neutral", diacriticX: 0, diacriticY: 0,
    font: "", drawSize: size, baseShift: 0, advance: 0, wRaw: 0,
    ascent: size * 0.8, descent: size * 0.2, nominalSize: size,
    isSpace: true, isBreak: true, color: [0, 0, 0, 0],
    underline: false, strike: false, kerning: "none", tracking: 0,
    hScale: 1, vScale: 1, fauxBold: false, fauxItalic: false, features: "",
  };
}

const RTL_STRONG = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
const LTR_STRONG = /[A-Za-z0-9\u00C0-\u024F]/u;

export function bidiClassForText(text: string): BidiDir {
  for (const ch of Array.from(text)) {
    if (RTL_STRONG.test(ch)) return "rtl";
    if (LTR_STRONG.test(ch)) return "ltr";
  }
  return "neutral";
}

function visualBidiOrder<T>(items: T[], dirOf: (item: T) => BidiDir, base: "ltr" | "rtl"): T[] {
  if (!items.some((item) => dirOf(item) === "rtl")) return items;
  const pieces: { dir: BidiDir; items: T[] }[] = [];
  for (const item of items) {
    const dir = dirOf(item);
    const prev = pieces[pieces.length - 1];
    if (prev && prev.dir === dir) prev.items.push(item);
    else pieces.push({ dir, items: [item] });
  }
  return (base === "rtl" ? pieces.slice().reverse() : pieces).flatMap((piece) =>
    piece.dir === "rtl" ? piece.items.slice().reverse() : piece.items);
}

function layoutBidiOrder<T>(items: T[], dirOf: (item: T) => BidiDir, base: "ltr" | "rtl"): T[] {
  const visual = visualBidiOrder(items, dirOf, base);
  return base === "rtl" ? visual.slice().reverse() : visual;
}

export function worldReadyVisualText(text: string, base: "ltr" | "rtl" = "ltr"): string {
  const chars = graphemeClusters(text);
  return visualBidiOrder(chars, bidiClassForText, base).join("");
}

// Type ▸ Language Options: ASCII digit → localized digit-glyph base codepoints.
const DIGIT_BASE: Record<string, number> = { arabic: 0x0660, hindi: 0x06f0 };
export function subDigit(ch: string, mode?: string): string {
  const base = mode && DIGIT_BASE[mode];
  if (!base || ch < "0" || ch > "9") return ch;
  return String.fromCodePoint(base + (ch.charCodeAt(0) - 48));
}

const KASHIDA = "\u0640";
const ARABIC_CONNECTING = /[\u0620-\u063A\u0641-\u064A]/u;
const ARABIC_DIACRITIC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/u;
const KASHIDA_COUNT: Record<string, number> = { none: 0, short: 1, medium: 2, long: 3, stylistic: 1 };

export function isArabicDiacritic(ch: string): boolean {
  return ARABIC_DIACRITIC.test(ch);
}

export function splitDiacritics(glyph: string): { base: string; marks: string } {
  let base = "", marks = "";
  for (const ch of Array.from(glyph)) {
    if (isArabicDiacritic(ch)) marks += ch;
    else base += ch;
  }
  return { base, marks };
}

// Type ▸ Language Options ▸ Kashidas. This is a deterministic baseline for
// Photoshop's Arabic tatweel insertion controls: insert elongation marks after
// connectable Arabic letters when another Arabic letter follows in the word.
export function applyKashidas(s: string, mode?: string): string {
  const count = KASHIDA_COUNT[mode ?? "none"] ?? 0;
  if (!count) return s;
  const chars = Array.from(s);
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    out += ch;
    if (!ARABIC_CONNECTING.test(ch)) continue;
    let j = i + 1;
    while (j < chars.length && isArabicDiacritic(chars[j])) j++;
    if (j < chars.length && ARABIC_CONNECTING.test(chars[j])) out += KASHIDA.repeat(count);
  }
  return out;
}

// Type ▸ OpenType substitutions via Unicode precomposed glyphs (no shaping).
const FRACTIONS: Record<string, string> = {
  "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾",
  "1/5": "⅕", "2/5": "⅖", "3/5": "⅗", "4/5": "⅘", "1/6": "⅙", "5/6": "⅚",
  "1/8": "⅛", "3/8": "⅜", "5/8": "⅝", "7/8": "⅞",
};
const SUPERSCRIPT: Record<string, string> = { s: "ˢ", t: "ᵗ", n: "ⁿ", d: "ᵈ", r: "ʳ", h: "ʰ" };
export function applyOpenType(s: string, spec: TextSpec): string {
  if (spec.liga) s = s.replace(/ffi/g, "ﬃ").replace(/ffl/g, "ﬄ").replace(/ff/g, "ﬀ").replace(/fi/g, "ﬁ").replace(/fl/g, "ﬂ");
  if (spec.dlig) s = s.replace(/st/g, "ﬆ");
  if (spec.frac) s = s.replace(/[1-9]\/[1-9]/g, (m) => FRACTIONS[m] ?? m);
  if (spec.ordn) s = s.replace(/(\d)(st|nd|rd|th)\b/gi, (_m, d, suf: string) => d + suf.toLowerCase().split("").map((c) => SUPERSCRIPT[c] ?? c).join(""));
  return s;
}

type SegmenterCtor = new (
  locales?: string | string[],
  options?: { granularity?: "grapheme" | "word" | "sentence" },
) => { segment(input: string): Iterable<{ segment: string }> };

let _graphemeSegmenter: { segment(input: string): Iterable<{ segment: string }> } | null | undefined;
function graphemeSegmenter(): { segment(input: string): Iterable<{ segment: string }> } | null {
  if (_graphemeSegmenter !== undefined) return _graphemeSegmenter;
  const ctor = (globalThis.Intl as typeof Intl & { Segmenter?: SegmenterCtor }).Segmenter;
  _graphemeSegmenter = ctor ? new ctor(undefined, { granularity: "grapheme" }) : null;
  return _graphemeSegmenter;
}

/** Split text into user-perceived glyph clusters. This keeps combining marks,
 *  emoji ZWJ sequences, Indic conjuncts, and regional-flag pairs together
 *  before Vision applies tracking/kerning/layout around them. */
export function graphemeClusters(s: string): string[] {
  const seg = graphemeSegmenter();
  return seg ? Array.from(seg.segment(s), (part) => part.segment) : Array.from(s);
}

type KerningCtx = CanvasRenderingContext2D & { fontKerning?: "auto" | "normal" | "none" };

function setFontKerning(ctx: CanvasRenderingContext2D, value: "normal" | "none") {
  const kctx = ctx as KerningCtx;
  try {
    if ("fontKerning" in kctx) kctx.fontKerning = value;
  } catch { /* older canvases can reject the property */ }
}

const LEFT_OPEN = new Set(["A", "F", "L", "P", "T", "V", "W", "Y"]);
const RIGHT_OPEN = new Set(["A", "J", "T", "V", "W", "Y"]);
const RIGHT_ROUND_OR_LOW = new Set(["a", "c", "d", "e", "g", "o", "q", "r", "s", "u", "v", "w", "y", "A", "C", "G", "O", "Q"]);

/** Latin pair-class ladder — the fallback for when the glyph outlines can't be
 *  sampled (no DOM canvas, blank/undrawable glyph, tainted read). */
function pairClassKernEm(left: string, right: string): number {
  if ((left === "T" || left === "Y") && RIGHT_ROUND_OR_LOW.has(right)) return -0.105;
  if ((left === "V" || left === "W") && RIGHT_ROUND_OR_LOW.has(right)) return -0.075;
  if (LEFT_OPEN.has(left) && RIGHT_OPEN.has(right)) return -0.06;
  if ((left === "F" || left === "P") && /[.,:;]/.test(right)) return -0.08;
  return 0;
}

// ── Outline-driven optical kerning ───────────────────────────────────────────
// Photoshop derives Optical kerning from the glyph shapes themselves, so it
// works in any script and in fonts with no kern table. We do the same with the
// only outline source a webview has: rasterize each glyph once and read its ink
// profile (leftmost/rightmost inked column per scanline). Everything is kept in
// em units at a normalized raster size, so one cache entry serves every point
// size of a family/style.

/** Per-scanline ink extents of one glyph, in em units from the pen origin.
 *  `NaN` marks a scanline the glyph does not touch. */
export interface GlyphInk { advance: number; left: Float32Array; right: Float32Array; }

const INK_EM = 64;      // raster size the profiles are sampled at
const INK_W = 192;      // canvas width  — fits an advance of ~2.5em from INK_X
const INK_H = 160;      // canvas height — INK_BASE of ascent, the rest descent
const INK_X = 32;       // pen origin x (left of it = negative sidebearing ink)
const INK_BASE = 112;   // baseline y
const INK_ALPHA = 96;   // ignore the faint antialias fringe
const GAP_CAP = 1.5;    // a recess (under a T's arm) reads as at most this × the neutral gap
const COLLISION_EM = 0.015; // closest the two inks may ever come after kerning
const NEUTRAL_GAP_FALLBACK = 0.08;

let _inkCtx: CanvasRenderingContext2D | null | undefined;
function inkCtx(): CanvasRenderingContext2D | null {
  if (_inkCtx !== undefined) return _inkCtx;
  _inkCtx = null;
  if (typeof document !== "undefined") {
    try {
      const c = document.createElement("canvas");
      c.width = INK_W; c.height = INK_H;
      _inkCtx = c.getContext("2d", { willReadFrequently: true });
    } catch { /* no 2d context (headless/node) — pair classes take over */ }
  }
  return _inkCtx;
}

/** Rewrite the CSS font's px size to the sampling size so profiles are
 *  size-independent. ponytail: ignores optical-size variable axes, which do
 *  change the outline per size — read `font-variation-settings` if that lands. */
function normalizedFont(font: string): string {
  return font.replace(/\d*\.?\d+px/, `${INK_EM}px`);
}

function measureInk(font: string, glyph: string): GlyphInk | null {
  const ctx = inkCtx();
  if (!ctx) return null;
  ctx.font = font;
  setFontKerning(ctx, "none");
  const advance = ctx.measureText(glyph).width / INK_EM;
  // Zero-width (marks) or wider than the sampling canvas — clipped ink would
  // read as a tight glyph, so hand those back to the pair classes instead.
  if (!(advance > 0) || advance > (INK_W - INK_X) / INK_EM) return null;
  ctx.clearRect(0, 0, INK_W, INK_H);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(glyph, INK_X, INK_BASE);
  let px: Uint8ClampedArray;
  try { px = ctx.getImageData(0, 0, INK_W, INK_H).data; } catch { return null; }
  const left = new Float32Array(INK_H).fill(NaN);
  const right = new Float32Array(INK_H).fill(NaN);
  let inked = false;
  for (let y = 0; y < INK_H; y++) {
    let lo = -1, hi = -1;
    const row = y * INK_W * 4;
    for (let x = 0; x < INK_W; x++) {
      if (px[row + x * 4 + 3] >= INK_ALPHA) { if (lo < 0) lo = x; hi = x; }
    }
    if (lo < 0) continue;
    left[y] = (lo - INK_X) / INK_EM;
    right[y] = (hi + 1 - INK_X) / INK_EM;
    inked = true;
  }
  return inked ? { advance, left, right } : null;
}

const _inkCache = new Map<string, GlyphInk | null>();
function glyphInk(font: string, glyph: string): GlyphInk | null {
  const key = `${font}\u0000${glyph}`;
  const hit = _inkCache.get(key);
  if (hit !== undefined) return hit;
  const ink = measureInk(font, glyph);
  // ponytail: flush-all instead of LRU eviction; a document with >2k distinct
  // glyph/font pairs would re-sample, swap in an LRU if that ever shows up.
  if (_inkCache.size > 2048) _inkCache.clear();
  _inkCache.set(key, ink);
  return ink;
}

const _neutralGap = new Map<string, number>();
/** The font's own "normal" letter gap, taken from a flat-sided glyph doubled.
 *  Every pair is judged loose or tight relative to this, which is what keeps
 *  the result font-relative instead of a hardcoded em fraction. */
function neutralGapEm(font: string): number {
  const hit = _neutralGap.get(font);
  if (hit !== undefined) return hit;
  let gap = NEUTRAL_GAP_FALLBACK;
  for (const g of ["n", "H", "o"]) {
    const ink = glyphInk(font, g);
    if (!ink) continue;
    const mean = meanInkGapEm(ink, ink, 0.5);
    if (mean !== null && mean > 0) { gap = mean; break; }
  }
  _neutralGap.set(font, gap);
  return gap;
}

/** Mean white gap between two ink profiles over the scanlines both touch, with
 *  each scanline capped so a deep recess reads as loose, not infinite.
 *  `null` when the pair shares no scanline (nothing to judge). */
function meanInkGapEm(l: GlyphInk, r: GlyphInk, cap: number): number | null {
  const n = Math.min(l.right.length, r.left.length);
  let sum = 0, rows = 0;
  for (let y = 0; y < n; y++) {
    const lr = l.right[y], rl = r.left[y];
    if (Number.isNaN(lr) || Number.isNaN(rl)) continue;
    const gap = (l.advance - lr) + rl;
    sum += gap < cap ? gap : cap;
    rows++;
  }
  return rows ? sum / rows : null;
}

/** Kern (em) for a pair from their ink profiles: pull them together until the
 *  capped mean gap matches the font's neutral gap, but never close enough for
 *  the two inks to touch. Returns `null` when the profiles don't overlap. */
export function outlineKernEm(l: GlyphInk, r: GlyphInk, neutralGap: number): number | null {
  const mean = meanInkGapEm(l, r, neutralGap * GAP_CAP);
  if (mean === null) return null;
  let closest = Infinity;
  const n = Math.min(l.right.length, r.left.length);
  for (let y = 0; y < n; y++) {
    const lr = l.right[y], rl = r.left[y];
    if (Number.isNaN(lr) || Number.isNaN(rl)) continue;
    const gap = (l.advance - lr) + rl;
    if (gap < closest) closest = gap;
  }
  let k = neutralGap - mean;
  // Collision floor only ever softens a negative kern — it must not push apart
  // glyphs that overlap by design (script/Arabic connected forms).
  if (k < 0) k = Math.max(k, -Math.max(0, closest - COLLISION_EM));
  return k < -0.25 ? -0.25 : k > 0.08 ? 0.08 : k;
}

/** Photoshop's Optical kerning: shape-derived, so it applies to any script and
 *  to fonts with no kern table. `font` (a CSS font string) enables the outline
 *  path; without it — or when the glyphs can't be sampled — the Latin
 *  pair-class ladder stands in. */
export function opticalKerningEm(left: string, right: string, font?: string): number {
  if (!left || !right || /\s/.test(left) || /\s/.test(right)) return 0;
  if (font) {
    const f = normalizedFont(font);
    const l = glyphInk(f, left), r = glyphInk(f, right);
    if (l && r) {
      const k = outlineKernEm(l, r, neutralGapEm(f));
      if (k !== null) return k;
    }
  }
  return pairClassKernEm(left, right);
}

export function kerningDelta(left: string, right: string, size: number, mode: Kerning, metricDelta = 0, font?: string): number {
  if (mode === "none") return 0;
  if (mode === "metrics") return Number.isFinite(metricDelta) ? metricDelta : 0;
  return opticalKerningEm(left, right, font) * Math.max(1, size);
}

function metricKerningDelta(ctx: CanvasRenderingContext2D, font: string, left: string, right: string): number {
  ctx.font = font;
  setFontKerning(ctx, "normal");
  const pair = ctx.measureText(left + right).width;
  const separate = ctx.measureText(left).width + ctx.measureText(right).width;
  return pair - separate;
}

function buildCells(spec: TextSpec): Cell[] {
  const ctx = scratchCtx();
  const cells: Cell[] = [];
  const ot = spec.liga || spec.dlig || spec.frac || spec.ordn;
  for (const run of spec.runs) {
    const st = resolveStyle(spec, run);
    const feat = mergedFeatures(spec, run);
    const vary = variationSettings(st);
    applyCanvasFeatures(ctx, feat, vary); // metrics must match the paint canvas
    let text = ot ? applyOpenType(run.text, spec) : run.text;
    text = applyKashidas(text, spec.kashida);
    let prev: Cell | null = null;
    for (const ch0 of graphemeClusters(text)) {
      if (ch0 === "\n") { cells.push(breakCell(st.size)); prev = null; continue; }
      const ch = subDigit(ch0, spec.digits);
      let glyph = ch;
      let sizeF = 1;
      if (st.caps === "all") glyph = ch.toUpperCase();
      else if (st.caps === "small") { const up = ch.toUpperCase(); if (up !== ch) { glyph = up; sizeF = 0.78; } }
      let scriptShift = 0;
      if (st.script === "super") { sizeF *= 0.66; scriptShift = st.size * 0.34; }
      else if (st.script === "sub") { sizeF *= 0.66; scriptShift = -st.size * 0.16; }
      const drawSize = Math.max(1, st.size * sizeF);
      const font = cssFont(st, drawSize);
      const { base, marks } = splitDiacritics(glyph);
      ctx.font = font;
      setFontKerning(ctx, st.kerning === "none" ? "none" : "normal");
      const m = ctx.measureText(glyph);
      const wRaw = m.width;
      const asc = isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : drawSize * 0.8;
      const desc = isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : drawSize * 0.2;
      const cell: Cell = {
        glyph, baseGlyph: base, markGlyph: marks,
        bidi: bidiClassForText(glyph),
        diacriticX: marks ? (spec.diacriticX ?? 0) : 0,
        diacriticY: marks ? (spec.diacriticY ?? 0) : 0,
        fontFamily: renderFontFamily(st), fontWeight: Number.isFinite(st.weight) ? Math.max(1, Math.min(1000, Math.round(st.weight))) : 400, fontItalic: st.italic,
        font, drawSize, baseShift: st.baseline + scriptShift,
        advance: wRaw * st.hScale + st.tracking + (st.fauxBold ? drawSize * 0.04 : 0),
        wRaw,
        ascent: asc * st.vScale, descent: desc * st.vScale,
        nominalSize: st.size,
        isSpace: /\s/.test(ch), isBreak: false,
        color: st.color, underline: st.underline, strike: st.strike,
        kerning: st.kerning, tracking: st.tracking,
        hScale: st.hScale, vScale: st.vScale, fauxBold: st.fauxBold, fauxItalic: st.fauxItalic,
        features: feat, variations: vary, noBreak: st.noBreak,
      };
      if (prev && !prev.isSpace && !cell.isSpace && prev.font === cell.font) {
        const metric = st.kerning === "metrics" ? metricKerningDelta(ctx, font, prev.glyph, cell.glyph) : 0;
        prev.advance += kerningDelta(prev.glyph, cell.glyph, prev.drawSize, st.kerning, metric, font) * prev.hScale;
      }
      cells.push(cell);
      prev = cell;
    }
  }
  return cells;
}

function splitParas(cells: Cell[]): Cell[][] {
  const out: Cell[][] = [[]];
  for (const c of cells) { if (c.isBreak) out.push([]); else out[out.length - 1].push(c); }
  return out;
}

function trimmedWidth(line: Cell[]): number {
  let end = line.length;
  while (end > 0 && line[end - 1].isSpace) end--;
  let w = 0;
  for (let i = 0; i < end; i++) w += line[i].advance;
  return w;
}

const HYPHEN_VOWEL = /[aeiouyàáâäãåæèéêëìíîïòóôöõøùúûüœ]/i;
const HYPHEN_WORD = /^[\p{L}']+$/u;

/** Candidate break indices for a word's letters (break before index i yields
 *  "word[0,i)-"), honouring words-longer-than / after-first / before-last.
 *  ponytail: vowel→consonant syllable heuristic, not Liang patterns — swap in
 *  a per-language dictionary hyphenator if typographic breaks must be exact. */
export function hyphenationPoints(letters: string[], h: Hyphenation = DEFAULT_HYPHENATION): number[] {
  const n = letters.length;
  if (n < h.wordsLongerThan || !HYPHEN_WORD.test(letters.join(""))) return [];
  const isV = (i: number) => i >= 0 && i < n && HYPHEN_VOWEL.test(letters[i]);
  const out: number[] = [];
  for (let i = Math.max(1, h.afterFirst); i <= n - Math.max(1, h.beforeLast); i++) {
    if (!isV(i) && isV(i + 1)) out.push(i); // break before a consonant opening a vowel syllable (bet-ter, ba-sic)
  }
  return out;
}

/** A word fragment (or space run) with the hyphen cell a mid-word break costs,
 *  and the width of a trailing 、。 that may hang past the margin (burasagari). */
interface Frag { cells: Cell[]; w: number; isSpace: boolean; hyphen: Cell | null; hang?: number; }
const frag = (cells: Cell[], isSpace: boolean, hyphen: Cell | null = null): Frag =>
  ({ cells, w: cells.reduce((s, c) => s + c.advance, 0), isSpace, hyphen });

/** The '-' glyph appended when a word breaks mid-line, styled like `proto`. */
function hyphenCell(proto: Cell): Cell {
  let wRaw = proto.drawSize * 0.33; // node fallback so composition stays pure-testable
  if (typeof document !== "undefined") {
    const ctx = scratchCtx();
    applyCanvasFeatures(ctx, proto.features, proto.variations);
    ctx.font = proto.font;
    wRaw = ctx.measureText("-").width;
  }
  return { ...proto, glyph: "-", baseGlyph: "-", markGlyph: "", bidi: "neutral", isSpace: false, wRaw, advance: wRaw * proto.hScale + proto.tracking };
}

function fragmentWord(cells: Cell[], h: Hyphenation): Frag[] {
  const points = hyphenationPoints(cells.map((c) => c.glyph), h);
  if (!points.length) return [frag(cells, false)];
  const out: Frag[] = [];
  let at = 0;
  for (const p of points) {
    const piece = cells.slice(at, p);
    out.push(frag(piece, false, hyphenCell(piece[piece.length - 1])));
    at = p;
  }
  out.push(frag(cells.slice(at), false));
  return out;
}

/** PS Single-line composer: first-fit, breaking a word at its best fitting
 *  hyphenation point when the whole word will not fit. */
function composeGreedy(frags: Frag[], avail0: number, availN: number, hyphenate: boolean, h: Hyphenation, justified: boolean): Cell[][] {
  const lines: Cell[][] = [];
  let cur: Cell[] = [];
  let curW = 0;
  let hyphRun = 0; // consecutive lines ending in a hyphen
  const avail = () => (lines.length === 0 ? avail0 : availN);
  const breakLine = (hyphened: boolean) => { lines.push(cur); cur = []; curW = 0; hyphRun = hyphened ? hyphRun + 1 : 0; };
  let i = 0;
  while (i < frags.length) {
    if (frags[i].isSpace) { cur.push(...frags[i].cells); curW += frags[i].w; i++; continue; }
    let end = i;
    let wordW = 0;
    while (end < frags.length && !frags[end].isSpace) { wordW += frags[end].w; end++; }
    const hang = frags[end - 1].hang ?? 0;
    while (curW + wordW - hang > avail() && (cur.length > 0 || wordW > avail())) {
      const gap = avail() - curW;
      // the hyphenation zone only gates unjustified text (PS single-line rule)
      const mayHyphen = hyphenate && (h.hyphenLimit === 0 || hyphRun < h.hyphenLimit) && (justified || h.zone <= 0 || gap > h.zone);
      let take = -1, takeW = 0;
      if (mayHyphen) {
        let w = 0;
        for (let j = i; j < end - 1; j++) { // the last fragment never hyphenates
          w += frags[j].w;
          const hy = frags[j].hyphen;
          if (hy && w + hy.advance <= gap) { take = j; takeW = w; }
        }
      }
      if (take >= 0) {
        for (let j = i; j <= take; j++) cur.push(...frags[j].cells);
        cur.push(frags[take].hyphen!);
        wordW -= takeW;
        i = take + 1;
        breakLine(true);
      } else if (cur.length > 0) {
        breakLine(false);
      } else break; // an unhyphenatable word wider than the box overflows, as before
    }
    for (; i < end; i++) { cur.push(...frags[i].cells); curW += frags[i].w; }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** PS Adobe Every-line composer: pick the break set minimising total squared
 *  slack across the whole paragraph (last line free), with a fixed penalty per
 *  hyphen break. ponytail: O(n²) DP over break candidates, no consecutive-
 *  hyphen cap here — full Knuth-Plass demerits if quality ever demands it. */
function composeEveryLine(frags: Frag[], avail0: number, availN: number): Cell[][] {
  const n = frags.length;
  if (!n) return [];
  const best = new Array<number>(n + 1).fill(Infinity);
  const next = new Array<number>(n + 1).fill(n);
  best[n] = 0;
  for (let k = n - 1; k >= 0; k--) {
    const avail = k === 0 ? avail0 : availN; // the first line always starts at frag 0
    const hyphenPenalty = avail * avail * 0.04; // ≈ a 20%-of-measure slack
    let w = 0;
    let found = false;
    for (let j = k; j < n; j++) {
      const f = frags[j];
      w += f.w;
      const atEnd = j + 1 === n;
      const hyphen = !atEnd && !f.isSpace ? f.hyphen : null;
      if (!atEnd && !f.isSpace && !hyphen) continue; // breaks only after spaces, hyphen points, or at the end
      const last = f.isSpace ? (j > k ? frags[j - 1] : undefined) : f; // its 、。 may hang
      const lineW = (f.isSpace ? w - f.w : w) + (hyphen ? hyphen.advance : 0) - (last?.hang ?? 0);
      const over = lineW > avail;
      if (over && found) break; // wider only gets worse
      const slack = avail - lineW;
      const cost = over
        ? 1e12 + lineW - avail // overfull allowed only when nothing fits
        : (atEnd ? 0 : slack * slack) + (hyphen ? hyphenPenalty : 0);
      found = true;
      if (cost + best[j + 1] < best[k]) { best[k] = cost + best[j + 1]; next[k] = j; }
    }
  }
  const lines: Cell[][] = [];
  for (let k = 0; k < n;) {
    const j = next[k];
    const line: Cell[] = [];
    for (let m = k; m <= j; m++) line.push(...frags[m].cells);
    if (j + 1 < n && !frags[j].isSpace && frags[j].hyphen) line.push(frags[j].hyphen!);
    lines.push(line);
    k = j + 1;
  }
  return lines;
}

// ── Type ▸ Language Options ▸ East Asian Features (spec.eastAsian) ──
// ponytail: one fixed JIS X 4051 set — not Photoshop's named Mojikumi / Kinsoku
// / Burasagari sets, no CJK↔Latin quarter-em, mojikumi in horizontal type only.
const CJK_OPENERS = "「『（［｛〈《【〔", CJK_CLOSERS = "」』）］｝〉》】〕", CJK_STOPS = "、。，．", CJK_MIDDLE = "・：；！？";
const charClass = (chars: string) => new RegExp(`^[${chars}]$`);
const CJK_OPEN = charClass(CJK_OPENERS);
const CJK_STOP = charClass(CJK_STOPS);
const CJK_CLOSE_OR_STOP = charClass(CJK_CLOSERS + CJK_STOPS);
const CJK_PUNCT = charClass(CJK_OPENERS + CJK_CLOSERS + CJK_STOPS + CJK_MIDDLE);
const CJK_NO_START = charClass(CJK_CLOSERS + CJK_STOPS + CJK_MIDDLE + "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶー々");
const CJK_CHAR = /^[\u3005\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]$/;
const isCjk = (g: string) => CJK_CHAR.test(g) || CJK_PUNCT.test(g);

/** Mojikumi: set consecutive CJK punctuation solid (」「 、「 。」 「「) by dropping
 *  the blank half of the first glyph's em. Returns copies. The tracking change
 *  keeps a compressed cell out of the native run painter, which would re-space
 *  it. A cell never shrinks below half its glyph, so a pair the font already
 *  set tight (metrics kerning, platform trimming) is not compressed twice. */
export function applyMojikumi(cells: readonly Cell[]): Cell[] {
  return cells.map((a, i) => {
    const b = cells[i + 1];
    const solid = !!b && (CJK_CLOSE_OR_STOP.test(a.glyph) ? CJK_PUNCT.test(b.glyph) : CJK_OPEN.test(a.glyph) && CJK_OPEN.test(b.glyph));
    if (!solid) return a;
    const half = (a.wRaw * a.hScale) / 2;
    const d = Math.max(0, Math.min(half, a.advance - half));
    return d > 0 ? { ...a, advance: a.advance - d, tracking: a.tracking - d } : a;
  });
}

/** Kinsoku shori: split a spaceless run at its CJK break opportunities — never
 *  before a closer, stop, small kana or ー, never after an opener. */
function kinsokuPieces(tk: Cell[]): Cell[][] {
  const out: Cell[][] = [[tk[0]]];
  for (let i = 1; i < tk.length; i++) {
    const a = tk[i - 1].glyph, b = tk[i].glyph;
    if ((isCjk(a) || isCjk(b)) && !CJK_NO_START.test(b) && !CJK_OPEN.test(a)) out.push([]);
    out[out.length - 1].push(tk[i]);
  }
  return out;
}

/** Wrap a paragraph's cells to the box width with the chosen composer. */
export function wrapPara(cells: Cell[], spec: TextSpec): Cell[][] {
  const avail0 = Math.max(1, spec.boxW - spec.leftIndent - spec.rightIndent - spec.firstIndent);
  const availN = Math.max(1, spec.boxW - spec.leftIndent - spec.rightIndent);
  const h = hyphenationOf(spec);
  // tokenize into maximal space / non-space runs, words pre-split at
  // hyphenation opportunities
  const frags: Frag[] = [];
  let i = 0;
  while (i < cells.length) {
    // Character ▸ No Break: a run of no-break cells becomes one unbreakable,
    // unhyphenatable token — its inner spaces included, so "New York" holds.
    if (cells[i].noBreak) {
      const tk: Cell[] = [];
      while (i < cells.length && cells[i].noBreak) { tk.push(cells[i]); i++; }
      frags.push(frag(tk, false));
      continue;
    }
    const sp = cells[i].isSpace;
    const tk: Cell[] = [];
    while (i < cells.length && !cells[i].noBreak && cells[i].isSpace === sp) { tk.push(cells[i]); i++; }
    if (sp) { frags.push(frag(tk, true)); continue; }
    (spec.eastAsian ? kinsokuPieces(tk) : [tk]).forEach((piece, k) => {
      if (k > 0) frags.push(frag([], true)); // a zero-width CJK break opportunity
      if (spec.hyphenate) frags.push(...fragmentWord(piece, h));
      else frags.push(frag(piece, false));
    });
  }
  if (spec.eastAsian) for (const f of frags) {
    const tail = f.cells[f.cells.length - 1];
    if (tail && !f.isSpace && CJK_STOP.test(tail.glyph)) f.hang = tail.advance;
  }
  const justified = spec.align === "justify" || spec.align === "justifyAll";
  const lines = spec.lineComposer === "everyline"
    ? composeEveryLine(frags, avail0, availN)
    : composeGreedy(frags, avail0, availN, !!spec.hyphenate, h, justified);
  return lines.length ? lines : [[]];
}

export interface LineJustify { extraPerSpace: number; extraPerLetter: number; glyphScale: number; }

/** Distribute a justify slack (`need` px, + stretch / − shrink) across the
 *  three Adobe justification stages — word spacing, letter spacing, glyph
 *  scaling — each clamped to its min/max. Any remainder is forced into word
 *  spaces (or letter gaps on space-less lines): PS also over-drives word
 *  spacing rather than leave a justified line ragged. Desired % is treated as
 *  the natural spacing baseline (ponytail: PS applies Desired to unjustified
 *  text too — wire that when non-justified spacing control matters). Pure. */
export function justifyLine(need: number, spaces: number, spaceW: number, gaps: number, glyphW: number, just: Justification): LineJustify {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  let word = 0, letter = 0, glyph = 0;
  if (spaces > 0) word = clamp(need, spaceW * (just.wordMin - 100) / 100, spaceW * (just.wordMax - 100) / 100);
  let rest = need - word;
  const unit = spaces > 0 ? spaceW / spaces : 0; // letter spacing % is of one space width
  if (rest !== 0 && gaps > 0 && unit > 0) {
    letter = clamp(rest, gaps * unit * just.letterMin / 100, gaps * unit * just.letterMax / 100);
    rest -= letter;
  }
  if (rest !== 0 && glyphW > 0) {
    glyph = clamp(rest, glyphW * (just.glyphMin - 100) / 100, glyphW * (just.glyphMax - 100) / 100);
    rest -= glyph;
  }
  if (rest !== 0) { if (spaces > 0) word += rest; else if (gaps > 0) letter += rest; }
  return {
    extraPerSpace: spaces > 0 ? word / spaces : 0,
    extraPerLetter: gaps > 0 ? letter / gaps : 0,
    glyphScale: glyphW > 0 ? 1 + glyph / glyphW : 1,
  };
}

// Roman Hanging Punctuation candidates (quotes, commas, periods, dashes).
const HANG_PUNCT = /^["'‘’“”.,–—:;!-]$/;

export function layoutHorizontal(cells0: Cell[], spec: TextSpec): Layout {
  const cells = spec.eastAsian ? applyMojikumi(cells0) : cells0;
  const isPara = spec.kind === "paragraph";
  const rtl = isRtl(spec);
  const paras = splitParas(cells);
  interface Line { cells: Cell[]; first: boolean; last: boolean; }
  const lines: Line[] = [];
  for (const para of paras) {
    const pl = isPara ? wrapPara(para, spec) : [para];
    pl.forEach((lc, i) => lines.push({ cells: lc, first: i === 0, last: i === pl.length - 1 }));
  }
  const blockW = isPara
    ? spec.boxW
    : Math.max(1, ...lines.map((l) => trimmedWidth(l.cells)));

  const placements: Placement[] = [];
  const just = justificationOf(spec);
  // ponytail: Roman hanging punctuation is LTR-only (it is a roman-script feature).
  const hangOn = !!spec.hangingPunctuation && isPara && !rtl;
  let y = 0;
  // Point type has no clipping box. Line advance ignores a downward baseline
  // shift and a vertical scale's descent, so the bitmap has to grow to the ink.
  let inkBottom = 0;
  lines.forEach((line, idx) => {
    const lineCells0 = spec.composer === "worldReady" ? layoutBidiOrder(line.cells, (c) => c.bidi, rtl ? "rtl" : "ltr") : line.cells;
    let nominal = spec.size;
    for (const c of lineCells0) nominal = Math.max(nominal, c.nominalSize);
    const lh = spec.leading > 0 ? spec.leading : nominal * (just.autoLeading / 100);
    if (line.first && idx > 0) y += spec.spaceBefore;
    let asc = nominal * 0.8;
    for (const c of lineCells0) asc = Math.max(asc, c.ascent + Math.max(0, c.baseShift));
    const baseY = y + asc;
    const lw = trimmedWidth(lineCells0);
    const leftI = isPara ? spec.leftIndent + (line.first ? spec.firstIndent : 0) : 0;
    const rightI = isPara ? spec.rightIndent : 0;
    const avail = blockW - leftI - rightI;
    // trimmed extent (trailing spaces excluded) — hanging + justify both need it
    let tEnd = lineCells0.length;
    while (tEnd > 0 && lineCells0[tEnd - 1].isSpace) tEnd--;
    // Roman Hanging Punctuation: line-edge punctuation hangs outside the
    // margins so the optical text edge stays flush.
    let hangLead = 0, hangTrail = 0;
    if (hangOn && tEnd > 0) {
      const head = lineCells0[0];
      if (!head.isSpace && HANG_PUNCT.test(head.glyph)) hangLead = head.advance;
      const tail = lineCells0[tEnd - 1];
      if (tail !== head && HANG_PUNCT.test(tail.glyph)) hangTrail = tail.advance;
    }
    // Burasagari: a 、。 the composer let overflow the measure hangs past it.
    if (spec.eastAsian && isPara && !rtl && tEnd > 0 && lw > avail && CJK_STOP.test(lineCells0[tEnd - 1].glyph)) {
      hangTrail = lineCells0[tEnd - 1].advance;
    }
    const lwOpt = lw - hangLead - hangTrail; // optical width, hanging excluded
    let startX = leftI - hangLead;
    let extraPerSpace = 0, extraPerLetter = 0, glyphScale = 1;
    const justify = spec.align === "justifyAll" || (spec.align === "justify" && !line.last);
    if (spec.align === "center") startX = leftI + (avail - lwOpt) / 2 - hangLead;
    else if (spec.align === "right") startX = blockW - rightI - lw + hangTrail;
    else if (justify) {
      let spaces = 0, spaceW = 0, gaps = 0, glyphW = 0;
      for (let i = 0; i < tEnd; i++) {
        const c = lineCells0[i];
        if (c.isSpace) { spaces++; spaceW += c.advance; }
        else { glyphW += c.advance; if (i + 1 < tEnd && !lineCells0[i + 1].isSpace) gaps++; }
      }
      ({ extraPerSpace, extraPerLetter, glyphScale } = justifyLine(avail - lwOpt, spaces, spaceW, gaps, glyphW, just));
    }
    // Glyph scaling both paints and advances scaled glyphs; spaces keep their width.
    const lineCells = glyphScale !== 1
      ? lineCells0.map((c) => (c.isSpace ? c : { ...c, advance: c.advance * glyphScale, hScale: c.hScale * glyphScale }))
      : lineCells0;
    // Word-space stretch after spaces; letter spacing only between two glyphs.
    const extraAfter = (i: number) => {
      const c = lineCells[i];
      if (c.isSpace) return extraPerSpace;
      const nx = lineCells[i + 1];
      return nx && !nx.isSpace ? extraPerLetter : 0;
    };
    if (rtl) {
      let x = startX + (justify ? avail : lw);
      lineCells.forEach((c, i) => {
        x -= c.advance + extraAfter(i);
        placements.push({ cell: c, x, y: baseY });
      });
    } else {
      let x = startX;
      lineCells.forEach((c, i) => {
        placements.push({ cell: c, x, y: baseY });
        x += c.advance + extraAfter(i);
      });
    }
    for (const c of lineCells) {
      if (c.isBreak) continue;
      inkBottom = Math.max(inkBottom, baseY + Math.max(0, -c.baseShift) + c.descent);
    }
    y += lh;
    if (line.last) y += spec.spaceAfter;
  });
  const fixedBox = spec.kind === "paragraph" && spec.boxH > 0;
  return { placements, blockW, blockH: fixedBox ? spec.boxH : Math.max(1, y, inkBottom) };
}

/** Caret x positions for a horizontal line of placements: one boundary before
 *  each glyph and one after the last advance. Hit tests use the midpoints. */
export function caretBoundaries(layout: Pick<Layout, "placements">): number[] {
  if (!layout.placements.length) return [0];
  const xs = layout.placements.map((p) => p.x);
  const last = layout.placements[layout.placements.length - 1];
  xs.push(last.x + last.cell.advance);
  return xs;
}

/** Index of the caret gap whose midpoint is the first one at or after `x`. */
export function caretIndexAt(xs: readonly number[], x: number): number {
  if (xs.length < 2) return 0;
  for (let i = 0; i < xs.length - 1; i++) {
    if (x < (xs[i] + xs[i + 1]) / 2) return i;
  }
  return xs.length - 2;
}

/** Document-relative caret boundaries for point type whose runs do not share
 *  one horizontal scale. Callers skip this when every run is scale 1. */
export function pointTypeCaretXs(spec: TextSpec): number[] {
  const cells = buildCells(spec);
  const layout = spec.vertical ? layoutVertical(cells, spec) : layoutHorizontal(cells, spec);
  return caretBoundaries(layout);
}

/** Cells in a column that carry ink — the vertical mirror of trimmedWidth's
 *  trailing-space trim (a column ends at its last visible glyph). */
function trimmedCount(col: readonly Cell[]): number {
  let end = col.length;
  while (end > 0 && col[end - 1].isSpace) end--;
  return end;
}

/** Break a paragraph into columns of at most `capFirst` / `capRest` cells,
 *  preferring a break after a space so a word is not split across columns.
 *  Every cell advances by the same leading, so the capacity is a count. */
function wrapColumns(para: Cell[], capFirst: number, capRest: number): Cell[][] {
  const out: Cell[][] = [];
  let i = 0;
  while (i < para.length) {
    const cap = Math.max(1, out.length === 0 ? capFirst : capRest);
    if (para.length - i <= cap) { out.push(para.slice(i)); break; }
    let end = i + cap;
    // A No Break run is one token. Prefer moving the whole run to the next
    // column; when it is taller than an empty column, let that one token
    // overflow instead of splitting it.
    if (para[end - 1]?.noBreak && para[end]?.noBreak) {
      let start = end;
      while (start > i && para[start - 1].noBreak) start--;
      if (start > i) end = start;
      else while (end < para.length && para[end].noBreak) end++;
    }
    let b = end;
    while (b > i && !(para[b - 1].isSpace && !para[b - 1].noBreak)) b--;
    if (b > i) end = b;
    out.push(para.slice(i, end));
    i = end;
  }
  return out.length ? out : [[]];
}

/** Tate-chu-yoko: in vertical type a run of 2–3 ASCII digits in one font sets
 *  upright across the column as a single cell, squeezed to the em when wider.
 *  ponytail: automatic 2–3 digits (InDesign's Auto Tate-Chu-Yoko); Photoshop's
 *  manual per-selection TCY would need a run attribute. */
export function tateChuYoko(cells: readonly Cell[]): Cell[] {
  const isDigit = (c: Cell | undefined) => !!c && /^[0-9]$/.test(c.glyph);
  const out: Cell[] = [];
  for (let i = 0; i < cells.length;) {
    let n = 1;
    while (isDigit(cells[i]) && isDigit(cells[i + n]) && cells[i + n].font === cells[i].font) n++;
    const run = cells.slice(i, i + n);
    i += n;
    if (n < 2 || n > 3) { out.push(...run); continue; }
    const w = run.reduce((s, c) => s + c.advance, 0);
    const squeeze = Math.min(1, run[0].nominalSize / w);
    const glyph = run.map((c) => c.glyph).join("");
    out.push({
      ...run[0], glyph, baseGlyph: glyph, advance: w * squeeze,
      wRaw: run.reduce((s, c) => s + c.wRaw, 0), hScale: run[0].hScale * squeeze,
    });
  }
  return out;
}

/** Vertical (CJK) type: layoutHorizontal transposed. Columns run RIGHT to LEFT,
 *  glyphs stack down each column, paragraph type wraps at the box height, and
 *  align / indents / spaceBefore / spaceAfter act on the transposed axes —
 *  align positions the run of glyphs *down* the column ("left" = top, "right" =
 *  bottom), indents inset the column's top/bottom, and paragraph spacing is the
 *  gap *between columns*. */
export function layoutVertical(cells0: Cell[], spec: TextSpec): Layout {
  const cells = spec.eastAsian ? tateChuYoko(cells0) : cells0;
  const isPara = spec.kind === "paragraph";
  const paras = splitParas(cells);
  let colW = spec.size;
  for (const c of cells) colW = Math.max(colW, c.advance, c.nominalSize);
  colW *= 1.1;
  const autoLeading = justificationOf(spec).autoLeading / 100;

  interface Col { cells: Cell[]; first: boolean; last: boolean; lh: number; }
  const cols: Col[] = [];
  let natural = 0;
  for (const para of paras) {
    let nominal = spec.size;
    for (const c of para) nominal = Math.max(nominal, c.nominalSize);
    const lh = spec.leading > 0 ? spec.leading : nominal * autoLeading;
    const pieces = isPara && spec.boxH > 0
      ? wrapColumns(para,
          Math.floor((spec.boxH - spec.leftIndent - spec.rightIndent - spec.firstIndent) / lh),
          Math.floor((spec.boxH - spec.leftIndent - spec.rightIndent) / lh))
      : [para];
    pieces.forEach((pc, i) => {
      cols.push({ cells: pc, first: i === 0, last: i === pieces.length - 1, lh });
      const insets = isPara ? spec.leftIndent + spec.rightIndent + (i === 0 ? spec.firstIndent : 0) : 0;
      natural = Math.max(natural, insets + pc.length * lh);
    });
  }
  const fixedBox = isPara && spec.boxH > 0;
  let blockH = fixedBox ? spec.boxH : Math.max(1, natural);

  let total = 0;
  cols.forEach((col, i) => {
    if (col.first && i > 0) total += spec.spaceBefore;
    total += colW;
    if (col.last) total += spec.spaceAfter;
  });
  const blockW = isPara && spec.boxW > 0 ? spec.boxW : Math.max(colW, total);

  const placements: Placement[] = [];
  let right = blockW;
  cols.forEach((col, i) => {
    if (col.first && i > 0) right -= spec.spaceBefore;
    right -= colW;
    const colX = right;
    const topI = isPara ? spec.leftIndent + (col.first ? spec.firstIndent : 0) : 0;
    const botI = isPara ? spec.rightIndent : 0;
    const avail = blockH - topI - botI;
    const n = trimmedCount(col.cells);
    const len = n * col.lh;
    // ponytail: vertical justify spreads the slack evenly between glyphs — the
    // word/letter/glyph-scaling stages justifyLine models are width-domain.
    const justify = spec.align === "justifyAll" || (spec.align === "justify" && !col.last);
    let y = topI;
    let extra = 0;
    if (spec.align === "center") y = topI + (avail - len) / 2;
    else if (spec.align === "right") y = blockH - botI - len;
    else if (justify && n > 1) extra = (avail - len) / (n - 1);
    for (const c of col.cells) {
      placements.push({ cell: c, x: colX + (colW - c.advance) / 2, y: y + c.ascent });
      y += col.lh + extra;
    }
    if (col.last) right -= spec.spaceAfter;
  });
  if (!fixedBox) {
    for (const p of placements) {
      blockH = Math.max(blockH, p.y + Math.max(0, -p.cell.baseShift) + p.cell.descent);
    }
  }
  return { placements, blockW, blockH };
}

// Faux italic paints with a fixed shear (see drawPlacement), which pushes ink
// sideways OUT of the glyph's advance box: 0.21×ascent to the right above the
// baseline, 0.21×descent to the left below it. blockW is advances-only, so none
// of that is in the bitmap unless the pad budgets it (#17) — otherwise the last
// glyph of the widest line loses its top-right corner above ~25px.
const FAUX_ITALIC_SHEAR = 0.21;

/** The widest faux-italic overhang past the advance box, in bitmap pixels. The
 *  shear runs inside the cell's h/v scale, so it lands scaled by hScale/vScale. */
function fauxItalicPad(cells: readonly Cell[]): number {
  let p = 0;
  for (const c of cells) {
    if (!c.fauxItalic) continue;
    const scale = c.vScale > 0 ? c.hScale / c.vScale : c.hScale;
    p = Math.max(p, FAUX_ITALIC_SHEAR * Math.max(c.ascent, c.descent) * scale);
  }
  return p;
}

/** Bitmap padding around the laid-out block. Exported for the unit test; `cells`
 *  is optional because the on-path renderer never shears. */
export function effectsPad(spec: TextSpec, cells: readonly Cell[] = []): number {
  let p = 4;
  if (spec.stroke && spec.stroke.width > 0) p = Math.max(p, spec.stroke.width * 2 + 2);
  if (spec.shadow) p = Math.max(p, spec.shadow.blur + Math.max(Math.abs(spec.shadow.dx), Math.abs(spec.shadow.dy)) + 2);
  p = Math.max(p, Math.abs(spec.diacriticX ?? 0) + 4, Math.abs(spec.diacriticY ?? 0) + 4);
  return Math.ceil(p + fauxItalicPad(cells));
}

function sameRgba(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function canPlatformShape(c: Cell): boolean {
  return !c.isBreak
    && (!c.markGlyph || (c.diacriticX === 0 && c.diacriticY === 0))
    && c.kerning === "metrics"
    && c.tracking === 0
    && c.hScale === 1
    && c.vScale === 1
    && !c.fauxBold
    && !c.fauxItalic;
}

function samePlatformStyle(a: Cell, b: Cell): boolean {
  return a.font === b.font
    && a.drawSize === b.drawSize
    && a.baseShift === b.baseShift
    && a.underline === b.underline
    && a.strike === b.strike
    && a.features === b.features
    && a.variations === b.variations
    && sameRgba(a.color, b.color);
}

/** Match layout width to the same native shaping call used for paint. Canvas
 * exposes the shaped word width but not glyph positions, so retain the existing
 * cluster advances and scale them to that exact total. */
function refinePlatformWidths(ctx: CanvasRenderingContext2D, cells: Cell[], spec: TextSpec): void {
  ctx.direction = isRtl(spec) ? "rtl" : "ltr";
  for (let start = 0; start < cells.length;) {
    const first = cells[start];
    if (first.isSpace || !canPlatformShape(first)) { start++; continue; }
    let end = start + 1;
    while (end < cells.length && !cells[end].isSpace && canPlatformShape(cells[end]) && samePlatformStyle(first, cells[end])) end++;
    if (end - start > 1) {
      applyCanvasFeatures(ctx, first.features, first.variations);
      ctx.font = first.font;
      setFontKerning(ctx, "normal");
      const current = cells.slice(start, end).reduce((sum, cell) => sum + cell.advance, 0);
      const shaped = ctx.measureText(cells.slice(start, end).map((cell) => cell.glyph).join("")).width;
      if (current > 0 && Number.isFinite(shaped)) {
        const scale = shaped / current;
        for (let i = start; i < end; i++) cells[i].advance *= scale;
      }
    }
    start = end;
  }
}

function platformRunLength(placements: Placement[], start: number, spec: TextSpec): number {
  if (spec.vertical) return 0;
  const rtl = isRtl(spec);
  const first = placements[start];
  if (!first || first.cell.isSpace || !canPlatformShape(first.cell)) return 0;
  let len = 1;
  while (start + len < placements.length) {
    const prev = placements[start + len - 1];
    const next = placements[start + len];
    if (!canPlatformShape(next.cell) || !samePlatformStyle(first.cell, next.cell)) break;
    if (Math.abs(next.y - first.y) > 0.01) break;
    const gap = rtl
      ? Math.abs((next.x + next.cell.advance) - prev.x)
      : Math.abs(next.x - (prev.x + prev.cell.advance));
    if (gap > 0.25) break;
    len++;
  }
  return len > 1 ? len : 0;
}

function setupTextShadow(ctx: CanvasRenderingContext2D, spec: TextSpec): boolean {
  if (!spec.shadow) return false;
  ctx.shadowColor = rgba(spec.shadow.color);
  ctx.shadowBlur = spec.shadow.blur;
  ctx.shadowOffsetX = spec.shadow.dx;
  ctx.shadowOffsetY = spec.shadow.dy;
  return true;
}

function drawCellText(ctx: CanvasRenderingContext2D, c: Cell, mode: "fill" | "stroke"): void {
  const draw = mode === "fill"
    ? (s: string, x: number, y: number) => ctx.fillText(s, x, y)
    : (s: string, x: number, y: number) => ctx.strokeText(s, x, y);
  if (!c.markGlyph || (c.diacriticX === 0 && c.diacriticY === 0)) {
    draw(c.glyph, 0, 0);
    return;
  }
  if (c.baseGlyph) draw(c.baseGlyph, 0, 0);
  draw(c.markGlyph, c.diacriticX, c.diacriticY);
}

function drawPlacement(ctx: CanvasRenderingContext2D, p: Placement, spec: TextSpec, pad: number, noShadow: string): void {
  const c = p.cell;
  if (c.isBreak) return;
  applyCanvasFeatures(ctx, c.features, c.variations);
  ctx.save();
  ctx.direction = isRtl(spec) ? "rtl" : "ltr";
  ctx.textAlign = "left";
  ctx.translate(p.x + pad, p.y + pad - c.baseShift);
  if (c.hScale !== 1 || c.vScale !== 1) ctx.scale(c.hScale, c.vScale);
  if (c.fauxItalic) ctx.transform(1, 0, -0.21, 1, 0, 0);
  ctx.font = c.font;
  setFontKerning(ctx, c.kerning === "none" ? "none" : "normal");
  let shadowOn = setupTextShadow(ctx, spec);
  if (spec.stroke && spec.stroke.width > 0 && !c.isSpace) {
    ctx.lineJoin = "round";
    ctx.strokeStyle = rgba(spec.stroke.color);
    ctx.lineWidth = spec.stroke.width * 2;
    drawCellText(ctx, c, "stroke");
    if (shadowOn) { ctx.shadowColor = noShadow; shadowOn = false; } // shadow already cast
  }
  ctx.fillStyle = rgba(c.color);
  if (!c.isSpace) {
    if (c.fauxBold) { ctx.lineWidth = c.drawSize * 0.05; ctx.strokeStyle = rgba(c.color); drawCellText(ctx, c, "stroke"); }
    drawCellText(ctx, c, "fill");
  }
  ctx.shadowColor = noShadow;
  if (c.underline) { const th = Math.max(1, c.drawSize * 0.06); ctx.fillRect(0, c.drawSize * 0.14, c.wRaw, th); }
  if (c.strike) { const th = Math.max(1, c.drawSize * 0.055); ctx.fillRect(0, -c.drawSize * 0.30, c.wRaw, th); }
  ctx.restore();
}

function drawPlatformRun(ctx: CanvasRenderingContext2D, placements: Placement[], start: number, len: number, spec: TextSpec, pad: number, noShadow: string): void {
  const first = placements[start];
  const c = first.cell;
  const rtl = isRtl(spec);
  const text = placements.slice(start, start + len).map((p) => p.cell.glyph).join("");
  applyCanvasFeatures(ctx, c.features, c.variations);
  ctx.save();
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  const anchorX = rtl ? first.x + c.advance : first.x;
  ctx.translate(anchorX + pad, first.y + pad - c.baseShift);
  ctx.font = c.font;
  setFontKerning(ctx, "normal");
  let shadowOn = setupTextShadow(ctx, spec);
  if (spec.stroke && spec.stroke.width > 0) {
    ctx.lineJoin = "round";
    ctx.strokeStyle = rgba(spec.stroke.color);
    ctx.lineWidth = spec.stroke.width * 2;
    ctx.strokeText(text, 0, 0);
    if (shadowOn) { ctx.shadowColor = noShadow; shadowOn = false; } // shadow already cast
  }
  ctx.fillStyle = rgba(c.color);
  ctx.fillText(text, 0, 0);
  ctx.shadowColor = noShadow;
  if (c.underline || c.strike) {
    const w = ctx.measureText(text).width;
    if (c.underline) { const th = Math.max(1, c.drawSize * 0.06); ctx.fillRect(0, c.drawSize * 0.14, w, th); }
    if (c.strike) { const th = Math.max(1, c.drawSize * 0.055); ctx.fillRect(0, -c.drawSize * 0.30, w, th); }
  }
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, placements: Placement[], spec: TextSpec, pad: number): void {
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const NO_SHADOW = "rgba(0,0,0,0)";
  for (let i = 0; i < placements.length;) {
    const runLen = platformRunLength(placements, i, spec);
    if (runLen > 1) {
      drawPlatformRun(ctx, placements, i, runLen, spec, pad, NO_SHADOW);
      i += runLen;
    } else {
      drawPlacement(ctx, placements[i], spec, pad, NO_SHADOW);
      i++;
    }
  }
}

export function antiAliasAlpha(a: number, mode: AntiAlias): number {
  if (mode === "smooth") return clamp01(a);
  if (mode === "none") return a < 0.5 ? 0 : 1;
  if (mode === "sharp") return clamp01((a - 0.5) * 1.6 + 0.5);
  if (mode === "crisp") return clamp01((a - 0.5) * 1.25 + 0.5);
  if (mode === "strong") return clamp01(a * 1.3);
  // Canvas exposes grayscale coverage, not LCD subpixel masks. Treat Windows LCD
  // as stronger ClearType-like coverage and Windows as its grayscale sibling.
  if (mode === "windowslcd") return clamp01((a - 0.42) * 1.45 + 0.5);
  if (mode === "windows") return clamp01((a - 0.48) * 1.35 + 0.5);
  return clamp01(a);
}

/** Map the smooth (browser-AA) coverage to the chosen anti-alias mode. */
function applyAA(data: Uint8ClampedArray, mode: AntiAlias): void {
  if (mode === "smooth") return;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i] / 255;
    data[i] = Math.round(antiAliasAlpha(a, mode) * 255);
  }
}

// ── Type ▸ Text on Path geometry (pure, unit-tested) ──────────────
export interface PathMetrics { len: number; segs: { x0: number; y0: number; x1: number; y1: number; len: number; cum: number }[]; }
export function pathMetrics(path: number[]): PathMetrics {
  const segs: PathMetrics["segs"] = [];
  let cum = 0;
  for (let i = 0; i + 3 < path.length; i += 2) {
    const x0 = path[i], y0 = path[i + 1], x1 = path[i + 2], y1 = path[i + 3];
    const len = Math.hypot(x1 - x0, y1 - y0);
    segs.push({ x0, y0, x1, y1, len, cum });
    cum += len;
  }
  return { len: cum, segs };
}
/** Point + tangent angle at arc-length `s` along the polyline. */
export function pointAt(m: PathMetrics, s: number): { x: number; y: number; angle: number } {
  if (m.segs.length === 0) return { x: 0, y: 0, angle: 0 };
  s = Math.max(0, Math.min(m.len, s));
  for (let k = 0; k < m.segs.length; k++) {
    const seg = m.segs[k];
    if (s <= seg.cum + seg.len || k === m.segs.length - 1) {
      const t = seg.len > 0 ? (s - seg.cum) / seg.len : 0;
      return { x: seg.x0 + (seg.x1 - seg.x0) * t, y: seg.y0 + (seg.y1 - seg.y0) * t, angle: Math.atan2(seg.y1 - seg.y0, seg.x1 - seg.x0) };
    }
  }
  return { x: 0, y: 0, angle: 0 };
}

/** Type ▸ Text on Path Options ▸ Align: which edge of the glyph rides the path. */
export type PathAlign = "baseline" | "ascender" | "center" | "descender";
export const PATH_ALIGNS: { id: PathAlign; label: string }[] = [
  { id: "baseline", label: "Baseline" },
  { id: "ascender", label: "Ascender" },
  { id: "center", label: "Center" },
  { id: "descender", label: "Descender" },
];

// The Type on a Path Options model. Declared as an augmentation so it lives
// beside the layout that consumes it; specs are JSON round-tripped opaquely by
// the engine, so older saved type layers simply lack these keys (all optional).
// ponytail: augmentation keeps this to one file — fold the five fields into
// TextSpec in spec.ts next time that file is edited.
declare module "./spec" {
  interface TextSpec {
    // Start/end brackets: arc-length window (px) the run is laid out inside.
    // Absent/0 = the whole path. `spec.align` positions the run in that window.
    pathStart?: number;
    pathEnd?: number;
    // Drag-across-the-path flip: run backwards, on the other side of the line.
    pathFlip?: boolean;
    pathAlign?: PathAlign;
    // Extra px between glyphs (negative tightens them around a curve).
    pathSpacing?: number;
  }
}

/** The only cell fields on-path layout needs — keeps it testable without a canvas. */
export interface PathCell { advance: number; ascent: number; descent: number; isSpace: boolean; isBreak: boolean; }
/** Where one glyph lands: a point on the path, the tangent to rotate to, and the
 *  baseline shift along the glyph's local +y (the align-to-path offset). */
export interface PathPlacement { index: number; x: number; y: number; angle: number; offset: number; }

/** Baseline shift that puts the requested glyph edge on the path. Glyph box is
 *  [-ascent, +descent] around the baseline in the glyph's local (rotated) frame. */
function pathAlignOffset(c: PathCell, align: PathAlign | undefined): number {
  if (align === "ascender") return c.ascent;      // glyph top on the path
  if (align === "descender") return -c.descent;   // glyph bottom on the path
  if (align === "center") return (c.ascent - c.descent) / 2;
  return 0;                                       // baseline (Photoshop default)
}

/** Lay glyphs along `spec.path` by arc length. Pure: `rasterizeOnPath` only
 *  draws what this returns, so start/end/flip/align/spacing are unit-testable. */
export function layoutOnPath(cells: readonly PathCell[], spec: TextSpec): PathPlacement[] {
  const m = pathMetrics(spec.path ?? []);
  const spacing = spec.pathSpacing ?? 0;
  const start = Math.max(0, Math.min(m.len, spec.pathStart ?? 0));
  const endRaw = spec.pathEnd && spec.pathEnd > 0 ? spec.pathEnd : m.len;
  const end = Math.max(start, Math.min(m.len, endRaw));
  const flip = !!spec.pathFlip;
  const idx: number[] = [];
  for (let i = 0; i < cells.length; i++) if (!cells[i].isBreak) idx.push(i);
  const run = idx.reduce((a, i) => a + cells[i].advance, 0) + spacing * Math.max(0, idx.length - 1);
  // Paragraph alignment slides the run between the brackets — that is what
  // Photoshop's start/centre/end handles do.
  // ponytail: justify falls back to left; add slack distribution if asked.
  const slack = Math.max(0, (end - start) - run);
  const lead = spec.align === "center" ? slack / 2 : spec.align === "right" ? slack : 0;
  const out: PathPlacement[] = [];
  let s = start + lead;
  for (const i of idx) {
    const c = cells[i];
    if (!c.isSpace) {
      const mid = s + c.advance / 2; // glyph centre rides the path
      // Flipping mirrors the walk about the bracket window and turns each glyph
      // 180°, so the type reads correctly on the opposite side of the line.
      const p = pointAt(m, flip ? start + end - mid : mid);
      out.push({ index: i, x: p.x, y: p.y, angle: flip ? p.angle + Math.PI : p.angle, offset: pathAlignOffset(c, spec.pathAlign) });
    }
    s += c.advance + spacing;
  }
  return out;
}

/** Paint one on-path glyph the way `drawPlacement` paints a block glyph.
 *  The centre translate uses `advance`, which already includes hScale, so it
 *  happens before `scale` — scaling first would walk the glyph off the path. */
function drawOnPathGlyph(
  ctx: CanvasRenderingContext2D, c: Cell, p: PathPlacement, spec: TextSpec, noShadow: string,
): void {
  applyCanvasFeatures(ctx, c.features, c.variations);
  ctx.save();
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.translate(-c.advance / 2, p.offset - c.baseShift);
  if (c.hScale !== 1 || c.vScale !== 1) ctx.scale(c.hScale, c.vScale);
  if (c.fauxItalic) ctx.transform(1, 0, -FAUX_ITALIC_SHEAR, 1, 0, 0);
  ctx.font = c.font;
  setFontKerning(ctx, c.kerning === "none" ? "none" : "normal");
  let shadowOn = setupTextShadow(ctx, spec);
  if (spec.stroke && spec.stroke.width > 0 && !c.isSpace) {
    ctx.lineJoin = "round";
    ctx.strokeStyle = rgba(spec.stroke.color);
    ctx.lineWidth = spec.stroke.width * 2;
    drawCellText(ctx, c, "stroke");
    if (shadowOn) { ctx.shadowColor = noShadow; shadowOn = false; }
  }
  ctx.fillStyle = rgba(c.color);
  if (!c.isSpace) {
    if (c.fauxBold) { ctx.lineWidth = c.drawSize * 0.05; ctx.strokeStyle = rgba(c.color); drawCellText(ctx, c, "stroke"); }
    drawCellText(ctx, c, "fill");
  }
  ctx.shadowColor = noShadow;
  if (c.underline) { const th = Math.max(1, c.drawSize * 0.06); ctx.fillRect(0, c.drawSize * 0.14, c.wRaw, th); }
  if (c.strike) { const th = Math.max(1, c.drawSize * 0.055); ctx.fillRect(0, -c.drawSize * 0.30, c.wRaw, th); }
  ctx.restore();
}

function rasterizeOnPath(spec: TextSpec): RasterResult {
  const cells = buildCells(spec);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < spec.path!.length; i += 2) {
    minx = Math.min(minx, spec.path![i]); maxx = Math.max(maxx, spec.path![i]);
    miny = Math.min(miny, spec.path![i + 1]); maxy = Math.max(maxy, spec.path![i + 1]);
  }
  let extent = spec.size * 1.5;
  for (const c of cells) {
    extent = Math.max(extent, c.ascent, c.descent, Math.abs(c.baseShift), Math.abs(c.advance));
  }
  const pad = Math.ceil(extent) + effectsPad(spec, cells);
  const originX = Math.floor(minx) - pad, originY = Math.floor(miny) - pad;
  const w = Math.max(1, Math.ceil(maxx) - originX + pad);
  const h = Math.max(1, Math.ceil(maxy) - originY + pad);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  const noShadow = "rgba(0,0,0,0)";
  ctx.translate(-originX, -originY);
  for (const p of layoutOnPath(cells, spec)) drawOnPathGlyph(ctx, cells[p.index], p, spec, noShadow);
  const img = ctx.getImageData(0, 0, w, h);
  releaseCanvas(canvas);
  applyAA(img.data, spec.antialias);
  return { w, h, data: img.data, placeX: originX, placeY: originY };
}

/** The same placements used to paint type, for the glyph-outline commands. */
export function layoutTypeOutline(spec: TextSpec): Layout & { pad: number; onPath: boolean } {
  const cells = buildCells(spec);
  if (spec.path && spec.path.length >= 4) return {
    placements: layoutOnPath(cells, spec).map((p) => ({
      cell: { ...cells[p.index], baseShift: cells[p.index].baseShift - p.offset },
      x: p.x, y: p.y, angle: p.angle, centerOffset: -cells[p.index].advance / 2,
    })), blockW: 0, blockH: 0, pad: 0, onPath: true,
  };
  if (!spec.vertical) refinePlatformWidths(scratchCtx(), cells, spec);
  const layout = spec.vertical ? layoutVertical(cells, spec) : layoutHorizontal(cells, spec);
  const placements: Placement[] = [];
  for (let i = 0; i < layout.placements.length;) {
    const len = platformRunLength(layout.placements, i, spec);
    const first = layout.placements[i];
    if (len > 1) {
      const run = layout.placements.slice(i, i + len);
      placements.push({ ...first, x: Math.min(...run.map((p) => p.x)),
        cell: { ...first.cell, glyph: run.map((p) => p.cell.glyph).join("") } });
      i += len;
    } else { placements.push(first); i++; }
  }
  const outlined = placements.flatMap((p) => {
    const c = p.cell;
    if (!c.markGlyph || (c.diacriticX === 0 && c.diacriticY === 0)) return [p];
    const base = c.baseGlyph ? [{ ...p, cell: { ...c, glyph: c.baseGlyph } }] : [];
    return [...base, { ...p,
      x: p.x + c.diacriticX * c.hScale - (c.fauxItalic ? 0.21 * c.hScale * c.diacriticY : 0),
      y: p.y + c.diacriticY * c.vScale,
      cell: { ...c, glyph: c.markGlyph } }];
  });
  return { ...layout, placements: outlined, pad: effectsPad(spec, cells), onPath: false };
}

export function rasterizeSpec(spec: TextSpec): RasterResult {
  if (spec.path && spec.path.length >= 4) return rasterizeOnPath(spec);
  const cells = buildCells(spec);
  if (!spec.vertical) refinePlatformWidths(scratchCtx(), cells, spec);
  const layout = spec.vertical ? layoutVertical(cells, spec) : layoutHorizontal(cells, spec);
  // Burasagari hangs a stop past blockW: budget that ink so it isn't clipped.
  const overhang = spec.eastAsian
    ? layout.placements.reduce((m, p) => (p.cell.isSpace ? m : Math.max(m, -p.x, p.x + p.cell.advance - layout.blockW)), 0)
    : 0;
  const pad = effectsPad(spec, cells) + Math.ceil(overhang); // effectsPad budgets the faux-italic shear overhang (#17)
  const w = Math.max(1, Math.ceil(layout.blockW) + pad * 2);
  const h = Math.max(1, Math.ceil(layout.blockH) + pad * 2);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, layout.placements, spec, pad);
  const img = ctx.getImageData(0, 0, w, h);
  releaseCanvas(canvas);
  applyAA(img.data, spec.antialias);

  const base: Bitmap = { w, h, data: img.data };
  const warped = warpBitmap(base, spec.warp);
  // Keep the text block centered on the same document point regardless of how
  // effects/warp grew the bitmap. base center == block center (pad is symmetric).
  const placeX = Math.round(spec.ax + layout.blockW / 2 - warped.cx);
  const placeY = Math.round(spec.ay + layout.blockH / 2 - warped.cy);
  return { w: warped.w, h: warped.h, data: warped.data, placeX, placeY };
}
