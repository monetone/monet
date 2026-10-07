// ─────────────────────────────────────────────────────────────
// engine/ops/rack.test — persistent nondestructive rack rendering
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { spectrum } from "../analysis/spectrum";
import { rmsAmplitude } from "../dsp/normalize";
import { sine } from "../generate/tone";
import { newAutomationLane, newEffectRack, newEffectSlot } from "../model/factory";
import { applyEffectRack } from "./rack";

const SR = 48000;
const FFT = 4096;
const binHz = (bin: number): number => (bin * SR) / FFT;

function binDb(d: AudioData, hz: number): number {
  const spec = spectrum(d, { fftSize: FFT, window: "hann" });
  let best = 0;
  for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
  return spec.db[best];
}

function mix(...sources: AudioData[]): AudioData {
  const n = Math.min(...sources.map(frameCount));
  const channels = sources[0]?.channels.length ?? 1;
  const out = createAudioData(channels, n, SR);
  for (const source of sources) {
    for (let ch = 0; ch < channels; ch++) {
      for (let i = 0; i < n; i++) out.channels[ch][i] += source.channels[ch][i];
    }
  }
  return out;
}

function sideSignal(d: AudioData): AudioData {
  const out = createAudioData(1, frameCount(d), d.sampleRate);
  for (let i = 0; i < frameCount(d); i++) out.channels[0][i] = (d.channels[0][i] - d.channels[1][i]) / 2;
  return out;
}

function channelMeanAbsDiff(d: AudioData): number {
  const n = frameCount(d);
  if (d.channels.length < 2 || n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(d.channels[0][i] - d.channels[1][i]);
  return sum / n;
}

function meanAbsDiff(a: AudioData, b: AudioData): number {
  const n = Math.min(frameCount(a), frameCount(b));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs((a.channels[0][i] ?? 0) - (b.channels[0][i] ?? 0));
  return n > 0 ? sum / n : 0;
}

function segmentRms(d: AudioData, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * d.sampleRate));
  const end = Math.min(frameCount(d), Math.round(endSeconds * d.sampleRate));
  let sum = 0;
  let count = 0;
  for (const channel of d.channels) {
    for (let i = start; i < end; i++) {
      sum += channel[i] * channel[i];
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

function channelSegmentRms(d: AudioData, channelIndex: number, startSeconds: number, endSeconds: number): number {
  const channel = d.channels[channelIndex];
  if (!channel) return 0;
  const start = Math.max(0, Math.round(startSeconds * d.sampleRate));
  const end = Math.min(frameCount(d), Math.round(endSeconds * d.sampleRate));
  let sum = 0;
  for (let i = start; i < end; i++) sum += channel[i] * channel[i];
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

function impulseAt(seconds: number, totalSeconds = 0.8): AudioData {
  const d = createAudioData(1, Math.round(totalSeconds * SR), SR);
  d.channels[0][Math.round(seconds * SR)] = 1;
  return d;
}

function limiterImpulseOnsets(): AudioData {
  const d = createAudioData(1, SR, SR);
  for (let i = 0; i < frameCount(d); i++) d.channels[0][i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR);
  d.channels[0][Math.round(0.25 * SR)] = 1;
  d.channels[0][Math.round(0.75 * SR)] = 1;
  return d;
}

function segmentMeanAbsDiff(a: AudioData, b: AudioData, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * a.sampleRate));
  const end = Math.min(frameCount(a), frameCount(b), Math.round(endSeconds * a.sampleRate));
  let sum = 0;
  let count = 0;
  const channels = Math.min(a.channels.length, b.channels.length);
  for (let c = 0; c < channels; c++) {
    for (let i = start; i < end; i++) {
      sum += Math.abs(a.channels[c][i] - b.channels[c][i]);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

describe("applyEffectRack", () => {
  it("renders parametric EQ slots as document-native rack processors", () => {
    const hz = binHz(86);
    const input = sine(hz, 0.5, { sampleRate: SR, amplitude: 0.25, channels: 1 });
    const rack = newEffectRack({
      slots: [newEffectSlot("parametricEQ", { params: { freq: hz, q: 4, gainDb: 12 } })],
    });

    const out = applyEffectRack(input, rack);

    expect(binDb(out, hz)).toBeGreaterThan(binDb(input, hz) + 6);
  });

  it("keeps native plug-in rack slots as inventory-only pass-through placeholders", () => {
    const input = sine(440, 0.2, { sampleRate: SR, amplitude: 0.25, channels: 1 });
    const rack = newEffectRack({
      slots: [newEffectSlot("nativePlugin", { params: { pluginId: "native-vst3-pro-q", hostStatus: "inventoryOnly", canProcess: false } })],
    });

    const out = applyEffectRack(input, rack);

    expect(out).toBe(input);
  });

  it("renders DeHummer slots and attenuates the selected hum fundamental", () => {
    const humHz = binHz(8);
    const hum = sine(humHz, 0.5, { sampleRate: SR, amplitude: 0.35, channels: 1 });
    const voice = sine(1000, 0.5, { sampleRate: SR, amplitude: 0.25, channels: 1 });
    const input = mix(hum, voice);
    const rack = newEffectRack({
      slots: [newEffectSlot("dehummer", { params: { frequency: humHz, q: 30, reductionDb: -36, harmonics: 1 } })],
    });

    const out = applyEffectRack(input, rack);

    expect(binDb(out, humHz)).toBeLessThan(binDb(input, humHz) - 18);
    expect(Math.abs(binDb(out, 1000) - binDb(input, 1000))).toBeLessThan(4);
  });

  it("renders stereo expander rack slots in the mid-side domain", () => {
    const tone = sine(440, 0.25, { sampleRate: SR, amplitude: 0.2, channels: 1 }).channels[0];
    const input = createAudioData(2, tone.length, SR);
    input.channels[0].set(tone);
    input.channels[1].set(Float32Array.from(tone, (sample) => -sample));
    const rack = newEffectRack({
      slots: [newEffectSlot("stereoExpander", { params: { expand: 200, centerPan: 0 } })],
    });

    const out = applyEffectRack(input, rack);

    expect(rmsAmplitude(sideSignal(out))).toBeGreaterThan(rmsAmplitude(sideSignal(input)) * 1.8);
  });

  it("renders phaser rack slots as persistent modulation processors", () => {
    const input = sine(880, 0.2, { sampleRate: SR, amplitude: 0.35, channels: 1 });
    const rack = newEffectRack({
      slots: [newEffectSlot("phaser", { params: { rateHz: 1.2, stages: 6, depth: 1, feedback: 0.4, mix: 1, baseFreqHz: 250, rangeOctaves: 5 } })],
    });

    const out = applyEffectRack(input, rack);

    expect(frameCount(out)).toBe(frameCount(input));
    expect(meanAbsDiff(out, input)).toBeGreaterThan(0.01);
  });

  it("renders distortion, guitar, exciter, and vocal rack slots", () => {
    const input = sine(440, 0.2, { sampleRate: SR, amplitude: 0.25, channels: 1 });
    const rack = newEffectRack({
      slots: [
        newEffectSlot("waveshaper", { params: { driveDb: 18, amount: 1, mix: 1 } }),
        newEffectSlot("guitarSuite", { params: { driveDb: 18, toneHz: 4500, mix: 0.8, outputDb: -3 } }),
        newEffectSlot("exciter", { params: { frequency: 1000, driveDb: 24, mix: 0.5 } }),
        newEffectSlot("vocalEnhancer", { params: { mode: "music" } }),
      ],
    });

    const out = applyEffectRack(input, rack);

    expect(frameCount(out)).toBe(frameCount(input));
    expect(binDb(out, 1320)).toBeGreaterThan(binDb(input, 1320) + 12);
  });

  it("renders center, channel matrix, and graphic phase rack slots", () => {
    const centerTone = sine(440, 0.5, { sampleRate: SR, amplitude: 0.3, channels: 1 }).channels[0];
    const centerInput = createAudioData(2, centerTone.length, SR);
    centerInput.channels[0].set(centerTone);
    centerInput.channels[1].set(centerTone);
    const centerOut = applyEffectRack(
      centerInput,
      newEffectRack({ slots: [newEffectSlot("centerChannel", { params: { mode: "remove", centerLevelDb: -80, sideLevelDb: 0, lowFreq: 20, highFreq: 20000 } })] }),
    );
    expect(rmsAmplitude(centerOut)).toBeLessThan(rmsAmplitude(centerInput) * 0.08);

    const matrixInput = createAudioData(2, 8, SR);
    matrixInput.channels[0].fill(0.1);
    matrixInput.channels[1].fill(0.4);
    const matrixOut = applyEffectRack(
      matrixInput,
      newEffectRack({ slots: [newEffectSlot("channelMixer", { params: { leftToLeft: 0, rightToLeft: 100, leftToRight: 100, rightToRight: 0 } })] }),
    );
    expect(matrixOut.channels[0][0]).toBeCloseTo(0.4, 6);
    expect(matrixOut.channels[1][0]).toBeCloseTo(0.1, 6);

    const phaseInput = sine(1000, 0.2, { sampleRate: SR, amplitude: 0.25, channels: 1 });
    const phaseOut = applyEffectRack(
      phaseInput,
      newEffectRack({ slots: [newEffectSlot("graphicPhaseShifter", { params: { channel: "both", lowPhaseDeg: 180, highPhaseDeg: 180 } })] }),
    );
    expect(frameCount(phaseOut)).toBe(frameCount(phaseInput));
    expect(meanAbsDiff(phaseOut, phaseInput)).toBeGreaterThan(0.1);
  });

  it("renders automatic phase correction rack slots", () => {
    const tone = sine(1000, 0.15, { sampleRate: SR, amplitude: 0.4, channels: 1 }).channels[0];
    const input = createAudioData(2, tone.length, SR);
    input.channels[0].set(tone);
    for (let i = 12; i < tone.length; i++) input.channels[1][i] = tone[i - 12];
    const before = channelMeanAbsDiff(input);
    const rack = newEffectRack({
      slots: [newEffectSlot("autoPhaseCorrect", { params: { mode: "auto", maxShiftMs: 2, correctPolarity: true } })],
    });

    const out = applyEffectRack(input, rack);

    expect(frameCount(out)).toBe(frameCount(input));
    expect(channelMeanAbsDiff(out)).toBeLessThan(before * 0.5);
  });

  it("renders tube, speech leveler, and mastering rack slots", () => {
    const input = sine(440, 0.3, { sampleRate: SR, amplitude: 0.08, channels: 1 });
    const rack = newEffectRack({
      slots: [
        newEffectSlot("tubeCompressor", { params: { driveDb: 12, warmth: 0.6, thresholdDb: -24, ratio: 3, makeupDb: 4 } }),
        newEffectSlot("speechLeveler", { params: { targetDb: -18, amount: 0.8, maxGainDb: 24, gateDb: -60, windowMs: 120 } }),
        newEffectSlot("mastering", { params: { lowShelfDb: 1, highShelfDb: 2, exciteAmount: 0.2, width: 1, driveDb: 4, ceilingDb: -1, amount: 1 } }),
      ],
    });

    const out = applyEffectRack(input, rack);

    expect(frameCount(out)).toBe(frameCount(input));
    expect(meanAbsDiff(out, input)).toBeGreaterThan(0.01);
    expect(rmsAmplitude(out)).toBeGreaterThan(rmsAmplitude(input));
  });

  it("renders Speech Leveler rack target automation during offline rack processing", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.08, channels: 1 });
    const slot = newEffectSlot("speechLeveler", {
      id: "fx-speech-leveler-auto",
      params: { targetDb: -40, amount: 1, maxGainDb: 30, gateDb: -80, windowMs: 10 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "targetDb" },
          interpolation: "hold",
          points: [
            { time: 0, value: -40 },
            { time: 0.5, value: -12 },
          ],
        }),
      ],
    });

    const outFirst = segmentRms(out, 0.2, 0.45);
    const outSecond = segmentRms(out, 0.75, 0.95);

    expect(outFirst).toBeLessThan(0.02);
    expect(outSecond).toBeGreaterThan(outFirst * 4);
  });

  it("renders Hard Limiter rack ceiling automation during offline rack processing", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 1 });
    const slot = newEffectSlot("limiter", {
      id: "fx-limiter-auto",
      params: { ceilingDb: 0, inputBoostDb: 0, lookAheadMs: 0, releaseMs: 5 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "ceilingDb" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: -20 },
          ],
        }),
      ],
    });

    const outFirst = segmentRms(out, 0.1, 0.45);
    const outSecond = segmentRms(out, 0.65, 0.95);

    expect(outFirst).toBeGreaterThan(0.45);
    expect(outSecond).toBeLessThan(outFirst * 0.2);
  });

  it("renders Hard Limiter rack look-ahead automation before later loud onsets", () => {
    const input = limiterImpulseOnsets();
    const slot = newEffectSlot("limiter", {
      id: "fx-limiter-lookahead-auto",
      params: { ceilingDb: -0.3, inputBoostDb: 6, lookAheadMs: 0, releaseMs: 20 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "lookAheadMs" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 20 },
          ],
        }),
      ],
    });

    const firstPre = segmentRms(out, 0.23, 0.25);
    const secondPre = segmentRms(out, 0.73, 0.75);

    expect(firstPre).toBeGreaterThan(secondPre * 1.15);
  });

  it("renders Distortion rack amount automation during offline rack processing", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.9, channels: 1 });
    const slot = newEffectSlot("waveshaper", {
      id: "fx-waveshaper-auto",
      params: { amount: 0, driveDb: 0, mix: 1 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "amount" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 1 },
          ],
        }),
      ],
    });
    const lowAmount = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("waveshaper", { params: { amount: 0, driveDb: 0, mix: 1 } })] }));
    const highAmount = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("waveshaper", { params: { amount: 1, driveDb: 0, mix: 1 } })] }));

    expect(segmentMeanAbsDiff(out, lowAmount, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, highAmount, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(lowAmount, highAmount, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Exciter rack mix automation during offline rack processing", () => {
    const input = sine(5000, 1, { sampleRate: SR, amplitude: 0.5, channels: 1 });
    const slot = newEffectSlot("exciter", {
      id: "fx-exciter-auto",
      params: { frequency: 3000, driveDb: 15, mix: 0 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "mix" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 0.6 },
          ],
        }),
      ],
    });
    const dry = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("exciter", { params: { frequency: 3000, driveDb: 15, mix: 0 } })] }));
    const wet = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("exciter", { params: { frequency: 3000, driveDb: 15, mix: 0.6 } })] }));

    expect(segmentMeanAbsDiff(out, dry, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Exciter rack frequency automation before the high-band detector", () => {
    const input = sine(5000, 1, { sampleRate: SR, amplitude: 0.5, channels: 1 });
    const params = { frequency: 12000, driveDb: 15, mix: 0.6 };
    const slot = newEffectSlot("exciter", {
      id: "fx-exciter-frequency-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "frequency" },
          interpolation: "hold",
          points: [
            { time: 0, value: 12000 },
            { time: 0.5, value: 1000 },
          ],
        }),
      ],
    });
    const closed = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("exciter", { params })] }));
    const open = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("exciter", { params: { ...params, frequency: 1000 } })] }));

    expect(segmentMeanAbsDiff(out, closed, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, open, 0.8, 0.95)).toBeLessThan(1e-3);
    expect(segmentMeanAbsDiff(closed, open, 0.8, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Guitar Suite rack mix and output automation during offline rack processing", () => {
    const input = sine(400, 1, { sampleRate: SR, amplitude: 0.3, channels: 1 });
    const params = { driveDb: 18, bodyHz: 90, toneHz: 5000, presenceDb: 3, mix: 0, outputDb: 0 };
    const slot = newEffectSlot("guitarSuite", {
      id: "fx-guitar-suite-mix-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "mix" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 1 },
          ],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "outputDb" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 6 },
          ],
        }),
      ],
    });
    const wet = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("guitarSuite", { params: { ...params, mix: 1, outputDb: 6 } })] }));

    expect(segmentMeanAbsDiff(out, input, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(input, wet, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Guitar Suite rack drive automation during offline rack processing", () => {
    const input = sine(400, 1, { sampleRate: SR, amplitude: 0.3, channels: 1 });
    const params = { driveDb: 0, bodyHz: 90, toneHz: 5000, presenceDb: 3, mix: 1, outputDb: 0 };
    const slot = newEffectSlot("guitarSuite", {
      id: "fx-guitar-suite-drive-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "driveDb" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 24 },
          ],
        }),
      ],
    });
    const low = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("guitarSuite", { params })] }));
    const high = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("guitarSuite", { params: { ...params, driveDb: 24 } })] }));

    expect(segmentMeanAbsDiff(out, low, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, high, 0.8, 0.95)).toBeLessThan(1e-3);
    expect(segmentMeanAbsDiff(low, high, 0.8, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Guitar Suite rack cabinet automation during offline rack processing", () => {
    const input = mix(
      sine(70, 1, { sampleRate: SR, amplitude: 0.08, channels: 1 }),
      sine(3000, 1, { sampleRate: SR, amplitude: 0.08, channels: 1 }),
      sine(9000, 1, { sampleRate: SR, amplitude: 0.08, channels: 1 }),
    );
    const low = { driveDb: 0, bodyHz: 40, toneHz: 12000, presenceDb: 0, mix: 1, outputDb: 0 };
    const high = { ...low, bodyHz: 250, toneHz: 3000, presenceDb: 6 };
    const slot = newEffectSlot("guitarSuite", {
      id: "fx-guitar-suite-cabinet-auto",
      params: low,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "bodyHz" },
          points: [{ time: 0, value: high.bodyHz }],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "toneHz" },
          points: [{ time: 0, value: high.toneHz }],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "presenceDb" },
          points: [{ time: 0, value: high.presenceDb }],
        }),
      ],
    });
    const lowOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("guitarSuite", { params: low })] }));
    const highOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("guitarSuite", { params: high })] }));

    expect(segmentMeanAbsDiff(out, highOut, 0.2, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(lowOut, highOut, 0.2, 0.95)).toBeGreaterThan(0.005);
  });

  it("renders Mastering rack amount automation during offline rack processing", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.25, channels: 2 });
    const slot = newEffectSlot("mastering", {
      id: "fx-mastering-auto",
      params: { lowShelfDb: 1, highShelfDb: 2, exciteAmount: 0.2, width: 1.2, driveDb: 3, ceilingDb: -1, amount: 0 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "amount" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 1 },
          ],
        }),
      ],
    });
    const wet = applyEffectRack(
      input,
      newEffectRack({
        slots: [
          newEffectSlot("mastering", {
            params: { lowShelfDb: 1, highShelfDb: 2, exciteAmount: 0.2, width: 1.2, driveDb: 3, ceilingDb: -1, amount: 1 },
          }),
        ],
      }),
    );

    expect(segmentMeanAbsDiff(out, input, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(input, wet, 0.65, 0.95)).toBeGreaterThan(0.01);
  });

  it("renders Mastering rack EQ automation during offline rack processing", () => {
    const input = mix(
      sine(80, 1, { sampleRate: SR, amplitude: 0.08, channels: 1 }),
      sine(10000, 1, { sampleRate: SR, amplitude: 0.08, channels: 1 }),
    );
    const params = { lowShelfDb: 0, highShelfDb: 0, exciteAmount: 0, width: 1, driveDb: 0, ceilingDb: 0, amount: 1 };
    const boosted = { ...params, lowShelfDb: 6, highShelfDb: 6 };
    const slot = newEffectSlot("mastering", {
      id: "fx-mastering-eq-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "lowShelfDb" },
          points: [{ time: 0, value: boosted.lowShelfDb }],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "highShelfDb" },
          points: [{ time: 0, value: boosted.highShelfDb }],
        }),
      ],
    });
    const flat = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("mastering", { params })] }));
    const expected = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("mastering", { params: boosted })] }));

    expect(segmentMeanAbsDiff(out, expected, 0.2, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(flat, expected, 0.2, 0.95)).toBeGreaterThan(0.005);
  });

  it("renders Mastering rack excite automation during offline rack processing", () => {
    const input = sine(5000, 1, { sampleRate: SR, amplitude: 0.3, channels: 2 });
    const params = { lowShelfDb: 0, highShelfDb: 0, exciteAmount: 0, width: 1, driveDb: 0, ceilingDb: 0, amount: 1 };
    const slot = newEffectSlot("mastering", {
      id: "fx-mastering-excite-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "exciteAmount" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 0.8 },
          ],
        }),
      ],
    });
    const low = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("mastering", { params })] }));
    const high = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("mastering", { params: { ...params, exciteAmount: 0.8 } })] }));

    expect(segmentMeanAbsDiff(out, low, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, high, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(low, high, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Mastering rack width automation during offline rack processing", () => {
    const left = sine(330, 1, { sampleRate: SR, amplitude: 0.2, channels: 1 }).channels[0];
    const input = createAudioData(2, left.length, SR);
    input.channels[0].set(left);
    input.channels[1].set(sine(440, 1, { sampleRate: SR, amplitude: 0.2, channels: 1 }).channels[0]);
    const params = { lowShelfDb: 0, highShelfDb: 0, exciteAmount: 0, width: 1, driveDb: 0, ceilingDb: 0, amount: 1 };
    const slot = newEffectSlot("mastering", {
      id: "fx-mastering-width-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "width" },
          interpolation: "hold",
          points: [
            { time: 0, value: 1 },
            { time: 0.5, value: 2 },
          ],
        }),
      ],
    });
    const normal = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("mastering", { params })] }));
    const wide = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("mastering", { params: { ...params, width: 2 } })] }));

    expect(segmentMeanAbsDiff(out, normal, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wide, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(normal, wide, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Mastering rack ambience automation during offline rack processing", () => {
    const input = sine(440, 0.24, { sampleRate: SR, amplitude: 0.15, channels: 2 });
    const params = {
      lowShelfDb: 0,
      highShelfDb: 0,
      exciteAmount: 0,
      width: 1,
      ambience: 0,
      ambienceDecayMs: 40,
      ambiencePreDelayMs: 0,
      driveDb: 0,
      ceilingDb: 0,
      amount: 1,
    };
    const slot = newEffectSlot("mastering", {
      id: "fx-mastering-ambience-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "ambience" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.12, value: 0.4 },
          ],
        }),
      ],
    });
    const dry = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("mastering", { params })] }));
    const wet = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("mastering", { params: { ...params, ambience: 0.4 } })] }));

    expect(frameCount(out)).toBeGreaterThan(frameCount(input));
    expect(segmentMeanAbsDiff(out, dry, 0.04, 0.1)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.15, 0.22)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.15, 0.22)).toBeGreaterThan(0.01);
  });

  it("renders compressor rack threshold automation during offline rack processing", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.7, channels: 1 });
    const slot = newEffectSlot("compressor", {
      id: "fx-compressor-auto",
      params: { thresholdDb: 0, ratio: 20, attackMs: 0.1, releaseMs: 20, kneeDb: 0, makeupDb: 0 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "thresholdDb" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: -40 },
          ],
        }),
      ],
    });

    const inputFirst = segmentRms(input, 0.1, 0.45);
    const outFirst = segmentRms(out, 0.1, 0.45);
    const outSecond = segmentRms(out, 0.65, 0.95);

    expect(outFirst).toBeGreaterThan(inputFirst * 0.85);
    expect(outSecond).toBeLessThan(outFirst * 0.25);
  });

  it("renders tube compressor rack threshold automation during offline rack processing", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.7, channels: 1 });
    const slot = newEffectSlot("tubeCompressor", {
      id: "fx-tube-auto",
      params: { driveDb: 0, warmth: 0, thresholdDb: 0, ratio: 20, attackMs: 0.1, releaseMs: 20, makeupDb: 0 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "thresholdDb" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: -40 },
          ],
        }),
      ],
    });

    const outFirst = segmentRms(out, 0.1, 0.45);
    const outSecond = segmentRms(out, 0.65, 0.95);

    expect(outFirst).toBeGreaterThan(0.3);
    expect(outSecond).toBeLessThan(outFirst * 0.25);
  });

  it("renders tube compressor rack saturation automation during offline rack processing", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.6, channels: 1 });
    const params = { driveDb: 0, warmth: 0, thresholdDb: 0, ratio: 1, attackMs: 10, releaseMs: 150, makeupDb: 0 };
    const slot = newEffectSlot("tubeCompressor", {
      id: "fx-tube-saturation-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "driveDb" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 18 },
          ],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "warmth" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 0.8 },
          ],
        }),
      ],
    });
    const low = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("tubeCompressor", { params })] }));
    const high = applyEffectRack(
      input,
      newEffectRack({ slots: [newEffectSlot("tubeCompressor", { params: { ...params, driveDb: 18, warmth: 0.8 } })] }),
    );

    expect(segmentMeanAbsDiff(out, low, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, high, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(low, high, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders DeEsser rack threshold automation during offline rack processing", () => {
    const input = sine(7000, 1, { sampleRate: SR, amplitude: 0.7, channels: 1 });
    const slot = newEffectSlot("deesser", {
      id: "fx-deesser-auto",
      params: { centerFreq: 7000, q: 8, thresholdDb: 0, ratio: 20, attackMs: 0.1, releaseMs: 20, rangeDb: 48 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "thresholdDb" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: -60 },
          ],
        }),
      ],
    });

    const inputFirst = segmentRms(input, 0.1, 0.45);
    const outFirst = segmentRms(out, 0.1, 0.45);
    const outSecond = segmentRms(out, 0.65, 0.95);

    expect(outFirst).toBeGreaterThan(inputFirst * 0.85);
    expect(outSecond).toBeLessThan(outFirst * 0.35);
  });

  it("renders Center Channel rack level automation during offline rack processing", () => {
    const centered = sine(440, 1, { sampleRate: SR, amplitude: 0.5, channels: 1 }).channels[0];
    const input = createAudioData(2, centered.length, SR);
    input.channels[0].set(centered);
    input.channels[1].set(centered);
    const slot = newEffectSlot("centerChannel", {
      id: "fx-center-auto",
      params: { mode: "remove", centerLevelDb: 0, sideLevelDb: 0, lowFreq: 20, highFreq: 20000 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "centerLevelDb" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: -80 },
          ],
        }),
      ],
    });

    const inputFirst = segmentRms(input, 0.1, 0.45);
    const outFirst = segmentRms(out, 0.1, 0.45);
    const outSecond = segmentRms(out, 0.65, 0.95);

    expect(outFirst).toBeGreaterThan(inputFirst * 0.75);
    expect(outSecond).toBeLessThan(outFirst * 0.1);
  });

  it("renders Channel Mixer rack matrix automation during offline rack processing", () => {
    const left = sine(440, 1, { sampleRate: SR, amplitude: 0.5, channels: 1 }).channels[0];
    const input = createAudioData(2, left.length, SR);
    input.channels[0].set(left);
    const slot = newEffectSlot("channelMixer", {
      id: "fx-channel-mixer-auto",
      params: { leftToLeft: 100, rightToLeft: 0, leftToRight: 0, rightToRight: 100 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "leftToRight" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 100 },
          ],
        }),
      ],
    });

    const leftFirst = channelSegmentRms(out, 0, 0.1, 0.45);
    const rightFirst = channelSegmentRms(out, 1, 0.1, 0.45);
    const rightSecond = channelSegmentRms(out, 1, 0.65, 0.95);

    expect(leftFirst).toBeGreaterThan(0.3);
    expect(rightFirst).toBeLessThan(1e-4);
    expect(rightSecond).toBeGreaterThan(leftFirst * 0.85);
  });

  it("renders Stereo Expander rack width automation during offline rack processing", () => {
    const side = sine(440, 1, { sampleRate: SR, amplitude: 0.3, channels: 1 }).channels[0];
    const input = createAudioData(2, side.length, SR);
    input.channels[0].set(side);
    input.channels[1].set(Float32Array.from(side, (sample) => -sample));
    const slot = newEffectSlot("stereoExpander", {
      id: "fx-stereo-expander-auto",
      params: { expand: 0, centerPan: 0 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "expand" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 200 },
          ],
        }),
      ],
    });

    const inputSideFirst = segmentRms(sideSignal(input), 0.1, 0.45);
    const outSideFirst = segmentRms(sideSignal(out), 0.1, 0.45);
    const outSideSecond = segmentRms(sideSignal(out), 0.65, 0.95);

    expect(outSideFirst).toBeLessThan(1e-4);
    expect(outSideSecond).toBeGreaterThan(inputSideFirst * 1.8);
  });

  it("renders Phaser rack mix automation during offline rack processing", () => {
    const input = sine(700, 1, { sampleRate: SR, amplitude: 0.4, channels: 1 });
    const params = { rateHz: 0.8, stages: 4, depth: 1, feedback: 0.3, mix: 0, baseFreqHz: 250, rangeOctaves: 4 };
    const slot = newEffectSlot("phaser", {
      id: "fx-phaser-mix-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "mix" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 1 },
          ],
        }),
      ],
    });
    const dry = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("phaser", { params })] }));
    const wet = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("phaser", { params: { ...params, mix: 1 } })] }));

    expect(segmentMeanAbsDiff(out, dry, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Phaser rack sweep automation during offline rack processing", () => {
    const input = sine(700, 1, { sampleRate: SR, amplitude: 0.4, channels: 1 });
    const low = { rateHz: 0.1, stages: 4, depth: 0.2, feedback: 0.2, mix: 1, baseFreqHz: 120, rangeOctaves: 1 };
    const high = { ...low, rateHz: 2.5, depth: 1, baseFreqHz: 900, rangeOctaves: 5 };
    const slot = newEffectSlot("phaser", {
      id: "fx-phaser-sweep-auto",
      params: low,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "rateHz" },
          points: [{ time: 0, value: high.rateHz }],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "depth" },
          points: [{ time: 0, value: high.depth }],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "baseFreqHz" },
          points: [{ time: 0, value: high.baseFreqHz }],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "rangeOctaves" },
          points: [{ time: 0, value: high.rangeOctaves }],
        }),
      ],
    });
    const expected = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("phaser", { params: high })] }));

    expect(segmentMeanAbsDiff(out, expected, 0, 1)).toBeLessThan(1e-6);
  });

  it("renders Phaser rack stage-count automation in the allpass cascade", () => {
    const input = impulseAt(0.55, 0.8);
    const low = { rateHz: 0, stages: 2, depth: 0, feedback: 0, mix: 1, baseFreqHz: 700, rangeOctaves: 0 };
    const high = { ...low, stages: 8 };
    const slot = newEffectSlot("phaser", {
      id: "fx-phaser-stages-auto",
      params: low,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "stages" },
          interpolation: "hold",
          points: [
            { time: 0, value: low.stages },
            { time: 0.5, value: high.stages },
          ],
        }),
      ],
    });
    const lowOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("phaser", { params: low })] }));
    const highOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("phaser", { params: high })] }));

    expect(segmentMeanAbsDiff(out, highOut, 0.55, 0.75)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(lowOut, highOut, 0.55, 0.75)).toBeGreaterThan(5e-4);
  });

  it("renders Delay rack mix automation during offline rack processing", () => {
    const input = sine(445, 1, { sampleRate: SR, amplitude: 0.3, channels: 1 });
    const params = { delayMs: 50, feedback: 0.35, mix: 0, tailSeconds: 0.2 };
    const slot = newEffectSlot("delay", {
      id: "fx-delay-mix-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "mix" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 1 },
          ],
        }),
      ],
    });
    const dry = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("delay", { params })] }));
    const wet = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("delay", { params: { ...params, mix: 1 } })] }));

    expect(segmentMeanAbsDiff(out, dry, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Delay rack feedback automation into future repeats", () => {
    const input = createAudioData(1, 1, SR);
    input.channels[0][0] = 1;
    const delayMs = 100;
    const slot = newEffectSlot("delay", {
      id: "fx-delay-feedback-auto",
      params: { delayMs, feedback: 0, mix: 1, tailSeconds: 0.35 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "feedback" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.05, value: 0.5 },
          ],
        }),
      ],
    });
    const d = Math.round((delayMs / 1000) * SR);

    expect(out.channels[0][d]).toBeCloseTo(1, 6);
    expect(out.channels[0][2 * d]).toBeCloseTo(0.5, 6);
    expect(out.channels[0][3 * d]).toBeCloseTo(0.25, 6);
  });

  it("renders Delay rack time automation into future repeat timing", () => {
    const input = createAudioData(1, 1, SR);
    input.channels[0][0] = 1;
    const slot = newEffectSlot("delay", {
      id: "fx-delay-time-auto",
      params: { delayMs: 100, feedback: 0.5, mix: 1, tailSeconds: 0.25 },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "delayMs" },
          interpolation: "hold",
          points: [
            { time: 0, value: 100 },
            { time: 0.12, value: 50 },
          ],
        }),
      ],
    });

    expect(out.channels[0][Math.round(0.1 * SR)]).toBeCloseTo(1, 6);
    expect(out.channels[0][Math.round(0.15 * SR)]).toBeCloseTo(0.5, 6);
    expect(out.channels[0][Math.round(0.2 * SR)]).toBeCloseTo(0.25, 6);
  });

  it("renders Delay rack tail automation into appended repeats", () => {
    const input = impulseAt(0.55, 0.6);
    const short = { delayMs: 100, feedback: 0.5, mix: 1, tailSeconds: 0.05 };
    const long = { ...short, tailSeconds: 0.35 };
    const slot = newEffectSlot("delay", {
      id: "fx-delay-tail-auto",
      params: short,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "tailSeconds" },
          interpolation: "hold",
          points: [
            { time: 0, value: short.tailSeconds },
            { time: 0.5, value: long.tailSeconds },
          ],
        }),
      ],
    });
    const shortOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("delay", { params: short })] }));
    const longOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("delay", { params: long })] }));
    const laterRepeat = Math.round(0.75 * SR);

    expect(frameCount(out)).toBe(frameCount(longOut));
    expect(frameCount(shortOut)).toBeLessThanOrEqual(laterRepeat);
    expect(out.channels[0][laterRepeat]).toBeCloseTo(longOut.channels[0][laterRepeat], 6);
    expect(Math.abs(out.channels[0][laterRepeat])).toBeGreaterThan(0.1);
  });

  it("renders Analog Delay rack mix automation during offline rack processing", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.3, channels: 1 });
    const params = { delayMs: 50, feedback: 0.35, toneHz: 4000, driveDb: 0, mix: 0, tailSeconds: 0.2 };
    const slot = newEffectSlot("analogDelay", {
      id: "fx-analog-delay-mix-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "mix" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 1 },
          ],
        }),
      ],
    });
    const dry = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("analogDelay", { params })] }));
    const wet = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("analogDelay", { params: { ...params, mix: 1 } })] }));

    expect(segmentMeanAbsDiff(out, dry, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Analog Delay rack feedback automation into later repeats", () => {
    const input = createAudioData(1, 1, SR);
    input.channels[0][0] = 1;
    const params = { delayMs: 100, feedback: 0, toneHz: 8000, driveDb: 0, mix: 1, tailSeconds: 0.35 };
    const slot = newEffectSlot("analogDelay", {
      id: "fx-analog-delay-feedback-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "feedback" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.05, value: 0.5 },
          ],
        }),
      ],
    });
    const high = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("analogDelay", { params: { ...params, feedback: 0.5 } })] }));

    expect(segmentMeanAbsDiff(out, high, 0.15, 0.34)).toBeLessThan(1e-6);
  });

  it("renders Analog Delay rack time automation into later delayed samples", () => {
    const input = sine(445, 1, { sampleRate: SR, amplitude: 0.3, channels: 1 });
    const long = { delayMs: 100, feedback: 0, toneHz: 12000, driveDb: 0, mix: 1, tailSeconds: 0.1 };
    const short = { ...long, delayMs: 50 };
    const slot = newEffectSlot("analogDelay", {
      id: "fx-analog-delay-time-auto",
      params: long,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "delayMs" },
          interpolation: "hold",
          points: [
            { time: 0, value: long.delayMs },
            { time: 0.5, value: short.delayMs },
          ],
        }),
      ],
    });
    const longOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("analogDelay", { params: long })] }));
    const shortOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("analogDelay", { params: short })] }));

    expect(segmentMeanAbsDiff(out, longOut, 0.2, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, shortOut, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(longOut, shortOut, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Analog Delay rack drive automation before delayed samples leave the feedback path", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 1 });
    const params = { delayMs: 50, feedback: 0, toneHz: 12000, driveDb: 0, mix: 1, tailSeconds: 0.1 };
    const slot = newEffectSlot("analogDelay", {
      id: "fx-analog-delay-drive-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "driveDb" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 18 },
          ],
        }),
      ],
    });
    const low = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("analogDelay", { params })] }));
    const high = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("analogDelay", { params: { ...params, driveDb: 18 } })] }));

    expect(segmentMeanAbsDiff(out, low, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, high, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(low, high, 0.65, 0.95)).toBeGreaterThan(0.005);
  });

  it("renders Analog Delay rack tone automation in the feedback lowpass", () => {
    const input = impulseAt(0.55, 0.8);
    const delayMs = 50;
    const params = { delayMs, feedback: 0, toneHz: 1500, driveDb: 0, mix: 1, tailSeconds: 0.1 };
    const slot = newEffectSlot("analogDelay", {
      id: "fx-analog-delay-tone-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "toneHz" },
          interpolation: "hold",
          points: [
            { time: 0, value: 1500 },
            { time: 0.5, value: 9000 },
          ],
        }),
      ],
    });
    const low = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("analogDelay", { params })] }));
    const high = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("analogDelay", { params: { ...params, toneHz: 9000 } })] }));
    const repeat = Math.round((0.55 + delayMs / 1000) * SR);

    expect(out.channels[0][repeat]).toBeCloseTo(high.channels[0][repeat], 6);
    expect(Math.abs(high.channels[0][repeat] - low.channels[0][repeat])).toBeGreaterThan(0.1);
  });

  it("renders Analog Delay rack tail automation into appended repeats", () => {
    const input = impulseAt(0.55, 0.6);
    const short = { delayMs: 100, feedback: 0.5, toneHz: 12000, driveDb: 0, mix: 1, tailSeconds: 0.05 };
    const long = { ...short, tailSeconds: 0.35 };
    const slot = newEffectSlot("analogDelay", {
      id: "fx-analog-delay-tail-auto",
      params: short,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "tailSeconds" },
          interpolation: "hold",
          points: [
            { time: 0, value: short.tailSeconds },
            { time: 0.5, value: long.tailSeconds },
          ],
        }),
      ],
    });
    const shortOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("analogDelay", { params: short })] }));
    const longOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("analogDelay", { params: long })] }));
    const laterRepeat = Math.round(0.75 * SR);

    expect(frameCount(out)).toBe(frameCount(longOut));
    expect(frameCount(shortOut)).toBeLessThanOrEqual(laterRepeat);
    expect(out.channels[0][laterRepeat]).toBeCloseTo(longOut.channels[0][laterRepeat], 6);
    expect(Math.abs(out.channels[0][laterRepeat])).toBeGreaterThan(0.01);
  });

  it("renders Echo rack mix automation during offline rack processing", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.25, channels: 1 });
    const params = { delayMs: 40, feedback: 0.5, mix: 0, tailSeconds: 0.2 };
    const slot = newEffectSlot("echo", {
      id: "fx-echo-mix-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "mix" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 1 },
          ],
        }),
      ],
    });
    const dry = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("echo", { params })] }));
    const wet = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("echo", { params: { ...params, mix: 1 } })] }));

    expect(segmentMeanAbsDiff(out, dry, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Echo rack feedback automation into cumulative repeats", () => {
    const input = createAudioData(1, 1, SR);
    input.channels[0][0] = 1;
    const delayMs = 100;
    const slot = newEffectSlot("echo", {
      id: "fx-echo-feedback-auto",
      params: {
        delayMs,
        feedback: 0,
        mix: 1,
        tailSeconds: 0.35,
        g31: 0,
        g62: 0,
        g125: 0,
        g250: 0,
        g500: 0,
        g1000: 0,
        g2000: 0,
        g4000: 0,
        g8000: 0,
        g16000: 0,
      },
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "feedback" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.05, value: 0.5 },
          ],
        }),
      ],
    });
    const d = Math.round((delayMs / 1000) * SR);

    expect(out.channels[0][d]).toBeCloseTo(0.5, 6);
    expect(out.channels[0][2 * d]).toBeCloseTo(0.25, 6);
    expect(out.channels[0][3 * d]).toBeCloseTo(0.125, 6);
  });

  it("renders Echo rack time automation into later repeat timing", () => {
    const input = sine(445, 1, { sampleRate: SR, amplitude: 0.25, channels: 1 });
    const long = {
      delayMs: 100,
      feedback: 0.5,
      mix: 1,
      tailSeconds: 0.2,
      g31: 0,
      g62: 0,
      g125: 0,
      g250: 0,
      g500: 0,
      g1000: 0,
      g2000: 0,
      g4000: 0,
      g8000: 0,
      g16000: 0,
    };
    const short = { ...long, delayMs: 50 };
    const slot = newEffectSlot("echo", {
      id: "fx-echo-time-auto",
      params: long,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "delayMs" },
          interpolation: "hold",
          points: [
            { time: 0, value: long.delayMs },
            { time: 0.5, value: short.delayMs },
          ],
        }),
      ],
    });
    const longOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("echo", { params: long })] }));
    const shortOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("echo", { params: short })] }));

    expect(segmentMeanAbsDiff(out, longOut, 0.2, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, shortOut, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(longOut, shortOut, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("renders Echo rack successive-EQ band automation before later repeats", () => {
    const input = impulseAt(0.55, 0.8);
    const flat = {
      delayMs: 100,
      feedback: 0.6,
      mix: 1,
      tailSeconds: 0.35,
      g31: 0,
      g62: 0,
      g125: 0,
      g250: 0,
      g500: 0,
      g1000: 0,
      g2000: 0,
      g4000: 0,
      g8000: 0,
      g16000: 0,
    };
    const dark = { ...flat, g8000: -36 };
    const slot = newEffectSlot("echo", {
      id: "fx-echo-eq-auto",
      params: flat,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "g8000" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: -36 },
          ],
        }),
      ],
    });
    const flatOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("echo", { params: flat })] }));
    const darkOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("echo", { params: dark })] }));

    expect(segmentMeanAbsDiff(out, darkOut, 0.6, 0.85)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(flatOut, darkOut, 0.6, 0.85)).toBeGreaterThan(0.0001);
  });

  it("renders Echo rack tail automation into appended repeats", () => {
    const input = impulseAt(0.55, 0.6);
    const short = {
      delayMs: 100,
      feedback: 0.5,
      mix: 1,
      tailSeconds: 0.05,
      g31: 0,
      g62: 0,
      g125: 0,
      g250: 0,
      g500: 0,
      g1000: 0,
      g2000: 0,
      g4000: 0,
      g8000: 0,
      g16000: 0,
    };
    const long = { ...short, tailSeconds: 0.35 };
    const slot = newEffectSlot("echo", {
      id: "fx-echo-tail-auto",
      params: short,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "tailSeconds" },
          interpolation: "hold",
          points: [
            { time: 0, value: short.tailSeconds },
            { time: 0.5, value: long.tailSeconds },
          ],
        }),
      ],
    });
    const shortOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("echo", { params: short })] }));
    const longOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("echo", { params: long })] }));
    const laterRepeat = Math.round(0.75 * SR);

    expect(frameCount(out)).toBe(frameCount(longOut));
    expect(frameCount(shortOut)).toBeLessThanOrEqual(laterRepeat);
    expect(out.channels[0][laterRepeat]).toBeCloseTo(longOut.channels[0][laterRepeat], 6);
    expect(Math.abs(out.channels[0][laterRepeat])).toBeGreaterThan(0.1);
  });

  it("renders Studio Reverb rack mix automation during offline rack processing", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.25, channels: 2 });
    const params = { decay: 0.5, damping: 0.4, earlyMs: 60, earlyLevel: 0.5, width: 0.7, mix: 0, tailSeconds: 0.2 };
    const slot = newEffectSlot("studioReverb", {
      id: "fx-studio-reverb-mix-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "mix" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.5, value: 1 },
          ],
        }),
      ],
    });
    const dry = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("studioReverb", { params })] }));
    const wet = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("studioReverb", { params: { ...params, mix: 1 } })] }));

    expect(segmentMeanAbsDiff(out, dry, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.65, 0.95)).toBeGreaterThan(0.001);
  });

  it("renders Studio Reverb rack early-level automation", () => {
    const input = createAudioData(2, Math.round(0.02 * SR), SR);
    input.channels[0][0] = 1;
    input.channels[1][0] = 1;
    const earlyMs = 80;
    const params = { decay: 0.5, damping: 0.4, earlyMs, earlyLevel: 0, width: 0, mix: 1, tailSeconds: 0.2 };
    const slot = newEffectSlot("studioReverb", {
      id: "fx-studio-reverb-early-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "earlyLevel" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.05, value: 1 },
          ],
        }),
      ],
    });
    const high = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("studioReverb", { params: { ...params, earlyLevel: 1 } })] }));
    const latestTap = Math.round(earlyMs * 0.001 * SR);

    expect(out.channels[0][latestTap]).toBeCloseTo(high.channels[0][latestTap], 6);
  });

  it("renders Studio Reverb rack decay and damping automation in the late tail", () => {
    const input = impulseAt(0.55, 0.75);
    const low = { decay: 0.1, damping: 0, earlyMs: 60, earlyLevel: 0, width: 0, mix: 1, tailSeconds: 0.5 };
    const high = { ...low, decay: 0.9, damping: 1 };
    const slot = newEffectSlot("studioReverb", {
      id: "fx-studio-reverb-tail-auto",
      params: low,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "decay" },
          interpolation: "hold",
          points: [
            { time: 0, value: low.decay },
            { time: 0.5, value: high.decay },
          ],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "damping" },
          interpolation: "hold",
          points: [
            { time: 0, value: low.damping },
            { time: 0.5, value: high.damping },
          ],
        }),
      ],
    });
    const lowOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("studioReverb", { params: low })] }));
    const highOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("studioReverb", { params: high })] }));

    expect(segmentMeanAbsDiff(out, highOut, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(lowOut, highOut, 0.65, 0.95)).toBeGreaterThan(0.0001);
  });

  it("renders Studio Reverb rack width automation in the early-reflection pattern", () => {
    const input = impulseAt(0.55, 0.75);
    const low = { decay: 0.1, damping: 0.4, earlyMs: 80, earlyLevel: 1, width: 0, mix: 1, tailSeconds: 0.2 };
    const high = { ...low, width: 0.9 };
    const slot = newEffectSlot("studioReverb", {
      id: "fx-studio-reverb-width-auto",
      params: low,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "width" },
          interpolation: "hold",
          points: [
            { time: 0, value: low.width },
            { time: 0.5, value: high.width },
          ],
        }),
      ],
    });
    const lowOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("studioReverb", { params: low })] }));
    const highOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("studioReverb", { params: high })] }));

    expect(segmentMeanAbsDiff(out, highOut, 0.57, 0.68)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(lowOut, highOut, 0.57, 0.68)).toBeGreaterThan(0.0001);
  });

  it("renders Full Reverb rack mix automation during offline rack processing", () => {
    const input = sine(330, 0.24, { sampleRate: SR, amplitude: 0.25, channels: 1 });
    const params = { decayMs: 40, perception: 40, preDelayMs: 0, absorption: 0.2, mix: 0, seed: 5 };
    const slot = newEffectSlot("fullReverb", {
      id: "fx-full-reverb-mix-auto",
      params,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "mix" },
          interpolation: "hold",
          points: [
            { time: 0, value: 0 },
            { time: 0.12, value: 1 },
          ],
        }),
      ],
    });
    const dry = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("fullReverb", { params })] }));
    const wet = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("fullReverb", { params: { ...params, mix: 1 } })] }));

    expect(segmentMeanAbsDiff(out, dry, 0.04, 0.1)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.15, 0.22)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.15, 0.22)).toBeGreaterThan(0.005);
  });

  it("renders Full Reverb rack shaping automation in the synthesized impulse response", () => {
    const input = impulseAt(0.12, 0.18);
    const low = { decayMs: 40, perception: 5, preDelayMs: 0, absorption: 0.05, highDb: 0, highFreq: 6000, mix: 1, seed: 3 };
    const high = { ...low, decayMs: 160, perception: 95, absorption: 0.8, highDb: -18, highFreq: 4000 };
    const slot = newEffectSlot("fullReverb", {
      id: "fx-full-reverb-shape-auto",
      params: low,
    });
    const rack = newEffectRack({ slots: [slot] });
    const out = applyEffectRack(input, rack, {
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "decayMs" },
          interpolation: "hold",
          points: [
            { time: 0, value: low.decayMs },
            { time: 0.1, value: high.decayMs },
          ],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "perception" },
          interpolation: "hold",
          points: [
            { time: 0, value: low.perception },
            { time: 0.1, value: high.perception },
          ],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "absorption" },
          interpolation: "hold",
          points: [
            { time: 0, value: low.absorption },
            { time: 0.1, value: high.absorption },
          ],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "highDb" },
          interpolation: "hold",
          points: [
            { time: 0, value: low.highDb },
            { time: 0.1, value: high.highDb },
          ],
        }),
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "highFreq" },
          interpolation: "hold",
          points: [
            { time: 0, value: low.highFreq },
            { time: 0.1, value: high.highFreq },
          ],
        }),
      ],
    });
    const lowOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("fullReverb", { params: low })] }));
    const highOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("fullReverb", { params: high })] }));

    expect(frameCount(out)).toBeGreaterThan(frameCount(lowOut));
    expect(frameCount(out)).toBeLessThanOrEqual(frameCount(highOut));
    expect(segmentMeanAbsDiff(out, highOut, 0.13, 0.25)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(lowOut, highOut, 0.13, 0.2)).toBeGreaterThan(0.001);
  });

  it("renders Full Reverb rack low and mid coloration params", () => {
    const input = impulseAt(0.02, 0.08);
    const flat = { decayMs: 120, perception: 40, preDelayMs: 0, absorption: 0.2, lowDb: 0, lowFreq: 200, midDb: 0, midFreq: 1000, midQ: 1, highDb: 0, highFreq: 6000, mix: 1, seed: 5 };
    const shaped = { ...flat, lowDb: 12, lowFreq: 180, midDb: -18, midFreq: 1200, midQ: 4 };
    const flatOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("fullReverb", { params: flat })] }));
    const shapedOut = applyEffectRack(input, newEffectRack({ slots: [newEffectSlot("fullReverb", { params: shaped })] }));

    expect(segmentMeanAbsDiff(flatOut, shapedOut, 0.02, 0.16)).toBeGreaterThan(0.001);
  });

  it("renders delay-family rack slots with appended effect tails", () => {
    const input = createAudioData(1, Math.round(0.05 * SR), SR);
    input.channels[0][0] = 1;
    const delayMs = 10;
    const rack = newEffectRack({
      slots: [newEffectSlot("delay", { params: { delayMs, feedback: 0, mix: 1, tailSeconds: 0.05 } })],
    });

    const out = applyEffectRack(input, rack);

    expect(frameCount(out)).toBeGreaterThan(frameCount(input));
    expect(out.channels[0][Math.round((delayMs / 1000) * SR)]).toBeGreaterThan(0.9);
  });

  it("renders Full Reverb rack slots with appended convolution tails", () => {
    const input = createAudioData(1, Math.round(0.02 * SR), SR);
    input.channels[0][0] = 1;
    const rack = newEffectRack({
      slots: [newEffectSlot("fullReverb", { params: { decayMs: 40, perception: 20, preDelayMs: 1, absorption: 0.2, mix: 0.5, seed: 7 } })],
    });

    const out = applyEffectRack(input, rack);

    expect(frameCount(out)).toBeGreaterThan(frameCount(input));
    expect(rmsAmplitude(out)).toBeGreaterThan(0);
  });
});
