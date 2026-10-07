// Color Lookup adjustment layer (engine kind 16) params (#441). A built-in look
// is `[presetId]`; a loaded .cube/.3dl rides the layer's own params as
// `[-1, N, domainMin×3, domainMax×3, N³·3 output triplets (red fastest)]` — the
// layout `pixel_adjust.rs lut3d_pixel` samples. Because adj_params already
// round-trip through MVSN, the LUT composites live, re-opens editable and
// persists with the layer without a document-level store or a format bump.
// ponytail: ~3 MB of params at the 64³ ceiling; a shared per-document LUT
// table is the upgrade if many layers reference one big cube.
import type { CubeLut } from "@monet-ui/monet-photo";

export const COLOR_LUT_MARKER = -1;
const HEADER = 8;

export function packColorLut(lut: CubeLut): Float32Array {
  const p = new Float32Array(HEADER + lut.data.length);
  p.set([COLOR_LUT_MARKER, lut.size, ...lut.domainMin, ...lut.domainMax]);
  p.set(lut.data, HEADER);
  return p;
}

/** True when kind-16 params carry a loaded LUT rather than a preset id. */
export const isColorLutParams = (p: ArrayLike<number>): boolean =>
  p.length > HEADER && p[0] === COLOR_LUT_MARKER;
