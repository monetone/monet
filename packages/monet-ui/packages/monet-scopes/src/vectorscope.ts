// Vectorscope display for the hue/saturation density grid produced by the
// SHARED engine op `Engine.vectorscope(n)` (packages/engine — Rec.709 luma →
// analog-YUV B-Y / R-Y, n×n row-major, log-normalized 0..1). The compute lives
// in the shared engine so monet-vision AND monet-artisan render an identical
// scope; this module is only the display side (colour-by-true-hue cells +
// broadcast graticule + skin-tone line).
//
// Shared here in @monet-ui/monet-scopes so monet-vision AND monet-artisan import
// the SAME display module (previously each app kept a hand-synced copy). The
// engine op they both call is the single source of truth for the data.

// Analog-YUV chroma scale factors — MUST match packages/engine vectorscope().
const U_SCALE = 0.565;
const V_SCALE = 0.713;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Map an RGB (0..1) triple to its normalized scope position (fx = column,
 *  fy = row — the same axes the engine grid uses; fy is flipped so red is up). */
export function rgbToScope(r: number, g: number, b: number): { fx: number; fy: number } {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const u = (b - y) * U_SCALE + 0.5;
  const v = (r - y) * V_SCALE + 0.5;
  return { fx: clamp01(u), fy: clamp01(1 - v) };
}

export interface ScopeTarget {
  label: string;
  fx: number;
  fy: number;
}

// Broadcast graticule: the six primary/secondary hue targets at 75% amplitude,
// so the boxes sit inside the ring (100% primaries clamp to the edge).
const TARGET_COLORS: [string, number, number, number][] = [
  ["R", 0.75, 0, 0],
  ["Yl", 0.75, 0.75, 0],
  ["G", 0, 0.75, 0],
  ["Cy", 0, 0.75, 0.75],
  ["B", 0, 0, 0.75],
  ["Mg", 0.75, 0, 0.75],
];

/** The six colour-target reference positions for the graticule. */
export function vectorscopeTargets(): ScopeTarget[] {
  return TARGET_COLORS.map(([label, r, g, b]) => ({ label, ...rgbToScope(r, g, b) }));
}

/** The flesh-tone reference line: from the neutral centre toward a typical warm
 *  skin chroma, extended to the scope edge. Endpoints in fx/fy (0..1). */
export function skinToneLine(): { cx: number; cy: number; ex: number; ey: number } {
  const { fx, fy } = rgbToScope(0.9, 0.68, 0.55); // only the hue direction matters
  const dx = fx - 0.5;
  const dy = fy - 0.5;
  const len = Math.hypot(dx, dy) || 1;
  const s = 0.5 / len; // reach the inscribed-circle edge
  return { cx: 0.5, cy: 0.5, ex: 0.5 + dx * s, ey: 0.5 + dy * s };
}

/** Hue (deg, 0..360) of a grid-cell centre, reconstructed at a fixed mid luma —
 *  the inverse of rgbToScope — so the scatter shows each cluster in its colour. */
export function cellHue(fx: number, fy: number): number {
  const bMinusY = (fx - 0.5) / U_SCALE;
  const rMinusY = (0.5 - fy) / V_SCALE; // fy = 1 - v ⇒ v - 0.5 = 0.5 - fy
  const y0 = 0.5;
  const r = clamp01(y0 + rMinusY);
  const b = clamp01(y0 + bMinusY);
  const g = clamp01((y0 - 0.2126 * r - 0.0722 * b) / 0.7152);
  return rgbHue(r, g, b);
}

function rgbHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Draw the vectorscope density grid to a square 2D context (side `size` px),
 *  round-clipped, with the graticule ring, crosshair, skin-tone line, and the
 *  six colour targets. `grid` is the engine's n×n row-major 0..1 array. */
export function drawVectorscope(
  ctx: CanvasRenderingContext2D,
  grid: Float32Array | number[],
  n: number,
  size: number,
): void {
  const R = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(R, R, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(0, 0, size, size);

  const s = size / n;
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const v = grid[gy * n + gx];
      if (!v || v <= 0.02) continue;
      const fx = (gx + 0.5) / n;
      const fy = (gy + 0.5) / n;
      const hue = cellHue(fx, fy);
      const radius = Math.hypot(fx - 0.5, fy - 0.5);
      const sat = Math.min(90, radius * 260); // desaturate the neutral centre
      ctx.fillStyle = `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, 55%, ${v.toFixed(3)})`;
      ctx.fillRect(gx * s, gy * s, s + 0.5, s + 0.5);
    }
  }

  // graticule ring + crosshair
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(R, R, R - 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(R, 0);
  ctx.lineTo(R, size);
  ctx.moveTo(0, R);
  ctx.lineTo(size, R);
  ctx.stroke();

  // skin-tone / flesh line
  const sk = skinToneLine();
  ctx.strokeStyle = "rgba(255,190,160,0.6)";
  ctx.beginPath();
  ctx.moveTo(sk.cx * size, sk.cy * size);
  ctx.lineTo(sk.ex * size, sk.ey * size);
  ctx.stroke();

  // colour targets
  ctx.font = "9px var(--font-mono, monospace)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const t of vectorscopeTargets()) {
    const x = t.fx * size;
    const y = t.fy * size;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.strokeRect(x - 3, y - 3, 6, 6);
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.fillText(t.label, x, y - 9);
  }

  ctx.restore();
}
