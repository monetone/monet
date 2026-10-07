// Pure options for the Clone Stamp / Healing Brush "Sample" dropdown. Engine-free
// so it unit-tests in node; the value is the engine clone_sample mode (0 current
// layer, 1 current & below, 2 all layers).
export const CLONE_SAMPLE_MODES = [
  { value: 0, label: "Current Layer" },
  { value: 1, label: "Current & Below" },
  { value: 2, label: "All Layers" },
] as const;

// Window ▸ Clone Source (#427): five session-only source slots. Each holds the
// document it was sampled in, so a slot keeps meaning across a tab switch, and
// its own transform (percent scale, degrees, flips).
export const CLONE_SLOT_COUNT = 5;

export type CloneSlotTransform = { w: number; h: number; angle: number; flipH: boolean; flipV: boolean };
export type CloneSlot = { source: { docId: number; x: number; y: number } | null; transform: CloneSlotTransform };

export const DEFAULT_CLONE_TRANSFORM: CloneSlotTransform = { w: 100, h: 100, angle: 0, flipH: false, flipV: false };

export const defaultCloneSlots = (): CloneSlot[] =>
  Array.from({ length: CLONE_SLOT_COUNT }, () => ({ source: null, transform: { ...DEFAULT_CLONE_TRANSFORM } }));

const RANGES = [
  ["w", "Width", 1, 1000, "%"],
  ["h", "Height", 1, 1000, "%"],
  ["angle", "Angle", -180, 180, "°"],
  ["opacity", "Overlay opacity", 0, 100, "%"],
] as const;

/** The first out-of-range field in a Clone Source edit, as the message the panel shows; null when it is valid. */
export function validateCloneOptions(patch: Partial<CloneSlotTransform & { opacity: number }>): string | null {
  for (const [key, label, min, max, unit] of RANGES) {
    const v = patch[key];
    if (v !== undefined && !(v >= min && v <= max)) return `${label} must be a number from ${min}${unit} to ${max}${unit}.`;
  }
  return null;
}

export const isIdentityCloneTransform = (t: CloneSlotTransform) =>
  t.w === 100 && t.h === 100 && t.angle === 0 && !t.flipH && !t.flipV;

/** Canvas setTransform(a, b, c, d, e, f) that draws the source image where a
 *  stroke anchored at `anchor` samples it: dest = anchor + R(angle)·scale·(s − src).
 *  The exact inverse of the engine's set_clone_transform map. */
export function cloneOverlayMatrix(
  src: { x: number; y: number },
  anchor: { x: number; y: number },
  t: CloneSlotTransform,
): [number, number, number, number, number, number] {
  const rad = (t.angle * Math.PI) / 180;
  const kx = ((t.flipH ? -1 : 1) * t.w) / 100;
  const ky = ((t.flipV ? -1 : 1) * t.h) / 100;
  const [a, b, c, d] = [Math.cos(rad) * kx, Math.sin(rad) * kx, -Math.sin(rad) * ky, Math.cos(rad) * ky];
  return [a, b, c, d, anchor.x - (a * src.x + c * src.y), anchor.y - (b * src.x + d * src.y)];
}
