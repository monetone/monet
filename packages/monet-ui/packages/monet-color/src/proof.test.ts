import { describe, it, expect } from "vitest";
import { DEFAULT_GAMUT_WARNING, gamutWarningPixel, isCmykGamutWarning, proofPixel } from "./proof";

describe("proof soft-proof transforms", () => {
  it("leaves white unchanged across all modes (no ink / identity at the white point)", () => {
    const modes = ["cmyk", "cyan", "magenta", "yellow", "black", "cmy", "gamma18", "protanopia", "deuteranopia"] as const;
    for (const m of modes) {
      const [wr, wg, wb] = proofPixel(m, 255, 255, 255);
      expect(wr).toBeGreaterThan(250);
      expect(wg).toBeGreaterThan(250);
      expect(wb).toBeGreaterThan(250);
    }
  });

  it("keeps black dark in the full-colour modes", () => {
    // Plate previews are excluded: a pure-black pixel prints with the K plate
    // only, so the C/M/Y plates correctly show *no* ink (white).
    for (const m of ["cmyk", "gamma18", "protanopia", "deuteranopia", "black"] as const) {
      const [r, g, b] = proofPixel(m, 0, 0, 0);
      expect(r).toBeLessThan(6);
      expect(g).toBeLessThan(6);
      expect(b).toBeLessThan(6);
    }
  });

  it("shows no C/M/Y ink for a pure-black pixel (black is all K)", () => {
    for (const m of ["cyan", "magenta", "yellow"] as const) {
      const [r] = proofPixel(m, 0, 0, 0);
      expect(r).toBeGreaterThan(250); // white = no ink on this plate
    }
  });

  it("cyan plate renders a cyan region dark and a red region light (ink coverage)", () => {
    // Pure cyan (0,255,255) is full cyan ink → near-black on the cyan plate.
    const [cr] = proofPixel("cyan", 0, 255, 255);
    expect(cr).toBeLessThan(10);
    // Pure red (255,0,0) carries no cyan ink → white on the cyan plate.
    const [rr] = proofPixel("cyan", 255, 0, 0);
    expect(rr).toBeGreaterThan(250);
  });

  it("plate previews are grayscale (r==g==b)", () => {
    for (const m of ["cyan", "magenta", "yellow", "black"] as const) {
      const [r, g, b] = proofPixel(m, 120, 64, 200);
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
  });

  it("legacy gamma-1.8 lightens midtones", () => {
    const [r] = proofPixel("gamma18", 128, 128, 128);
    expect(r).toBeGreaterThan(128); // 0.5^(1.8/2.2) > 0.5
  });

  it("uses the host sRGB canvas for Internet Standard and Monitor RGB proofs", () => {
    const source = [17, 129, 241] as const;
    expect(proofPixel("srgb", ...source)).toEqual(source);
    expect(proofPixel("monitor", ...source)).toEqual(source);
  });

  it("CMYK soft proof darkens a midtone via dot gain", () => {
    // A mid gray gains ink → the proofed value is no lighter than the source.
    const [r] = proofPixel("cmyk", 128, 128, 128);
    expect(r).toBeLessThanOrEqual(128);
  });

  it("simulates paper color by lowering and warming the print proof white point", () => {
    const plain = proofPixel("cmyk", 255, 255, 255);
    const paper = proofPixel("cmyk", 255, 255, 255, { simulatePaperColor: true });
    expect(plain).toEqual([255, 255, 255]);
    expect(paper[0]).toBeLessThan(255);
    expect(paper[1]).toBeLessThan(255);
    expect(paper[2]).toBeLessThan(paper[0]);
  });

  it("simulates black ink by raising the printable black point without dimming paper white", () => {
    const black = proofPixel("cmyk", 0, 0, 0, { simulateBlackInk: true });
    const white = proofPixel("cmyk", 255, 255, 255, { simulateBlackInk: true });
    expect(black[0]).toBeGreaterThan(0);
    expect(black[0]).toBeLessThan(20);
    expect(white).toEqual([255, 255, 255]);
  });

  it("does not apply print paper or black-ink options to non-print proofs", () => {
    const defaultGamma = proofPixel("gamma18", 128, 128, 128);
    const printOptionsGamma = proofPixel("gamma18", 128, 128, 128, {
      simulatePaperColor: true,
      simulateBlackInk: true,
    });
    expect(printOptionsGamma).toEqual(defaultGamma);
  });

  it("OCIO ACES proof modes apply a bounded display transform", () => {
    const src = [220, 120, 45] as const;
    const acescg = proofPixel("acescg", ...src);
    const aces2065 = proofPixel("aces2065", ...src);
    expect(acescg).not.toEqual(src);
    expect(aces2065).not.toEqual(src);
    for (const v of [...acescg, ...aces2065]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it("HDR proof modes compress highlights without clipping them away", () => {
    const pq = proofPixel("hdr-pq", 245, 245, 245);
    const hlg = proofPixel("hdr-hlg", 245, 245, 245);
    expect(pq[0]).toBeGreaterThan(180);
    expect(hlg[0]).toBeGreaterThan(180);
    expect(pq).not.toEqual(hlg);
  });

  it("deuteranopia collapses red/green discrimination (red shifts toward green's response)", () => {
    const red = proofPixel("deuteranopia", 220, 30, 30);
    const green = proofPixel("deuteranopia", 30, 220, 30);
    // The two confusable hues map much closer together than they start.
    const before = Math.abs(220 - 30) + Math.abs(30 - 220);
    const after = Math.abs(red[0] - green[0]) + Math.abs(red[1] - green[1]);
    expect(after).toBeLessThan(before);
  });

  it("marks saturated RGB colours for the display-only CMYK gamut warning", () => {
    expect(isCmykGamutWarning(255, 0, 0)).toBe(true);
    expect(isCmykGamutWarning(128, 128, 128)).toBe(false);
    expect(isCmykGamutWarning(90, 120, 150)).toBe(false);
    expect(gamutWarningPixel()).toEqual([128, 128, 128]);
  });

  it("paints the gamut warning in the preferred colour at the preferred opacity", () => {
    const src = [200, 100, 0] as const;
    // Default is Photoshop's opaque medium gray, source pixel or not.
    expect(gamutWarningPixel(src)).toEqual([128, 128, 128]);
    expect(DEFAULT_GAMUT_WARNING.color).toEqual([128, 128, 128]);
    // A chosen colour at full opacity replaces the pixel outright.
    expect(gamutWarningPixel(src, { color: [255, 0, 255], opacity: 1 })).toEqual([255, 0, 255]);
    // Half opacity blends halfway between the warning colour and the pixel.
    expect(gamutWarningPixel(src, { color: [0, 0, 0], opacity: 0.5 })).toEqual([100, 50, 0]);
    // Translucent with no source pixel to blend against stays the pure colour.
    expect(gamutWarningPixel(undefined, { color: [10, 20, 30], opacity: 0.25 })).toEqual([10, 20, 30]);
    // Out-of-range preference values are clamped, never emitted as-is.
    expect(gamutWarningPixel(src, { color: [-40, 300, 12.6], opacity: 5 })).toEqual([0, 255, 13]);
    expect(gamutWarningPixel(src, { color: [255, 0, 0], opacity: Number.NaN })).toEqual([255, 0, 0]);
    // Fully transparent shows the pixel untouched.
    expect(gamutWarningPixel(src, { color: [0, 255, 0], opacity: 0 })).toEqual([200, 100, 0]);
  });
});
