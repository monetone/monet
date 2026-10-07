import { describe, expect, it } from "vitest";
import { fromChannels } from "../audio/buffer";
import { sine } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { generateSilence } from "../generate/silence";
import { concat } from "../audio/buffer";
import { fft, isPow2, magnitudes, nextPow2 } from "./fft";
import { analyzeLevels, channelStats, rmsEnvelope } from "./levels";
import { spectrum } from "./spectrum";
import { measureLoudness } from "./loudness";
import { channelPeaks, computePeaks } from "./peaks";
import { detectClipping, detectSilence } from "./detect";
import { scanAudioDiagnostics } from "./diagnostics";

const SR = 48000;

describe("fft", () => {
  it("nextPow2 / isPow2", () => {
    expect(nextPow2(1000)).toBe(1024);
    expect(isPow2(1024)).toBe(true);
    expect(isPow2(1000)).toBe(false);
  });

  it("forward then inverse FFT round-trips", () => {
    const n = 16;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 2 * i) / n);
    const re0 = re.slice();
    fft(re, im, false);
    fft(re, im, true);
    for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(re0[i], 6);
  });

  it("a delta has a flat magnitude spectrum", () => {
    const sig = new Float32Array(16);
    sig[0] = 1;
    const mag = magnitudes(sig, 16);
    for (const m of mag) expect(m).toBeCloseTo(1, 6);
  });

  it("a sine peaks at its frequency bin", () => {
    const fftSize = 4096;
    const freq = 1000;
    const sig = sine(freq, fftSize / SR, { sampleRate: SR, amplitude: 1 }).channels[0];
    const mag = magnitudes(sig, fftSize);
    let peakBin = 0;
    for (let i = 1; i < mag.length; i++) if (mag[i] > mag[peakBin]) peakBin = i;
    const peakFreq = (peakBin * SR) / fftSize;
    expect(peakFreq).toBeCloseTo(freq, -1.2); // within ~1 bin
  });
});

describe("levels", () => {
  it("peak/rms of a full-scale sine", () => {
    const d = sine(440, 0.2, { sampleRate: SR, amplitude: 1 });
    const s = analyzeLevels(d);
    expect(s.peak).toBeCloseTo(1, 2);
    expect(s.rms).toBeCloseTo(Math.SQRT1_2, 2);
    expect(s.peakDb).toBeCloseTo(0, 1);
  });

  it("channelStats detects DC offset and clipping", () => {
    const s = channelStats(Float32Array.from([1, 1, 1, 1]));
    expect(s.dcOffset).toBeCloseTo(1, 6);
    expect(s.clippedSamples).toBe(4);
  });

  it("rmsEnvelope tracks loud→quiet", () => {
    const loud = sine(440, 0.1, { sampleRate: SR, amplitude: 1 }).channels[0];
    const quiet = sine(440, 0.1, { sampleRate: SR, amplitude: 0.1 }).channels[0];
    const env = rmsEnvelope(Float32Array.from([...loud, ...quiet]), SR * 0.05);
    expect(env[0]).toBeGreaterThan(env[env.length - 1]);
  });
});

describe("spectrum", () => {
  it("a full-scale sine reads near 0 dB at its frequency", () => {
    const d = sine(1000, 0.5, { sampleRate: SR, amplitude: 1 });
    const s = spectrum(d, { fftSize: 8192, window: "hann" });
    let peak = 0;
    for (let i = 1; i < s.db.length; i++) if (s.db[i] > s.db[peak]) peak = i;
    expect(s.freqs[peak]).toBeCloseTo(1000, -2);
    expect(s.db[peak]).toBeGreaterThan(-3);
    expect(s.db[peak]).toBeLessThan(3);
  });
});

describe("loudness (LUFS)", () => {
  it("a steady tone yields a finite integrated loudness near momentary", () => {
    const d = sine(1000, 2, { sampleRate: SR, amplitude: 0.5 });
    const l = measureLoudness(d);
    expect(Number.isFinite(l.integrated)).toBe(true);
    expect(Math.abs(l.integrated - l.momentaryMax)).toBeLessThan(1.5);
  });

  it("a louder tone measures higher than a quieter one", () => {
    const loud = measureLoudness(sine(1000, 2, { sampleRate: SR, amplitude: 0.8 }));
    const quiet = measureLoudness(sine(1000, 2, { sampleRate: SR, amplitude: 0.2 }));
    expect(loud.integrated).toBeGreaterThan(quiet.integrated);
  });

  it("silence is gated out (−∞ integrated)", () => {
    const l = measureLoudness(generateSilence(2, 1, SR));
    expect(l.integrated).toBe(-Infinity);
  });
});

describe("peaks", () => {
  it("channelPeaks min ≤ max and within range", () => {
    const d = sine(440, 0.2, { sampleRate: SR, amplitude: 1 });
    const p = channelPeaks(d.channels[0], 100);
    for (let i = 0; i < 100; i++) {
      expect(p.min[i]).toBeLessThanOrEqual(p.max[i]);
      expect(p.max[i]).toBeLessThanOrEqual(1.0001);
      expect(p.min[i]).toBeGreaterThanOrEqual(-1.0001);
    }
  });

  it("computePeaks returns one entry per channel", () => {
    const d = sine(440, 0.1, { sampleRate: SR, channels: 2 });
    expect(computePeaks(d, 50)).toHaveLength(2);
  });
});

describe("detection", () => {
  it("detectSilence finds the silent lead-in", () => {
    const sig = concat(generateSilence(0.5, 1, SR), sine(440, 0.5, { sampleRate: SR, amplitude: 0.8 }));
    const regions = detectSilence(sig, -60, 0.2);
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions[0].start).toBeCloseTo(0, 2);
    expect(regions[0].end).toBeCloseTo(0.5, 1);
  });

  it("detectClipping counts full-scale samples", () => {
    const d = fromChannels([[0.1, 1.0, -1.0, 0.2, 1.0]], SR);
    const report = detectClipping(d);
    expect(report.count).toBe(3);
    expect(report.positions).toContain(1);
  });

  it("clean audio reports no clipping", () => {
    const d = sine(440, 0.2, { sampleRate: SR, amplitude: 0.5 });
    expect(detectClipping(d).count).toBe(0);
  });

  it("scanAudioDiagnostics reports flat clipping and long silence as selectable ranges", () => {
    const hot = sine(440, 0.25, { sampleRate: SR, amplitude: 1.5 }).channels[0];
    const clipped = fromChannels([Array.from(hot, (v) => Math.max(-1, Math.min(1, v)))], SR);
    const sig = concat(generateSilence(0.35, 1, SR), clipped, generateSilence(0.35, 1, SR));
    const issues = scanAudioDiagnostics(sig, { clipCeiling: 0.999, minSilenceMs: 250 });

    expect(issues.some((issue) => issue.kind === "clipping")).toBe(true);
    expect(issues.filter((issue) => issue.kind === "silence")).toHaveLength(2);
    expect(issues.every((issue) => issue.end > issue.start && issue.sampleCount > 0)).toBe(true);
    expect(issues.every((issue) => issue.peak >= 0 && issue.peakDb <= 0 && issue.rms >= 0 && issue.rmsDb <= issue.peakDb)).toBe(true);
    expect(issues.find((issue) => issue.kind === "clipping")?.peakDb).toBeCloseTo(0, 4);
    expect(issues.filter((issue) => issue.kind === "silence").every((issue) => issue.peakDb <= -119 && issue.rmsDb <= -119)).toBe(true);
    expect(issues.map((issue) => issue.start)).toEqual([...issues].map((issue) => issue.start).sort((a, b) => a - b));
  });

  it("scanAudioDiagnostics reports repairable DC offset when enabled", () => {
    const tone = sine(440, 0.5, { sampleRate: SR, amplitude: 0.1 }).channels[0];
    const biased = fromChannels([Array.from(tone, (v) => v + 0.12)], SR);

    const issues = scanAudioDiagnostics(biased, {
      includeClipping: false,
      includeSilence: false,
      includeDcOffset: true,
      dcOffsetThresholdDb: -30,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("dc-offset");
    expect(issues[0].start).toBe(0);
    expect(issues[0].end).toBeCloseTo(0.5, 6);
    expect(issues[0].dcOffset).toBeCloseTo(0.12, 3);
    expect(issues[0].dcOffsetDb).toBeCloseTo(-18.4, 1);
    expect(
      scanAudioDiagnostics(biased, {
        includeClipping: false,
        includeSilence: false,
        includeDcOffset: true,
        dcOffsetThresholdDb: -12,
      }),
    ).toHaveLength(0);
    expect(scanAudioDiagnostics(biased, { includeClipping: false, includeSilence: false, includeDcOffset: false })).toHaveLength(0);
  });

  it("scanAudioDiagnostics reports short click/pop impulses when enabled", () => {
    const clean = sine(440, 0.5, { sampleRate: SR, amplitude: 0.2 }).channels[0];
    const clicked = Float32Array.from(clean);
    const clickFrame = Math.round(0.25 * SR);
    clicked[clickFrame] = -0.95;
    const audio = fromChannels([clicked], SR);

    const issues = scanAudioDiagnostics(audio, {
      includeClipping: false,
      includeClicks: true,
      includeDcOffset: false,
      includeSilence: false,
      clickThreshold: 0.1,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("click");
    expect(issues[0].start).toBeLessThan(0.25);
    expect(issues[0].end).toBeGreaterThan(0.25);
    expect(issues[0].sampleCount).toBeLessThanOrEqual(3);
    expect(scanAudioDiagnostics(audio, { includeClipping: false, includeDcOffset: false, includeSilence: false })).toHaveLength(0);
    expect(
      scanAudioDiagnostics(audio, {
        includeClipping: false,
        includeClicks: true,
        includeDcOffset: false,
        includeSilence: false,
        clickThreshold: 1,
      }),
    ).toHaveLength(0);
  });
});

describe("noise sanity for analysis", () => {
  it("white noise has a broadband spectrum (not a single peak)", () => {
    const d = whiteNoise(0.5, { sampleRate: SR, seed: 3, amplitude: 0.5 });
    const s = spectrum(d, { fftSize: 4096 });
    // spread: many bins within 12 dB of the max
    let max = -Infinity;
    for (const v of s.db) max = Math.max(max, v);
    let near = 0;
    for (const v of s.db) if (v > max - 12) near++;
    expect(near).toBeGreaterThan(s.db.length / 4);
  });
});
