import { applyH, solveHomography } from "../state/adaptiveWideAngle";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** One Vanishing Point plane: a quad TL,TR,BR,BL in document px. A torn-off
 *  plane is derived from its parent's edge (i → i+1) folded to `angle` degrees,
 *  so its quad follows the parent whenever the parent changes. */
export type VanishingPlane = { quad: number[]; parent: number | null; edge: number; angle: number };
/** A rectangle in a plane's unit square (the perspective marquee and float). */
export type VanishingRect = { plane: number; u0: number; v0: number; u1: number; v1: number };

type Pt = [number, number];
type V3 = [number, number, number];
const UNIT: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
const corners = (q: number[]): Pt[] => [0, 2, 4, 6].map((i) => [q[i], q[i + 1]]);
const handleRadius = (zoom: number) => Math.max(4, 10 / Math.max(zoom, 0.01));

export const clonePlanes = (planes: VanishingPlane[]): VanishingPlane[] => planes.map((p) => ({ ...p, quad: [...p.quad] }));

export function hitVanishingPointHandle(
  quad: number[],
  x: number,
  y: number,
  zoom: number,
): number | null {
  if (quad.length !== 8) return null;
  const radius = handleRadius(zoom);
  const r2 = radius * radius;
  let best = -1;
  let bestD2 = r2;
  for (let handle = 0; handle < 4; handle++) {
    const dx = x - quad[handle * 2];
    const dy = y - quad[handle * 2 + 1];
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      best = handle;
      bestD2 = d2;
    }
  }
  return best >= 0 ? best : null;
}

export function moveVanishingPointHandle(
  quad: number[],
  handle: number,
  x: number,
  y: number,
  docW: number,
  docH: number,
): number[] {
  const next = quad.length === 8 ? [...quad] : [0, 0, docW, 0, docW, docH, 0, docH];
  const i = clamp(Math.round(handle), 0, 3) * 2;
  next[i] = Math.round(clamp(x, 0, docW));
  next[i + 1] = Math.round(clamp(y, 0, docH));
  return next;
}

/** Unit square → the plane's image quad. Null for a degenerate quad. */
export function planeH(quad: number[]): number[] | null {
  return quad.length === 8 ? solveHomography(UNIT, corners(quad)) : null;
}

/** Image point → the plane's unit-square coordinates. */
export function uvAt(quad: number[], x: number, y: number): Pt | null {
  const h = quad.length === 8 ? solveHomography(corners(quad), UNIT) : null;
  return h ? applyH(h, [x, y]) : null;
}

const insideUnit = (uv: Pt | null) => !!uv && uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1;

/** The topmost (last) plane containing the point. */
export function planeAt(planes: VanishingPlane[], x: number, y: number): number | null {
  for (let i = planes.length - 1; i >= 0; i--) if (insideUnit(uvAt(planes[i].quad, x, y))) return i;
  return null;
}

/** The uv of a point when it lies inside `rect` on its plane. */
export function uvInRect(planes: VanishingPlane[], rect: VanishingRect | null, x: number, y: number): Pt | null {
  const uv = rect ? uvAt(planes[rect.plane]?.quad ?? [], x, y) : null;
  return uv && rect && uv[0] >= rect.u0 && uv[0] <= rect.u1 && uv[1] >= rect.v0 && uv[1] <= rect.v1 ? uv : null;
}

/** Corner handles of root planes; torn-off planes follow their parent. */
export function hitPlaneHandle(planes: VanishingPlane[], x: number, y: number, zoom: number): { plane: number; handle: number } | null {
  let best: { plane: number; handle: number } | null = null;
  let bestD2 = Infinity;
  planes.forEach((p, plane) => {
    const handle = p.parent === null ? hitVanishingPointHandle(p.quad, x, y, zoom) : null;
    if (handle === null) return;
    const d2 = (x - p.quad[handle * 2]) ** 2 + (y - p.quad[handle * 2 + 1]) ** 2;
    if (d2 <= bestD2) { best = { plane, handle }; bestD2 = d2; }
  });
  return best;
}

/** The edge (i → i+1) whose midpoint handle is under the point. */
export function hitPlaneEdge(quad: number[], x: number, y: number, zoom: number): number | null {
  if (quad.length !== 8) return null;
  const mids = [0, 1, 2, 3].flatMap((i) => {
    const j = (i + 1) % 4;
    return [(quad[i * 2] + quad[j * 2]) / 2, (quad[i * 2 + 1] + quad[j * 2 + 1]) / 2];
  });
  return hitVanishingPointHandle(mids, x, y, zoom);
}

export function movePlaneHandle(planes: VanishingPlane[], plane: number, handle: number, x: number, y: number, docW: number, docH: number): VanishingPlane[] {
  const next = clonePlanes(planes);
  if (next[plane]) next[plane].quad = moveVanishingPointHandle(next[plane].quad, handle, x, y, docW, docH);
  return resolvePlanes(next, docW, docH);
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const signedArea = (q: number[]) => [0, 1, 2, 3].reduce((s, i) => {
  const j = (i + 1) % 4;
  return s + q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1];
}, 0);

/** Fold a new plane off `parentQuad`'s edge at `angleDeg` (180 = flat
 *  continuation, 90 = perpendicular, toward the camera). The parent quad is
 *  lifted to 3D with a pinhole camera centred on the document; its focal length
 *  comes from the plane's two vanishing directions being perpendicular, or
 *  max(docW, docH) when the plane has fewer than two finite vanishing points.
 *  The shared edge is copied bit-exactly and the result keeps the parent's
 *  winding, so a float moved across planes is never mirrored. Null when the fold
 *  is degenerate or would reach behind the camera.
 *  ponytail: depth = the parent's extent, shortened so the far edge stays at
 *  least half as far from the camera as the fold; a depth handle is the upgrade. */
export function tearOffPlane(parentQuad: number[], edge: number, angleDeg: number, docW: number, docH: number): number[] | null {
  if (!Number.isFinite(angleDeg) || angleDeg <= 0 || angleDeg >= 360) return null;
  const h = planeH(parentQuad);
  if (!h) return null;
  const cx = docW / 2, cy = docH / 2;
  const col = (i: number): V3 => [h[i] - cx * h[6 + i], h[3 + i] - cy * h[6 + i], h[6 + i]];
  const c1 = col(0), c2 = col(1), c3 = col(2);
  const f2 = -(c1[0] * c2[0] + c1[1] * c2[1]) / (c1[2] * c2[2]);
  const f = Number.isFinite(f2) && f2 > 0 ? Math.sqrt(f2) : Math.max(docW, docH);
  const lift = (c: V3, s: number): V3 => [(c[0] / f) * s, (c[1] / f) * s, c[2] * s];
  const sign = c3[2] < 0 ? -1 : 1;
  const a = lift(c1, sign), b = lift(c2, sign), t = lift(c3, sign);
  const P = ([u, v]: Pt) => add(t, add(mul(a, u), mul(b, v)));
  const e = ((Math.round(edge) % 4) + 4) % 4;
  const E0 = P(UNIT[e]), E1 = P(UNIT[(e + 1) % 4]);
  const out = sub(E1, P(UNIT[(e + 2) % 4])); // in-plane, away from the opposite edge
  const along = sub(E1, E0);
  const alongLen = Math.hypot(...along);
  const n = cross(a, b);
  const nLen = Math.hypot(...n);
  if (!(alongLen > 1e-12) || !(nLen > 1e-12)) return null;
  const q = mul(along, dot(out, along) / (alongLen * alongLen));
  const p = sub(out, q);
  const pLen = Math.hypot(...p);
  if (!(pLen > 1e-12)) return null;
  const toward = mul(n, (dot(n, t) > 0 ? -1 : 1) / nLen);
  const phi = ((180 - angleDeg) * Math.PI) / 180;
  let w = add(q, add(mul(p, Math.cos(phi)), mul(toward, pLen * Math.sin(phi))));
  const nearZ = Math.min(E0[2], E1[2]);
  if (w[2] < 0) w = mul(w, Math.min(1, (0.5 * nearZ) / -w[2]));
  const project = (X: V3): Pt | null => (X[2] > 1e-9 ? [(f * X[0]) / X[2] + cx, (f * X[1]) / X[2] + cy] : null);
  const far0 = project(add(E0, w)), far1 = project(add(E1, w));
  if (!far0 || !far1 || !(nearZ > 1e-9)) return null;
  const i0 = e * 2, i1 = ((e + 1) % 4) * 2;
  let quad = [parentQuad[i0], parentQuad[i0 + 1], far0[0], far0[1], far1[0], far1[1], parentQuad[i1], parentQuad[i1 + 1]];
  if (Math.sign(signedArea(quad)) !== Math.sign(signedArea(parentQuad))) {
    quad = [quad[6], quad[7], quad[4], quad[5], quad[2], quad[3], quad[0], quad[1]];
  }
  return quad.every(Number.isFinite) && planeH(quad) ? quad : null;
}

/** Re-derive every torn-off plane from its (earlier) parent. A child whose fold
 *  no longer resolves keeps its previous quad. */
export function resolvePlanes(planes: VanishingPlane[], docW: number, docH: number): VanishingPlane[] {
  const next = clonePlanes(planes);
  for (const p of next) {
    const parent = p.parent === null ? null : next[p.parent];
    const quad = parent ? tearOffPlane(parent.quad, p.edge, p.angle, docW, docH) : null;
    if (quad) p.quad = quad;
  }
  return next;
}

/** A plane-space rectangle as an image-space quad TL,TR,BR,BL. */
export function uvRectQuad(quad: number[], r: VanishingRect): number[] | null {
  const h = planeH(quad);
  if (!h) return null;
  const out = ([[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]] as Pt[]).flatMap((uv) => applyH(h, uv));
  return out.every(Number.isFinite) ? out : null;
}

/** Move a rectangle within its plane's unit square without resizing it. */
export function shiftRect(r: VanishingRect, du: number, dv: number): VanishingRect {
  const w = r.u1 - r.u0, h = r.v1 - r.v0;
  const u0 = clamp(r.u0 + du, 0, 1 - w), v0 = clamp(r.v0 + dv, 0, 1 - h);
  return { plane: r.plane, u0, v0, u1: u0 + w, v1: v0 + h };
}

/** A pasted image's starting rectangle: roughly its pixel size on the plane,
 *  scaled down to fit, centred, aspect kept. */
export function fitFloatRect(quad: number[], iw: number, ih: number, plane: number): VanishingRect {
  const c = corners(quad);
  const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const pw = (dist(c[0], c[1]) + dist(c[3], c[2])) / 2 || 1;
  const ph = (dist(c[0], c[3]) + dist(c[1], c[2])) / 2 || 1;
  const s = Math.max(iw / pw, ih / ph, 1);
  const du = iw / pw / s, dv = ih / ph / s;
  return { plane, u0: (1 - du) / 2, v0: (1 - dv) / 2, u1: (1 + du) / 2, v1: (1 + dv) / 2 };
}

/** Warp `src` (sw×sh RGBA) from `srcQuad` onto `dstQuad`, covering the
 *  destination's bounding box clipped to the document; alpha is 0 outside the
 *  destination quad. Null when nothing lands on the canvas.
 *  ponytail: JS bilinear warp per float change; move to a CSS matrix3d preview
 *  or a Rust warp if large floats lag. */
export function warpQuadToQuad(
  src: ArrayLike<number>, sw: number, sh: number,
  srcQuad: number[], dstQuad: number[], docW: number, docH: number,
): { x: number; y: number; w: number; h: number; rgba: Uint8Array } | null {
  const toUv = dstQuad.length === 8 ? solveHomography(corners(dstQuad), UNIT) : null;
  const toSrc = planeH(srcQuad);
  if (!toUv || !toSrc || sw <= 0 || sh <= 0 || src.length < sw * sh * 4) return null;
  const xs = [0, 2, 4, 6].map((i) => dstQuad[i]), ys = [1, 3, 5, 7].map((i) => dstQuad[i]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(docW, Math.ceil(Math.max(...xs))), y1 = Math.min(docH, Math.ceil(Math.max(...ys)));
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0 && h > 0)) return null;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const uv = applyH(toUv, [x0 + x + 0.5, y0 + y + 0.5]);
      if (!insideUnit(uv)) continue;
      const [sx, sy] = applyH(toSrc, uv);
      const fx = clamp(sx - 0.5, 0, sw - 1), fy = clamp(sy - 0.5, 0, sh - 1);
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const ax = fx - ix, ay = fy - iy;
      const ix1 = Math.min(sw - 1, ix + 1), iy1 = Math.min(sh - 1, iy + 1);
      const r0 = iy * sw, r1 = iy1 * sw, o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[(r0 + ix) * 4 + c] * (1 - ax) + src[(r0 + ix1) * 4 + c] * ax;
        const bottom = src[(r1 + ix) * 4 + c] * (1 - ax) + src[(r1 + ix1) * 4 + c] * ax;
        rgba[o + c] = Math.round(top * (1 - ay) + bottom * ay);
      }
    }
  }
  return { x: x0, y: y0, w, h, rgba };
}
