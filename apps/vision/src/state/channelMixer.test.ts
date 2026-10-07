// Unit tests for the Channel Mixer helpers. Engine-free (node); the dialog +
// engine wiring are covered by the e2e suite + the Rust side. These pin the pure
// math: the engine matrix layout (fractions), identity = no-op, monochrome, the
// black-and-white presets, the Total readout, clamping, and applying the mix to
// pixels exactly as the engine does.
import { describe, it, expect } from "vitest";
import {
  defaultMixer,
  identityRow,
  DEFAULT_GRAY,
  channelTotal,
  setRowField,
  activeRow,
  packMixer,
  applyChannelMixer,
  applyMonochromePreset,
  MONOCHROME_PRESETS,
  MIXER_OUTPUTS,
  SOURCE_MIN,
  SOURCE_MAX,
  CONST_MIN,
  CONST_MAX,
  type ChannelMixerState,
} from "./channelMixer";

const close = (got: Float32Array, want: number[]) =>
  want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 6));

describe("defaults & identity", () => {
  it("defaultMixer is colour mode, identity per channel", () => {
    const s = defaultMixer();
    expect(s.monochrome).toBe(false);
    expect(s.red).toEqual({ red: 100, green: 0, blue: 0, constant: 0 });
    expect(s.green).toEqual({ red: 0, green: 100, blue: 0, constant: 0 });
    expect(s.blue).toEqual({ red: 0, green: 0, blue: 100, constant: 0 });
  });

  it("identityRow routes 100% of the matching source", () => {
    expect(identityRow(0)).toEqual({ red: 100, green: 0, blue: 0, constant: 0 });
    expect(identityRow(1)).toEqual({ red: 0, green: 100, blue: 0, constant: 0 });
    expect(identityRow(2)).toEqual({ red: 0, green: 0, blue: 100, constant: 0 });
  });

  it("identity packs to the engine identity matrix and is a pixel no-op", () => {
    close(packMixer(defaultMixer()), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    for (const [r, g, b] of [
      [0, 0, 0],
      [255, 255, 255],
      [10, 20, 30],
      [200, 50, 90],
    ]) {
      expect(applyChannelMixer(defaultMixer(), r, g, b)).toEqual({ r, g, b });
    }
  });

  it("MIXER_OUTPUTS lists R/G/B in order", () => {
    expect(MIXER_OUTPUTS.map((o) => o.value)).toEqual([0, 1, 2]);
    expect(MIXER_OUTPUTS.map((o) => o.label)).toEqual(["Red", "Green", "Blue"]);
  });
});

describe("packMixer — engine layout", () => {
  it("packs per-output rows as [r,g,b,const]×3 in fractions", () => {
    const s = defaultMixer();
    s.red = { red: 100, green: 50, blue: -25, constant: 10 };
    s.green = { red: 0, green: 100, blue: 0, constant: 0 };
    s.blue = { red: -200, green: 0, blue: 200, constant: -100 };
    close(packMixer(s), [1, 0.5, -0.25, 0.1, 0, 1, 0, 0, -2, 0, 2, -1]);
  });

  it("is a Float32Array of length 12", () => {
    const m = packMixer(defaultMixer());
    expect(m).toBeInstanceOf(Float32Array);
    expect(m.length).toBe(12);
  });

  it("is deterministic", () => {
    expect(Array.from(packMixer(defaultMixer()))).toEqual(Array.from(packMixer(defaultMixer())));
  });
});

describe("monochrome", () => {
  it("packs all three output rows from the single gray recipe", () => {
    const s: ChannelMixerState = { ...defaultMixer(), monochrome: true, gray: { red: 25, green: 60, blue: 15, constant: 5 } };
    const m = packMixer(s);
    // every output row identical → result is gray
    expect(Array.from(m.slice(0, 4))).toEqual(Array.from(m.slice(4, 8)));
    expect(Array.from(m.slice(4, 8))).toEqual(Array.from(m.slice(8, 12)));
    close(m, [0.25, 0.6, 0.15, 0.05, 0.25, 0.6, 0.15, 0.05, 0.25, 0.6, 0.15, 0.05]);
  });

  it("produces a true gray (R===G===B) for any input pixel", () => {
    const s: ChannelMixerState = { ...defaultMixer(), monochrome: true, gray: { ...DEFAULT_GRAY } };
    for (const [r, g, b] of [
      [255, 0, 0],
      [12, 240, 33],
      [70, 130, 200],
    ]) {
      const out = applyChannelMixer(s, r, g, b);
      expect(out.r).toBe(out.g);
      expect(out.g).toBe(out.b);
    }
  });

  it("default gray mix turns pure red into 40% gray", () => {
    const s: ChannelMixerState = { ...defaultMixer(), monochrome: true };
    expect(applyChannelMixer(s, 255, 0, 0)).toEqual({ r: 102, g: 102, b: 102 }); // round(0.4*255)
    expect(applyChannelMixer(s, 255, 255, 255)).toEqual({ r: 255, g: 255, b: 255 });
    expect(applyChannelMixer(s, 0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("Total readout", () => {
  it("sums the three source %s, excluding the constant", () => {
    expect(channelTotal(identityRow(0))).toBe(100);
    expect(channelTotal({ red: 40, green: 40, blue: 20, constant: 99 })).toBe(100);
    expect(channelTotal({ red: -70, green: 200, blue: -30, constant: 0 })).toBe(100);
  });
});

describe("setRowField — immutability & clamping", () => {
  it("updates the active colour-mode row without mutating the input", () => {
    const s = defaultMixer();
    const next = setRowField(s, 1, "red", 30);
    expect(next.green.red).toBe(30);
    expect(s.green.red).toBe(0); // original untouched
    expect(next).not.toBe(s);
  });

  it("selects the right colour-mode row per output channel", () => {
    const s = defaultMixer();
    expect(activeRow(s, 0)).toBe(s.red);
    expect(activeRow(s, 1)).toBe(s.green);
    expect(activeRow(s, 2)).toBe(s.blue);
    expect(setRowField(s, 2, "red", 30).blue.red).toBe(30);
  });

  it("edits the gray recipe when monochrome, regardless of selected output", () => {
    const s: ChannelMixerState = { ...defaultMixer(), monochrome: true };
    const next = setRowField(s, 0, "green", 75);
    expect(next.gray.green).toBe(75);
    expect(activeRow(next, 0)).toBe(next.gray);
    expect(activeRow(next, 1)).toBe(next.gray);
    expect(activeRow(next, 2)).toBe(next.gray);
  });

  it("channelTotal tolerates slider float-fuzz once rounded (matches the UI readout)", () => {
    // The % sliders emit binary-float fuzz; the dialog rounds the Total for display
    // and the brightness check, so a fuzzed identity row still reads as 100%.
    const fuzzed = setRowField(setRowField(defaultMixer(), 0, "red", 20.00000000000003), 0, "green", 79.99999999999997);
    expect(Math.round(channelTotal(fuzzed.red))).toBe(100);
  });

  it("clamps sources to ±200 and the constant to ±100", () => {
    const s = defaultMixer();
    expect(setRowField(s, 0, "red", 999).red.red).toBe(SOURCE_MAX);
    expect(setRowField(s, 0, "red", -999).red.red).toBe(SOURCE_MIN);
    expect(setRowField(s, 0, "constant", 999).red.constant).toBe(CONST_MAX);
    expect(setRowField(s, 0, "constant", -999).red.constant).toBe(CONST_MIN);
  });
});

describe("monochrome presets", () => {
  it("every preset's gray recipe sums to 100%", () => {
    for (const p of MONOCHROME_PRESETS) expect(channelTotal(p.gray)).toBe(100);
  });

  it("preset names are unique", () => {
    const names = MONOCHROME_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("applyMonochromePreset switches to monochrome and loads the recipe", () => {
    const s = applyMonochromePreset(defaultMixer(), "Black & White with Red Filter");
    expect(s.monochrome).toBe(true);
    expect(s.gray).toEqual({ red: 100, green: 0, blue: 0, constant: 0 });
  });

  it("an unknown preset name leaves the state unchanged", () => {
    const s = defaultMixer();
    expect(applyMonochromePreset(s, "nope")).toBe(s);
  });
});

describe("clamping in applyChannelMixer (engine clamps each output to [0,1])", () => {
  it("a +100% constant forces white; a -100% constant forces black", () => {
    const white: ChannelMixerState = {
      ...defaultMixer(),
      red: { ...identityRow(0), constant: 100 },
      green: { ...identityRow(1), constant: 100 },
      blue: { ...identityRow(2), constant: 100 },
    };
    expect(applyChannelMixer(white, 0, 0, 0)).toEqual({ r: 255, g: 255, b: 255 });
    const black: ChannelMixerState = {
      ...defaultMixer(),
      red: { ...identityRow(0), constant: -100 },
      green: { ...identityRow(1), constant: -100 },
      blue: { ...identityRow(2), constant: -100 },
    };
    expect(applyChannelMixer(black, 255, 255, 255)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("an all-zero gray recipe yields pure black regardless of input", () => {
    const s: ChannelMixerState = { ...defaultMixer(), monochrome: true, gray: { red: 0, green: 0, blue: 0, constant: 0 } };
    expect(applyChannelMixer(s, 255, 255, 255)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

// ── Several preset fixtures applied to a small pixel set ─────────────────────
interface PixelCase {
  px: [number, number, number];
  gray: number; // expected gray output for the monochrome preset
}
const PRESET_FIXTURES: { name: string; cases: PixelCase[] }[] = [
  {
    // Red filter: gray = R only.
    name: "Black & White with Red Filter",
    cases: [
      { px: [200, 50, 50], gray: 200 },
      { px: [0, 255, 255], gray: 0 },
    ],
  },
  {
    // Green filter: gray = G only.
    name: "Black & White with Green Filter",
    cases: [
      { px: [50, 200, 50], gray: 200 },
      { px: [255, 0, 255], gray: 0 },
    ],
  },
  {
    // Blue filter: gray = B only.
    name: "Black & White with Blue Filter",
    cases: [
      { px: [50, 50, 90], gray: 90 },
      { px: [255, 255, 0], gray: 0 },
    ],
  },
  {
    // Yellow filter: gray = 0.34R + 0.66G.
    name: "Black & White with Yellow Filter",
    cases: [{ px: [255, 255, 0], gray: Math.round((0.34 + 0.66) * 255) }], // = 255
  },
];

describe.each(PRESET_FIXTURES)("preset fixture: $name", ({ name, cases }) => {
  it("maps each pixel to the expected gray (R===G===B)", () => {
    const s = applyMonochromePreset(defaultMixer(), name);
    for (const { px, gray } of cases) {
      const out = applyChannelMixer(s, px[0], px[1], px[2]);
      expect(out).toEqual({ r: gray, g: gray, b: gray });
    }
  });
});

describe("infrared preset (negative + >100% weights)", () => {
  it("packs to fractions with negatives and 2.0, sums to 100%", () => {
    const s = applyMonochromePreset(defaultMixer(), "Black & White Infrared");
    expect(channelTotal(s.gray)).toBe(100);
    close(packMixer(s), [-0.7, 2, -0.3, 0, -0.7, 2, -0.3, 0, -0.7, 2, -0.3, 0]);
  });

  it("boosts greens dramatically (classic IR look) and clamps", () => {
    const s = applyMonochromePreset(defaultMixer(), "Black & White Infrared");
    // Pure green: gray = 2.0 → clamps to white.
    expect(applyChannelMixer(s, 0, 255, 0)).toEqual({ r: 255, g: 255, b: 255 });
    // Pure red: gray = -0.7 → clamps to black.
    expect(applyChannelMixer(s, 255, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });
});
