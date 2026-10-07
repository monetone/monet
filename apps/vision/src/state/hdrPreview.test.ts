// Unit tests for the 32-bit Preview Options pure tone-map. Engine-free
// (node); the dialog + engine wiring are covered by the Rust side
// (`hdr_preview_default_matches_plain_clamp`, mod.rs). These pin the plain-JS
// spec that mirrors `hdr_preview_tone_map`: the exact identity fast path,
// exposure as 2^stops, gamma as 1/gamma, and the Highlight Compression fold.
import { describe, it, expect } from "vitest";
import {
  defaultHdrPreview,
  applyHdrPreviewChannel,
  HDR_PREVIEW_METHODS,
  HDR_EXPOSURE_MIN,
  HDR_EXPOSURE_MAX,
  HDR_GAMMA_MIN,
  HDR_GAMMA_MAX,
  HDR_GAMMA_FLOOR,
  type HdrPreviewState,
} from "./hdrPreview";

const st = (over: Partial<HdrPreviewState> = {}): HdrPreviewState => ({ ...defaultHdrPreview(), ...over });

describe("defaults & ranges", () => {
  it("default is identity (Exposure and Gamma, 0 stops, gamma 1)", () => {
    expect(defaultHdrPreview()).toEqual({ method: 0, exposure: 0, gamma: 1 });
  });

  it("exposes both methods", () => {
    expect(HDR_PREVIEW_METHODS).toEqual([
      { value: 0, label: "Exposure and Gamma" },
      { value: 1, label: "Highlight Compression" },
    ]);
  });

  it("range constants are sane", () => {
    expect(HDR_EXPOSURE_MIN).toBeLessThan(HDR_EXPOSURE_MAX);
    expect(HDR_GAMMA_MIN).toBeLessThan(HDR_GAMMA_MAX);
    expect(HDR_GAMMA_FLOOR).toBe(1e-4);
  });
});

describe("applyHdrPreviewChannel — identity fast path", () => {
  it("default settings pass every value through unchanged, including HDR range", () => {
    for (const v of [-1, 0, 0.5, 1, 2.5, 1000]) {
      expect(applyHdrPreviewChannel(v, defaultHdrPreview())).toBe(v);
    }
  });
});

describe("applyHdrPreviewChannel — Exposure and Gamma", () => {
  it("negative values clamp to 0 before the power (no NaN)", () => {
    const out = applyHdrPreviewChannel(-2, st({ exposure: 1 }));
    expect(out).toBe(0);
    expect(Number.isNaN(out)).toBe(false);
  });

  it("EV +1 doubles the scene-linear value", () => {
    expect(applyHdrPreviewChannel(0.25, st({ exposure: 1 }))).toBeCloseTo(0.5, 9);
  });

  it("EV -1 halves it", () => {
    expect(applyHdrPreviewChannel(0.5, st({ exposure: -1 }))).toBeCloseTo(0.25, 9);
  });

  it("gamma > 1 lifts a mid value toward 1", () => {
    // gamma 2 -> invGamma 0.5 -> sqrt(0.25) = 0.5
    expect(applyHdrPreviewChannel(0.25, st({ gamma: 2 }))).toBeCloseTo(0.5, 9);
  });

  it("gamma floor guards divide-by-zero for gamma 0", () => {
    const out = applyHdrPreviewChannel(0.5, st({ gamma: 0 }));
    expect(Number.isFinite(out)).toBe(true);
  });

  it("can preserve values above 1 (no clamp until write-out)", () => {
    expect(applyHdrPreviewChannel(3, st({ exposure: 0, gamma: 1.5 }))).toBeGreaterThan(1);
  });
});

describe("applyHdrPreviewChannel — Highlight Compression", () => {
  it("folds values above 1 back toward (but never reaching) 1", () => {
    const out = applyHdrPreviewChannel(4, st({ method: 1 }));
    expect(out).toBeLessThan(1);
    expect(out).toBeGreaterThan(0.5);
  });

  it("maps 0 to 0 and stays finite for huge inputs", () => {
    expect(applyHdrPreviewChannel(0, st({ method: 1 }))).toBe(0);
    expect(Number.isFinite(applyHdrPreviewChannel(1e6, st({ method: 1 })))).toBe(true);
  });

  it("is monotonic in the input", () => {
    const s = st({ method: 1 });
    let prev = -1;
    for (const v of [0, 0.1, 0.5, 1, 2, 5, 20]) {
      const out = applyHdrPreviewChannel(v, s);
      expect(out).toBeGreaterThan(prev);
      prev = out;
    }
  });
});
