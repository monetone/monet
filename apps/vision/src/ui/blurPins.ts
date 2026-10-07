// ─────────────────────────────────────────────────────────────
// Blur Gallery pins — pure geometry for the pin-based Field / Iris /
// Tilt-Shift / Spin blur workspaces. Dialogs.tsx renders pins on the
// in-dialog document preview and drives them through these helpers.
// Coordinates are document pixels; rotation is degrees in the UI and
// radians at the engine seam (filters.rs pin records).
// ─────────────────────────────────────────────────────────────

export type PinKind = 0 | 1 | 2 | 3; // field · iris · tilt-shift · spin

export interface BlurPin {
  x: number;
  y: number;
  /** Field: per-pin blur 0..1 (other kinds keep 1). */
  amount: number;
  /** Iris/Spin: ellipse semi-axis rx px · Tilt: band half-width px. */
  focus: number;
  /** Iris: feather-ring position 0..0.95 · Tilt: ramp width px · Spin: edge ease 0..1. */
  feather: number;
  /** Degrees. Iris/Spin: ellipse rotation · Tilt: band axis angle. */
  rotation: number;
  /** Iris/Spin: roundness ry/rx. */
  aspect: number;
}

export function defaultPin(kind: PinKind, w: number, h: number, x = w / 2, y = h / 2): BlurPin {
  const base = Math.max(8, Math.min(w, h));
  return {
    x,
    y,
    amount: 1,
    rotation: 0,
    aspect: 1,
    focus: kind === 2 ? base * 0.2 : base * 0.35,
    feather: kind === 1 ? 0.5 : kind === 3 ? 0.25 : base * 0.2,
  };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Flat engine records for `gallery_blur_pins` — 7 floats per pin. */
export function flattenGalleryPins(pins: BlurPin[]): Float32Array {
  const out = new Float32Array(pins.length * 7);
  pins.forEach((p, i) =>
    out.set([p.x, p.y, p.amount, p.focus, p.feather, rad(p.rotation), p.aspect], i * 7));
  return out;
}

/** Flat engine records for `spin_blur_pins` — 6 floats per pin. */
export function flattenSpinPins(pins: BlurPin[]): Float32Array {
  const out = new Float32Array(pins.length * 6);
  pins.forEach((p, i) =>
    out.set([p.x, p.y, p.focus, p.focus * p.aspect, rad(p.rotation), p.feather], i * 6));
  return out;
}

/** Legacy centred-pin `focus` 0..1 for the pre-pin `filter_gallery_blur` ABI
 *  (the fallback when the wasm build predates the pin exports). Inverse of the
 *  wrapper mapping in filters.rs: iris rx = w·fr, tilt half-width = (h/2)·fr. */
export function legacyFocus(kind: PinKind, pin: BlurPin | undefined, w: number, h: number): number {
  if (!pin) return 0.4;
  const f = kind === 1 ? pin.focus / Math.max(1, w) : pin.focus / Math.max(1, h / 2);
  return Math.min(1, Math.max(0.05, f));
}

export type PinHit = { index: number; part: "move" | "ring" } | null;

/** Signed distance (doc px) from a pin's editable outline: the ellipse edge
 *  (iris/spin) or the nearer band edge (tilt-shift). */
export function shapeDistance(kind: PinKind, p: BlurPin, x: number, y: number): number {
  const dx = x - p.x;
  const dy = y - p.y;
  const r = rad(p.rotation);
  if (kind === 2) return Math.abs(dy * Math.cos(r) - dx * Math.sin(r)) - p.focus;
  const rx = Math.max(1e-3, p.focus);
  const ry = Math.max(1e-3, p.focus * p.aspect);
  const ex = (dx * Math.cos(r) + dy * Math.sin(r)) / rx;
  const ey = (-dx * Math.sin(r) + dy * Math.cos(r)) / ry;
  return (Math.hypot(ex, ey) - 1) * Math.min(rx, ry);
}

/** Hit-test at (x, y) doc px with tolerance `tol` doc px: pin dots first
 *  (topmost wins), then the selected pin's shape outline for resize/rotate. */
export function hitTestPins(
  pins: BlurPin[], kind: PinKind, selected: number, x: number, y: number, tol: number,
): PinHit {
  for (let i = pins.length - 1; i >= 0; i--) {
    if (Math.hypot(x - pins[i].x, y - pins[i].y) <= tol) return { index: i, part: "move" };
  }
  const sel = pins[selected];
  if (sel && kind !== 0 && Math.abs(shapeDistance(kind, sel, x, y)) <= tol) {
    return { index: selected, part: "ring" };
  }
  return null;
}

/** Ring drag: the pointer at (x, y) resets the pin's size to its distance and
 *  its rotation to its angle (tilt bands normalize to [0, 180) — a band is
 *  symmetric under a half turn). */
export function ringDrag(kind: PinKind, p: BlurPin, x: number, y: number): BlurPin {
  const dx = x - p.x;
  const dy = y - p.y;
  const focus = Math.max(4, Math.hypot(dx, dy));
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (kind === 2) return { ...p, focus, rotation: ((ang - 90) % 180 + 180) % 180 };
  return { ...p, focus, rotation: ang };
}
