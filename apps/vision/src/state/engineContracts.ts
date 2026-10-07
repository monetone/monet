// Numeric values crossing the TypeScript ↔ Rust/WASM boundary. Keep this file
// engine-free so unit tests can pin it directly to the Rust declarations.

export const LAYER_KIND = {
  pixel: 0,
  adjustment: 1,
  text: 2,
  vector: 3,
  fill: 4,
  groupHeader: 6,
  smartObject: 7,
} as const;

export const BLEND_ORDER = [
  "normal", "dissolve", "darken", "multiply", "color-burn", "linear-burn",
  "lighten", "screen", "color-dodge", "linear-dodge", "overlay", "soft-light",
  "hard-light", "vivid-light", "linear-light", "pin-light", "hard-mix",
  "difference", "exclusion", "subtract", "divide", "hue", "saturation",
  "color", "luminosity", "pass-through", "darker-color", "lighter-color",
] as const;

export const blendIndex = (kebab: string): number =>
  Math.max(0, BLEND_ORDER.indexOf(kebab as typeof BLEND_ORDER[number]));
