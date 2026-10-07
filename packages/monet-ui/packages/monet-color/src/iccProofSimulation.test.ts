import { describe, expect, it } from "vitest";
import { iccProofSimulationMap } from "./proof";

// Apply the affine remap the blit path performs on an ICC LUT sample.
function apply(map: { scale: number[]; offset: number[] }, v: [number, number, number]) {
  return v.map((c, i) => Math.min(255, Math.max(0, Math.round(c * map.scale[i] + map.offset[i]))));
}

// A plausible FOGRA-ish press black rendition (relative colorimetric, no BPC).
const INK_BLACK: [number, number, number] = [29, 28, 26];

describe("iccProofSimulationMap (Simulate Paper Color / Black Ink over the real ICC proof)", () => {
  it("with neither option, stretches the proof's ink black to display black and holds white", () => {
    const map = iccProofSimulationMap(INK_BLACK);
    expect(map).not.toBeNull();
    expect(apply(map!, INK_BLACK)).toEqual([0, 0, 0]);
    expect(apply(map!, [255, 255, 255])).toEqual([255, 255, 255]);
    // Midtones move monotonically, never past the anchors.
    const mid = apply(map!, [128, 128, 128]);
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[0]).toBeLessThan(255);
  });

  it("the black stretch is profile-derived: a lighter ink black stretches harder", () => {
    const soft = iccProofSimulationMap([60, 60, 60])!;
    const hard = iccProofSimulationMap(INK_BLACK)!;
    expect(soft.scale[0]).toBeGreaterThan(hard.scale[0]);
    expect(apply(soft, [60, 60, 60])).toEqual([0, 0, 0]);
  });

  it("Simulate Black Ink shows the LUT's true ink black (identity remap)", () => {
    expect(iccProofSimulationMap(INK_BLACK, { simulateBlackInk: true })).toBeNull();
  });

  it("Simulate Paper Color lowers and warms the white point and implies black ink", () => {
    const map = iccProofSimulationMap(INK_BLACK, { simulatePaperColor: true });
    expect(map).not.toBeNull();
    const white = apply(map!, [255, 255, 255]);
    expect(white[0]).toBeLessThan(255);
    expect(white[2]).toBeLessThan(white[0]); // warm tint: blue drops most
    // Implies Black Ink (Photoshop pairing): the ink black is kept, not
    // stretched to display black.
    const black = apply(map!, INK_BLACK);
    expect(black[0]).toBeGreaterThan(0);
    // paper alongside an explicit black-ink flag behaves the same
    expect(iccProofSimulationMap(INK_BLACK, { simulatePaperColor: true, simulateBlackInk: true })).toEqual(map);
  });

  it("is an identity when the proof already renders black at display black", () => {
    expect(iccProofSimulationMap([0, 0, 0])).toBeNull();
  });
});
