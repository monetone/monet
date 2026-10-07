/* ─────────────────────────────────────────────────────────────
   Monet core — design tokens as typed values
   ─────────────────────────────────────────────────────────────
   The visual source of truth is the CSS (tokens.css / styles.css).
   This module mirrors the per-app accents and a few token references
   so TypeScript consumers (and the Rust bridge) can share one
   vocabulary. Import the stylesheet separately:

     import "@monet-ui/monet-core/index.css";
*/

/** The four per-app accent identities. The chrome itself stays neutral —
 *  accents only ever tint highlights (active indicators, sliders, focus). */
export type Accent = "raster" | "vector" | "audio" | "motion";

/** Platform chrome variants Monet knows how to draw. */
export type Platform = "mac" | "win";

/** Colour themes. Dark is the unscoped default; light is opt-in via
 *  `data-theme="light"` on the `.monet-window` (or `:root`, which cascades
 *  to every window). Only glass / stroke / highlight / text tokens and the
 *  desktop tones are redefined — accents and radii are unchanged. */
export type Theme = "dark" | "light";

/** Every theme Monet ships, in display order. */
export const THEMES: readonly Theme[] = ["dark", "light"];

/** The DOM attribute that selects a theme, and the default when absent. */
export const THEME_ATTR = "data-theme" as const;
export const DEFAULT_THEME: Theme = "dark";

/** Chrome density. `default` matches the historical fixed metrics exactly;
 *  `compact` tightens every chrome height. Opt in via `data-density="compact"`
 *  on the `.monet-window` (or `:root`). */
export type Density = "default" | "compact";

/** Every density Monet ships, in display order. */
export const DENSITIES: readonly Density[] = ["default", "compact"];

/** The DOM attribute that selects a density, and the default when absent. */
export const DENSITY_ATTR = "data-density" as const;
export const DEFAULT_DENSITY: Density = "default";

export interface AccentDef {
  /** Token name, e.g. "raster". */
  readonly name: Accent;
  /** The CSS custom property that holds it, e.g. "--accent-raster". */
  readonly cssVar: `--accent-${Accent}`;
  /** The literal oklch() value, matching tokens.css. */
  readonly value: string;
  /** Human label + the creative context it dresses. */
  readonly label: string;
  readonly context: string;
}

export const ACCENTS: Readonly<Record<Accent, AccentDef>> = {
  raster: { name: "raster", cssVar: "--accent-raster", value: "oklch(0.78 0.14 200)", label: "Raster", context: "Photo · cyan" },
  vector: { name: "vector", cssVar: "--accent-vector", value: "oklch(0.80 0.14 70)", label: "Vector", context: "Illustration · amber" },
  audio: { name: "audio", cssVar: "--accent-audio", value: "oklch(0.74 0.16 305)", label: "Audio", context: "Multitrack · violet" },
  motion: { name: "motion", cssVar: "--accent-motion", value: "oklch(0.75 0.18 350)", label: "Motion", context: "Video · magenta" },
};

export const ACCENT_NAMES: readonly Accent[] = ["raster", "vector", "audio", "motion"];

/** A `var(--accent-…)` reference for the named accent, suitable for the
 *  `--accent` custom property on `.monet-window`. */
export function accentVar(accent: Accent): string {
  return `var(${ACCENTS[accent].cssVar})`;
}

/** The literal oklch() value for the named accent. */
export function accentValue(accent: Accent): string {
  return ACCENTS[accent].value;
}

/** Resolve an accent input that may be a known name, a `var(--…)` ref, or
 *  any raw CSS color. Names resolve to their `var(--accent-…)`; anything
 *  else passes through unchanged. */
export function resolveAccent(input: Accent | (string & {})): string {
  return (input as Accent) in ACCENTS ? accentVar(input as Accent) : input;
}

/** Fixed component heights, mirroring the metrics section of the design
 *  system. Each value is the default the CSS uses; styles.css reads these
 *  through the matching custom property (see {@link METRIC_VARS}) as
 *  `var(--monet-…, <default>)`, so `[data-density="compact"]` can retune the
 *  chrome without touching any rule. */
export const METRICS = {
  titlebarMac: 48,
  titlebarWin: 36,
  tabstripWin: 42,
  menustrip: 28,
  toolbarH: 44,
  toolRailV: 48,
  toolButton: 36,
  panelTabStrip: 32,
  statusBar: 24,
} as const;

/** The CSS custom property backing each {@link METRICS} entry. Mirrors the
 *  `--monet-…` tokens defined in tokens.css / styles.css. */
export const METRIC_VARS: Readonly<Record<keyof typeof METRICS, string>> = {
  titlebarMac: "--monet-h-titlebar-mac",
  titlebarWin: "--monet-h-titlebar-win",
  tabstripWin: "--monet-h-tabstrip-win",
  menustrip: "--monet-h-menustrip",
  toolbarH: "--monet-h-toolbar",
  toolRailV: "--monet-w-tool-rail",
  toolButton: "--monet-sz-tool-button",
  panelTabStrip: "--monet-h-panel-tabstrip",
  statusBar: "--monet-h-statusbar",
} as const;

export const RADII = {
  window: 14,
  panel: 10,
  control: 7,
  pill: 999,
} as const;
