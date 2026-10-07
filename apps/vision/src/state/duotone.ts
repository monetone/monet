// Image ▸ Mode ▸ Duotone: a duotone document is ONE grayscale plate printed with
// 1–4 named inks (Monotone / Duotone / Tritone / Quadtone). Each ink carries a
// transfer curve — Photoshop's 13 input stops, 0% = highlight … 100% = shadow —
// giving that ink's density at every tone, which is also its press plate. The
// inks composite subtractively (each ink tints the paper, tints multiply), and
// Overprint Colors override the measured colour of an ink combination, which a
// multiply model cannot predict.
//
// The composite is handed to the engine as a gradient-map LUT (adjustment kind
// 13) over the gray plate, so the plate survives and the inks stay editable.

import { labToRgb } from "@monet-ui/monet-photo";
import { hsvToRgb } from "./vibrance";

export type Ink = [number, number, number];

/** A colour exactly as a Photoshop file stated it — its 10-byte colour
 *  structure, colour-book inks included — and the RGB Vision shows it as. A save
 *  writes the bytes back for as long as the colour is still that RGB. */
export interface DuotoneColorSpec {
  bytes: number[];
  rgb: Ink;
}

export interface DuotoneInk {
  name: string;
  color: Ink; // the ink at 100% density on white paper
  curve: number[]; // density in % at each DUOTONE_CURVE_INPUTS stop
  spec?: DuotoneColorSpec; // how a Photoshop file stated the colour, when not as RGB
  curveBytes?: number[]; // how a Photoshop file stated the curve, when not with all 13 stops
}

/** Photoshop's Duotone Curve input stops, in % of image tone
 *  (0 = highlight, 100 = shadow). */
export const DUOTONE_CURVE_INPUTS = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];

export const MAX_DUOTONE_INKS = 4; // Quadtone

/** Overprint Colors: the measured colour of an ink combination, keyed by ink
 *  index (`overprintKey([0, 1])` → `"0+1"`). Pairs and up only — a single ink's
 *  colour is the ink itself. */
export type Overprints = Record<string, Ink>;

export const overprintKey = (inks: readonly number[]): string => [...inks].sort((a, b) => a - b).join("+");

/** A document's ink specification: the inks, the overprints the user set (an
 *  unset one prints as the ink model predicts, as in Photoshop), and how a
 *  Photoshop file stated those overprints when not as RGB. */
export interface DuotoneInks {
  inks: DuotoneInk[];
  overprints: Overprints;
  overprintSpecs?: Record<string, DuotoneColorSpec>;
}

/** Every ink combination the Overprint Colors dialog lists, Photoshop's order:
 *  pairs first, then triples, then the full set. */
export function overprintCombos(count: number): number[][] {
  const all: number[][] = [];
  for (let mask = 3; mask < 1 << count; mask++) {
    const idx = [...Array(count).keys()].filter((i) => mask & (1 << i));
    if (idx.length >= 2) all.push(idx);
  }
  return all.sort((a, b) => a.length - b.length || overprintKey(a).localeCompare(overprintKey(b)));
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** A straight 0→100% ink ramp — Photoshop's default for a new ink. */
export const linearInkCurve = (): number[] => DUOTONE_CURVE_INPUTS.slice();

/** A gamma-shaped ink ramp: `g` > 1 holds the ink back into the shadows, `g` < 1
 *  pushes it into the highlights. `peak` caps the ink's maximum density. */
export function gammaInkCurve(g: number, peak = 100): number[] {
  return DUOTONE_CURVE_INPUTS.map((t) => Math.round(peak * (t / 100) ** g));
}

/** This ink's density (0..1) at `tonePct` (0 = highlight, 100 = shadow) —
 *  piecewise-linear between the curve's 13 stops, like Photoshop's editor. */
export function inkDensity(curve: readonly number[], tonePct: number): number {
  const t = clamp(tonePct, 0, 100);
  const last = DUOTONE_CURVE_INPUTS.length - 1;
  let i = 0;
  while (i < last - 1 && DUOTONE_CURVE_INPUTS[i + 1] < t) i++;
  const x0 = DUOTONE_CURVE_INPUTS[i];
  const x1 = DUOTONE_CURVE_INPUTS[i + 1];
  const f = (t - x0) / (x1 - x0);
  const y = curve[i] + (curve[i + 1] - curve[i]) * f;
  return clamp(y, 0, 100) / 100;
}

const clampInk = (c: Ink): Ink => [clamp(Math.round(c[0]), 0, 255), clamp(Math.round(c[1]), 0, 255), clamp(Math.round(c[2]), 0, 255)];
const sameInk = (a: Ink, b: Ink) => a.every((v, c) => v === b[c]);
const isInk = (c: unknown): c is Ink => Array.isArray(c) && c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
const isBytes = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every((b) => Number.isInteger(b) && b >= 0 && b <= 255);

/** A colour spec as stored data can hold it, or undefined when it is not one. */
function colorSpec(value: unknown): DuotoneColorSpec | undefined {
  const spec = value as Partial<DuotoneColorSpec> | undefined;
  if (!spec || !isInk(spec.rgb) || !isBytes(spec.bytes, 10)) return undefined;
  return { bytes: [...spec.bytes], rgb: [...spec.rgb] as Ink };
}

const normalizeCurve = (curve: readonly number[]): number[] =>
  DUOTONE_CURVE_INPUTS.map((x, j) => clamp(Math.round(curve[j] ?? x), 0, 100));

/** One ink, defaulting to Photoshop's linear transfer curve. */
export function duotoneInk(name: string, color: Ink, curve: number[] = linearInkCurve()): DuotoneInk {
  return { name, color: clampInk(color), curve };
}

/** Coerce anything ink-shaped into a usable 1–4 ink set: curves padded/trimmed to
 *  the 13 stops and clamped to 0–100%, colours to 0–255. Presets and dialog input
 *  are the only sources, but both are user data. */
export function normalizeDuotoneInks(inks: readonly DuotoneInk[]): DuotoneInk[] {
  const out = inks.slice(0, MAX_DUOTONE_INKS).map((ink, i) => {
    const spec = colorSpec(ink.spec);
    return {
      name: (ink.name || `Ink ${i + 1}`).trim() || `Ink ${i + 1}`,
      color: clampInk(ink.color ?? [0, 0, 0]),
      curve: normalizeCurve(ink.curve ?? []),
      ...(spec ? { spec } : {}),
      ...(isBytes(ink.curveBytes, ADO_CURVE_BYTES) ? { curveBytes: [...ink.curveBytes] } : {}),
    };
  });
  return out.length ? out : [duotoneInk("Black", [0, 0, 0])];
}

/** An ink specification from stored data (a project file), or null when it is
 *  not one. Overprints outside the ink set are dropped. */
export function normalizeDuotoneInkSpec(value: unknown): DuotoneInks | null {
  const raw = value as Partial<DuotoneInks> | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.inks) || !raw.inks.length) return null;
  const inks = normalizeDuotoneInks(raw.inks);
  const keys = new Set(overprintCombos(inks.length).map(overprintKey));
  const overprints: Overprints = {};
  const overprintSpecs: Record<string, DuotoneColorSpec> = {};
  for (const key of keys) {
    const color = raw.overprints?.[key];
    if (isInk(color)) overprints[key] = [...color] as Ink;
    const spec = colorSpec(raw.overprintSpecs?.[key]);
    if (spec) overprintSpecs[key] = spec;
  }
  return { inks, overprints, ...(Object.keys(overprintSpecs).length ? { overprintSpecs } : {}) };
}

/** The printed colour at `tonePct` (0 = highlight, 100 = shadow): every ink tints
 *  the paper by its density, tints multiply, then each overprint entry pulls the
 *  result toward its measured colour by the combination's joint density.
 *  ponytail: the overprint correction is an additive delta scaled by that joint
 *  density — exact where the combination prints solid and alone, an approximation
 *  where a third ink also lays down. A Neugebauer mix is the upgrade if a real
 *  press proof ever disagrees. */
export function duotoneColorAt(inks: readonly DuotoneInk[], overprints: Overprints, tonePct: number): Ink {
  const d = inks.map((ink) => inkDensity(ink.curve, tonePct));
  const rgb = [1, 1, 1];
  inks.forEach((ink, i) => {
    for (let c = 0; c < 3; c++) rgb[c] *= 1 - d[i] * (1 - ink.color[c] / 255);
  });
  for (const [key, color] of Object.entries(overprints)) {
    // (#164) Reject the whole entry when any index is out of range — filtering
    // the strays OUT let a stale "0+1+2" survive a Tritone→Duotone switch as
    // [0, 1], so the triple's measured colour was applied to the 0+1 pair.
    const idx = key.split("+").map(Number);
    if (idx.length < 2 || idx.length !== new Set(idx).size) continue;
    if (idx.some((i) => !Number.isInteger(i) || i < 0 || i >= inks.length)) continue;
    const w = idx.reduce((p, i) => p * d[i], 1);
    if (w <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const solid = idx.reduce((p, i) => p * (inks[i].color[c] / 255), 1); // the combination the multiply predicts
      rgb[c] = clamp(rgb[c] + (clamp(color[c], 0, 255) / 255 - solid) * w, 0, 1);
    }
  }
  return [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
}

/** The ink composite as the engine's gradient-map LUT (adjustment kind 13):
 *  256 normalised RGB triples indexed by plate luminance (0 = shadow). */
export function duotoneLutF32(inks: readonly DuotoneInk[], overprints: Overprints = {}): Float32Array {
  const lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const rgb = duotoneColorAt(inks, overprints, (1 - i / 255) * 100); // luminance 0 = shadow = 100% tone
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = rgb[c] / 255;
  }
  return lut;
}

/** One ink's separation plate: density (0–255) per plate luminance level. The
 *  press output of a duotone document is this, once per ink. */
export function inkPlateLut(ink: DuotoneInk): Uint8Array {
  const plate = new Uint8Array(256);
  for (let i = 0; i < 256; i++) plate[i] = Math.round(inkDensity(ink.curve, (1 - i / 255) * 100) * 255);
  return plate;
}

/** What the multiply model predicts for an ink combination printing solid — the
 *  overprint colour a document carries when none was set. */
export const solidOverprint = (inks: readonly DuotoneInk[], idx: readonly number[]): Ink =>
  [0, 1, 2].map((c) => Math.round(idx.reduce((p, i) => p * (inks[i].color[c] / 255), 1) * 255)) as unknown as Ink;

// A Photoshop Duotone file carries its inks in the colour mode data, laid out
// like a Duotone Options (.ado) file (Adobe's file format spec): version 1, the
// ink count, then always four 10-byte colours, four 64-byte Pascal names, four
// 28-byte curves (13 stops in 0.1 %, −1 = no point, then an unused override),
// the ignored dot gain and eleven overprint colours in overprintCombos order. A
// colour Photoshop leaves unset (the unused inks, an overprint it predicts
// itself) has colour space 0xFFFF.
const ADO_BYTES = 524;
const ADO_NAMES = 4 + 4 * 10;
const ADO_CURVES = ADO_NAMES + 4 * 64;
const ADO_CURVE_BYTES = 28;
const ADO_OVERPRINTS = ADO_CURVES + 4 * ADO_CURVE_BYTES + 2;
const NULL_CURVE = DUOTONE_CURVE_INPUTS.map((_, i, all) => (i === 0 ? 0 : i === all.length - 1 ? 1000 : -1));
const UNSET_SPACE = 0xffff;
/** A colour-book ink with no Alternate Duotone Colors to show it by. */
const UNKNOWN_INK: Ink = [128, 128, 128];

/** An ink's transfer curve at `at`: 13 stops in 0.1 %, where −1 leaves a stop
 *  out to be interpolated (the end points always exist), rounded to whole %. */
function readCurve(view: DataView, at: number): number[] {
  const points = DUOTONE_CURVE_INPUTS.map((_, j) => view.getInt16(at + j * 2));
  if (points[0] < 0) points[0] = 0;
  if (points[points.length - 1] < 0) points[points.length - 1] = 1000;
  const known = points.flatMap((p, j) => (p >= 0 ? [j] : []));
  return normalizeCurve(points.map((p, j) => {
    if (p >= 0) return p / 10;
    const lo = known.filter((k) => k < j).pop()!;
    const hi = known.find((k) => k > j)!;
    const t = (DUOTONE_CURVE_INPUTS[j] - DUOTONE_CURVE_INPUTS[lo]) / (DUOTONE_CURVE_INPUTS[hi] - DUOTONE_CURVE_INPUTS[lo]);
    return (points[lo] + (points[hi] - points[lo]) * t) / 10;
  }));
}

/** A curve with all 13 stops, the way Vision writes one. */
function denseCurve(curve: readonly number[]): number[] {
  const out = new DataView(new ArrayBuffer(ADO_CURVE_BYTES));
  curve.forEach((v, j) => out.setInt16(j * 2, Math.round(v * 10)));
  return [...new Uint8Array(out.buffer)];
}

/** The ink specification a Duotone Photoshop file carries. An ink or overprint
 *  whose colour came from a Photoshop file and has not changed goes back as
 *  that file stated it, and so does a curve (Photoshop's leave stops out);
 *  any other colour goes out as RGB and any other curve with all 13 stops.
 *  Names go out as ASCII (anything else becomes "?"), and an overprint no one
 *  set stays unset. */
export function encodeDuotoneSpec({ inks, overprints, overprintSpecs = {} }: DuotoneInks): Uint8Array {
  const bytes = new Uint8Array(ADO_BYTES);
  const out = new DataView(bytes.buffer);
  for (let slot = 0; slot < 4; slot++) out.setUint16(4 + slot * 10, UNSET_SPACE);
  for (let slot = 0; slot < 11; slot++) out.setUint16(ADO_OVERPRINTS + slot * 10, UNSET_SPACE);
  const color = (at: number, rgb: Ink, spec: DuotoneColorSpec | undefined) => {
    if (spec && sameInk(spec.rgb, rgb)) {
      bytes.set(spec.bytes, at);
      return;
    }
    out.setUint16(at, 0); // RGB
    rgb.forEach((v, i) => out.setUint16(at + 2 + i * 2, v * 257));
    out.setUint16(at + 8, 0);
  };
  out.setUint16(0, 1);
  out.setUint16(2, inks.length);
  inks.forEach((ink, i) => {
    color(4 + i * 10, ink.color, ink.spec);
    const name = [...ink.name].slice(0, 63).map((ch) => (ch >= " " && ch <= "~" ? ch.charCodeAt(0) : 63));
    out.setUint8(ADO_NAMES + i * 64, name.length);
    name.forEach((b, j) => out.setUint8(ADO_NAMES + i * 64 + 1 + j, b));
  });
  for (let i = 0; i < 4; i++) {
    const at = ADO_CURVES + i * ADO_CURVE_BYTES;
    const ink = inks[i];
    if (!ink) {
      NULL_CURVE.forEach((v, j) => out.setInt16(at + j * 2, v));
      continue;
    }
    const stated = ink.curveBytes && new DataView(Uint8Array.from(ink.curveBytes).buffer);
    const unchanged = stated && readCurve(stated, 0).every((v, j) => v === ink.curve[j]);
    bytes.set(unchanged ? ink.curveBytes! : denseCurve(ink.curve), at);
  }
  out.setUint16(ADO_OVERPRINTS - 2, 20); // dot gain, kept for Photoshop 2.0
  overprintCombos(inks.length).forEach((idx, i) => {
    const key = overprintKey(idx);
    if (overprints[key]) color(ADO_OVERPRINTS + i * 10, overprints[key], overprintSpecs[key]);
  });
  return bytes;
}

/** One colour structure as RGB: RGB, HSB, CMYK (0 = solid ink), Lab (L 0–10000,
 *  a/b ±12800, D50) and Gray (0–10000 of ink). Null for an unset colour and for
 *  a colour-book ink, whose book is private to Photoshop. */
function specColor(view: DataView, at: number): Ink | null {
  const v = (i: number) => view.getUint16(at + 2 + i * 2) / 65535;
  const to8 = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255);
  switch (view.getUint16(at)) {
    case 0: return [to8(v(0)), to8(v(1)), to8(v(2))];
    case 1: {
      const { r, g, b } = hsvToRgb(v(0) * 360, v(1), v(2));
      return [to8(r), to8(g), to8(b)];
    }
    case 2: return [to8(v(0) * v(3)), to8(v(1) * v(3)), to8(v(2) * v(3))];
    case 7: {
      const rgb = labToRgb(view.getUint16(at + 2) / 100, view.getInt16(at + 4) / 100, view.getInt16(at + 6) / 100);
      return rgb.map((c) => Math.round(c)) as Ink;
    }
    case 8: {
      const gray = to8(1 - view.getUint16(at + 2) / 10000);
      return [gray, gray, gray];
    }
    default: return null;
  }
}

/** A colour read from a file, with its structure kept unless it was plain RGB,
 *  which round-trips through the colour itself. */
function readColor(bytes: Uint8Array, view: DataView, at: number, fallback: Ink | null) {
  const rgb = specColor(view, at) ?? fallback;
  if (!rgb) return null;
  const spec = view.getUint16(at) === 0 ? undefined : { bytes: [...bytes.subarray(at, at + 10)], rgb };
  return { rgb, spec };
}

/** A Duotone file's inks, or null when the bytes are not a readable spec (the
 *  document then opens as the plain gray plate it is). `alternates` is the
 *  file's Alternate Duotone Colors resource (1066), which shows a colour-book
 *  ink by its Lab equivalent. Missing curve points are interpolated, and a
 *  curve stated any other way than with all 13 stops keeps its bytes. */
export function decodeDuotoneSpec(bytes: Uint8Array, alternates: Uint8Array = new Uint8Array(0)): DuotoneInks | null {
  if (bytes.length < ADO_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(2);
  if (view.getUint16(0) !== 1 || count < 1 || count > MAX_DUOTONE_INKS) return null;
  const altView = new DataView(alternates.buffer, alternates.byteOffset, alternates.byteLength);
  const alternate = (i: number) =>
    alternates.length >= 4 + (i + 1) * 10 && altView.getUint16(2) > i ? specColor(altView, 4 + i * 10) : null;
  const inks = [...Array(count).keys()].map((i): DuotoneInk => {
    const length = Math.min(63, view.getUint8(ADO_NAMES + i * 64));
    const name = String.fromCharCode(...bytes.subarray(ADO_NAMES + i * 64 + 1, ADO_NAMES + i * 64 + 1 + length));
    const at = ADO_CURVES + i * ADO_CURVE_BYTES;
    const curve = readCurve(view, at);
    const stated = [...bytes.subarray(at, at + ADO_CURVE_BYTES)];
    const dense = denseCurve(curve).every((b, j) => b === stated[j]);
    const { rgb, spec } = readColor(bytes, view, 4 + i * 10, alternate(i) ?? UNKNOWN_INK)!;
    return { ...duotoneInk(name, rgb, curve), ...(spec ? { spec } : {}), ...(dense ? {} : { curveBytes: stated }) };
  });
  const overprints: Overprints = {};
  const overprintSpecs: Record<string, DuotoneColorSpec> = {};
  overprintCombos(count).forEach((idx, i) => {
    const read = readColor(bytes, view, ADO_OVERPRINTS + i * 10, null);
    if (!read) return; // unset: printed as the inks predict
    overprints[overprintKey(idx)] = read.rgb;
    if (read.spec) overprintSpecs[overprintKey(idx)] = read.spec;
  });
  return { inks: normalizeDuotoneInks(inks), overprints, ...(Object.keys(overprintSpecs).length ? { overprintSpecs } : {}) };
}

export interface DuotonePreset {
  name: string;
  inks: DuotoneInk[];
  overprints?: Overprints;
}

/** The shipped preset library. Photoshop's is far larger and loads from `.ado`
 *  files (the layout `decodeDuotoneSpec` reads); Vision carries its own
 *  starter set.
 *  ponytail: Load/Save preset needs the file plumbing in state/app.ts — a JSON
 *  `.mvpresets` category is the natural home once this list can be edited. */
export const DUOTONE_PRESETS: DuotonePreset[] = [
  { name: "Black (Monotone)", inks: [duotoneInk("Black", [0, 0, 0])] },
  {
    name: "Sepia",
    inks: [duotoneInk("Black", [0, 0, 0], gammaInkCurve(1.4)), duotoneInk("PMS 145 Tan", [176, 122, 45], gammaInkCurve(0.7, 85))],
  },
  {
    name: "Cool Blue",
    inks: [duotoneInk("Black", [0, 0, 0], gammaInkCurve(1.5)), duotoneInk("PMS 300 Blue", [0, 94, 184], gammaInkCurve(0.8, 80))],
  },
  {
    name: "Warm Tritone",
    inks: [
      duotoneInk("Black", [0, 0, 0], gammaInkCurve(1.8)),
      duotoneInk("PMS 187 Red", [166, 25, 46], gammaInkCurve(1.2, 55)),
      duotoneInk("PMS 123 Yellow", [255, 199, 44], gammaInkCurve(0.6, 65)),
    ],
  },
  {
    name: "Neutral Quadtone",
    inks: [
      duotoneInk("Black", [0, 0, 0], gammaInkCurve(2.0)),
      duotoneInk("Warm Gray 11", [110, 98, 89], gammaInkCurve(1.3, 70)),
      duotoneInk("Warm Gray 7", [151, 141, 133], gammaInkCurve(0.9, 55)),
      duotoneInk("Warm Gray 3", [191, 184, 175], gammaInkCurve(0.6, 45)),
    ],
  },
];

/** The preset the Duotone dialog opens on for a given ink count, so switching
 *  Monotone→Quadtone always lands on a sane ink set rather than N black inks. */
export function presetForInkCount(count: number): DuotonePreset {
  return DUOTONE_PRESETS.find((p) => p.inks.length === count) ?? DUOTONE_PRESETS[0];
}
