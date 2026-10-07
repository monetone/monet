// ─────────────────────────────────────────────────────────────
// Gradient presets — pure named-gradient list + lookups for the Gradient tool's
// preset picker (Photoshop's Gradients panel). Each preset is a list of colour
// stops (pos 0..1, rgba 0..255) that loads into the editable ramp (store
// gradientStops); gradient_fill renders them. Engine-free so it unit-tests in node.
// ─────────────────────────────────────────────────────────────
import type { GradientKind, GradientValue } from "@monet-ui/monet-react";
import type { GradientStop } from "./store";

export interface GradientPreset {
  name: string;
  stops: GradientStop[];
}

/** Sentinel shown in the picker when the live stops match no preset. */
export const CUSTOM_GRADIENT = "Custom";

const stop = (pos: number, r: number, g: number, b: number, a = 255): GradientStop => ({ pos, r, g, b, a });

/** Named gradient presets (foreground-independent, so they are static/testable). */
export const GRADIENT_PRESETS: GradientPreset[] = [
  { name: "Black, White", stops: [stop(0, 0, 0, 0), stop(1, 255, 255, 255)] },
  { name: "White, Black", stops: [stop(0, 255, 255, 255), stop(1, 0, 0, 0)] },
  { name: "Black, Transparent", stops: [stop(0, 0, 0, 0, 255), stop(1, 0, 0, 0, 0)] },
  { name: "Spectrum", stops: [stop(0, 255, 0, 0), stop(0.17, 255, 255, 0), stop(0.33, 0, 255, 0), stop(0.5, 0, 255, 255), stop(0.67, 0, 0, 255), stop(0.83, 255, 0, 255), stop(1, 255, 0, 0)] },
  { name: "Sunset", stops: [stop(0, 255, 94, 58), stop(0.5, 255, 149, 0), stop(1, 255, 222, 89)] },
  { name: "Ocean", stops: [stop(0, 0, 79, 156), stop(0.5, 0, 160, 176), stop(1, 135, 231, 176)] },
];

/** The preset with the given name, or undefined. Searches `list` (defaults to the
 *  built-ins; the Store passes its live library so user-saved gradients resolve too). */
export function gradientByName(name: string, list: GradientPreset[] = GRADIENT_PRESETS): GradientPreset | undefined {
  return list.find((p) => p.name === name);
}

/** The preset whose stops exactly match (ordered pos+rgba), or undefined (→ Custom). */
export function gradientPresetFor(stops: GradientStop[], list: GradientPreset[] = GRADIENT_PRESETS): GradientPreset | undefined {
  return list.find((p) => stopsEqual(p.stops, stops));
}

function stopsEqual(a: GradientStop[], b: GradientStop[]): boolean {
  return a.length === b.length &&
    a.every((s, i) => s.pos === b[i].pos && s.r === b[i].r && s.g === b[i].g && s.b === b[i].b && s.a === b[i].a);
}

/** The next "Gradient N" auto-name, one past the highest existing "Gradient <int>". */
export function defaultGradientPresetName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Gradient (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Gradient ${max + 1}`;
}

/** Append a preset; a preset whose name is already present is a same-ref no-op. */
export function addGradientPresetTo(list: GradientPreset[], preset: GradientPreset): GradientPreset[] {
  if (list.some((p) => p.name === preset.name)) return list;
  return [...list, preset];
}

/** Remove the preset at index `i`; out-of-range is a same-ref no-op. */
export function removeGradientPresetAt(list: GradientPreset[], i: number): GradientPreset[] {
  if (i < 0 || i >= list.length) return list;
  return list.filter((_, j) => j !== i);
}

// ── Cross-app gradient model ─────────────────────────────────────────────────
// `GradientValue` (@monet-ui/monet-react) is the ONE gradient model every Monet
// app converts to and from. Artisan's is strictly richer — radial centre/radius,
// focal point, spread — so Vision parks what its ramp has no UI for in a
// `foreign` bag and re-emits it verbatim: a gradient dropped in from Artisan
// rides back out intact instead of surviving only as flattened artwork.

/** The parts of the shared model Vision's ramp cannot edit, kept for the trip back. */
export type GradientForeign = Partial<Pick<GradientValue, "angle" | "cx" | "cy" | "r" | "fx" | "fy" | "spread">>;

const FOREIGN_KEYS = ["angle", "cx", "cy", "r", "fx", "fy", "spread"] as const;

/** Everything in `gv` Vision cannot edit, ready to park on the store. Absent keys
 *  stay absent so an all-defaults gradient parks nothing. */
export function gradientForeignOf(gv: GradientValue): GradientForeign {
  const out: Record<string, unknown> = {};
  for (const k of FOREIGN_KEYS) if (gv[k] !== undefined) out[k] = gv[k];
  return out as GradientForeign;
}

const hex2 = (n: number): string => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, "0");

/** A ramp stop as the shared model's "#rrggbbaa" colour (what Artisan emits). */
export const stopHex = (s: GradientStop): string => `#${hex2(s.r)}${hex2(s.g)}${hex2(s.b)}${hex2(s.a)}`;

/** Parse "#rgb"/"#rgba"/"#rrggbb"/"#rrggbbaa" into a ramp stop at `pos`. Malformed
 *  components read as 0 and a missing alpha as opaque, like `hexToRgb` — a bad
 *  colour must not take the whole imported gradient down with it. */
export function stopFromHex(pos: number, hex: string): GradientStop {
  const h = hex.replace(/^#/, "");
  const s = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join("") : h;
  const byte = (i: number, dflt: number): number => {
    const v = parseInt(s.slice(i, i + 2), 16);
    return Number.isFinite(v) ? v : dflt;
  };
  return { pos, r: byte(0, 0), g: byte(2, 0), b: byte(4, 0), a: s.length >= 8 ? byte(6, 255) : 255 };
}

/** The live ramp as the shared cross-app gradient. `reverse` is baked into the
 *  stop order — the vector side has no reverse flag, so baking is what makes
 *  Artisan draw the ramp Vision was drawing. */
export function toGradientValue(
  stops: GradientStop[],
  type: GradientKind,
  reverse = false,
  foreign: GradientForeign = {},
): GradientValue {
  let ordered = stops;
  if (reverse) {
    const mirrored = stops.map((s) => ({ ...s, pos: 1 - s.pos })).reverse();
    // A midpoint describes the gap to the NEXT stop, so mirroring shifts it one
    // stop left and complements it (0.3 from the left edge is 0.7 from the right).
    ordered = mirrored.map((s, i) => ({ ...s, midpoint: mirrored[i + 1]?.midpoint == null ? undefined : 1 - mirrored[i + 1].midpoint! }));
  }
  return {
    ...foreign,
    type,
    angle: foreign.angle ?? 0,
    stops: ordered.map((s, i) => ({ id: `s${i}`, offset: s.pos, color: stopHex(s), midpoint: s.midpoint })),
  };
}

/** Parse a persisted gradient library (localStorage JSON) → the list (possibly
 *  empty), or null when the payload is missing/malformed. Validates each preset's
 *  name + stops so a corrupt store can't break boot. */
export function parseGradientPresets(json: string | null): GradientPreset[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    // An empty array is a legitimately empty library, not a corrupt payload
    // (#146) — rejecting it made "delete every preset" resurrect the built-ins
    // on the next launch, since the loader only applies a non-null parse.
    if (!Array.isArray(v)) return null;
    const okStop = (s: unknown): boolean =>
      !!s && typeof s === "object" &&
      ["pos", "r", "g", "b", "a"].every((k) => typeof (s as Record<string, unknown>)[k] === "number");
    if (!v.every((p) => p && typeof p.name === "string" && Array.isArray(p.stops) && p.stops.length > 0 && p.stops.every(okStop))) return null;
    return v as GradientPreset[];
  } catch { return null; }
}
