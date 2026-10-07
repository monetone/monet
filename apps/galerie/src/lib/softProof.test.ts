// GAL-DEV-15 — Develop Soft Proofing display math. The LUT bake itself is
// covered by the engine's rust tests (proof_lut_*); these prove the blit-side
// remap: gamut overlay, ink-black stretch, Paper & Ink simulation, and the
// load-boundary ICC validation.
import { describe, expect, it } from "vitest";

import { applySoftProof, sniffProofProfile } from "./softProof";

/** A 2³ proof LUT (n³·4: RGB + gamut byte, R fastest) with identity corners. */
function identityLut(): Uint8Array {
  const n = 2;
  const lut = new Uint8Array(n * n * n * 4);
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        lut.set([r * 255, g * 255, b * 255, 0], ((b * n + g) * n + r) * 4);
      }
    }
  }
  return lut;
}

const setCorner = (lut: Uint8Array, r: number, g: number, b: number, vals: number[]) =>
  lut.set(vals, ((b * 2 + g) * 2 + r) * 4);

const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255]);

describe("applySoftProof", () => {
  it("rejects a buffer that is not a packed proof lattice", () => {
    const rgba = px(1, 2, 3);
    expect(applySoftProof(rgba, new Uint8Array(5), { paperInk: false, gamutWarning: true })).toBe(false);
    expect([...rgba]).toEqual([1, 2, 3, 255]); // untouched
  });

  it("overlays out-of-gamut pixels red only when the warning is on", () => {
    const lut = identityLut();
    setCorner(lut, 0, 1, 0, [0, 255, 0, 255]); // pure green: out of gamut
    const warned = px(0, 255, 0);
    expect(applySoftProof(warned, lut, { paperInk: false, gamutWarning: true })).toBe(true);
    expect([...warned].slice(0, 3)).toEqual([255, 0, 0]); // LR's red overlay
    const unwarned = px(0, 255, 0);
    applySoftProof(unwarned, lut, { paperInk: false, gamutWarning: false });
    expect([...unwarned].slice(0, 3)).toEqual([0, 255, 0]); // proofed value shows
    const inGamut = px(255, 255, 255);
    applySoftProof(inGamut, lut, { paperInk: false, gamutWarning: true });
    expect([...inGamut].slice(0, 3)).toEqual([255, 255, 255]);
  });

  it("stretches the proof's ink black to display black by default", () => {
    const lut = identityLut();
    setCorner(lut, 0, 0, 0, [10, 10, 10, 0]); // press black renders lighter
    const black = px(0, 0, 0);
    applySoftProof(black, lut, { paperInk: false, gamutWarning: false });
    expect([...black].slice(0, 3)).toEqual([0, 0, 0]); // ink black → display black
    const white = px(255, 255, 255);
    applySoftProof(white, lut, { paperInk: false, gamutWarning: false });
    expect([...white].slice(0, 3)).toEqual([255, 255, 255]); // white held fixed
  });

  it("Simulate Paper & Ink shows the paper tint and true ink black", () => {
    const lut = identityLut();
    setCorner(lut, 0, 0, 0, [10, 10, 10, 0]);
    const white = px(255, 255, 255);
    applySoftProof(white, lut, { paperInk: true, gamutWarning: false });
    expect([...white].slice(0, 3)).toEqual([244, 241, 232]); // paper white, not display white
    const black = px(0, 0, 0);
    applySoftProof(black, lut, { paperInk: true, gamutWarning: false });
    // True press black, unstretched — scaled toward the paper tint like the
    // rest of the range (iccProofSimulationMap's paper branch).
    expect([...black].slice(0, 3)).toEqual([10, 9, 9]);
  });
});

describe("sniffProofProfile", () => {
  /** Minimal ICC header: bytes 16..20 = device colorspace, 36..40 = "acsp". */
  const fakeIcc = (space: string) => {
    const bytes = new Uint8Array(132);
    bytes.set(new TextEncoder().encode(space), 16);
    bytes.set(new TextEncoder().encode("acsp"), 36);
    return bytes;
  };

  it("accepts RGB and CMYK device profiles", () => {
    expect(sniffProofProfile("printer.icc", fakeIcc("RGB ")).space).toBe("RGB");
    expect(sniffProofProfile("press.icc", fakeIcc("CMYK")).space).toBe("CMYK");
  });

  it("refuses junk and unsupported device spaces at the load boundary", () => {
    expect(() => sniffProofProfile("junk.icc", new Uint8Array([1, 2, 3]))).toThrow(/not a usable ICC/);
    expect(() => sniffProofProfile("gray.icc", fakeIcc("GRAY"))).toThrow(/RGB or CMYK/);
  });
});
