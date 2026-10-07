// ─────────────────────────────────────────────────────────────
// effects.test — ColorGrade ⇄ engine f32 param block
// ─────────────────────────────────────────────────────────────
// effects.ts says it is "unit-tested for slot agreement" with
// engine/src/color.rs, but had no test. The slot layout is a cross-language
// contract: a drifting index silently maps (say) contrast onto saturation. Pin
// every slot, plus the gradeIsActive neutrality rules.

import { describe, it, expect } from "vitest";
import {
  COLOR_PARAMS_LEN,
  P_BLACKS,
  P_CONTRAST,
  P_ENABLED,
  P_EXPOSURE,
  P_GAIN,
  P_GAMMA,
  P_HIGHLIGHTS,
  P_HUE,
  P_LIFT,
  P_LUT_MIX,
  P_SATURATION,
  P_SHADOWS,
  P_TEMPERATURE,
  P_TINT,
  P_VIBRANCE,
  P_WHITES,
  gradeIsActive,
  gradeToParams,
  makeClipLut,
  resolveLut,
  sanitizeClipLut,
} from "./effects";
import { MAX_CUBE_LUT_IMPORT_BYTES } from "@monet-ui/monet-photo";
import { defaultColorGrade, createClip, createProject } from "../timeline/model/factory";
import { fromMonet, toMonet } from "../timeline/io/monet-adapter";
import type { ClipLut, ColorGrade } from "../timeline/model/types";

describe("gradeToParams — slot layout", () => {
  it("emits a fixed-length block with the documented indices", () => {
    // Each field is set to the value of its own slot index, so a correct packer
    // yields p[i] === i for every used slot (the cleanest possible drift guard).
    const g: ColorGrade = {
      enabled: true,
      exposure: P_EXPOSURE,
      contrast: P_CONTRAST,
      saturation: P_SATURATION,
      temperature: P_TEMPERATURE,
      tint: P_TINT,
      highlights: P_HIGHLIGHTS,
      shadows: P_SHADOWS,
      whites: P_WHITES,
      blacks: P_BLACKS,
      vibrance: P_VIBRANCE,
      hue: P_HUE,
      gamma: P_GAMMA,
      lift: P_LIFT,
      gain: P_GAIN,
    };
    const p = gradeToParams(g);
    expect(p).toBeInstanceOf(Float32Array);
    expect(p).toHaveLength(COLOR_PARAMS_LEN);
    expect(p[P_ENABLED]).toBe(1); // boolean → 1
    for (let i = P_EXPOSURE; i <= P_GAIN; i++) expect(p[i], `slot ${i}`).toBe(i);
    // the constants index distinct, in-range slots
    expect(new Set([P_EXPOSURE, P_CONTRAST, P_SATURATION, P_TEMPERATURE, P_TINT, P_HIGHLIGHTS, P_SHADOWS, P_WHITES, P_BLACKS, P_VIBRANCE, P_HUE, P_GAMMA, P_LIFT, P_GAIN]).size).toBe(14);
  });

  it("encodes the enabled flag as 1/0 and leaves the reserved tail slot at 0", () => {
    expect(gradeToParams({ ...defaultColorGrade(), enabled: true })[P_ENABLED]).toBe(1);
    expect(gradeToParams(defaultColorGrade())[P_ENABLED]).toBe(0); // default is disabled
    expect(gradeToParams(defaultColorGrade())[COLOR_PARAMS_LEN - 1]).toBe(0); // slot 15 = P_LUT_MIX, 0 with no Look
  });

  it("round-trips the neutral default's multiplicative terms (gamma/gain = 1)", () => {
    const p = gradeToParams(defaultColorGrade());
    expect(p[P_GAMMA]).toBe(1);
    expect(p[P_GAIN]).toBe(1);
  });
});

describe("gradeIsActive — neutrality", () => {
  const neutral = defaultColorGrade();

  it("a disabled grade is never active, even with loud terms", () => {
    expect(gradeIsActive({ ...neutral, enabled: false, exposure: 5, gain: 9 })).toBe(false);
  });

  it("an enabled but fully-neutral grade is inactive", () => {
    expect(gradeIsActive({ ...neutral, enabled: true })).toBe(false);
  });

  // Every term, with the correct neutral baseline (0 for additive, 1 for gamma/gain).
  const offNeutral: Array<[keyof ColorGrade, number]> = [
    ["exposure", 0.3],
    ["contrast", 0.3],
    ["saturation", 0.3],
    ["temperature", 0.3],
    ["tint", 0.3],
    ["highlights", 0.3],
    ["shadows", 0.3],
    ["whites", 0.3],
    ["blacks", 0.3],
    ["vibrance", 0.3],
    ["hue", 0.3],
    ["gamma", 1.3], // neutral is 1
    ["lift", 0.3],
    ["gain", 1.3], // neutral is 1
  ];
  for (const [k, v] of offNeutral) {
    it(`is active when ${k} departs from neutral`, () => {
      expect(gradeIsActive({ ...neutral, enabled: true, [k]: v })).toBe(true);
    });
  }

  it("treats gamma=1 and gain=1 as neutral (multiplicative identity, not 0)", () => {
    expect(gradeIsActive({ ...neutral, enabled: true, gamma: 1, gain: 1 })).toBe(false);
  });
});

// ── Creative Look (3D LUT) ────────────────────────────────────
// The interop half: Cinema stores an imported `.cube`/`.3dl` verbatim on the
// clip and parses it through the SHARED @monet-ui/monet-photo parser, so a LUT
// exported from Vision (File ▸ Export ▸ Color Lookup Tables) grades here
// unchanged and survives a `.monet` round trip.

/** 2³ identity cube in the shared red-fastest lattice order. */
const IDENTITY_CUBE = [
  'TITLE "Identity"',
  "LUT_3D_SIZE 2",
  "0.0 0.0 0.0",
  "1.0 0.0 0.0",
  "0.0 1.0 0.0",
  "1.0 1.0 0.0",
  "0.0 0.0 1.0",
  "1.0 0.0 1.0",
  "0.0 1.0 1.0",
  "1.0 1.0 1.0",
  "",
].join("\n");

describe("resolveLut — shared .cube parsing + memoisation", () => {
  it("parses a .cube into the red-fastest lattice monet-photo and the engine share", () => {
    const lut = resolveLut({ name: "id.cube", text: IDENTITY_CUBE, intensity: 1 })!;
    expect(lut).not.toBeNull();
    expect(lut.size).toBe(2);
    expect(lut.data).toHaveLength(2 * 2 * 2 * 3);
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
    // index = ((b·n + g)·n + r)·3 — the r=1,g=0,b=0 entry is pure red.
    expect(Array.from(lut.data.slice(3, 6))).toEqual([1, 0, 0]);
  });

  it("also reads Autodesk .3dl (Vision's other import dialect)", () => {
    const mesh = "0 1023";
    const rows = [
      "0 0 0", "0 0 1023", // blue varies fastest in .3dl…
      "0 1023 0", "0 1023 1023",
      "1023 0 0", "1023 0 1023",
      "1023 1023 0", "1023 1023 1023",
    ];
    const lut = resolveLut({ name: "l.3dl", text: [mesh, ...rows].join("\n"), intensity: 1 })!;
    expect(lut).not.toBeNull();
    // …and must land re-packed red-fastest, so entry 1 is pure red here too.
    expect(Array.from(lut.data.slice(3, 6))).toEqual([1, 0, 0]);
  });

  it("returns the SAME object for the same text (EngineClient dedupes uploads by identity)", () => {
    const a = resolveLut({ name: "a", text: IDENTITY_CUBE, intensity: 1 });
    const b = resolveLut({ name: "b", text: IDENTITY_CUBE, intensity: 0.5 });
    expect(a).toBe(b);
  });

  it("is null for no LUT and for text that isn't a usable 3D LUT", () => {
    expect(resolveLut(undefined)).toBeNull();
    expect(resolveLut({ name: "x", text: "", intensity: 1 })).toBeNull();
    expect(resolveLut({ name: "x", text: "not a lut at all", intensity: 1 })).toBeNull();
    // A 1D LUT is a curve, not a colour table — monet-photo rejects it.
    expect(resolveLut({ name: "x", text: "LUT_1D_SIZE 2\n0 0 0\n1 1 1", intensity: 1 })).toBeNull();
    // Truncated cube: header promises 8 entries, body has 2.
    expect(resolveLut({ name: "x", text: "LUT_3D_SIZE 2\n0 0 0\n1 1 1", intensity: 1 })).toBeNull();
  });
});

describe("makeClipLut — import boundary", () => {
  it("builds a full-strength Look from a valid file", () => {
    expect(makeClipLut("teal-orange.cube", IDENTITY_CUBE)).toEqual({
      name: "teal-orange.cube",
      text: IDENTITY_CUBE,
      intensity: 1,
    });
  });

  it("refuses an unusable file instead of attaching a dead Look", () => {
    expect(makeClipLut("notes.txt", "hello")).toBeNull();
    expect(makeClipLut("curve.cube", "LUT_1D_SIZE 2\n0 0 0\n1 1 1")).toBeNull();
  });
});

describe("sanitizeClipLut — .monet trust boundary", () => {
  it("keeps the source text verbatim and clamps intensity", () => {
    const ok = sanitizeClipLut({ name: "look.cube", text: IDENTITY_CUBE, intensity: 2 })!;
    expect(ok.text).toBe(IDENTITY_CUBE); // byte-faithful: the look must survive the trip
    expect(ok.intensity).toBe(1);
    expect(sanitizeClipLut({ name: "l", text: "x", intensity: -5 })!.intensity).toBe(0);
    expect(sanitizeClipLut({ name: "l", text: "x", intensity: NaN })!.intensity).toBe(1);
    expect(sanitizeClipLut({ text: "x" })!.name).toBe("LUT");
  });

  it("drops anything malformed or absurdly large before it reaches the parser", () => {
    expect(sanitizeClipLut(undefined)).toBeUndefined();
    expect(sanitizeClipLut("a string")).toBeUndefined();
    expect(sanitizeClipLut({ name: "l" })).toBeUndefined(); // no text
    expect(sanitizeClipLut({ text: 42 })).toBeUndefined();
    expect(sanitizeClipLut({ text: "" })).toBeUndefined();
    expect(sanitizeClipLut({ text: "x".repeat(MAX_CUBE_LUT_IMPORT_BYTES + 1) })).toBeUndefined();
  });
});

describe("Look in the param block + activity", () => {
  const withLut = (intensity: number): ColorGrade => ({
    ...defaultColorGrade(),
    enabled: true,
    lut: { name: "l.cube", text: IDENTITY_CUBE, intensity },
  });

  it("packs intensity into the reserved tail slot, clamped", () => {
    expect(gradeToParams(withLut(0.4))[P_LUT_MIX]).toBeCloseTo(0.4, 6);
    expect(gradeToParams(withLut(5))[P_LUT_MIX]).toBe(1);
    expect(gradeToParams(withLut(-1))[P_LUT_MIX]).toBe(0);
    expect(P_LUT_MIX).toBe(COLOR_PARAMS_LEN - 1); // engine reads color[P_LUT_MIX]
    expect(P_LUT_MIX).toBe(P_GAIN + 1);
  });

  it("makes an otherwise-neutral grade active — and a 0% Look does not", () => {
    expect(gradeIsActive(withLut(1))).toBe(true);
    expect(gradeIsActive(withLut(0))).toBe(false);
    expect(gradeIsActive({ ...withLut(1), enabled: false })).toBe(false);
  });
});

describe("Look survives a .monet round trip", () => {
  const lut: ClipLut = { name: "vision-export.cube", text: IDENTITY_CUBE, intensity: 0.6 };

  it("re-emits the LUT text byte-for-byte through toMonet/fromMonet", () => {
    const p = createProject("Doc");
    const clip = createClip({ name: "hero", kind: "video", start: 0, duration: 24, inPoint: 0 });
    clip.color.enabled = true;
    clip.color.lut = { ...lut };
    p.sequences[0].tracks[0].clips.push(clip);

    const back = fromMonet(toMonet(p)).sequences[0].tracks[0].clips[0];
    expect(back.color.lut).toEqual(lut);
    expect(resolveLut(back.color.lut)).not.toBeNull();
  });

  it("drops a malformed Look on load rather than shipping it to the engine", () => {
    const p = createProject("Doc");
    const clip = createClip({ name: "hero", kind: "video", start: 0, duration: 24, inPoint: 0 });
    clip.color.enabled = true;
    // A hand-edited / hostile document.
    (clip.color as { lut?: unknown }).lut = { name: 7, intensity: "loud" };
    p.sequences[0].tracks[0].clips.push(clip);

    const back = fromMonet(toMonet(p)).sequences[0].tracks[0].clips[0];
    expect(back.color.lut).toBeUndefined();
    expect(gradeToParams(back.color)[P_LUT_MIX]).toBe(0);
  });
});
