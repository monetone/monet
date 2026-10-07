// outputSharpen spec — the pure USM math + media/amount param mapping.

import { describe, expect, it } from "vitest";

import { sharpenParams, unsharpMask, type SharpenAmount, type SharpenMedia } from "./outputSharpen";

const AMOUNTS: SharpenAmount[] = ["low", "standard", "high"];
const MEDIA: SharpenMedia[] = ["screen", "matte", "glossy"];

/** Build an RGBA buffer from grayscale column values (1px tall), alpha=255. */
function grayRow(vals: number[], alpha = 255): Uint8ClampedArray {
  const out = new Uint8ClampedArray(vals.length * 4);
  vals.forEach((v, i) => {
    out.set([v, v, v, alpha], i * 4);
  });
  return out;
}

/** Build a w×h RGBA buffer, gray value per (x,y). */
function grayField(w: number, h: number, at: (x: number, y: number) => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set([at(x, y), at(x, y), at(x, y), 255], (y * w + x) * 4);
  return out;
}

describe("sharpenParams", () => {
  it("amount increases low → standard → high for a fixed medium", () => {
    const a = sharpenParams({ media: "screen", amount: "low" }).amount;
    const b = sharpenParams({ media: "screen", amount: "standard" }).amount;
    const c = sharpenParams({ media: "screen", amount: "high" }).amount;
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("paper media sharpen harder than screen at the same amount", () => {
    const screen = sharpenParams({ media: "screen", amount: "standard" }).amount;
    const glossy = sharpenParams({ media: "glossy", amount: "standard" }).amount;
    const matte = sharpenParams({ media: "matte", amount: "standard" }).amount;
    expect(glossy).toBeGreaterThan(screen);
    expect(matte).toBeGreaterThan(glossy);
  });

  it("matte uses a larger radius and higher threshold than screen", () => {
    const screen = sharpenParams({ media: "screen", amount: "standard" });
    const matte = sharpenParams({ media: "matte", amount: "standard" });
    expect(matte.radius).toBeGreaterThan(screen.radius);
    expect(matte.threshold).toBeGreaterThan(screen.threshold);
  });

  it("covers every media × amount without NaN", () => {
    for (const media of MEDIA)
      for (const amount of AMOUNTS) {
        const p = sharpenParams({ media, amount });
        expect(Number.isFinite(p.amount)).toBe(true);
        expect(p.radius).toBeGreaterThanOrEqual(1);
      }
  });
});

describe("unsharpMask", () => {
  it("leaves a flat field unchanged", () => {
    const flat = grayRow([128, 128, 128, 128, 128]);
    const out = unsharpMask(flat, 5, 1, { amount: 1, radius: 1, threshold: 0 });
    expect(Array.from(out)).toEqual(Array.from(flat));
  });

  it("overshoots at an edge: darkens the dark side, brightens the bright side", () => {
    // step edge: three dark cols then three bright cols.
    const img = grayRow([80, 80, 80, 160, 160, 160]);
    const out = unsharpMask(img, 6, 1, { amount: 1, radius: 1, threshold: 0 });
    expect(out[2 * 4]).toBeLessThan(80); // last dark pixel undershoots
    expect(out[3 * 4]).toBeGreaterThan(160); // first bright pixel overshoots
  });

  it("respects the threshold (edge detail below it is left alone)", () => {
    const img = grayRow([80, 80, 80, 160, 160, 160]);
    const out = unsharpMask(img, 6, 1, { amount: 1, radius: 1, threshold: 50 });
    expect(Array.from(out)).toEqual(Array.from(img));
  });

  it("preserves the alpha channel", () => {
    const img = grayRow([80, 80, 80, 160, 160, 160], 200);
    const out = unsharpMask(img, 6, 1, { amount: 1, radius: 1, threshold: 0 });
    for (let i = 0; i < 6; i++) expect(out[i * 4 + 3]).toBe(200);
  });

  it("amount 0 is a no-op", () => {
    const img = grayRow([80, 160, 80, 160]);
    const out = unsharpMask(img, 4, 1, { amount: 0, radius: 1, threshold: 0 });
    expect(Array.from(out)).toEqual(Array.from(img));
  });

  it("sharpens a HORIZONTAL edge (exercises the vertical blur pass) with matte radius 2", () => {
    // 3 wide × 6 tall: top 3 rows dark, bottom 3 bright. Uniform per row, so the
    // horizontal pass is identity and only the vertical pass shapes the result.
    const img = grayField(3, 6, (_x, y) => (y < 3 ? 80 : 160));
    const p = sharpenParams({ media: "matte", amount: "standard" }); // radius 2
    expect(p.radius).toBe(2);
    const out = unsharpMask(img, 3, 6, p);
    const at = (x: number, y: number) => out[(y * 3 + x) * 4];
    expect(at(0, 2)).toBeLessThan(80); // last dark row undershoots
    expect(at(0, 3)).toBeGreaterThan(160); // first bright row overshoots
  });

  it("threshold is exclusive: |delta|==threshold is skipped, one below is applied", () => {
    // Edge [80,80,80,160,160,160] → |delta| at the boundary ≈ 26.67 (radius 1).
    const img = grayRow([80, 80, 80, 160, 160, 160]);
    const skipped = unsharpMask(img, 6, 1, { amount: 1, radius: 1, threshold: 27 });
    expect(Array.from(skipped)).toEqual(Array.from(img)); // 26.67 <= 27 → untouched
    const applied = unsharpMask(img, 6, 1, { amount: 1, radius: 1, threshold: 26 });
    expect(applied[2 * 4]).toBeLessThan(80); // 26.67 > 26 → sharpened
  });

  it("uses luminance (not one channel): a red→green edge sharpens all channels together", () => {
    // Red luma ≈76, green luma ≈150 — a real luma edge that a single-channel USM
    // would mis-handle. The green side should gain luma across ALL channels.
    const w = 6;
    const img = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x++) out8(img, x, x < 3 ? [255, 0, 0] : [0, 255, 0]);
    const out = unsharpMask(img, w, 1, { amount: 1, radius: 1, threshold: 0 });
    // First green pixel (x=3) overshoots: its formerly-zero red channel rises > 0.
    expect(out[3 * 4]).toBeGreaterThan(0);
    // Same luma delta is added to every channel, so R and B move by the same amount.
    const dR = out[3 * 4] - img[3 * 4];
    const dB = out[3 * 4 + 2] - img[3 * 4 + 2];
    expect(dR).toBe(dB);
  });
});

function out8(buf: Uint8ClampedArray, x: number, rgb: [number, number, number]) {
  buf.set([rgb[0], rgb[1], rgb[2], 255], x * 4);
}
