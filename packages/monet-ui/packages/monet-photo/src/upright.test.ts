// The shared Upright solver (#444, moved from Galerie so Vision's Camera Raw uses
// the same one). Galerie's DevelopPanels.upright.test.ts keeps covering the
// forward-model recovery through its re-export; these cover what sharing added.

import { describe, expect, it } from "vitest";

import { solveGuidedUpright, solveUpright } from "./upright";

/** Dark anti-aliased horizon lines on white, tilted by `theta`. Line width and
 *  position are normalised, so every size draws the same picture. */
function tiltedHorizons(size: number, theta: number) {
  const data = new Uint8ClampedArray(size * size * 4);
  const slope = Math.tan(theta);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xn = (x + 0.5) / size;
      const yn = (y + 0.5) / size;
      let ink = 0;
      for (const c of [-0.25, 0, 0.25]) {
        const d = Math.abs(yn - (c + 0.5 + slope * (xn - 0.5))) * size;
        ink = Math.max(ink, Math.min(1, Math.max(0, (size / 160) - d + 0.5)));
      }
      const v = 255 - Math.round(220 * ink);
      data.set([v, v, v, 255], (y * size + x) * 4);
    }
  }
  return { data, width: size, height: size };
}

describe("solveUpright", () => {
  it("solves a proxy-sized preview like the 320 px one it is tuned for", () => {
    const theta = (4 * Math.PI) / 180;
    const small = solveUpright("level", tiltedHorizons(320, theta));
    const large = solveUpright("level", tiltedHorizons(1000, theta));
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(small!.rotate).toBeLessThan(-0.1); // −4°/15 ≈ −0.27
    expect(Math.abs(large!.rotate - small!.rotate)).toBeLessThan(0.05);
  });

  it("returns null when the image has no straight lines to correct", () => {
    const flat = { data: new Uint8ClampedArray(64 * 64 * 4).fill(128), width: 64, height: 64 };
    expect(solveUpright("auto", flat)).toBeNull();
  });
});

describe("solveGuidedUpright", () => {
  it("straightens from a single tilted guide", () => {
    const s = solveGuidedUpright([{ x0: 0.55, y0: 0.1, x1: 0.5, y1: 0.9 }]);
    expect(s.rotate).toBeLessThan(0);
    expect(s.vertical).toBe(0);
  });
});
