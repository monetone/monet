// Unit tests for the Halftone Pattern filter. Engine-free (node), single grey-channel model (exact
// for grey R=G=B input with grey fg/bg). These pin the tone threshold, the three screen patterns
// (Dot/Line/Circle), and the `screen > t` two-tone decision (must match filters.rs halftone_pattern),
// plus cross-implementation goldens captured from the Rust engine. The per-op f32 frounds ARE
// load-bearing: a full f32-vs-f64 sweep of the operating points below has 4832 decision flips,
// concentrated where the screen sits on the tone boundary. The plain structural goldens (12×12 /
// 9×9) happen not to land in a discriminating regime, so the `engine f32-vs-f64 discriminators`
// block adds one engine-captured probe per pattern that a pure-f64 (fround-dropped) mirror gets
// wrong. sqrt is correctly-rounded (double-rounding theorem) and Math.hypot equals the correctly-
// rounded f32 result over the integer/half-integer inputs used here, so every golden is bit-exact.
import { describe, it, expect } from "vitest";
import {
  halftoneTone,
  halftoneScreen,
  halftonePattern2D,
  HALFTONE_PATTERN_MAX,
} from "./halftonePattern";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();
const FG16 = 20 * 257; // 5140
const BG16 = 230 * 257; // 59110

describe("halftoneTone", () => {
  it("maps mid-grey to 0.5 and saturates black→0 / white→1 (k-dependence checked separately below)", () => {
    const k = 1 + 6 * 0.6; // 4.6
    expect(halftoneTone(32768, k)).toBeCloseTo(0.5, 4); // luma ≈ 0.5 ⇒ t ≈ 0.5
    expect(halftoneTone(0, k)).toBe(0); // (0−0.5)·4.6+0.5 < 0 → clamp 0
    expect(halftoneTone(HALFTONE_PATTERN_MAX, k)).toBe(1); // → clamp 1
  });
  it("is monotonic non-decreasing in v", () => {
    let prev = -1;
    for (let v = 0; v <= 65535; v += 1024) {
      const t = halftoneTone(v, 4.6);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
  it("steepens around mid-grey as k grows (k is actually exercised, unlike the saturating cases)", () => {
    // v=36000 (luma ≈ 0.549, just above mid) is non-saturating, so k genuinely changes the result —
    // the mid-grey/black/white cases above are all k-invariant (clamp or luma=0.5), so on their own
    // they would pass even if k were ignored.
    const t1 = halftoneTone(36000, 1); // k=1 (contrast 0) ⇒ t = luma
    const t2 = halftoneTone(36000, 2.5); // k=2.5 (contrast 0.25)
    const t3 = halftoneTone(36000, 7); // k=7 (contrast 1)
    expect(t1).toBeLessThan(t2);
    expect(t2).toBeLessThan(t3);
    expect(t2).toBeCloseTo(0.6233, 4);
    expect(t3).toBeCloseTo(0.8453, 4);
  });
});

describe("halftoneScreen", () => {
  it("Dot (1) peaks at the cell centre and falls toward the corner; all screens stay in [0,1]", () => {
    expect(halftoneScreen(2, 2, 1, 4, 12, 12)).toBeGreaterThan(halftoneScreen(0, 0, 1, 4, 12, 12)); // centre > corner
    for (const pat of [1, 2, 3]) {
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
        const s = halftoneScreen(x, y, pat, 4.5, 12, 12);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });
  it("Line (2) depends only on y; Circle (3) is radially symmetric about the centre", () => {
    expect(halftoneScreen(0, 3, 2, 4, 12, 12)).toBe(halftoneScreen(9, 3, 2, 4, 12, 12)); // same y → same line value
    expect(halftoneScreen(6 + 2, 6, 3, 4, 12, 12)).toBe(halftoneScreen(6 - 2, 6, 3, 4, 12, 12)); // mirror about cx=6 (w=12)
  });
});

describe("halftonePattern2D", () => {
  const g = grid(12, 12, (x, y) => (x * 9973 + y * 9931) % HALFTONE_PATTERN_MAX);

  it("emits only the two tone colours (fg16 or bg16)", () => {
    for (const pat of [1, 2, 3]) {
      for (const v of flat(halftonePattern2D(g, 4.5, 0.6, pat, 20, 230))) {
        expect(v === FG16 || v === BG16).toBe(true);
      }
    }
  });

  it("an all-black image inks heavily (t=0 ⇒ fg wherever screen>0); all-white is all bg (t=1)", () => {
    const black = grid(8, 8, () => 0);
    const white = grid(8, 8, () => HALFTONE_PATTERN_MAX);
    const inked = flat(halftonePattern2D(black, 4, 0.6, 1, 0, 255)).filter((v) => v === 0).length;
    expect(inked).toBeGreaterThan(32); // most pixels inked (screen>0)
    for (const v of flat(halftonePattern2D(white, 4, 0.6, 1, 0, 255))) expect(v).toBe(255 * 257); // all paper
  });

  it("clamps the cell size to ≥ 1 (and a clamped cell is a real cell-1, not a degenerate no-op)", () => {
    // Use Dot, whose output genuinely changes with cell size — the Line@integer-coord screen is 0
    // for every integer cell, which would make this equality hold for ANY size and hide the clamp.
    const s1 = halftonePattern2D(g, 1, 0.6, 1, 20, 230);
    expect(halftonePattern2D(g, 0.5, 0.6, 1, 20, 230)).toEqual(s1); // size<1 → cell 1
    expect(halftonePattern2D(g, 0, 0.6, 1, 20, 230)).toEqual(s1); // size 0 → cell 1
    expect(halftonePattern2D(g, 2, 0.6, 1, 20, 230)).not.toEqual(s1); // size 2 ≠ size 1: the clamp target is a live cell
  });

  it("treats any non-1/2 pattern as Circle and clamps contrast to [0,1] (matching the engine match/clamp)", () => {
    const circle = halftonePattern2D(g, 4.5, 0.6, 3, 20, 230);
    expect(halftonePattern2D(g, 4.5, 0.6, 0, 20, 230)).toEqual(circle); // 0 → Circle (engine `_ =>`)
    expect(halftonePattern2D(g, 4.5, 0.6, 255, 20, 230)).toEqual(circle); // 255 → Circle
    expect(halftonePattern2D(g, 4.5, 0.6, 0, 20, 230)).not.toEqual(halftonePattern2D(g, 4.5, 0.6, 1, 20, 230)); // not Dot
    const c0 = halftonePattern2D(g, 4.5, 0, 3, 20, 230);
    const c1 = halftonePattern2D(g, 4.5, 1, 3, 20, 230);
    expect(halftonePattern2D(g, 4.5, -0.5, 3, 20, 230)).toEqual(c0); // contrast < 0 → 0
    expect(halftonePattern2D(g, 4.5, 1.5, 3, 20, 230)).toEqual(c1); // contrast > 1 → 1
    expect(c0).not.toEqual(c1); // the clamp endpoints are genuinely different operating points
  });

  it("handles empty / degenerate / 1×1 images, is deterministic and does not mutate the input", () => {
    expect(halftonePattern2D([], 4.5, 0.6, 1)).toEqual([]); // 0 rows
    expect(halftonePattern2D([[], []], 4.5, 0.6, 1)).toEqual([[], []]); // 2×0 (w=0 early-out)
    // a genuine 1×1 (Circle, cx=cy=0.5): v=40000 ⇒ tone≈1 ⇒ screen ≤ t ⇒ bg; engine-confirmed bg16=230·257.
    expect(halftonePattern2D([[40000]], 4.5, 0.6, 3, 20, 230)).toEqual([[59110]]);
    const snapshot = g.map((r) => [...r]);
    const out = halftonePattern2D(g, 4.5, 0.6, 3, 20, 230);
    expect(g).toEqual(snapshot);
    expect(halftonePattern2D(g, 4.5, 0.6, 3, 20, 230)).toEqual(out);
  });

  it("is shape-preserving on a non-square image", () => {
    const ng = grid(5, 13, (x, y) => (x * 11 + y * 5) % 50000);
    const out = halftonePattern2D(ng, 4, 0.5, 1, 20, 230);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens: exact u16 output captured from the Rust engine's halftone_pattern
//    on a 12×12 grey pattern v=(x·9973+y·9931)%65535 (size 4.5, contrast 0.6, fg 20 / bg 230) for
//    all three screen patterns, plus a 9×9 odd-dimension Circle case (half-integer centre, fg 0 /
//    bg 255) that hardens the hypot path. Fully bit-exact (sqrt/hypot correctly-rounded). ──
describe("engine golden (halftone_pattern)", () => {
  const g = grid(12, 12, (x, y) => (x * 9973 + y * 9931) % HALFTONE_PATTERN_MAX);
  const rows = (n: number, vals: number[]): number[][] => Array.from({ length: n }, (_, y) => vals.slice(y * n, y * n + n));
  const PAT: Record<number, number[]> = {
    1: [59110, 5140, 5140, 59110, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 59110, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140],
    2: [59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 5140, 59110, 5140, 5140, 59110, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 5140, 5140, 5140],
    3: [5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 5140, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 59110, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 5140, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 5140, 5140, 59110, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140, 59110, 59110, 59110, 5140, 5140, 5140],
  };
  it.each([
    { pat: 1, name: "Dot" },
    { pat: 2, name: "Line" },
    { pat: 3, name: "Circle" },
  ])("matches the engine bit-exactly — $name (size 4.5, contrast 0.6, fg 20, bg 230)", ({ pat }) => {
    expect(halftonePattern2D(g, 4.5, 0.6, pat, 20, 230)).toEqual(rows(12, PAT[pat]));
  });

  it("matches the engine bit-exactly — 9×9 Circle, odd dims, size 3, contrast 0.45, fg 0, bg 255 (hypot)", () => {
    const g9 = grid(9, 9, (x, y) => (x * 7919 + y * 104729) % HALFTONE_PATTERN_MAX);
    expect(halftonePattern2D(g9, 3, 0.45, 3, 0, 255)).toEqual(
      rows(9, [
        0, 0, 0, 0, 0, 0, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 0, 0, 0, 0, 65535, 0, 0, 0, 65535, 65535,
        65535, 65535, 0, 0, 65535, 65535, 0, 0, 0, 0, 0, 65535, 65535, 0, 65535, 65535, 65535, 65535, 65535, 0, 0, 0,
        65535, 0, 0, 0, 0, 65535, 65535, 65535, 65535, 0, 65535, 65535, 65535, 0, 0, 0, 65535, 65535, 0, 0, 0, 65535,
        65535, 65535, 65535, 0, 0, 65535, 65535, 0, 0, 0, 0, 0, 65535, 65535,
      ]),
    );
  });
});

// ── f32-vs-f64 discriminators: uniform grey fields whose screen lands ON the tone boundary, so a
//    pure-f64 (fround-dropped) mirror diverges from the engine's f32. Captured from the real engine
//    as the R byte (20 = fg ink, 230 = bg paper); these are exactly the regime the structural
//    goldens above miss. Each `parse` string is verbatim engine output. ──
describe("engine f32-vs-f64 discriminators (halftone_pattern)", () => {
  const fill = (h: number, w: number, v: number): number[][] => grid(h, w, () => v);
  // verbatim engine R-byte dump (20=fg, 230=bg) → expected u16 rows (fg16=20·257=5140, bg16=230·257=59110)
  const parse = (w: number, dump: string): number[][] => {
    const v16 = dump.trim().split(/\s+/).map((b) => (Number(b) === 20 ? FG16 : BG16));
    return Array.from({ length: v16.length / w }, (_, y) => v16.slice(y * w, y * w + w));
  };

  it("Dot — 8×8 white field, size 2: f32 keeps every dot-centre bg (a pure-f64 mirror inks it fg)", () => {
    // v=65535 ⇒ dot centres ((1,1),(3,1),…) have screen=1.0 and tone≈1.0; f32 luma rounding tips
    // screen ≤ tone ⇒ bg everywhere. Dropping the luma/tone frounds tips screen > tone at the
    // centres ⇒ fg, so this all-bg golden fails under f64.
    expect(halftonePattern2D(fill(8, 8, 65535), 2, 0, 1, 20, 230)).toEqual(
      parse(8, "230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 230"),
    );
  });

  it("Line — 7×7 of v=26214, size 2.5: screen=0.4 just exceeds tone=0.4 in f32 (f64 flips the inked rows)", () => {
    // The Line screen fround `fr(y/cell)` is individually load-bearing here: f32 screen 0.40000010 >
    // tone 0.40000001 ⇒ fg; f64 (or dropping that one fround) gives 0.39999998 ⇒ bg.
    expect(halftonePattern2D(fill(7, 7, 26214), 2.5, 0, 2, 20, 230)).toEqual(
      parse(7, "230 230 230 230 230 230 230 20 20 20 20 20 20 20 230 230 230 230 230 230 230 20 20 20 20 20 20 20 20 20 20 20 20 20 20 230 230 230 230 230 230 230 20 20 20 20 20 20 20"),
    );
  });

  it("Circle — 8×8 of v=43690, size 1.5: the ring boundary resolves differently under f32 vs f64", () => {
    expect(halftonePattern2D(fill(8, 8, 43690), 1.5, 0, 3, 20, 230)).toEqual(
      parse(8, "230 230 230 230 230 230 230 230 230 230 20 230 230 230 20 230 230 20 230 20 20 20 230 20 230 230 20 230 230 230 20 230 230 230 20 230 230 230 20 230 230 230 20 230 230 230 20 230 230 20 230 20 20 20 230 20 230 230 20 230 230 230 20 230"),
    );
  });
});
