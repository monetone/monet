// ─────────────────────────────────────────────────────────────
// Perspective Warp — pure geometry for Edit ▸ Transform ▸ Perspective Warp.
// Engine-free so it unit-tests in node; app.ts feeds the result to the engine's
// general 4-corner homography (perspective_transform).
//
// Photoshop's Perspective Warp lets each of the layer's four corners move
// independently (unlike the symmetric keystone). Vision expresses the warp as a
// per-corner offset (percent of the canvas W/H) added to the identity rectangle
// corners TL, TR, BR, BL — so all-zero offsets are a no-op.
// ─────────────────────────────────────────────────────────────

/** A per-corner nudge, in percent of the canvas width/height. */
export interface WarpOffset {
  dx: number;
  dy: number;
}

/** The identity (unchanged) warp: no corner moves. Order is TL, TR, BR, BL. */
export const ZERO_WARP_OFFSETS: WarpOffset[] = [
  { dx: 0, dy: 0 },
  { dx: 0, dy: 0 },
  { dx: 0, dy: 0 },
  { dx: 0, dy: 0 },
];

// The identity rectangle corners as canvas fractions, in TL, TR, BR, BL order.
const IDENTITY_CORNERS: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** Map the four corner offsets into the flat pixel coord list
 *  [x0,y0, x1,y1, x2,y2, x3,y3] (TL, TR, BR, BL) the engine's
 *  perspective_transform expects, for a `w`×`h` canvas. */
export function perspectiveWarpCoords(offsets: WarpOffset[], w: number, h: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const o = offsets[i] ?? ZERO_WARP_OFFSETS[i];
    out.push((IDENTITY_CORNERS[i][0] + o.dx / 100) * w, (IDENTITY_CORNERS[i][1] + o.dy / 100) * h);
  }
  return out;
}

/** True when every corner offset is zero (the warp would be a no-op). */
export function isIdentityWarp(offsets: WarpOffset[]): boolean {
  return offsets.length === 4 && offsets.every((o) => o.dx === 0 && o.dy === 0);
}
