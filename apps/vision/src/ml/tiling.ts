// ─────────────────────────────────────────────────────────────
// tiling.ts — run a convolutional net over a document at NATIVE resolution.
//
// A net with a 256² input used to be fed the WHOLE composite squashed to 256²,
// with the 256² result blown back up: on any real photo that destroys far more
// detail than the filter removes. Instead walk the image in overlapping 256²
// windows, run the net on each at 1:1 pixel scale, and feather-blend the
// results so the seams disappear. The net still sees exactly a 256² tensor, so
// fixed-input-shape exports keep working.
//
// aiDenoise proved the pattern; Photo Restoration and Harmonize share it now
// (harmonize needs its region mask tiled alongside the image).
// ─────────────────────────────────────────────────────────────
import { throwIfCancelled } from "./mlJob";

export const TILE = 256;
export const TILE_OVERLAP = 32;

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Tile origins along one axis, clamped so the last tile stays in bounds —
 *  extra overlap at the far edge beats a partial tile. */
export function tileOrigins(extent: number, tile: number = TILE, overlap: number = TILE_OVERLAP): number[] {
  const step = Math.max(1, tile - overlap);
  const out: number[] = [];
  for (let p = 0; p < extent; p += step) out.push(Math.min(p, Math.max(0, extent - tile)));
  return [...new Set(out)];
}

export interface TileInput {
  /** planar [3,tile,tile] RGB in [0,1], edge-clamped where the window overhangs */
  img: Float32Array;
  /** planar [tile,tile] region mask in [0,1], or null when none was supplied */
  mask: Float32Array | null;
  tile: number;
  x: number;
  y: number;
  index: number;
  total: number;
}

export interface TileOptions {
  tile?: number;
  overlap?: number;
  /** full-resolution 0..255 region mask, tiled alongside the image */
  mask?: Uint8Array | null;
  onTile?: (index: number, total: number) => void;
}

/**
 * Map `run` over the image in overlapping tiles and feather-blend the results
 * into a full-resolution RGBA buffer (alpha 255). `run` receives planar CHW
 * input and returns planar [3,tile,tile] in [0,1].
 *
 * Cancellation is checked at each tile boundary, so a running job stops within
 * one tile instead of grinding through the whole image.
 */
export async function tileFilter(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  run: (input: TileInput) => Promise<Float32Array>,
  opts: TileOptions = {},
): Promise<{ rgba: Uint8ClampedArray; tiles: number }> {
  const T = opts.tile ?? TILE, ov = opts.overlap ?? TILE_OVERLAP, plane = T * T;
  const xs = tileOrigins(w, T, ov), ys = tileOrigins(h, T, ov);
  const total = xs.length * ys.length;
  // Feather weight ramps from ~0 at a tile edge to 1 by `ov` pixels in.
  const feather = (i: number, span: number) => Math.min(1, Math.min(i + 1, span - i) / (ov + 1));
  const acc = new Float32Array(w * h * 3);
  const wsum = new Float32Array(w * h);
  let done = 0;
  for (const ty of ys) for (const tx of xs) {
    throwIfCancelled();
    opts.onTile?.(++done, total);
    const tw = Math.min(T, w - tx), th = Math.min(T, h - ty);
    const img = new Float32Array(3 * plane);
    const mask = opts.mask ? new Float32Array(plane) : null;
    for (let j = 0; j < T; j++) {
      const sy = ty + Math.min(j, th - 1);
      for (let i = 0; i < T; i++) {
        const sp = sy * w + tx + Math.min(i, tw - 1), dp = j * T + i;
        img[dp] = data[sp * 4] / 255;
        img[plane + dp] = data[sp * 4 + 1] / 255;
        img[2 * plane + dp] = data[sp * 4 + 2] / 255;
        if (mask) mask[dp] = opts.mask![sp] / 255;
      }
    }
    const o = await run({ img, mask, tile: T, x: tx, y: ty, index: done, total });
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      const wgt = feather(i, tw) * feather(j, th), dp = j * T + i, op = (ty + j) * w + (tx + i);
      acc[op * 3] += clampByte(o[dp] * 255) * wgt;
      acc[op * 3 + 1] += clampByte(o[plane + dp] * 255) * wgt;
      acc[op * 3 + 2] += clampByte(o[2 * plane + dp] * 255) * wgt;
      wsum[op] += wgt;
    }
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const ws = wsum[p] || 1;
    rgba[p * 4] = acc[p * 3] / ws;
    rgba[p * 4 + 1] = acc[p * 3 + 1] / ws;
    rgba[p * 4 + 2] = acc[p * 3 + 2] / ws;
    rgba[p * 4 + 3] = 255;
  }
  return { rgba, tiles: total };
}
