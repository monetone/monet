import { describe, it, expect } from "vitest";
import { matteComposite } from "./matteComposite";

const px = (r: number, g: number, b: number) => [r, g, b, 255];

describe("matteComposite", () => {
  it("keeps fg where the matte is opaque and bg where it's transparent", () => {
    // 2×1: pixel 0 = subject (matte 255 → keep fg), pixel 1 = background (matte 0 → use bg)
    const fg = new Uint8ClampedArray([...px(200, 10, 10), ...px(200, 10, 10)]);
    const bg = new Uint8ClampedArray([...px(0, 0, 250), ...px(0, 0, 250)]);
    const matte = new Uint8Array([255, 0]);
    const out = matteComposite(fg, bg, matte, 2, 1);
    expect([...out.slice(0, 4)]).toEqual(px(200, 10, 10)); // subject kept
    expect([...out.slice(4, 8)]).toEqual(px(0, 0, 250)); // background replaced
  });

  it("feathers a mid matte value halfway between fg and bg", () => {
    const fg = new Uint8ClampedArray(px(100, 100, 100));
    const bg = new Uint8ClampedArray(px(200, 200, 200));
    const out = matteComposite(fg, bg, new Uint8Array([128]), 1, 1);
    // a = 128/255 ≈ 0.502 → 100*0.502 + 200*0.498 ≈ 149–150
    expect(out[0]).toBeGreaterThanOrEqual(149);
    expect(out[0]).toBeLessThanOrEqual(151);
    expect(out[3]).toBe(255);
  });
});
