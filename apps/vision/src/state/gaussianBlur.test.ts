// Unit tests for the Gaussian Blur filter. Engine-free (node), single grey-channel model on an opaque
// image. These pin the f32 Gaussian kernel (exp weights, normalised), the separable two-pass f32-
// accumulation convolution with edge clamping, the premultiply/unpremultiply, and the radius<0.1
// no-op (must match filters.rs gaussian_blur + gaussian_kernel), plus engine goldens. The weights use
// `exp`: the engine's f32::exp (libm expf) and JS fround(Math.exp) can disagree by ≤1 ULP, shifting the
// quantised output by ≤1 LSB — so this is bit-exact-to-≤1; the goldens below sit at exact points.
import { describe, it, expect } from "vitest";
import { gaussianBlurKernel, gaussianBlur2D, GAUSSIAN_BLUR_MAX } from "./gaussianBlur";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const noise24 = grid(24, 24, (x, y) => (x * 9973 + y * 9931 + 7919) % 65535);
const rows = (w: number, s: string): number[][] => {
  const v = s.trim().split(/\s+/).map(Number);
  return Array.from({ length: v.length / w }, (_, y) => v.slice(y * w, y * w + w));
};

describe("gaussianBlurKernel", () => {
  it("radius < 1 is the single-tap identity; otherwise 2r+1 normalised weights", () => {
    expect(gaussianBlurKernel(0)).toEqual({ weights: [1], r: 0 });
    expect(gaussianBlurKernel(0.5)).toEqual({ weights: [0.10650697350502014, 0.7869859933853149, 0.10650697350502014], r: 1 }); // r=ceil(0.5)=1
    expect(gaussianBlurKernel(2)).toEqual({
      weights: [0.054488688707351685, 0.24420136213302612, 0.40261995792388916, 0.24420136213302612, 0.054488688707351685],
      r: 2,
    });
    const k = gaussianBlurKernel(2);
    expect(Math.abs(k.weights.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-5); // normalised
  });
});

describe("gaussianBlur2D", () => {
  const img = grid(12, 12, (x, y) => (x * 5000 + y * 3000) % 65535);

  it("is a no-op for radius < 0.1, negative, or NaN", () => {
    expect(gaussianBlur2D(img, 0.05)).toEqual(img);
    expect(gaussianBlur2D(img, 0)).toEqual(img);
    expect(gaussianBlur2D(img, -3)).toEqual(img); // radius < 0.1
    // a NaN radius is not caught by `< 0.1`, but Rust `f32::max(NaN,0)=0` ⇒ r=0 ⇒ identity kernel
    // ⇒ the image passes through unchanged (engine-verified); JS Math.max(NaN,0)=NaN would zero it.
    expect(gaussianBlur2D(img, NaN)).toEqual(img);
    // an Infinity radius must not loop forever building an infinite kernel — it safely returns identity.
    expect(gaussianBlur2D(img, Infinity)).toEqual(img);
  });

  it("leaves a flat field unchanged (blur of a constant is the constant)", () => {
    const flatField = grid(10, 10, () => 30000);
    expect(gaussianBlur2D(flatField, 3)).toEqual(flatField);
  });

  it("spreads an impulse more as the radius grows (centre darkens, neighbours brighten)", () => {
    const impulse = grid(15, 15, (x, y) => (x === 7 && y === 7 ? 60000 : 0));
    const b2 = gaussianBlur2D(impulse, 2);
    const b4 = gaussianBlur2D(impulse, 4);
    expect(b4[7][7]).toBeLessThan(b2[7][7]); // wider blur ⇒ lower peak
    expect(b4[7][10]).toBeGreaterThan(b2[7][10]); // …and energy reaches farther (3px out: r4 lights it, r2 doesn't)
  });

  it("keeps every output an integer in [0, 65535]", () => {
    for (const v of flat(gaussianBlur2D(img, 2.5))) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(GAUSSIAN_BLUR_MAX);
    }
  });

  it("handles empty / 1×1 images, is deterministic and does not mutate the input", () => {
    expect(gaussianBlur2D([], 2)).toEqual([]);
    expect(gaussianBlur2D([[], []], 2)).toEqual([[], []]);
    expect(gaussianBlur2D([[40000]], 2)).toEqual([[40000]]); // lone pixel: all taps clamp to it
    const snapshot = img.map((r) => [...r]);
    const out = gaussianBlur2D(img, 2);
    expect(img).toEqual(snapshot);
    expect(gaussianBlur2D(img, 2)).toEqual(out);
  });

  it("is shape-preserving on a non-square image", () => {
    const out = gaussianBlur2D(grid(5, 9, (x, y) => (x * 31 + y * 17) % 65535), 2);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 9)).toBe(true);
  });
});

// ── Cross-implementation goldens from the Rust engine's `gaussian_blur` on grey opaque images. An
//    impulse (point-spread), a step edge, a gradient, a tiny radius (r=ceil(0.1)=1), and a larger
//    radius. The f32 kernel + f32-accumulation reproduce the engine bit-for-bit at these radii. ──
describe("engine golden (gaussian_blur)", () => {
  it("matches the engine bit-exactly — impulse, radius 2 (point spread)", () => {
    expect(gaussianBlur2D(grid(12, 12, (x, y) => (x === 6 && y === 6 ? 60000 : 5000)), 2)).toEqual(
      rows(12, "5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5163 5732 6207 5732 5163 5000 5000 5000 5000 5000 5000 5000 5732 8280 10408 8280 5732 5000 5000 5000 5000 5000 5000 5000 6207 10408 13916 10408 6207 5000 5000 5000 5000 5000 5000 5000 5732 8280 10408 8280 5732 5000 5000 5000 5000 5000 5000 5000 5163 5732 6207 5732 5163 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000 5000"),
    );
  });
  it("matches the engine bit-exactly — step edge, radius 3", () => {
    expect(gaussianBlur2D(grid(12, 12, (x) => (x < 6 ? 10000 : 60000)), 3)).toEqual(
      rows(12, "10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000 10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000 10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000 10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000 10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000 10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000 10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000 10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000 10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000 10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000 10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000 10000 10000 10000 11832 17396 28233 41767 52604 58168 60000 60000 60000"),
    );
  });
  it("matches the engine bit-exactly — gradient, radius 1.5", () => {
    expect(gaussianBlur2D(grid(10, 10, (x, y) => (x * 5000 + y * 3000) % 65535), 1.5)).toEqual(
      rows(10, "1993 5823 10747 15747 20747 25747 30747 35747 40671 44502 4291 8122 13046 18046 23046 28046 33046 38046 42970 46800 7246 11076 16000 21000 26000 31000 36000 41000 45924 49754 10246 14076 19000 24000 29000 34000 39000 44000 48924 52754 13246 17076 22000 27000 32000 37000 42000 47000 51924 55754 16246 20076 25000 30000 35000 40000 45000 49985 54691 57991 19246 23076 28000 33000 38000 43000 48000 52767 54337 50009 22246 26076 31000 36000 41000 46000 50985 55019 48649 26078 25200 29030 33954 38954 43954 48954 53721 54620 40621 14915 27498 31329 36253 41253 46253 51253 55489 49274 24132 8822"),
    );
  });
  it("matches the engine bit-exactly — tiny radius 0.1 (r=1 small blur)", () => {
    expect(gaussianBlur2D(grid(8, 8, (x, y) => (x * 9973 + y * 9931) % 65535), 0.1)).toEqual(
      rows(8, "2120 11031 21004 30977 40950 50179 48423 10508 10993 19904 29877 39850 49080 48066 15964 13888 20924 29835 39808 49038 48024 15922 14908 23076 30855 39766 48996 47982 15880 14866 24096 33007 40786 48954 47940 15838 14824 24054 34027 42938 49974 47898 15796 14782 24012 33985 43958 52869 48175 15754 14740 23970 33943 43916 53146 56563 10223 13641 22870 32843 42816 52789 56526 19355"),
    );
  });
  it("matches the engine bit-exactly — 9×5 non-square gradient, radius 2 (pins the per-axis clamp length)", () => {
    expect(gaussianBlur2D(grid(5, 9, (x, y) => (x * 31 + y * 17) % 65535), 2)).toEqual(
      rows(9, "17 39 68 99 130 161 192 221 243 29 51 80 111 142 173 204 233 255 45 67 96 127 158 189 220 249 271 61 83 112 143 174 205 236 265 287 73 95 124 155 186 217 248 277 299"),
    );
  });
  it("matches the engine bit-exactly even at radius 1.08 (an exp-weight-disagreement radius — absorbed)", () => {
    // The f32/f64 exp weights differ by 1 ULP at two taps here, but quantisation absorbs it → exact.
    expect(gaussianBlur2D(grid(8, 8, (x, y) => (x * 9973 + y * 9931) % 65535), 1.08)).toEqual(
      rows(8, "2661 11308 21274 31247 41206 49954 46044 11831 11272 19919 29885 39844 48598 45841 18190 14076 21195 29843 39795 48549 45791 18155 15390 22818 31126 39760 48507 45749 18113 15355 24102 32736 41044 48472 45707 18071 15313 24067 34019 42667 49749 45673 18029 15271 24025 33985 43944 52554 45798 17980 15222 23976 33935 43902 52716 54967 11548 13830 22614 32573 42546 52475 54931 21862"),
    );
  });
  it("matches the engine bit-exactly — radius 4 (diamond)", () => {
    expect(gaussianBlur2D(grid(14, 14, (x, y) => (Math.abs(x - 7) + Math.abs(y - 7) < 4 ? 55000 : 8000)), 4)).toEqual(
      rows(14, "8000 8000 8000 8036 8086 8161 8234 8265 8234 8161 8086 8036 8000 8000 8000 8000 8036 8208 8489 8867 9221 9369 9221 8867 8489 8208 8036 8000 8000 8036 8208 8736 9581 10656 11612 12002 11612 10656 9581 8736 8208 8036 8036 8208 8736 9976 11850 14095 16011 16771 16011 14095 11850 9976 8736 8208 8086 8489 9581 11850 15188 19047 22227 23464 22227 19047 15188 11850 9581 8489 8161 8867 10656 14095 19047 24610 29077 30785 29077 24610 19047 14095 10656 8867 8234 9221 11612 16011 22227 29077 34475 36513 34475 29077 22227 16011 11612 9221 8265 9369 12002 16771 23464 30785 36513 38664 36513 30785 23464 16771 12002 9369 8234 9221 11612 16011 22227 29077 34475 36513 34475 29077 22227 16011 11612 9221 8161 8867 10656 14095 19047 24610 29077 30785 29077 24610 19047 14095 10656 8867 8086 8489 9581 11850 15188 19047 22227 23464 22227 19047 15188 11850 9581 8489 8036 8208 8736 9976 11850 14095 16011 16771 16011 14095 11850 9976 8736 8208 8000 8036 8208 8736 9581 10656 11612 12002 11612 10656 9581 8736 8208 8036 8000 8000 8036 8208 8489 8867 9221 9369 9221 8867 8489 8208 8036 8000"),
    );
  });
});

// ── f32-vs-f64 accumulation discriminator. The structural goldens above are f32/f64-blind (a pure-f64
//    blur reproduces them), so they don't witness the f32 kernel + accumulation discipline. At radius
//    5 over a 24×24 noise field, the f32 accumulation order diverges: pixel (17,1) is 29446 in the
//    engine's f32 but 29445 under a pure-f64 mirror. Captured from the real engine. ──
describe("engine f32-vs-f64 accumulation discriminator (gaussian_blur)", () => {
  it("matches the engine's f32 accumulation where a pure-f64 blur diverges — 24×24, radius 5", () => {
    // Two witnesses so a regression that happens to leave one pixel unchanged is still caught; each
    // pins the f32 kernel + the horizontal-then-vertical f32 accumulation (a pure-f64 blur diverges).
    expect(gaussianBlur2D(noise24, 5)[1][17]).toBe(29446); // pure-f64 → 29445
    expect(gaussianBlur2D(noise24, 5)[20][7]).toBe(32804); // pure-f64 → 32803
  });
});
