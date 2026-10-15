// ─────────────────────────────────────────────────────────────
// TextSpec — the re-editable type model for Monet Vision.
//
// Mirrors Photoshop's run-based type engine: a layer carries default
// character/paragraph attributes plus an ordered list of *runs* (spans of
// uniformly-formatted characters). Newlines inside a run's text are hard
// breaks. The whole spec is serialized to JSON and stored opaquely in the
// engine layer (`set_text_layer_spec` / `layer_text_spec`) so type stays
// editable across saves. See src/text/raster.ts for rendering.
// ─────────────────────────────────────────────────────────────

export type RGBA = [number, number, number, number];

export type WarpStyle =
  | "none" | "arc" | "arcLower" | "arcUpper" | "arch" | "bulge"
  | "shellLower" | "shellUpper" | "flag" | "wave" | "fish" | "rise"
  | "fisheye" | "inflate" | "squeeze" | "twist";

export type AntiAlias = "none" | "sharp" | "crisp" | "strong" | "smooth" | "windowslcd" | "windows";
export type Kerning = "metrics" | "optical" | "none";
export type Align = "left" | "center" | "right" | "justify" | "justifyAll";
export type Direction = "ltr" | "rtl";
export type Composer = "latin" | "worldReady";
export type Caps = "none" | "all" | "small";
export type Script = "none" | "super" | "sub";
export type Kashida = "none" | "short" | "medium" | "long" | "stylistic";

/** A span of uniformly-formatted characters. Any omitted attribute falls back
 *  to the layer default in TextSpec. `text` may contain '\n' (hard breaks). */
export interface TextRun {
  text: string;
  font?: string;
  size?: number;
  color?: RGBA;
  bold?: boolean;
  italic?: boolean;
  /** The real face weight, CSS-numeric (1–1000). Absent means "whatever `bold`
   *  says" (700/400) — which is how every document saved before the Style
   *  picker existed keeps rendering. See resolveStyle. */
  weight?: number;
  /** Exact PostScript/full face name; distinguishes same-weight subfamilies. */
  face?: string;
  /** Variable-font axis values, tag → value (e.g. `{ wdth: 87.5 }`). The
   *  `wght` axis is carried by `weight` instead — CSS font-weight *is* that
   *  axis — and variationSettings drops it if it sneaks in. */
  axes?: Record<string, number>;
  fauxBold?: boolean;
  fauxItalic?: boolean;
  underline?: boolean;
  strike?: boolean;
  kerning?: Kerning;
  tracking?: number; // px of extra advance per glyph
  hScale?: number;   // 1 = 100%
  vScale?: number;
  baseline?: number; // baseline shift, +up px
  caps?: Caps;
  script?: Script;
  /** Per-run OpenType feature overrides (tag → on/off), merged over the layer
   *  defaults in TextSpec.features. See mergedFeatures. */
  features?: Record<string, boolean>;
  /** Character ▸ No Break: this span never wraps — the composer keeps it whole
   *  on one line (spaces inside it included) and never hyphenates it. */
  noBreak?: boolean;
}

// ── Paragraph composition: Hyphenation / Justification / composer ──
// Photoshop keeps these in two dialogs off the Paragraph panel flyout plus the
// panel's Hyphenate checkbox. All optional on TextSpec: absent = the factory
// defaults below, which reproduce the legacy layout (no hyphenation, greedy
// single-line wrap, all justify slack into word spaces, 120% auto leading).
export interface Hyphenation {
  wordsLongerThan: number; // hyphenate only words with ≥ this many letters
  afterFirst: number;      // min letters kept before the break
  beforeLast: number;      // min letters carried to the next line
  hyphenLimit: number;     // max consecutive hyphen-ending lines (0 = unlimited)
  zone: number;            // px dead-band at the right edge (unjustified single-line only)
}
export interface Justification {
  wordMin: number; wordDesired: number; wordMax: number;       // word spacing, % of a space
  letterMin: number; letterDesired: number; letterMax: number; // letter spacing, % of a space per gap
  glyphMin: number; glyphDesired: number; glyphMax: number;    // glyph scaling, %
  autoLeading: number;                                         // auto leading, % of size
}
export type LineComposer = "single" | "everyline";

/** Photoshop's factory defaults for both dialogs. */
export const DEFAULT_HYPHENATION: Hyphenation = { wordsLongerThan: 5, afterFirst: 2, beforeLast: 2, hyphenLimit: 2, zone: 36 };
export const DEFAULT_JUSTIFICATION: Justification = {
  wordMin: 80, wordDesired: 100, wordMax: 133,
  letterMin: 0, letterDesired: 0, letterMax: 0,
  glyphMin: 100, glyphDesired: 100, glyphMax: 100,
  autoLeading: 120,
};
export const LINE_COMPOSERS: { id: LineComposer; label: string }[] = [
  { id: "single", label: "Single-line Composer" },
  { id: "everyline", label: "Every-line Composer" },
];

export const hyphenationOf = (spec: TextSpec): Hyphenation => ({ ...DEFAULT_HYPHENATION, ...spec.hyphenation });
export const justificationOf = (spec: TextSpec): Justification => ({ ...DEFAULT_JUSTIFICATION, ...spec.justification });

export interface TextWarp {
  style: WarpStyle;
  bend: number; // -1..1 (Photoshop -100..100%)
  h: number;    // horizontal distortion -1..1
  v: number;    // vertical distortion -1..1
  orient: "h" | "v";
}

export interface TextStroke { width: number; color: RGBA; }
export interface TextShadow { color: RGBA; blur: number; dx: number; dy: number; }

export interface TextSpec {
  v: 1;
  kind: "point" | "paragraph";
  vertical: boolean;
  ax: number; // anchor: document-space top-left of the unwarped text block
  ay: number;
  runs: TextRun[];
  // character defaults
  font: string;
  size: number;
  color: RGBA;
  bold: boolean;
  italic: boolean;
  tracking: number;
  kerning: Kerning;
  leading: number; // 0 = auto (justification.autoLeading % of size, 120% by default)
  hScale: number;
  vScale: number;
  // paragraph
  align: Align;
  direction?: Direction; // absent = ltr, back-compat with older saved specs
  composer?: Composer; // absent = latin, back-compat with older saved specs
  boxW: number; // wrap width when kind === 'paragraph'
  boxH: number; // 0 = auto height
  firstIndent: number;
  leftIndent: number;
  rightIndent: number;
  spaceBefore: number;
  spaceAfter: number;
  // Paragraph panel ▸ Hyphenate + the Hyphenation / Justification dialogs, and
  // the composer choice. Optional (absent = the defaults above), back-compat
  // with older saved specs.
  hyphenate?: boolean;
  hyphenation?: Partial<Hyphenation>;
  justification?: Partial<Justification>;
  lineComposer?: LineComposer;
  // Paragraph panel flyout ▸ Roman Hanging Punctuation.
  hangingPunctuation?: boolean;
  // Type ▸ Language Options ▸ East Asian Features: kinsoku breaks, mojikumi,
  // burasagari and tate-chu-yoko (text/raster.ts). Absent = off, back-compat.
  eastAsian?: boolean;
  // rendering
  antialias: AntiAlias;
  // Type ▸ Language Options ▸ Use … Digits: substitute ASCII 0-9 glyphs.
  // Optional (absent = "latin", back-compat with older specs).
  digits?: "latin" | "arabic" | "hindi";
  // Type ▸ Language Options ▸ Kashidas: deterministic Arabic tatweel insertion.
  // Optional (absent = "none", back-compat with older specs).
  kashida?: Kashida;
  // Type ▸ Middle Eastern Features: adjust combining diacritic marks in px.
  // Optional (absent = 0, back-compat with older specs).
  diacriticX?: number;
  diacriticY?: number;
  // Type ▸ Text on Path: a doc-space polyline [x0,y0,x1,y1,…] the glyphs ride
  // along (baseline on the path, each glyph rotated to the local tangent).
  // Optional — absent means normal point/paragraph layout.
  path?: number[];
  // Type ▸ OpenType: precomposed-glyph substitutions (no shaping engine needed).
  liga?: boolean; // Standard Ligatures (fi → ﬁ)
  dlig?: boolean; // Discretionary Ligatures (st → ﬆ)
  frac?: boolean; // Fractions (1/2 → ½)
  ordn?: boolean; // Ordinals (1st → 1ˢᵗ)
  // Type ▸ OpenType advanced sets: arbitrary feature tags (ss01–ss20, swsh, salt,
  // calt, onum, titl, jalt) applied to editable type via canvas
  // font-feature-settings (tag → on/off). Optional (absent = none), back-compat.
  features?: Record<string, boolean>;
  // effects (Photoshop layer styles, common on type)
  stroke: TextStroke | null;
  shadow: TextShadow | null;
  // warp
  warp: TextWarp;
}

/** Fully-resolved per-character style (run merged over layer defaults). */
export interface ResolvedStyle {
  font: string; size: number; color: RGBA;
  bold: boolean; italic: boolean; weight: number; face?: string; axes: Record<string, number>;
  fauxBold: boolean; fauxItalic: boolean;
  underline: boolean; strike: boolean;
  tracking: number; kerning: Kerning; hScale: number; vScale: number; baseline: number;
  caps: Caps; script: Script; noBreak: boolean;
}

export function resolveStyle(spec: TextSpec, run: TextRun): ResolvedStyle {
  return {
    font: run.font ?? spec.font,
    size: run.size ?? spec.size,
    color: run.color ?? spec.color,
    bold: run.bold ?? spec.bold,
    italic: run.italic ?? spec.italic,
    // A run's own numeric weight, else the bold flag's Photoshop 700/400 — which
    // is how every document saved before the Style picker keeps rendering.
    weight: run.weight ?? ((run.bold ?? spec.bold) ? 700 : 400),
    face: run.face,
    axes: run.axes ?? {},
    fauxBold: run.fauxBold ?? false,
    fauxItalic: run.fauxItalic ?? false,
    underline: run.underline ?? false,
    strike: run.strike ?? false,
    kerning: run.kerning ?? spec.kerning ?? "metrics",
    tracking: run.tracking ?? spec.tracking,
    hScale: run.hScale ?? spec.hScale,
    vScale: run.vScale ?? spec.vScale,
    baseline: run.baseline ?? 0,
    caps: run.caps ?? "none",
    script: run.script ?? "none",
    noBreak: run.noBreak ?? false,
  };
}

/** A CSS font shorthand for a resolved style at an (already script/caps-adjusted)
 *  size. The weight is the real numeric one, so a registered Semibold (600) or
 *  Black (900) face is asked for by name instead of collapsing to bold/regular;
 *  on a variable face the browser drives its `wght` axis with it. An optional
 *  line height rides along as `size/lh` for the on-canvas editor, whose caret
 *  must measure with the very font the raster paints. */
export function cssFont(st: ResolvedStyle, sizePx: number, lineHeightPx?: number): string {
  const style = st.italic ? "italic " : "";
  const w = Number.isFinite(st.weight) ? Math.round(st.weight) : 400;
  const lh = lineHeightPx === undefined ? "" : `/${lineHeightPx}px`;
  return `${style}${Math.max(1, Math.min(1000, w))} ${sizePx}px${lh} ${renderFontFamily(st)}`;
}

export const fontFaceAlias = (face: string): string => `Monet face:${face}`;

/** CSS uses a provisioned local-face alias; vector rendering resolves the exact
 *  face name that follows it. The original family stack stays the fallback. */
export function renderFontFamily(st: Pick<ResolvedStyle, "font" | "face">): string {
  return typeof st.face === "string" && st.face.trim()
    ? `${JSON.stringify(fontFaceAlias(st.face))}, ${JSON.stringify(st.face)}, ${st.font}`
    : st.font;
}

/** A four-character OpenType axis tag (`wdth`, `opsz`, `GRAD`, …). */
const AXIS_TAG_RE = /^[A-Za-z0-9]{4}$/;

/** The CSS `font-variation-settings` value for a resolved style — the run's axis
 *  values, sorted for a stable string. `wght` is left out on purpose: cssFont already carries it as font-weight, which IS that
 *  axis, and font-variation-settings would silently outrank it. Empty string
 *  when the style sets no axes. Pure. */
export function variationSettings(st: ResolvedStyle): string {
  return Object.entries(st.axes ?? {})
    .filter(([tag, v]) => tag !== "wght" && AXIS_TAG_RE.test(tag) && Number.isFinite(v))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([tag, v]) => `"${tag}" ${v}`)
    .join(", ");
}

/** The four precomposed-substitution booleans (liga/dlig/frac/ordn) double as
 *  real OpenType tags when a font supports them — see mergedFeatures. */
const LEGACY_FEATURE_TAGS = ["liga", "dlig", "frac", "ordn"] as const;

/** Advanced OpenType feature tags exposed by Type ▸ OpenType (beyond the four
 *  legacy toggles), applied to editable type via canvas font-feature-settings. */
export const OPENTYPE_FEATURE_TAGS: string[] = [
  "calt", "swsh", "onum", "salt", "titl", "jalt",
  ...Array.from({ length: 20 }, (_, i) => `ss${String(i + 1).padStart(2, "0")}`),
];

/** The CSS `font-feature-settings` value for a run: the layer-default features
 *  (plus the four legacy booleans, folded in as their real OT tags) merged with
 *  the run's own overrides. Empty string when nothing is enabled. Pure. */
export function mergedFeatures(spec: TextSpec, run?: TextRun): string {
  const map = new Map<string, boolean>();
  for (const tag of LEGACY_FEATURE_TAGS) if (spec[tag]) map.set(tag, true);
  if (spec.features) for (const [tag, on] of Object.entries(spec.features)) map.set(tag, on);
  if (run?.features) for (const [tag, on] of Object.entries(run.features)) map.set(tag, on);
  if (map.size === 0) return "";
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([tag, on]) => `"${tag}" ${on ? 1 : 0}`)
    .join(", ");
}

// ── Type ▸ Glyphs: the browsable repertoire ──────────────────────────────
// Photoshop's Glyphs panel lists the *font's* glyphs grouped by Unicode
// category. These are the candidate codepoints per category; which of them the
// font actually draws is decided by fontCoverage() in raster.ts.
export interface GlyphCategory { id: string; label: string; ranges: [number, number][]; }

/** Ascending, whitespace-free codepoint ranges (inclusive) per category. */
export const GLYPH_CATEGORIES: GlyphCategory[] = [
  { id: "basic", label: "Basic Latin", ranges: [[0x21, 0x7e]] },
  { id: "latin", label: "Latin Extended", ranges: [[0xc0, 0x24f]] },
  { id: "punctuation", label: "Punctuation", ranges: [[0xa1, 0xbf], [0x2010, 0x2027], [0x2030, 0x205e]] },
  { id: "currency", label: "Currency", ranges: [[0x24, 0x24], [0xa2, 0xa5], [0x20a0, 0x20bf]] },
  { id: "numbers", label: "Numbers & Fractions", ranges: [[0x30, 0x39], [0xb2, 0xb3], [0xb9, 0xb9], [0x2070, 0x209c], [0x2150, 0x218b]] },
  { id: "math", label: "Math", ranges: [[0xb1, 0xb1], [0xd7, 0xd7], [0xf7, 0xf7], [0x2200, 0x22ff]] },
  { id: "arrows", label: "Arrows", ranges: [[0x2190, 0x21ff]] },
  { id: "symbols", label: "Symbols", ranges: [[0xa9, 0xa9], [0xae, 0xae], [0x2122, 0x2122], [0x2600, 0x27bf]] },
  { id: "greek", label: "Greek", ranges: [[0x370, 0x3ff]] },
  { id: "cyrillic", label: "Cyrillic", ranges: [[0x400, 0x4ff]] },
];

/** The candidate glyphs of one category, ascending and de-duplicated. Skips
 *  whitespace (nothing to look at, and it would read as an absent glyph); the
 *  unassigned holes inside a range fall out later — they paint the notdef box,
 *  which is exactly what the coverage probe filters on. Pure. */
export function categoryChars(id: string): string[] {
  const cat = GLYPH_CATEGORIES.find((c) => c.id === id);
  if (!cat) return [];
  const seen = new Set<number>();
  const out: string[] = [];
  for (const [lo, hi] of cat.ranges) {
    for (let cp = lo; cp <= hi; cp++) {
      if (seen.has(cp)) continue;
      seen.add(cp);
      const ch = String.fromCodePoint(cp);
      if (/\s/u.test(ch)) continue;
      out.push(ch);
    }
  }
  return out;
}

/** Type ▸ Glyphs: insert `ch` as its own run at the type cursor, replacing the
 *  selected range (Photoshop inserts at the caret, never at the end of the
 *  layer). `range` is the editor's [start,end) selection, clamped here; null —
 *  no open editor — appends. Optionally carries a per-glyph OpenType feature
 *  override: Photoshop's per-glyph alternates, i.e. a swash/stylistic/titling
 *  form on ONE character instead of the whole run. Pure. */
export function insertGlyph(
  spec: TextSpec,
  ch: string,
  range: readonly [number, number] | null,
  features?: Record<string, boolean>,
  style?: { font?: string },
): TextSpec {
  const prev = fullText(spec);
  const at = range ? Math.max(0, Math.min(prev.length, Math.min(range[0], range[1]))) : prev.length;
  const to = range ? Math.max(0, Math.min(prev.length, Math.max(range[0], range[1]))) : prev.length;
  const next = setText(spec, prev.slice(0, at) + ch + prev.slice(to));
  // The features patch is always applied, never omitted: setText styles inserted
  // text like the run at the caret, so a plain glyph typed right after a swash
  // would silently inherit the swash. applyRangeFormat then leaves an explicit
  // `features: undefined` behind, which would stop mergeRuns folding the run
  // back into its neighbour — drop the key again before merging.
  let runs = applyRangeFormat(next.runs, at, at + ch.length, { features })
    .map(({ features: f, ...rest }) => (f ? { ...rest, features: f } : rest));
  if (style?.font) runs = applyRangeFormat(runs, at, at + ch.length, { font: style.font });
  return { ...next, runs: mergeRuns(runs) };
}

/** Range a Glyphs alternate should replace: the character just inserted, and
 *  only while the editor caret is still collapsed on it. A selection, a
 *  different character, or no editor returns null so the insert appends. */
export function glyphReplaceRange(
  last: string | null,
  ch: string,
  selection: readonly [number, number] | null,
): [number, number] | null {
  if (!selection || !last || !ch || last !== ch || selection[0] !== selection[1]) return null;
  const caret = selection[0];
  return [Math.max(0, caret - ch.length), caret];
}

/** `insertGlyph` with no editor open: append to the end of the layer. */
export const appendGlyph = (spec: TextSpec, ch: string, features?: Record<string, boolean>): TextSpec =>
  insertGlyph(spec, ch, null, features);

export const FONTS = [
  "Inter, system-ui, sans-serif",
  "system-ui, -apple-system, sans-serif",
  "Helvetica, Arial, sans-serif",
  "Arial, sans-serif",
  "Verdana, Geneva, sans-serif",
  "'Trebuchet MS', sans-serif",
  "Georgia, serif",
  "'Times New Roman', Times, serif",
  "Palatino, 'Palatino Linotype', serif",
  "'Courier New', Courier, monospace",
  "Menlo, Monaco, monospace",
  "Impact, Haettenschweiler, sans-serif",
];
const BUILT_IN_FONT_COUNT = FONTS.length;

export const fontFamilyKey = (font: string): string =>
  font.split(",", 1)[0].replace(/^["']|["']$/g, "").trim().toLowerCase();

/** A host-reported family name as the picker stores it: control characters
 *  blanked, trimmed, capped. Every registry keyed by family (the picker's FONTS,
 *  the style registry in state/fontStyles) must key on this same name, or a
 *  family that needed cleaning lands under two keys and loses its styles. */
export const cleanFontFamily = (raw: string): string =>
  Array.from(raw, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  }).join("").trim().slice(0, 256);

/** Add native-discovered families to the existing picker in place so every
 * consumer keeps the same array reference. Returns true only when it changed. */
export function addDiscoveredFonts(families: string[]): boolean {
  const known = new Set(FONTS.map(fontFamilyKey));
  let changed = false;
  for (const raw of families) {
    const family = cleanFontFamily(raw);
    const key = fontFamilyKey(family);
    if (!family || known.has(key)) continue;
    known.add(key);
    FONTS.push(JSON.stringify(family));
    changed = true;
  }
  if (changed) {
    const discovered = FONTS
      .slice(BUILT_IN_FONT_COUNT)
      .sort((a, b) => a.localeCompare(b));
    FONTS.splice(BUILT_IN_FONT_COUNT, discovered.length, ...discovered);
  }
  return changed;
}

export const WARP_STYLES: { id: WarpStyle; label: string }[] = [
  { id: "none", label: "None" },
  { id: "arc", label: "Arc" },
  { id: "arcLower", label: "Arc Lower" },
  { id: "arcUpper", label: "Arc Upper" },
  { id: "arch", label: "Arch" },
  { id: "bulge", label: "Bulge" },
  { id: "shellLower", label: "Shell Lower" },
  { id: "shellUpper", label: "Shell Upper" },
  { id: "flag", label: "Flag" },
  { id: "wave", label: "Wave" },
  { id: "fish", label: "Fish" },
  { id: "rise", label: "Rise" },
  { id: "fisheye", label: "Fisheye" },
  { id: "inflate", label: "Inflate" },
  { id: "squeeze", label: "Squeeze" },
  { id: "twist", label: "Twist" },
];

export const ANTIALIAS: AntiAlias[] = ["none", "sharp", "crisp", "strong", "smooth", "windowslcd", "windows"];
export const ANTIALIAS_LABELS: Record<AntiAlias, string> = {
  none: "None",
  sharp: "Sharp",
  crisp: "Crisp",
  strong: "Strong",
  smooth: "Smooth",
  windowslcd: "Windows LCD",
  windows: "Windows",
};
export const KERNING: Kerning[] = ["metrics", "optical", "none"];
export const KERNING_LABELS: Record<Kerning, string> = {
  metrics: "Metrics",
  optical: "Optical",
  none: "None",
};
export const ALIGNMENTS: { id: Align; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "center", label: "Center" },
  { id: "right", label: "Right" },
  { id: "justify", label: "Justify" },
  { id: "justifyAll", label: "Justify All" },
];
export const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: "ltr", label: "LTR" },
  { id: "rtl", label: "RTL" },
];
export const COMPOSERS: { id: Composer; label: string }[] = [
  { id: "latin", label: "Latin" },
  { id: "worldReady", label: "World-Ready" },
];
export const KASHIDAS: { id: Kashida; label: string }[] = [
  { id: "none", label: "None" },
  { id: "short", label: "Short" },
  { id: "medium", label: "Medium" },
  { id: "long", label: "Long" },
  { id: "stylistic", label: "Stylistic" },
];

export function defaultSpec(text = "Monet", patch: Partial<TextSpec> = {}): TextSpec {
  return {
    v: 1,
    kind: "point",
    vertical: false,
    ax: 0,
    ay: 0,
    runs: [{ text }],
    font: FONTS[0],
    size: 64,
    color: [255, 255, 255, 255],
    bold: false,
    italic: false,
    tracking: 0,
    kerning: "metrics",
    leading: 0,
    hScale: 1,
    vScale: 1,
    align: "left",
    direction: "ltr",
    composer: "latin",
    boxW: 480,
    boxH: 0,
    firstIndent: 0,
    leftIndent: 0,
    rightIndent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    antialias: "smooth",
    kashida: "none",
    diacriticX: 0,
    diacriticY: 0,
    stroke: null,
    shadow: null,
    warp: { style: "none", bend: 0, h: 0, v: 0, orient: "h" },
    ...patch,
  };
}

/** The concatenated plain text of every run. */
export function fullText(spec: TextSpec): string {
  return spec.runs.map((r) => r.text).join("");
}

/** Stable style signature (everything except `text`) — used to coalesce runs. */
function styleKey(r: TextRun): string {
  const { text, ...rest } = r; void text;
  const keys = Object.keys(rest).sort();
  return JSON.stringify(keys.map((k) => [k, (rest as Record<string, unknown>)[k]]));
}

/** Merge adjacent runs with identical formatting; drop empties. */
export function mergeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (r.text.length === 0) continue;
    const last = out[out.length - 1];
    if (last && styleKey(last) === styleKey(r)) last.text += r.text;
    else out.push({ ...r });
  }
  return out.length ? out : [{ text: "" }];
}

/** Apply a formatting patch to the character range [start,end) (indices over the
 *  concatenated text), splitting/merging runs as needed. Pure. */
export function applyRangeFormat(
  runs: TextRun[],
  start: number,
  end: number,
  patch: Partial<TextRun>,
): TextRun[] {
  if (end <= start) return runs;
  // A family/B/I change asks for another face. Axis-only edits (the wght slider
  // sends a bare weight) keep each run's own face; named style picks supply
  // their own exact identity.
  if (!("face" in patch) && (patch.font !== undefined || patch.bold !== undefined || patch.italic !== undefined)) {
    patch = { ...patch, face: undefined };
  }
  // The legacy bold flag moves with a bare weight, as it does in stylePatch.
  if (patch.weight !== undefined && patch.bold === undefined) patch = { ...patch, bold: patch.weight >= 600 };
  const out: TextRun[] = [];
  let pos = 0;
  for (const run of runs) {
    const rs = pos;
    const re = pos + run.text.length;
    pos = re;
    if (re <= start || rs >= end) { out.push(run); continue; }
    const a = Math.max(rs, start);
    const b = Math.min(re, end);
    if (a > rs) out.push({ ...run, text: run.text.slice(0, a - rs) });
    const styled: TextRun = { ...run, ...patch,
      ...(patch.axes ? { axes: { ...run.axes, ...patch.axes } } : {}),
      text: run.text.slice(a - rs, b - rs),
    };
    // An undefined patch value clears the attribute outright: a key left holding
    // undefined reads as null in styleKey and keeps this run from merging.
    for (const [key, value] of Object.entries(patch)) if (value === undefined) delete (styled as Partial<TextRun>)[key as keyof TextRun];
    out.push(styled);
    if (b < re) out.push({ ...run, text: run.text.slice(b - rs) });
  }
  return mergeRuns(out);
}

/** Set the whole-layer text, PRESERVING per-run formatting (Photoshop keeps
 *  untouched characters styled while you type). A controlled textarea edit is
 *  always one contiguous splice: diff the common prefix/suffix against the
 *  current text, keep the runs outside the splice, and style the inserted
 *  characters like the run at the caret (the character just before the
 *  insertion point — Photoshop's caret-inherit rule). */
export function setText(spec: TextSpec, text: string): TextSpec {
  const prev = fullText(spec);
  if (text === prev) return spec;
  // Longest common prefix / suffix (non-overlapping).
  let p = 0;
  const maxP = Math.min(prev.length, text.length);
  while (p < maxP && prev[p] === text[p]) p++;
  let s = 0;
  const maxS = Math.min(prev.length - p, text.length - p);
  while (s < maxS && prev[prev.length - 1 - s] === text[text.length - 1 - s]) s++;
  const insert = text.slice(p, text.length - s); // replaces prev[p, prev.length - s)
  const delEnd = prev.length - s;

  // Style for the inserted text: the run containing the character before the
  // splice (or the first run when inserting at the very start).
  const styleAt = (idx: number): TextRun => {
    let pos = 0;
    for (const run of spec.runs) {
      const re = pos + run.text.length;
      if (idx < re) return { ...run };
      pos = re;
    }
    const last = spec.runs[spec.runs.length - 1];
    return last ? { ...last } : { text: "" };
  };
  const inherit = styleAt(Math.max(0, p - 1));

  // Walk the runs, keeping [0,p) and [delEnd,∞), injecting the insert at p.
  const out: TextRun[] = [];
  let pos = 0;
  let injected = false;
  for (const run of spec.runs) {
    const rs = pos;
    const re = pos + run.text.length;
    pos = re;
    const keepHead = Math.max(0, Math.min(re, p) - rs);
    if (keepHead > 0) out.push({ ...run, text: run.text.slice(0, keepHead) });
    if (!injected && re >= p) {
      out.push({ ...inherit, text: insert });
      injected = true;
    }
    const tailFrom = Math.max(rs, delEnd);
    if (tailFrom < re) out.push({ ...run, text: run.text.slice(tailFrom - rs) });
  }
  if (!injected) out.push({ ...inherit, text: insert });
  return { ...spec, runs: mergeRuns(out) };
}
