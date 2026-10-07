// ─────────────────────────────────────────────────────────────
// Text warp — Photoshop's 15 envelope warp styles as a general mesh
// deformation. We define a forward map F(u,v) → (x,y) per style (u,v are
// normalized source coords), tessellate the source bitmap into a grid,
// push every grid vertex through F, then inverse-bilinear sample each
// destination quad. This handles true 2D warps (arc curvature, twist,
// fisheye) — not only vertical bows — and keeps glyph edges clean.
//
// Bend/h/v are -1..1 (Photoshop -100..100%). Horizontal/Vertical Distortion
// are a keystone (trapezoid) layered on top of the style, per Adobe's docs.
// ─────────────────────────────────────────────────────────────

import type { TextWarp, WarpStyle } from "./spec";

export interface Bitmap { w: number; h: number; data: Uint8ClampedArray; }
/** A warped bitmap plus where the source center (W/2,H/2) landed in it, so the
 *  caller can keep the text visually anchored even for asymmetric warps. */
export interface WarpResult extends Bitmap { cx: number; cy: number; }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Baseline-ribbon styles: glyphs ride a curve yb(u) and tilt to its slope,
 *  keeping constant thickness (Arc, Arch, Rise, Flag). */
function ribbon(u: number, v: number, W: number, H: number, yb: (u: number) => number): [number, number] {
  const e = 1e-3;
  const x = u * W;
  const y0 = yb(u);
  const yp = yb(Math.min(1, u + e));
  const ym = yb(Math.max(0, u - e));
  const dydx = (yp - ym) / (2 * e * W);
  const phi = Math.atan(dydx);
  const dy = (v - 0.5) * H;
  return [x + dy * -Math.sin(phi), H / 2 + y0 + dy * Math.cos(phi)];
}

const par = (u: number) => 1 - 4 * (u - 0.5) * (u - 0.5); // parabola: 1 at center, 0 at ends

/** Per-style forward map (orientation 'h'); returns destination px. */
function styleMap(style: WarpStyle, b: number, u: number, v: number, W: number, H: number): [number, number] {
  const X0 = u * W;
  const Y0 = v * H;
  switch (style) {
    case "none": return [X0, Y0];
    case "arc": return ribbon(u, v, W, H, (uu) => -b * H * 1.1 * par(uu));
    case "arch": return ribbon(u, v, W, H, (uu) => -b * H * 1.9 * par(uu));
    case "rise": return ribbon(u, v, W, H, (uu) => -b * H * 1.2 * (uu - 0.5) * 2);
    case "flag": return ribbon(u, v, W, H, (uu) => b * H * 0.5 * Math.sin(uu * Math.PI * 2));
    case "wave": {
      const yb = b * H * 0.6 * Math.sin(u * Math.PI * 2);
      const amp = 0.4 * b * Math.cos(u * Math.PI * 2);
      return [X0, H / 2 + yb + (v - 0.5) * H * (1 + amp)];
    }
    case "bulge": return [X0, H / 2 + (v - 0.5) * H * (1 + b * Math.cos((u - 0.5) * Math.PI * 2))];
    case "inflate": return [X0, H / 2 + (v - 0.5) * H * (1 + b * par(u))];
    case "squeeze": return [X0, H / 2 + (v - 0.5) * H * (1 - 0.9 * b * Math.cos((u - 0.5) * Math.PI * 2))];
    case "fish": return [X0, H / 2 + (v - 0.5) * H * (1 + b * (u - 0.5) * 2)];
    case "arcUpper": { const c = -b * H * 1.2 * par(u); return [X0, lerp(c, H, v)]; }
    case "arcLower": { const c = H - b * H * 1.2 * par(u); return [X0, lerp(0, c, v)]; }
    case "shellUpper": { const c = -b * H * (0.4 + 0.5 * Math.cos((u - 0.5) * Math.PI * 2)); return [X0, lerp(c, H, v)]; }
    case "shellLower": { const c = H + b * H * (0.4 + 0.5 * Math.cos((u - 0.5) * Math.PI * 2)); return [X0, lerp(0, c, v)]; }
    case "fisheye": {
      const dx = X0 - W / 2, dy = Y0 - H / 2;
      const rmax = Math.hypot(W / 2, H / 2) || 1;
      const f = 1 + b * (1 - Math.hypot(dx, dy) / rmax);
      return [W / 2 + dx * f, H / 2 + dy * f];
    }
    case "twist": {
      const ang = b * 1.6 * (u - 0.5);
      const dx = X0 - W / 2, dy = Y0 - H / 2;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      return [W / 2 + dx * cs - dy * sn, H / 2 + dx * sn + dy * cs];
    }
  }
  return [X0, Y0];
}

/** Full forward map including the keystone distortion (h = horizontal, v = vertical).
 *  Exported (shared with the layer Transform ▸ Warp, which feeds it to the engine mesh). */
export function warpPoint(w: TextWarp, u: number, v: number, W: number, H: number): [number, number] {
  let [x, y] = styleMap(w.style, w.bend, u, v, W, H);
  if (w.h !== 0) x = W / 2 + (x - W / 2) * (1 + w.h * (v - 0.5));
  if (w.v !== 0) y = H / 2 + (y - H / 2) * (1 + w.v * (u - 0.5));
  return [x, y];
}

type V2 = [number, number];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];

/** Inverse bilinear: parametric (s,t) of point p inside quad a(0,0) b(1,0) c(1,1) d(0,1),
 *  or null if outside. (s = along a→b, t = along a→d.) */
function invBilinear(p: V2, a: V2, b: V2, c: V2, d: V2): V2 | null {
  const e = sub(b, a);
  const f = sub(d, a);
  const g = sub(sub(a, b), sub(d, c));
  const h = sub(p, a);
  const k2 = cross(g, f);
  const k1 = cross(e, f) + cross(h, g);
  const k0 = cross(h, e);
  let s: number, t: number;
  if (Math.abs(k2) < 1e-7) {
    const den = e[0] * k1 - g[0] * k0;
    if (Math.abs(den) < 1e-12) return null;
    s = (h[0] * k1 + f[0] * k0) / den;
    t = Math.abs(k1) < 1e-12 ? -1 : -k0 / k1;
  } else {
    let disc = k1 * k1 - 4 * k0 * k2;
    if (disc < 0) return null;
    disc = Math.sqrt(disc);
    t = (-k1 - disc) / (2 * k2);
    let den = e[0] + g[0] * t;
    s = Math.abs(den) < 1e-7 ? (h[1] - f[1] * t) / (e[1] + g[1] * t) : (h[0] - f[0] * t) / den;
    if (s < -0.001 || s > 1.001 || t < -0.001 || t > 1.001) {
      t = (-k1 + disc) / (2 * k2);
      den = e[0] + g[0] * t;
      s = Math.abs(den) < 1e-7 ? (h[1] - f[1] * t) / (e[1] + g[1] * t) : (h[0] - f[0] * t) / den;
    }
  }
  if (s < -0.001 || s > 1.001 || t < -0.001 || t > 1.001) return null;
  return [s, t];
}

/** Bilinear sample of an RGBA bitmap at (x,y) in pixel space; transparent outside. */
function sample(src: Bitmap, x: number, y: number, out: number[]): void {
  if (x < 0 || y < 0 || x > src.w - 1 || y > src.h - 1) { out[0] = out[1] = out[2] = out[3] = 0; return; }
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(src.w - 1, x0 + 1), y1 = Math.min(src.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const d = src.data;
  for (let k = 0; k < 4; k++) {
    const a = d[(y0 * src.w + x0) * 4 + k], b = d[(y0 * src.w + x1) * 4 + k];
    const c = d[(y1 * src.w + x0) * 4 + k], e = d[(y1 * src.w + x1) * 4 + k];
    out[k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
  }
}

const isIdentity = (w: TextWarp) => (w.style === "none" || w.bend === 0) && w.h === 0 && w.v === 0;

/** Warp a source bitmap by the given style. Returns a new (typically larger)
 *  bitmap; the result is sized to the deformed bounding box plus a small pad. */
export function warpBitmap(src: Bitmap, warp: TextWarp): WarpResult {
  if (isIdentity(warp)) {
    return { w: src.w, h: src.h, data: new Uint8ClampedArray(src.data), cx: src.w / 2, cy: src.h / 2 };
  }

  // Vertical orientation: transpose, warp horizontally, transpose back.
  if (warp.orient === "v") {
    const t = transpose(src);
    const w = warpBitmap(t, { ...warp, orient: "h" });
    const tb = transpose(w);
    return { ...tb, cx: w.cy, cy: w.cx };
  }

  const W = src.w, H = src.h;
  const NX = Math.max(16, Math.min(160, Math.round(W / 6)));
  const NY = Math.max(6, Math.min(48, Math.round(H / 6)));

  // forward-map every grid vertex
  const verts: V2[] = new Array((NX + 1) * (NY + 1));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let j = 0; j <= NY; j++) {
    for (let i = 0; i <= NX; i++) {
      const p = warpPoint(warp, i / NX, j / NY, W, H);
      verts[j * (NX + 1) + i] = p;
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
  }
  const pad = 2;
  const outW = Math.max(1, Math.ceil(maxX - minX) + pad * 2);
  const outH = Math.max(1, Math.ceil(maxY - minY) + pad * 2);
  const data = new Uint8ClampedArray(outW * outH * 4);
  const ox = -minX + pad, oy = -minY + pad;
  const px: number[] = [0, 0, 0, 0];

  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const a = verts[j * (NX + 1) + i];
      const b = verts[j * (NX + 1) + i + 1];
      const c = verts[(j + 1) * (NX + 1) + i + 1];
      const d = verts[(j + 1) * (NX + 1) + i];
      const da: V2 = [a[0] + ox, a[1] + oy], db: V2 = [b[0] + ox, b[1] + oy];
      const dc: V2 = [c[0] + ox, c[1] + oy], dd: V2 = [d[0] + ox, d[1] + oy];
      const x0 = Math.max(0, Math.floor(Math.min(da[0], db[0], dc[0], dd[0])));
      const x1 = Math.min(outW - 1, Math.ceil(Math.max(da[0], db[0], dc[0], dd[0])));
      const y0 = Math.max(0, Math.floor(Math.min(da[1], db[1], dc[1], dd[1])));
      const y1 = Math.min(outH - 1, Math.ceil(Math.max(da[1], db[1], dc[1], dd[1])));
      // source rect for this cell
      const su0 = (i / NX) * W, su1 = ((i + 1) / NX) * W;
      const sv0 = (j / NY) * H, sv1 = ((j + 1) / NY) * H;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const st = invBilinear([x + 0.5, y + 0.5], da, db, dc, dd);
          if (!st) continue;
          const sx = lerp(su0, su1, Math.max(0, Math.min(1, st[0])));
          const sy = lerp(sv0, sv1, Math.max(0, Math.min(1, st[1])));
          sample(src, sx, sy, px);
          if (px[3] <= 0) continue;
          const di = (y * outW + x) * 4;
          if (px[3] >= data[di + 3]) { // keep the most opaque contribution at seams
            data[di] = px[0]; data[di + 1] = px[1]; data[di + 2] = px[2]; data[di + 3] = px[3];
          }
        }
      }
    }
  }
  const mc = warpPoint(warp, 0.5, 0.5, W, H);
  return { w: outW, h: outH, data, cx: mc[0] + ox, cy: mc[1] + oy };
}

function transpose(src: Bitmap): Bitmap {
  const { w, h, data } = src;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = (x * h + y) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
  }
  return { w: h, h: w, data: out };
}
