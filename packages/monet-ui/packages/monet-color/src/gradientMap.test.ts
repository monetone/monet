// Unit tests for the Gradient Map LUT builders. Engine-free (node); the dialog +
// engine wiring are covered by the e2e suite + the Rust side. These pin the pure
// math: luminance indexing (must match the engine), the identity ramp, reverse,
// multi-stop interpolation, Photoshop midpoints, edge cases, and RGBA↔f32 parity.
import { describe, it, expect } from "vitest";
import {
  gradientMapIndex,
  sampleGradientMap,
  buildGradientMapLutRgba,
  buildGradientMapLutF32,
  gradientMapPreset,
  GRADIENT_MAP_PRESETS,
  DEFAULT_GRADIENT_MAP,
  LUMA_R,
  LUMA_G,
  LUMA_B,
  type GradientMapStop,
} from "./gradientMap";

const BW: GradientMapStop[] = [
  { pos: 0, r: 0, g: 0, b: 0 },
  { pos: 1, r: 255, g: 255, b: 255 },
];

// The reference luminance index the engine computes: floor(l*255 + 0.5) on
// normalised channels === Math.round(0.299r + 0.587g + 0.114b).
const refIndex = (r: number, g: number, b: number) =>
  Math.max(0, Math.min(255, Math.round(LUMA_R * r + LUMA_G * g + LUMA_B * b)));

describe("gradientMapIndex (engine luminance parity)", () => {
  it("weights are exactly Rec.601", () => {
    expect([LUMA_R, LUMA_G, LUMA_B]).toEqual([0.299, 0.587, 0.114]);
    expect(LUMA_R + LUMA_G + LUMA_B).toBeCloseTo(1, 6);
  });

  it("maps the canonical pixels to the engine's slots", () => {
    expect(gradientMapIndex(0, 0, 0)).toBe(0);
    expect(gradientMapIndex(255, 255, 255)).toBe(255);
    expect(gradientMapIndex(128, 128, 128)).toBe(128);
    expect(gradientMapIndex(255, 0, 0)).toBe(76); // 0.299*255 = 76.245
    expect(gradientMapIndex(0, 255, 0)).toBe(150); // 0.587*255 = 149.685
    expect(gradientMapIndex(0, 0, 255)).toBe(29); // 0.114*255 = 29.07
  });

  it("equals the reference for every gray level and clamps", () => {
    for (let v = 0; v <= 255; v++) expect(gradientMapIndex(v, v, v)).toBe(v);
    expect(gradientMapIndex(-50, -50, -50)).toBe(0);
    expect(gradientMapIndex(999, 999, 999)).toBe(255);
  });
});

describe("buildGradientMapLutRgba — format", () => {
  it("is 256 RGBA entries with opaque alpha", () => {
    const lut = buildGradientMapLutRgba(BW);
    expect(lut).toBeInstanceOf(Uint8Array);
    expect(lut.length).toBe(256 * 4);
    for (let i = 0; i < 256; i++) expect(lut[i * 4 + 3]).toBe(255);
  });

  it("Black → White is the identity ramp (lut[i] === i, all channels)", () => {
    const lut = buildGradientMapLutRgba(BW);
    for (let i = 0; i < 256; i++) {
      expect(lut[i * 4]).toBe(i);
      expect(lut[i * 4 + 1]).toBe(i);
      expect(lut[i * 4 + 2]).toBe(i);
    }
  });

  it("endpoints take the first/last stop colour", () => {
    const lut = buildGradientMapLutRgba([
      { pos: 0, r: 10, g: 20, b: 30 },
      { pos: 1, r: 200, g: 210, b: 220 },
    ]);
    expect([lut[0], lut[1], lut[2]]).toEqual([10, 20, 30]);
    expect([lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2]]).toEqual([200, 210, 220]);
  });

  it("is monotonic for a monotonic ramp (no banding gaps)", () => {
    const lut = buildGradientMapLutRgba(BW);
    for (let i = 1; i < 256; i++) expect(lut[i * 4]).toBeGreaterThanOrEqual(lut[(i - 1) * 4]);
  });

  it("is deterministic", () => {
    expect(Array.from(buildGradientMapLutRgba(BW))).toEqual(Array.from(buildGradientMapLutRgba(BW)));
  });
});

describe("buildGradientMapLutF32 — format & parity", () => {
  it("is 256 RGB entries normalised to 0..1", () => {
    const lut = buildGradientMapLutF32(BW);
    expect(lut).toBeInstanceOf(Float32Array);
    expect(lut.length).toBe(256 * 3);
    for (const v of lut) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is byte-exact with the RGBA builder ÷ 255", () => {
    const stops = gradientMapPreset("Cobalt · Magenta · Gold").stops;
    const rgba = buildGradientMapLutRgba(stops);
    const f32 = buildGradientMapLutF32(stops);
    for (let i = 0; i < 256; i++) {
      expect(f32[i * 3]).toBeCloseTo(rgba[i * 4] / 255, 5);
      expect(f32[i * 3 + 1]).toBeCloseTo(rgba[i * 4 + 1] / 255, 5);
      expect(f32[i * 3 + 2]).toBeCloseTo(rgba[i * 4 + 2] / 255, 5);
    }
  });
});

describe("reverse", () => {
  it("flips Black → White to lut[i] === 255 - i", () => {
    const lut = buildGradientMapLutRgba(BW, { reverse: true });
    for (let i = 0; i < 256; i++) expect(lut[i * 4]).toBe(255 - i);
  });

  it("is the exact mirror of the forward LUT for any ramp (incl. midpoints)", () => {
    const stops = gradientMapPreset("Sepia").stops;
    const opts = { midpoints: [0.3] };
    const fwd = buildGradientMapLutRgba(stops, opts);
    const rev = buildGradientMapLutRgba(stops, { ...opts, reverse: true });
    for (let i = 0; i < 256; i++) {
      for (let c = 0; c < 3; c++) expect(rev[i * 4 + c]).toBe(fwd[(255 - i) * 4 + c]);
    }
  });

  it("reverse∘reverse restores the original (involution)", () => {
    const stops = gradientMapPreset("Blue → Orange").stops;
    const plain = buildGradientMapLutRgba(stops);
    // A doubly-reversed ramp samples the same colours as the plain one.
    const once = buildGradientMapLutRgba(stops, { reverse: true });
    const mirrored = once.slice();
    // Mirror `once` back by index and compare to plain.
    for (let i = 0; i < 256; i++) for (let c = 0; c < 4; c++) mirrored[i * 4 + c] = once[(255 - i) * 4 + c];
    expect(Array.from(mirrored)).toEqual(Array.from(plain));
  });
});

describe("multi-stop interpolation", () => {
  const stops: GradientMapStop[] = [
    { pos: 0, r: 10, g: 20, b: 70 },
    { pos: 0.5, r: 200, g: 30, b: 120 },
    { pos: 1, r: 255, g: 215, b: 90 },
  ];

  it("hits each stop colour exactly at its position", () => {
    expect(sampleGradientMap(stops, 0)).toMatchObject({ r: 10, g: 20, b: 70 });
    expect(sampleGradientMap(stops, 0.5)).toMatchObject({ r: 200, g: 30, b: 120 });
    expect(sampleGradientMap(stops, 1)).toMatchObject({ r: 255, g: 215, b: 90 });
  });

  it("interpolates within the correct gap", () => {
    // Quarter way into the first gap (pos 0.25): halfway black-stop → mid-stop.
    const c = sampleGradientMap(stops, 0.25);
    expect(c.r).toBe(Math.round(10 + (200 - 10) * 0.5));
    expect(c.g).toBe(Math.round(20 + (30 - 20) * 0.5));
    expect(c.b).toBe(Math.round(70 + (120 - 70) * 0.5));
  });

  it("sorts unsorted stops (order-independent)", () => {
    const shuffled: GradientMapStop[] = [stops[2], stops[0], stops[1]];
    expect(Array.from(buildGradientMapLutRgba(shuffled))).toEqual(
      Array.from(buildGradientMapLutRgba(stops)),
    );
  });
});

describe("Photoshop midpoints (diamond)", () => {
  it("default midpoint 0.5 is plain linear", () => {
    const linear = buildGradientMapLutRgba(BW);
    const mid = buildGradientMapLutRgba(BW, { midpoints: [0.5] });
    expect(Array.from(mid)).toEqual(Array.from(linear));
  });

  it("a 0.25 midpoint moves the 50% blend earlier", () => {
    // With the diamond at 0.25, the colours are 50/50 at pos 0.25, not 0.5.
    const c = sampleGradientMap(BW, 0.25, { midpoints: [0.25] });
    expect(c.r).toBe(128); // round(255 * 0.5)
    // ...and past the midpoint it is lighter than the linear ramp at the same pos.
    expect(sampleGradientMap(BW, 0.6, { midpoints: [0.25] }).r).toBeGreaterThan(
      sampleGradientMap(BW, 0.6).r,
    );
  });

  it("degenerate midpoints (0, 1, NaN) fall back to linear, never divide by zero", () => {
    for (const m of [0, 1, NaN, -1, 2]) {
      const lut = buildGradientMapLutRgba(BW, { midpoints: [m] });
      expect(lut.length).toBe(256 * 4);
      expect(lut.every((v, i) => (i % 4 === 3 ? v === 255 : Number.isFinite(v)))).toBe(true);
    }
  });
});

describe("edge cases", () => {
  it("no stops falls back to Black → White", () => {
    expect(Array.from(buildGradientMapLutRgba([]))).toEqual(Array.from(buildGradientMapLutRgba(BW)));
  });

  it("a single stop is a constant colour everywhere", () => {
    const lut = buildGradientMapLutRgba([{ pos: 0.3, r: 10, g: 20, b: 30 }]);
    for (let i = 0; i < 256; i++) {
      expect([lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2]]).toEqual([10, 20, 30]);
    }
    expect(sampleGradientMap([{ pos: 0.3, r: 10, g: 20, b: 30 }], 0.9)).toMatchObject({
      r: 10,
      g: 20,
      b: 30,
      a: 255,
    });
  });

  it("clamps positions outside [0,1] to the ends", () => {
    expect(sampleGradientMap(BW, -1)).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(sampleGradientMap(BW, 2)).toMatchObject({ r: 255, g: 255, b: 255 });
  });

  it("coincident stops make a hard step, not a crash", () => {
    const step: GradientMapStop[] = [
      { pos: 0, r: 0, g: 0, b: 0 },
      { pos: 0.5, r: 0, g: 0, b: 0 },
      { pos: 0.5, r: 255, g: 255, b: 255 },
      { pos: 1, r: 255, g: 255, b: 255 },
    ];
    const lut = buildGradientMapLutRgba(step);
    expect(lut.length).toBe(256 * 4);
    expect(lut[120 * 4]).toBe(0); // below the step → black
    expect(lut[135 * 4]).toBe(255); // above the step → white
  });

  it("carries optional alpha through interpolation", () => {
    const c = sampleGradientMap(
      [
        { pos: 0, r: 0, g: 0, b: 0, a: 0 },
        { pos: 1, r: 0, g: 0, b: 0, a: 255 },
      ],
      0.5,
    );
    expect(c.a).toBe(128);
  });
});

describe("presets", () => {
  it("default is Black → White", () => {
    expect(DEFAULT_GRADIENT_MAP.name).toBe("Black → White");
  });

  it("names are unique and lookup falls back", () => {
    const names = GRADIENT_MAP_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(gradientMapPreset("does-not-exist")).toBe(GRADIENT_MAP_PRESETS[0]);
    expect(gradientMapPreset("Sepia").name).toBe("Sepia");
  });

  it("every preset builds a valid LUT whose ends match its outer stops", () => {
    for (const p of GRADIENT_MAP_PRESETS) {
      const lut = buildGradientMapLutRgba(p.stops);
      expect(lut.length).toBe(256 * 4);
      const first = p.stops[0];
      const last = p.stops[p.stops.length - 1];
      expect([lut[0], lut[1], lut[2]]).toEqual([first.r, first.g, first.b]);
      expect([lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2]]).toEqual([last.r, last.g, last.b]);
    }
  });
});

// ── Several gradient fixtures, swept for the global invariants ──────────────
interface Fixture {
  name: string;
  stops: GradientMapStop[];
  opts?: { reverse?: boolean; midpoints?: number[] };
}
const FIXTURES: Fixture[] = [
  { name: "duotone B→W", stops: BW },
  { name: "sepia", stops: gradientMapPreset("Sepia").stops },
  { name: "three-stop", stops: gradientMapPreset("Cobalt · Magenta · Gold").stops },
  { name: "reversed orange", stops: gradientMapPreset("Blue → Orange").stops, opts: { reverse: true } },
  { name: "off-centre midpoint", stops: BW, opts: { midpoints: [0.2] } },
  {
    name: "five-stop spectrum",
    stops: [
      { pos: 0, r: 0, g: 0, b: 0 },
      { pos: 0.25, r: 0, g: 90, b: 255 },
      { pos: 0.5, r: 0, g: 200, b: 120 },
      { pos: 0.75, r: 255, g: 160, b: 0 },
      { pos: 1, r: 255, g: 255, b: 255 },
    ],
  },
];

describe.each(FIXTURES)("fixture: $name", ({ stops, opts }) => {
  it("produces a full 256-entry RGBA LUT of valid bytes", () => {
    const lut = buildGradientMapLutRgba(stops, opts);
    expect(lut.length).toBe(256 * 4);
    for (let i = 0; i < lut.length; i++) {
      expect(Number.isInteger(lut[i])).toBe(true);
      expect(lut[i]).toBeGreaterThanOrEqual(0);
      expect(lut[i]).toBeLessThanOrEqual(255);
      if (i % 4 === 3) expect(lut[i]).toBe(255);
    }
  });

  it("RGBA and f32 builders agree", () => {
    const rgba = buildGradientMapLutRgba(stops, opts);
    const f32 = buildGradientMapLutF32(stops, opts);
    for (let i = 0; i < 256; i++) {
      for (let c = 0; c < 3; c++) expect(f32[i * 3 + c]).toBeCloseTo(rgba[i * 4 + c] / 255, 5);
    }
  });

  it("reverse is an exact index mirror", () => {
    const fwd = buildGradientMapLutRgba(stops, opts);
    const rev = buildGradientMapLutRgba(stops, { ...opts, reverse: !opts?.reverse });
    for (let i = 0; i < 256; i++) {
      for (let c = 0; c < 3; c++) expect(rev[i * 4 + c]).toBe(fwd[(255 - i) * 4 + c]);
    }
  });
});

// ── Applying the map to a small "image" fixture via the engine's index rule ──
describe("applying the map to pixels (luminance → gradient)", () => {
  const apply = (lut: Uint8Array, r: number, g: number, b: number) => {
    const i = refIndex(r, g, b) * 4;
    return { r: lut[i], g: lut[i + 1], b: lut[i + 2] };
  };

  it("Black → White preserves luminance as gray (and the index matches the engine rule)", () => {
    const lut = buildGradientMapLutRgba(BW);
    const pixels = [
      [0, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [128, 128, 128],
      [255, 255, 255],
    ];
    for (const [r, g, b] of pixels) {
      const idx = refIndex(r, g, b);
      expect(gradientMapIndex(r, g, b)).toBe(idx);
      expect(apply(lut, r, g, b)).toEqual({ r: idx, g: idx, b: idx });
    }
  });

  it("a Sepia map turns shadows dark-brown and highlights cream", () => {
    const lut = buildGradientMapLutRgba(gradientMapPreset("Sepia").stops);
    const shadow = apply(lut, 0, 0, 0);
    const highlight = apply(lut, 255, 255, 255);
    expect(shadow).toEqual({ r: 30, g: 18, b: 4 });
    expect(highlight).toEqual({ r: 255, g: 232, b: 186 });
    // a midtone is warm: red dominant, blue lowest
    const mid = apply(lut, 128, 128, 128);
    expect(mid.r).toBeGreaterThan(mid.g);
    expect(mid.g).toBeGreaterThan(mid.b);
  });
});
