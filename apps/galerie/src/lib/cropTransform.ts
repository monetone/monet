// cropTransform — apply a develop recipe's crop rect + straighten angle to a
// rendered RGBA buffer. Pure geometry (bilinear resample), no engine/canvas, so
// every render site (loupe, export, print) can share ONE deterministic crop and
// stay pixel-consistent. Masks are folded upstream in full-image space, so crop
// is a final viewport step here.
//
// ponytail: straighten rotates the source content about its centre under a fixed
// crop rect (a defensible model, not pixel-exact to Adobe's straightened-frame
// crop); EXIF `orientation` is already applied by the engine at decode, so only
// rect + angle matter here. Out-of-frame samples clamp to the edge.

import type { CropRect } from "@monet-ui/monet-photo";

export interface CropSpec {
  rect: CropRect;
  /** Straighten angle in degrees. */
  angle: number;
}

export interface CropImage {
  /** RGBA8; accepts either array kind (engine renders yield Uint8Array). */
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** applyCrop's result — always a fresh clamped buffer (safe for putImageData). */
export interface CroppedImage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The default full-frame, un-straightened crop — a no-op. */
export function isIdentityCrop(c: CropSpec): boolean {
  const r = c.rect;
  return c.angle === 0 && r.left === 0 && r.top === 0 && r.right === 1 && r.bottom === 1;
}

/** Bilinear RGBA sample at fractional (fx, fy), clamped to the image edge. */
function sample(src: ArrayLike<number>, W: number, H: number, fx: number, fy: number, out: Uint8ClampedArray, o: number): void {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const cx0 = x0 < 0 ? 0 : x0 >= W ? W - 1 : x0;
  const cy0 = y0 < 0 ? 0 : y0 >= H ? H - 1 : y0;
  const cx1 = x0 + 1 < 0 ? 0 : x0 + 1 >= W ? W - 1 : x0 + 1;
  const cy1 = y0 + 1 < 0 ? 0 : y0 + 1 >= H ? H - 1 : y0 + 1;
  for (let c = 0; c < 4; c++) {
    const a = src[(cy0 * W + cx0) * 4 + c];
    const b = src[(cy0 * W + cx1) * 4 + c];
    const d = src[(cy1 * W + cx0) * 4 + c];
    const e = src[(cy1 * W + cx1) * 4 + c];
    const top = a + (b - a) * tx;
    const bot = d + (e - d) * tx;
    out[o + c] = Math.round(top + (bot - top) * ty);
  }
}

/** Apply `crop` to a rendered image, returning a new (possibly smaller) RGBA.
 *  An identity/absent crop returns a copy of the input unchanged. */
export function applyCrop(img: CropImage, crop: CropSpec | null | undefined): CroppedImage {
  if (!crop || isIdentityCrop(crop)) {
    return { rgba: new Uint8ClampedArray(img.rgba), width: img.width, height: img.height };
  }
  const W = img.width;
  const H = img.height;
  const left = clamp01(crop.rect.left);
  const top = clamp01(crop.rect.top);
  const right = clamp01(crop.rect.right);
  const bottom = clamp01(crop.rect.bottom);
  const rx0 = left * W;
  const ry0 = top * H;
  const rw = Math.max(1, (right - left) * W);
  const rh = Math.max(1, (bottom - top) * H);
  const outW = Math.max(1, Math.round(rw));
  const outH = Math.max(1, Math.round(rh));

  const rad = (-crop.angle * Math.PI) / 180; // inverse rotation (source → straightened)
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = W / 2;
  const cy = H / 2;
  const sx = rw / outW;
  const sy = rh / outH;

  const out = new Uint8ClampedArray(outW * outH * 4);
  const src = img.rgba;
  for (let oy = 0; oy < outH; oy++) {
    const py = ry0 + (oy + 0.5) * sy;
    for (let ox = 0; ox < outW; ox++) {
      const px = rx0 + (ox + 0.5) * sx;
      // inverse-rotate the sample point about the image centre (straighten)
      const dx = px - cx;
      const dy = py - cy;
      const rxp = cx + dx * cos - dy * sin;
      const ryp = cy + dx * sin + dy * cos;
      sample(src, W, H, rxp - 0.5, ryp - 0.5, out, (oy * outW + ox) * 4);
    }
  }
  return { rgba: out, width: outW, height: outH };
}
