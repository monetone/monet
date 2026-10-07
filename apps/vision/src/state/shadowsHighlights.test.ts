// Unit tests for the Shadows/Highlights adjustment. Engine-free (node). These pin the
// luminance-driven influences and delta (must match adjust.rs shadows_highlights:
// sh_inf = clamp01(1−l/sw), hi_inf = clamp01(1−(1−l)/hw), widths clamped to [0.01,1],
// delta = sa·sh_inf·(1−l) − ha·hi_inf·l, same delta added to every channel) and the
// defining behaviours: shadows lift the dark end, highlights pull the bright end,
// midtones outside both bands are untouched, and colour (channel ratios) is preserved.
// The engine's other two params — Color (chroma scale) and Midtone (S-curve), which the
// dialog passes and seeds Color at 20 — are covered here too (#147/#135).
import { describe, it, expect } from "vitest";
import {
  applyShadowsHighlights,
  shadowsHighlightsArgs,
  defaultShadowsHighlights,
  clampWidth,
  clampMidtone,
  midtoneCurve,
  colorScale,
  shadowInfluence,
  highlightInfluence,
  toneDelta,
  luminance,
  WIDTH_CLAMP_MIN,
  WIDTH_CLAMP_MAX,
  MIDTONE_CLAMP,
  type ShadowsHighlightsState,
} from "./shadowsHighlights";

const sh = (
  shadowsAmount: number,
  shadowsWidth: number,
  highlightsAmount: number,
  highlightsWidth: number,
  color = 0,
  midtone = 0,
): ShadowsHighlightsState => ({ shadowsAmount, shadowsWidth, highlightsAmount, highlightsWidth, color, midtone });

describe("shadowsHighlightsArgs / defaults", () => {
  // Six args, exactly as Dialogs.tsx calls adj.shadowsHighlights (#135): the four tone
  // sliders and Color ÷ 100, Midtone ÷ 200 (the engine clamps that to ±0.5).
  it("divides the tone sliders and Color by 100 and Midtone by 200, in engine order", () => {
    expect(shadowsHighlightsArgs(sh(50, 40, 30, 20))).toEqual([0.5, 0.4, 0.3, 0.2, 0, 0]);
    expect(shadowsHighlightsArgs(sh(50, 40, 30, 20, 20, 100))).toEqual([0.5, 0.4, 0.3, 0.2, 0.2, 0.5]);
    expect(shadowsHighlightsArgs(sh(0, 0, 0, 0, -100, -100))).toEqual([0, 0, 0, 0, -1, -0.5]);
  });

  it("an omitted Color/Midtone reads as 0 (never NaN)", () => {
    const partial = { shadowsAmount: 10, shadowsWidth: 20, highlightsAmount: 0, highlightsWidth: 0 };
    expect(shadowsHighlightsArgs(partial)).toEqual([0.1, 0.2, 0, 0, 0, 0]);
  });

  it("the default state is a no-op (all sliders 0)", () => {
    expect(defaultShadowsHighlights()).toEqual(sh(0, 0, 0, 0));
    expect(shadowsHighlightsArgs(defaultShadowsHighlights())).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("clampMidtone / midtoneCurve", () => {
  it("clamps midtone to the engine's ±0.5 (beyond it the curve stops being monotone)", () => {
    expect(clampMidtone(0)).toBe(0);
    expect(clampMidtone(0.25)).toBe(0.25);
    expect(clampMidtone(2)).toBe(MIDTONE_CLAMP);
    expect(clampMidtone(-2)).toBe(-MIDTONE_CLAMP);
  });

  it("is the identity at midtone 0 and pins 0 / 0.5 / 1 at any strength", () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) expect(midtoneCurve(v, 0)).toBe(v);
    for (const mt of [-0.5, -0.2, 0.2, 0.5]) {
      for (const v of [0, 0.5, 1]) expect(midtoneCurve(v, mt)).toBeCloseTo(v, 12);
    }
  });

  it("positive midtone steepens (darkens below 0.5, brightens above); negative flattens", () => {
    expect(midtoneCurve(0.25, 0.5)).toBeLessThan(0.25);
    expect(midtoneCurve(0.75, 0.5)).toBeGreaterThan(0.75);
    expect(midtoneCurve(0.25, -0.5)).toBeGreaterThan(0.25);
    expect(midtoneCurve(0.75, -0.5)).toBeLessThan(0.75);
    // the engine's exact formula: v + mt·t·(0.25 − t²)·4, t = v − 0.5
    expect(midtoneCurve(0.25, 0.5)).toBeCloseTo(0.25 + 0.5 * -0.25 * (0.25 - 0.0625) * 4, 12);
  });

  it("stays in [0,1] and is monotone across the ramp at full strength", () => {
    let prev = -Infinity;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const out = midtoneCurve(Math.min(v, 1), MIDTONE_CLAMP);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
      expect(out).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = out;
    }
  });
});

describe("colorScale", () => {
  const grey = { r: 0.5, g: 0.5, b: 0.5 };
  const warm = { r: 0.6, g: 0.4, b: 0.3 };

  it("is a same-value no-op at color 0 (the engine skips the branch)", () => {
    expect(colorScale(warm, 0, 1)).toEqual(warm);
  });

  it("does nothing where the correction did not reach (influence 0)", () => {
    expect(colorScale(warm, 1, 0)).toEqual(warm);
  });

  it("scales chroma about the pixel's own luma, leaving that luma fixed", () => {
    const out = colorScale(warm, 0.2, 1);
    const nl = luminance(warm.r, warm.g, warm.b);
    expect(luminance(out.r, out.g, out.b)).toBeCloseTo(nl, 9);
    expect(out.r - nl).toBeCloseTo((warm.r - nl) * 1.2, 9); // satmul = 1 + 0.2·1
    expect(out.b - nl).toBeCloseTo((warm.b - nl) * 1.2, 9);
  });

  it("a negative Color desaturates, and a neutral pixel has no chroma to scale", () => {
    const out = colorScale(warm, -1, 1);
    const nl = luminance(warm.r, warm.g, warm.b);
    expect(out.r).toBeCloseTo(nl, 9); // satmul = 0 → fully grey
    expect(colorScale(grey, 1, 1).r).toBeCloseTo(0.5, 9);
  });

  it("clamps to [0,1] at extreme saturation", () => {
    const out = colorScale({ r: 1, g: 0, b: 0 }, 1, 1);
    for (const c of [out.r, out.g, out.b]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe("luminance", () => {
  it("is the Rec.601 weighted sum", () => {
    expect(luminance(1, 1, 1)).toBeCloseTo(1, 9);
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(1, 0, 0)).toBeCloseTo(0.299, 9);
    expect(luminance(0, 1, 0)).toBeCloseTo(0.587, 9);
    expect(luminance(0, 0, 1)).toBeCloseTo(0.114, 9);
  });
});

describe("clampWidth", () => {
  it("clamps a 0..1 width into the engine's [0.01, 1] range", () => {
    expect(clampWidth(0)).toBe(WIDTH_CLAMP_MIN); // 0 → 0.01 (no divide-by-zero)
    expect(clampWidth(0.005)).toBe(WIDTH_CLAMP_MIN);
    expect(clampWidth(0.5)).toBe(0.5);
    expect(clampWidth(1)).toBe(WIDTH_CLAMP_MAX);
    expect(clampWidth(2)).toBe(WIDTH_CLAMP_MAX); // > 1 → 1
  });
});

describe("shadowInfluence", () => {
  it("is 1 at black and ramps linearly to 0 at l = width", () => {
    expect(shadowInfluence(0, 0.5)).toBe(1);
    expect(shadowInfluence(0.25, 0.5)).toBeCloseTo(0.5, 9); // 1 − 0.25/0.5
    expect(shadowInfluence(0.5, 0.5)).toBe(0);
  });

  it("clamps to 0 above the width boundary", () => {
    expect(shadowInfluence(0.75, 0.5)).toBe(0);
    expect(shadowInfluence(1, 0.5)).toBe(0);
  });

  it("a 0 width is widened to 0.01 (still reaches 0 just above black)", () => {
    expect(shadowInfluence(0, 0)).toBe(1);
    expect(shadowInfluence(0.01, 0)).toBe(0); // l = clampWidth(0) = 0.01
  });

  it("is monotonically non-increasing in luminance", () => {
    let prev = Infinity;
    for (let l = 0; l <= 1.0001; l += 0.05) {
      const v = shadowInfluence(l, 0.6);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });
});

describe("highlightInfluence", () => {
  it("is 1 at white and ramps linearly to 0 at l = 1 − width", () => {
    expect(highlightInfluence(1, 0.5)).toBe(1);
    expect(highlightInfluence(0.75, 0.5)).toBeCloseTo(0.5, 9); // 1 − 0.25/0.5
    expect(highlightInfluence(0.5, 0.5)).toBe(0);
  });

  it("clamps to 0 below the width boundary", () => {
    expect(highlightInfluence(0.25, 0.5)).toBe(0);
    expect(highlightInfluence(0, 0.5)).toBe(0);
  });

  it("a 0 width is widened to 0.01 (still reaches 0 just below white)", () => {
    expect(highlightInfluence(1, 0)).toBe(1);
    expect(highlightInfluence(0.99, 0)).toBe(0); // l = 1 − clampWidth(0) = 0.99
  });

  it("is monotonically non-decreasing in luminance", () => {
    let prev = -Infinity;
    for (let l = 0; l <= 1.0001; l += 0.05) {
      const v = highlightInfluence(l, 0.6);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });
});

describe("toneDelta", () => {
  it("is 0 when both amounts are 0 (identity)", () => {
    for (const l of [0, 0.25, 0.5, 0.75, 1]) expect(toneDelta(l, 0, 0.5, 0, 0.5)).toBe(0);
  });

  it("at black, the delta is the full shadow amount (highlight term vanishes via ·l)", () => {
    expect(toneDelta(0, 0.5, 0.5, 0.3, 0.5)).toBeCloseTo(0.5, 9); // 0.5·1·1 − 0.3·hi·0
  });

  it("at white, the delta is minus the full highlight amount (shadow term vanishes via ·(1−l))", () => {
    expect(toneDelta(1, 0.5, 0.5, 0.3, 0.5)).toBeCloseTo(-0.3, 9); // 0.5·sh·0 − 0.3·1·1
  });

  it("a midtone outside both tonal bands is untouched", () => {
    expect(toneDelta(0.5, 0.8, 0.5, 0.8, 0.5)).toBe(0); // sh_inf(0.5,0.5)=0, hi_inf(0.5,0.5)=0
  });

  it("shadow lift is positive (brightens) and highlight recovery is negative (darkens)", () => {
    expect(toneDelta(0.2, 0.5, 1, 0, 1)).toBeGreaterThan(0); // dark pixel, shadows only
    expect(toneDelta(0.8, 0, 1, 0.5, 1)).toBeLessThan(0); // bright pixel, highlights only
  });
});

describe("applyShadowsHighlights", () => {
  it("the default state leaves every pixel unchanged", () => {
    const id = defaultShadowsHighlights();
    for (const [r, g, b] of [
      [0, 0, 0],
      [128, 128, 128],
      [255, 255, 255],
      [10, 120, 240],
      [200, 50, 90],
    ]) {
      expect(applyShadowsHighlights(id, r, g, b)).toEqual({ r, g, b });
    }
  });

  it("lifts a black pixel by the shadow amount", () => {
    // l=0 → delta = 0.5 → byte(0.5) = 128
    expect(applyShadowsHighlights(sh(50, 50, 0, 0), 0, 0, 0)).toEqual({ r: 128, g: 128, b: 128 });
  });

  it("pulls a white pixel down by the highlight amount", () => {
    // l=1 → delta = −0.5 → byte(0.5) = 128
    expect(applyShadowsHighlights(sh(0, 0, 50, 50), 255, 255, 255)).toEqual({
      r: 128,
      g: 128,
      b: 128,
    });
  });

  it("shifts every channel by exactly the same amount (colour preserved, no clamping)", () => {
    // (100,150,200), shadows +20 over full width → delta ≈ +0.0402 → +10 per channel
    const out = applyShadowsHighlights(sh(20, 100, 0, 0), 100, 150, 200);
    expect(out).toEqual({ r: 110, g: 160, b: 210 });
    // the three shifts are identical — the hallmark of one luminance delta on all channels
    expect(out.r - 100).toBe(out.g - 150);
    expect(out.g - 150).toBe(out.b - 200);
  });

  it("leaves a midtone essentially untouched when both widths are narrow", () => {
    const out = applyShadowsHighlights(sh(50, 50, 50, 50), 128, 128, 128);
    // l≈0.502 falls just outside both 50%-wide bands → within 1 LSB of identity
    expect(Math.abs(out.r - 128)).toBeLessThanOrEqual(1);
    expect(out.r).toBe(out.g);
    expect(out.g).toBe(out.b);
  });

  it("clamps rather than overflowing at extreme amounts", () => {
    // shadows +100 on black → delta 1 → byte(1) = 255 (clamped, not wrapped)
    expect(applyShadowsHighlights(sh(100, 100, 0, 0), 0, 0, 0)).toEqual({ r: 255, g: 255, b: 255 });
    // highlights +100 on white → delta −1 → byte(0) = 0
    expect(applyShadowsHighlights(sh(0, 0, 100, 100), 255, 255, 255)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("shadows act on the dark end without darkening the bright end", () => {
    const s = sh(60, 50, 0, 0);
    expect(applyShadowsHighlights(s, 20, 20, 20).r).toBeGreaterThan(20); // dark pixel rises
    expect(applyShadowsHighlights(s, 245, 245, 245).r).toBe(245); // bright pixel untouched
  });

  it("highlights act on the bright end without brightening the dark end", () => {
    const s = sh(0, 0, 60, 50);
    expect(applyShadowsHighlights(s, 235, 235, 235).r).toBeLessThan(235); // bright pixel falls
    expect(applyShadowsHighlights(s, 10, 10, 10).r).toBe(10); // dark pixel untouched
  });

  it("is monotone in the shadows amount for a fixed dark pixel", () => {
    let prev = -1;
    for (const amt of [0, 25, 50, 75, 100]) {
      const v = applyShadowsHighlights(sh(amt, 60, 0, 0), 30, 30, 30).r;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("applies the Midtone S-curve after the delta (#135)", () => {
    // Pure midtone: no tone correction at all, so the only change is the curve.
    const before = applyShadowsHighlights(sh(0, 0, 0, 0), 64, 64, 64);
    const steep = applyShadowsHighlights(sh(0, 0, 0, 0, 0, 100), 64, 64, 64);
    const flat = applyShadowsHighlights(sh(0, 0, 0, 0, 0, -100), 64, 64, 64);
    expect(before).toEqual({ r: 64, g: 64, b: 64 });
    expect(steep.r).toBeLessThan(64); // below the midpoint, +midtone darkens
    expect(flat.r).toBeGreaterThan(64);
    expect(steep.r).toBe(Math.round(midtoneCurve(64 / 255, 0.5) * 255));
  });

  it("applies the Color chroma scale only where the correction reached (#135)", () => {
    // A dark, saturated pixel inside the shadow band: Color pushes it away from its luma.
    const plain = applyShadowsHighlights(sh(40, 60, 0, 0), 40, 20, 10);
    const saturated = applyShadowsHighlights(sh(40, 60, 0, 0, 60), 40, 20, 10);
    const lum = (p: { r: number; g: number; b: number }) => luminance(p.r, p.g, p.b);
    expect(saturated.r - lum(saturated)).toBeGreaterThan(plain.r - lum(plain));
    expect(lum(saturated)).toBeCloseTo(lum(plain), 0); // luma preserved (±1 LSB rounding)
    // A midtone outside both bands has influence 0 → Color must not touch it.
    // (128,100,150) has l ≈ 0.447, outside both 30%-wide bands.
    expect(applyShadowsHighlights(sh(40, 30, 40, 30, 100), 128, 100, 150))
      .toEqual(applyShadowsHighlights(sh(40, 30, 40, 30), 128, 100, 150));
  });

  it("Color at the dialog's default 20 is NOT the identity on a corrected pixel (#135)", () => {
    // Dialogs.tsx seeds Color at 20, so a default dialog open already runs the chroma
    // branch — the old 4-param mirror asserted an identity the engine never satisfied.
    expect(applyShadowsHighlights(sh(35, 50, 0, 50, 20), 30, 60, 90))
      .not.toEqual(applyShadowsHighlights(sh(35, 50, 0, 50), 30, 60, 90));
  });

  it("is deterministic and does not mutate the input state", () => {
    const s = sh(40, 60, 30, 50);
    const snapshot = { ...s };
    const a = applyShadowsHighlights(s, 60, 90, 120);
    const b = applyShadowsHighlights(s, 60, 90, 120);
    expect(a).toEqual(b);
    expect(s).toEqual(snapshot);
  });
});

// ── Several pixel/param fixtures swept for in-range, color-shift, and direction ──
const FIXTURES: { name: string; state: ShadowsHighlightsState; pixels: [number, number, number][] }[] = [
  { name: "shadow lift", state: sh(40, 60, 0, 0), pixels: [[0, 0, 0], [40, 60, 80], [128, 128, 128], [255, 255, 255]] },
  { name: "highlight recover", state: sh(0, 0, 40, 60), pixels: [[255, 255, 255], [200, 180, 220], [128, 64, 32], [0, 0, 0]] },
  { name: "both ends", state: sh(35, 45, 35, 45), pixels: [[12, 34, 56], [120, 130, 140], [240, 220, 200]] },
  { name: "wide bands", state: sh(25, 100, 25, 100), pixels: [[10, 10, 10], [90, 140, 190], [250, 250, 250]] },
];

describe.each(FIXTURES)("fixture: $name", ({ state, pixels }) => {
  it("keeps every channel a valid byte and applies one shared delta per pixel", () => {
    for (const [r, g, b] of pixels) {
      const out = applyShadowsHighlights(state, r, g, b);
      for (const v of [out.r, out.g, out.b]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
      // Whenever no channel hits a clamp boundary, all three move by the identical delta.
      const noClamp = [out.r, out.g, out.b].every((v) => v > 0 && v < 255);
      if (noClamp) {
        expect(out.r - r).toBe(out.g - g);
        expect(out.g - g).toBe(out.b - b);
      }
    }
  });
});
