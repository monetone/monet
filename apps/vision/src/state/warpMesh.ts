// Edit ▸ Transform ▸ Warp — build the engine mesh_warp destination grid from a
// preset envelope style. Pure & node-safe: it reuses the Text-Warp forward map
// (warpPoint) over a regular control grid; the store feeds the result to the
// engine's mesh_warp, which bilinear-interpolates the displacement and samples.
//
//   https://helpx.adobe.com/photoshop/using/warping-image.html

import { warpPoint } from "../text/warp";
import type { TextWarp } from "../text/spec";

/** Sample the warp forward map over a (gw+1)×(gh+1) control grid. `dst[idx]` is
 *  where the regular grid vertex (i*w/gw, j*h/gh) lands — the convention
 *  engine.mesh_warp expects (a destination grid; identity grid = no warp). */
export function warpGrid(
  warp: TextWarp,
  gw: number,
  gh: number,
  w: number,
  h: number,
): { dstX: Float32Array; dstY: Float32Array } {
  const n = (gw + 1) * (gh + 1);
  const dstX = new Float32Array(n);
  const dstY = new Float32Array(n);
  for (let j = 0; j <= gh; j++) {
    for (let i = 0; i <= gw; i++) {
      const [x, y] = warpPoint(warp, i / gw, j / gh, w, h);
      const idx = j * (gw + 1) + i;
      dstX[idx] = x;
      dstY[idx] = y;
    }
  }
  return { dstX, dstY };
}
