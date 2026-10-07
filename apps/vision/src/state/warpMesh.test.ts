import { describe, it, expect } from "vitest";
import { warpGrid } from "./warpMesh";
import type { TextWarp } from "../text/spec";

const W = 40, H = 40, GW = 4, GH = 4;
const warp = (style: TextWarp["style"], bend = 0): TextWarp => ({ style, bend, h: 0, v: 0, orient: "h" });

describe("warpGrid", () => {
  it("returns a (gw+1)*(gh+1) destination grid", () => {
    const { dstX, dstY } = warpGrid(warp("arc", 0.5), GW, GH, W, H);
    expect(dstX.length).toBe((GW + 1) * (GH + 1));
    expect(dstY.length).toBe((GW + 1) * (GH + 1));
  });

  it("style 'none' is the identity grid (each vertex at its regular position)", () => {
    const { dstX, dstY } = warpGrid(warp("none"), GW, GH, W, H);
    for (let j = 0; j <= GH; j++) {
      for (let i = 0; i <= GW; i++) {
        const idx = j * (GW + 1) + i;
        expect(dstX[idx]).toBeCloseTo((i * W) / GW, 4);
        expect(dstY[idx]).toBeCloseTo((j * H) / GH, 4);
      }
    }
  });

  it("bend 0 is the identity grid even for a curved style", () => {
    const { dstX, dstY } = warpGrid(warp("arc", 0), GW, GH, W, H);
    for (let j = 0; j <= GH; j++) {
      for (let i = 0; i <= GW; i++) {
        const idx = j * (GW + 1) + i;
        expect(dstX[idx]).toBeCloseTo((i * W) / GW, 3);
        expect(dstY[idx]).toBeCloseTo((j * H) / GH, 3);
      }
    }
  });

  it("an arc with positive bend bows the top-centre vertex upward", () => {
    const { dstX, dstY } = warpGrid(warp("arc", 0.5), GW, GH, W, H);
    const topCentre = 0 * (GW + 1) + GW / 2; // i=GW/2, j=0
    expect(dstY[topCentre]).toBeLessThan(0); // pushed above the canvas top (regular y was 0)
    expect(dstX[topCentre]).toBeCloseTo(W / 2, 1); // horizontally still centred
  });
});
