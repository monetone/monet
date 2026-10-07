// Unit tests for the NTSC Colors filter. Engine-free (node), modelled as a true RGB-pixel
// transform (NOT a grey single-channel — the desaturation couples channels through luminance and
// is invisible on grey). These pin the luminance desaturation (0.85 toward lum), the NTSC-safe
// range compression into [16/255, 235/255], and the round-to-u16 (must match filters.rs
// ntsc_colors), plus cross-implementation goldens captured from the Rust engine on COLOUR input.
import { describe, it, expect } from "vitest";
import { ntscLum, ntscChannel, ntscPixel, ntscColors2D, NTSC_MAX, type RGB } from "./ntscColors";

const fr = Math.fround;
// The NTSC-safe u16 endpoints: round(16/255·65535)=16·257 and round(235/255·65535)=235·257.
const NTSC_LO_U16 = 4112; // 16 · 257
const NTSC_HI_U16 = 60395; // 235 · 257

describe("ntscLum / ntscChannel", () => {
  it("luminance weights sum to exactly 1 in f32 (grey maps to itself)", () => {
    expect(ntscLum(1, 1, 1)).toBe(1);
    expect(ntscLum(0, 0, 0)).toBe(0);
  });

  it("ntscChannel compresses into [LO, HI]: 0→16/255, 1→235/255", () => {
    expect(ntscChannel(0, 0)).toBe(fr(16 / 255));
    expect(ntscChannel(1, 1)).toBe(fr(235 / 255));
  });

  it("ntscChannel desaturates toward lum: a channel above lum is pulled down, below is pulled up", () => {
    const lum = 0.5;
    expect(ntscChannel(1, lum)).toBeLessThan(ntscChannel(1, 1)); // bright channel, grey lum → pulled down
    expect(ntscChannel(0, lum)).toBeGreaterThan(ntscChannel(0, 0)); // dark channel, grey lum → pulled up
  });
});

describe("ntscPixel", () => {
  it("maps black → LO and white → HI on every channel", () => {
    expect(ntscPixel(0, 0, 0)).toEqual([NTSC_LO_U16, NTSC_LO_U16, NTSC_LO_U16]);
    expect(ntscPixel(NTSC_MAX, NTSC_MAX, NTSC_MAX)).toEqual([NTSC_HI_U16, NTSC_HI_U16, NTSC_HI_U16]);
  });

  it("desaturates a pure-red pixel toward its luminance (lifts G,B; lowers R)", () => {
    // [65535,0,0] lum=0.299. Correct desaturation (×0.85) → [54477,6636,6636]. Discriminating:
    // a no-desaturation mutant (factor 1) gives [60395,4112,4112]; a full-desaturation mutant
    // (factor 0) makes all three channels equal. The exact triple pins the 0.85 factor + weights.
    expect(ntscPixel(NTSC_MAX, 0, 0)).toEqual([54477, 6636, 6636]);
    const [r, g, b] = ntscPixel(NTSC_MAX, 0, 0);
    expect(g).toBe(b); // G,B equal (both started at 0, same lum)
    expect(g).toBeGreaterThan(NTSC_LO_U16); // lifted above the floor by desaturation toward lum
    expect(r).toBeLessThan(NTSC_HI_U16); // pulled below the ceiling
  });

  it("matches the engine on mixed-colour probes", () => {
    expect(ntscPixel(32768, 32768, 32768)).toEqual([32254, 32254, 32254]);
    expect(ntscPixel(10000, 40000, 60000)).toEqual([15703, 37603, 52203]);
    expect(ntscPixel(50000, 25000, 5000)).toEqual([44502, 26252, 11652]);
  });

  it("pins the per-op f32 rounding (fround-sensitive goldens an f64 computation would miss)", () => {
    // These inputs are off-by-1 sensitive to the engine's f32 op ORDER: a mirror that dropped the
    // per-op Math.fround (computing in f64) would give B=51056 / R=6372 here, not the engine's
    // values below. They make the "fully bit-exact" claim enforceable: (0,1244,62913) pins the
    // ntscChannel + final ·65535 frounds (via B), (0,28301,8198) pins the ntscLum frounds (via R),
    // so dropping ANY Math.fround flips at least one of these assertions. Captured from the engine.
    expect(ntscPixel(0, 1244, 62913)).toEqual([5130, 6038, 51057]);
    expect(ntscPixel(0, 28301, 8198)).toEqual([6373, 27032, 12357]);
  });

  it("keeps a grey pixel grey (equal channels) and only compresses it", () => {
    for (const v of [0, 1000, 25000, 32768, 50000, NTSC_MAX]) {
      const [r, g, b] = ntscPixel(v, v, v);
      expect(r).toBe(g);
      expect(g).toBe(b);
      expect(r).toBeGreaterThanOrEqual(NTSC_LO_U16);
      expect(r).toBeLessThanOrEqual(NTSC_HI_U16);
    }
  });

  it("always lands inside the NTSC-safe u16 range [4112, 60395]", () => {
    for (let r = 0; r <= NTSC_MAX; r += 4369) {
      for (let g = 0; g <= NTSC_MAX; g += 8191) {
        for (let b = 0; b <= NTSC_MAX; b += 13107) {
          for (const v of ntscPixel(r, g, b)) {
            expect(v).toBeGreaterThanOrEqual(NTSC_LO_U16);
            expect(v).toBeLessThanOrEqual(NTSC_HI_U16);
            expect(Number.isInteger(v)).toBe(true);
          }
        }
      }
    }
  });

  it("compresses the channel range to an exact NTSC-safe triple", () => {
    // [65535,32768,0] → engine-exact [56955,33035,9114]. The output span 47841 is well under the
    // input span 65535 (NTSC compresses); pinning the exact triple beats a tautological `< 65535`
    // (every input compresses into [4112,60395] ⇒ span ≤ 56283, so `< 65535` can never fail).
    expect(ntscPixel(65535, 32768, 0)).toEqual([56955, 33035, 9114]);
    const [r, g, b] = ntscPixel(65535, 32768, 0);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBe(47841);
  });
});

describe("ntscColors2D", () => {
  const grid = (h: number, w: number, fn: (x: number, y: number) => RGB): RGB[][] =>
    Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));

  it("applies per pixel, preserving shape, without mutating the input", () => {
    const g = grid(5, 7, (x, y) => [(x * 9973) % NTSC_MAX, (y * 7919) % NTSC_MAX, (x * 4099 + y) % NTSC_MAX]);
    const snapshot = g.map((row) => row.map((p) => [...p]));
    const out = ntscColors2D(g);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 7)).toBe(true);
    expect(g).toEqual(snapshot); // not mutated
    expect(ntscColors2D(g)).toEqual(out); // deterministic
    for (const row of out) for (const [r, gg, b] of row) {
      for (const v of [r, gg, b]) {
        expect(v).toBeGreaterThanOrEqual(NTSC_LO_U16);
        expect(v).toBeLessThanOrEqual(NTSC_HI_U16);
      }
    }
  });

  it("handles empty and 1×1 images", () => {
    expect(ntscColors2D([])).toEqual([]);
    expect(ntscColors2D([[]])).toEqual([[]]);
    expect(ntscColors2D([[[0, 0, 0]]])).toEqual([[[NTSC_LO_U16, NTSC_LO_U16, NTSC_LO_U16]]]);
  });
});

// ── Cross-implementation golden: exact u16 RGB output captured from the Rust engine's
//    ntsc_colors on a 5×5 COLOUR fixture with distinct per-channel hashes (r=(x·9973+y·9931),
//    g=(x·7919+y·6553), b=(x·4099+y·8191), all mod 65535) so the luminance desaturation is
//    exercised. Fully bit-exact (no trig/sqrt). ──
describe("engine golden (ntsc_colors, 5×5 colour)", () => {
  it("matches the engine bit-exactly", () => {
    const input: RGB[][] = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 5 }, (_, x) => [
        (x * 9973 + y * 9931) % NTSC_MAX,
        (x * 7919 + y * 6553) % NTSC_MAX,
        (x * 4099 + y * 8191) % NTSC_MAX,
      ] as RGB),
    );
    expect(ntscColors2D(input)).toEqual([
      [[4112, 4112, 4112], [12435, 10936, 8147], [20759, 17760, 12183], [29082, 24584, 16218], [37406, 31408, 20254]],
      [[12360, 9894, 11090], [20683, 16718, 15125], [29007, 23542, 19161], [37330, 30366, 23196], [45654, 37190, 27232]],
      [[20608, 15676, 18068], [28931, 22500, 22103], [37255, 29324, 26138], [45578, 36148, 30174], [53902, 42972, 34209]],
      [[28856, 21458, 25045], [37179, 28282, 29081], [45503, 35106, 33116], [53826, 41930, 37152], [11785, 46230, 38663]],
      [[37104, 27240, 32023], [45427, 34064, 36059], [53751, 40888, 40094], [11709, 45188, 41605], [20033, 52012, 45641]],
    ]);
  });
});
