// ─────────────────────────────────────────────────────────────
// engine/ops/rack — nondestructive racks + automation rendering
// ─────────────────────────────────────────────────────────────
// This is the serializable, built-in signal path for clip/track/bus/master
// racks. UI commands may still bake arbitrary DSP, but persistent sessions need
// a small set of document-native processors that can round-trip and render.

import { cloneAudioData, setChannelCount } from "../audio/buffer";
import { clamp, dbToGain } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { autoPhaseCorrect } from "../dsp/auto-phase";
import { applyPan, invertPolarity, silence } from "../dsp/basic";
import { centerChannelExtract, type CenterChannelAutomationOptions } from "../dsp/center-channel";
import { channelMixer, type ChannelMixerAutomationOptions } from "../dsp/channel-mixer";
import { delay, type DelayAutomationOptions } from "../dsp/delay";
import { analogDelay, type AnalogDelayAutomationOptions } from "../dsp/analog-delay";
import { echo, type EchoAutomationOptions } from "../dsp/echo";
import { compress, type CompressorAutomationOptions } from "../dsp/dynamics";
import { exciter, type ExciterAutomationOptions } from "../dsp/exciter";
import { GRAPHIC_EQ_FREQS, graphicEQ, parametricEQ, type EQBand } from "../dsp/eq";
import { applyGainDb } from "../dsp/gain";
import { fullReverb, type FullReverbAutomationOptions } from "../dsp/full-reverb";
import { guitarSuite, type GuitarSuiteAutomationOptions } from "../dsp/guitar-suite";
import { graphicPhaseShifter } from "../dsp/phase-shifter";
import { hardLimiter, type HardLimiterAutomationOptions } from "../dsp/limiter";
import { mastering, type MasteringAutomationOptions } from "../dsp/mastering";
import { phaser, type PhaserAutomationOptions } from "../dsp/phaser";
import { deClick } from "../dsp/declick";
import { deEss, type DeEsserAutomationOptions } from "../dsp/de-esser";
import { deHum } from "../dsp/dehummer";
import { notchFilter } from "../dsp/notch-filter";
import { speechLeveler, type SpeechLevelerAutomationOptions } from "../dsp/speech-leveler";
import { stereoExpander, type StereoExpanderAutomationOptions } from "../dsp/stereo-expander";
import { studioReverb, type StudioReverbAutomationOptions } from "../dsp/studio-reverb";
import { tubeCompress, type TubeCompressorAutomationOptions } from "../dsp/tube";
import { vocalEnhance, type VocalEnhancerMode } from "../dsp/vocal-enhancer";
import { waveshaper, type WaveshaperAutomationOptions } from "../dsp/waveshaper";
import type { AutomationLane, EffectRack, EffectSlot } from "../model/types";

export function rackHasActiveSlots(rack: EffectRack | undefined): boolean {
  return !!rack && !rack.bypassed && rack.slots.some((slot) => slot.enabled);
}

export function hasActiveAutomation(lanes: AutomationLane[] | undefined): boolean {
  return !!lanes && lanes.some((lane) => lane.enabled && lane.points.length > 0);
}

export function activeAutomationLane(lanes: AutomationLane[] | undefined, kind: AutomationLane["target"]["kind"]): AutomationLane | undefined {
  return lanes?.find((lane) => lane.enabled && lane.target.kind === kind && lane.points.length > 0);
}

export interface ApplyEffectRackOptions {
  automation?: AutomationLane[];
  automationOffsetSeconds?: number;
}

export function applyEffectRack(audio: AudioData, rack: EffectRack | undefined, opts: ApplyEffectRackOptions = {}): AudioData {
  if (!rack || !rackHasActiveSlots(rack)) return audio;
  let out = audio;
  for (const slot of rack.slots) out = applyEffectSlot(out, slot, opts);
  return out;
}

export function applyEffectSlot(audio: AudioData, slot: EffectSlot, opts: ApplyEffectRackOptions = {}): AudioData {
  if (!slot.enabled) return audio;
  switch (slot.kind) {
    case "gain": {
      const lane = activeEffectParamLane(opts.automation, slot.id, ["gainDb", "db"]);
      return applyGainAutomation(audio, lane, opts.automationOffsetSeconds, numberParam(slot, ["gainDb", "db"], 0));
    }
    case "pan": {
      const lane = activeEffectParamLane(opts.automation, slot.id, ["pan"]);
      return applyPanAutomation(audio, lane, opts.automationOffsetSeconds, numberParam(slot, ["pan"], 0));
    }
    case "compressor":
      return compress(audio, {
        thresholdDb: clampedNumberParam(slot, ["thresholdDb"], -18, -80, 0),
        ratio: clampedNumberParam(slot, ["ratio"], 4, 1, 20),
        attackMs: clampedNumberParam(slot, ["attackMs"], 10, 0.1, 200),
        releaseMs: clampedNumberParam(slot, ["releaseMs"], 120, 5, 1000),
        kneeDb: clampedNumberParam(slot, ["kneeDb"], 6, 0, 24),
        makeupDb: clampedNumberParam(slot, ["makeupDb"], 0, -24, 24),
        automation: compressorAutomation(slot, opts),
      });
    case "limiter":
      return hardLimiter(audio, {
        ceilingDb: clampedNumberParam(slot, ["ceilingDb"], -0.3, -24, 0),
        inputBoostDb: clampedNumberParam(slot, ["inputBoostDb", "boostDb"], 0, 0, 36),
        lookAheadMs: clampedNumberParam(slot, ["lookAheadMs"], 5, 0, 50),
        releaseMs: clampedNumberParam(slot, ["releaseMs"], 100, 5, 1000),
        automation: hardLimiterAutomation(slot, opts),
      });
    case "tubeCompressor":
      return tubeCompress(audio, {
        driveDb: clampedNumberParam(slot, ["driveDb"], 9, 0, 24),
        warmth: clampedNumberParam(slot, ["warmth"], 0.4, 0, 1),
        thresholdDb: clampedNumberParam(slot, ["thresholdDb"], -18, -80, 0),
        ratio: clampedNumberParam(slot, ["ratio"], 3, 1, 20),
        attackMs: clampedNumberParam(slot, ["attackMs"], 10, 0.1, 200),
        releaseMs: clampedNumberParam(slot, ["releaseMs"], 150, 5, 1000),
        makeupDb: clampedNumberParam(slot, ["makeupDb"], 3, -24, 24),
        automation: tubeCompressorAutomation(slot, opts),
      });
    case "speechLeveler":
      return speechLeveler(audio, {
        targetDb: clampedNumberParam(slot, ["targetDb"], -18, -60, 0),
        amount: clampedNumberParam(slot, ["amount"], 0.7, 0, 1),
        maxGainDb: clampedNumberParam(slot, ["maxGainDb"], 24, 0, 60),
        gateDb: clampedNumberParam(slot, ["gateDb"], -50, -100, 0),
        windowMs: clampedNumberParam(slot, ["windowMs"], 300, 10, 5000),
        automation: speechLevelerAutomation(slot, opts),
      });
    case "parametricEQ":
      return parametricEQ(audio, parametricEqBands(slot));
    case "graphicEQ":
      return graphicEQ(audio, graphicEqGains(slot), GRAPHIC_EQ_FREQS);
    case "notchFilter":
      return notchFilter(audio, {
        notches: [
          {
            frequency: clampedNumberParam(slot, ["frequency", "freq"], 1000, 20, audio.sampleRate / 2 - 1),
            gainDb: clampedNumberParam(slot, ["gainDb"], -40, -80, 0),
          },
        ],
        q: clampedNumberParam(slot, ["q"], 30, 0.1, 100),
      });
    case "dehummer":
      return deHum(audio, {
        frequency: clampedNumberParam(slot, ["frequency", "freq"], 60, 20, Math.min(400, audio.sampleRate / 2 - 1)),
        q: clampedNumberParam(slot, ["q"], 20, 0.1, 100),
        reductionDb: clampedNumberParam(slot, ["reductionDb", "gainDb"], -24, -80, 0),
        harmonics: integerParam(slot, ["harmonics"], 10, 1, 64),
        harmonicFalloff: clampedNumberParam(slot, ["harmonicFalloff"], 1, 0, 1),
      });
    case "declicker":
      return deClick(audio, {
        sensitivity: clampedNumberParam(slot, ["sensitivity"], 5, 0, 50),
        threshold: clampedNumberParam(slot, ["threshold"], 0.02, 0, 1),
        maxRunLength: integerParam(slot, ["maxRunLength"], 16, 1, 1024),
      });
    case "deesser":
      return deEss(audio, {
        centerFreq: clampedNumberParam(slot, ["centerFreq", "frequency", "freq"], 7000, 1000, audio.sampleRate / 2 - 1),
        q: clampedNumberParam(slot, ["q"], 2.5, 0.1, 20),
        thresholdDb: clampedNumberParam(slot, ["thresholdDb"], -30, -80, 0),
        ratio: clampedNumberParam(slot, ["ratio"], 4, 1, 40),
        attackMs: clampedNumberParam(slot, ["attackMs"], 1, 0.1, 200),
        releaseMs: clampedNumberParam(slot, ["releaseMs"], 60, 1, 2000),
        rangeDb: clampedNumberParam(slot, ["rangeDb"], 12, 0, 48),
        automation: deEsserAutomation(slot, opts),
      });
    case "centerChannel": {
      const lowFreq = clampedNumberParam(slot, ["lowFreq"], 120, 20, audio.sampleRate / 2 - 1);
      const highFreq = clampedNumberParam(slot, ["highFreq"], 10000, 20, audio.sampleRate / 2 - 1);
      return centerChannelExtract(audio, {
        mode: centerChannelMode(slot),
        centerLevelDb: clampedNumberParam(slot, ["centerLevelDb"], -80, -80, 24),
        sideLevelDb: clampedNumberParam(slot, ["sideLevelDb"], 0, -80, 24),
        lowFreq: Math.min(lowFreq, highFreq),
        highFreq: Math.max(lowFreq, highFreq),
        automation: centerChannelAutomation(slot, opts),
      });
    }
    case "channelMixer":
      return channelMixer(audio, {
        leftToLeft: clampedNumberParam(slot, ["leftToLeft"], 100, -200, 200),
        rightToLeft: clampedNumberParam(slot, ["rightToLeft"], 0, -200, 200),
        leftToRight: clampedNumberParam(slot, ["leftToRight"], 0, -200, 200),
        rightToRight: clampedNumberParam(slot, ["rightToRight"], 100, -200, 200),
        automation: channelMixerAutomation(slot, opts),
      });
    case "graphicPhaseShifter":
      return graphicPhaseShifter(audio, {
        channel: phaseShifterChannel(slot),
        curve: [
          { freq: 0, phaseDeg: clampedNumberParam(slot, ["lowPhaseDeg", "phaseDeg"], 0, -180, 180) },
          { freq: audio.sampleRate / 2, phaseDeg: clampedNumberParam(slot, ["highPhaseDeg", "phaseDeg"], 180, -180, 180) },
        ],
      });
    case "autoPhaseCorrect":
      return autoPhaseCorrect(audio, {
        mode: autoPhaseMode(slot),
        maxShiftMs: clampedNumberParam(slot, ["maxShiftMs"], 5, 0, 100),
        correctPolarity: booleanParam(slot, "correctPolarity", true),
        leftShiftMs: clampedNumberParam(slot, ["leftShiftMs"], 0, -100, 100),
        rightShiftMs: clampedNumberParam(slot, ["rightShiftMs"], 0, -100, 100),
      });
    case "phaser":
      return phaser(audio, {
        rateHz: clampedNumberParam(slot, ["rateHz"], 0.5, 0, 20),
        stages: integerParam(slot, ["stages"], 4, 1, 24),
        depth: clampedNumberParam(slot, ["depth"], 1, 0, 1),
        feedback: clampedNumberParam(slot, ["feedback"], 0.3, -0.95, 0.95),
        mix: clampedNumberParam(slot, ["mix"], 0.5, 0, 1),
        baseFreqHz: clampedNumberParam(slot, ["baseFreqHz", "freq"], 300, 20, audio.sampleRate * 0.45),
        rangeOctaves: clampedNumberParam(slot, ["rangeOctaves"], 4, 0, 10),
        automation: phaserAutomation(slot, opts),
      });
    case "stereoExpander":
      return stereoExpander(audio, {
        expand: clampedNumberParam(slot, ["expand"], 125, 0, 300),
        centerPan: clampedNumberParam(slot, ["centerPan"], 0, -100, 100),
        automation: stereoExpanderAutomation(slot, opts),
      });
    case "waveshaper": {
      const amount = clampedNumberParam(slot, ["amount"], 0.7, 0, 1);
      return waveshaper(audio, {
        curve: rackWaveshaperCurve(amount),
        driveDb: clampedNumberParam(slot, ["driveDb"], 12, -24, 48),
        mix: clampedNumberParam(slot, ["mix"], 1, 0, 1),
        automation: waveshaperAutomation(slot, opts, amount),
      });
    }
    case "guitarSuite":
      return guitarSuite(audio, {
        driveDb: clampedNumberParam(slot, ["driveDb"], 12, 0, 48),
        bodyHz: clampedNumberParam(slot, ["bodyHz"], 90, 20, 500),
        toneHz: clampedNumberParam(slot, ["toneHz"], 5000, 500, audio.sampleRate / 2 - 1),
        presenceDb: clampedNumberParam(slot, ["presenceDb"], 3, -12, 12),
        mix: clampedNumberParam(slot, ["mix"], 1, 0, 1),
        outputDb: clampedNumberParam(slot, ["outputDb"], 0, -24, 24),
        automation: guitarSuiteAutomation(slot, opts),
      });
    case "exciter":
      return exciter(audio, {
        frequency: clampedNumberParam(slot, ["frequency", "freq"], 3000, 200, audio.sampleRate / 2 - 1),
        driveDb: clampedNumberParam(slot, ["driveDb"], 12, 0, 48),
        mix: clampedNumberParam(slot, ["mix"], 0.3, 0, 1),
        automation: exciterAutomation(slot, opts),
      });
    case "vocalEnhancer":
      return vocalEnhance(audio, { mode: vocalEnhancerMode(slot) });
    case "mastering":
      return mastering(audio, {
        lowShelfDb: clampedNumberParam(slot, ["lowShelfDb"], 1, -12, 12),
        highShelfDb: clampedNumberParam(slot, ["highShelfDb"], 2, -12, 12),
        exciteAmount: clampedNumberParam(slot, ["exciteAmount"], 0.2, 0, 1),
        width: clampedNumberParam(slot, ["width"], 1.3, 0, 3),
        ambience: clampedNumberParam(slot, ["ambience"], 0, 0, 1),
        ambienceDecayMs: clampedNumberParam(slot, ["ambienceDecayMs"], 250, 10, 2000),
        ambiencePreDelayMs: clampedNumberParam(slot, ["ambiencePreDelayMs"], 8, 0, 250),
        driveDb: clampedNumberParam(slot, ["driveDb"], 3, 0, 24),
        ceilingDb: clampedNumberParam(slot, ["ceilingDb"], -1, -24, 0),
        amount: clampedNumberParam(slot, ["amount"], 1, 0, 1),
        automation: masteringAutomation(slot, opts),
      });
    case "delay":
      return delay(audio, {
        delayMs: clampedNumberParam(slot, ["delayMs"], 250, 1, 5000),
        feedback: clampedNumberParam(slot, ["feedback"], 0.35, 0, 0.99),
        mix: clampedNumberParam(slot, ["mix"], 0.35, 0, 1),
        tailSeconds: automatedTailSeconds(audio, slot, opts, 1.5),
        automation: delayAutomation(slot, opts),
      });
    case "analogDelay":
      return analogDelay(audio, {
        delayMs: clampedNumberParam(slot, ["delayMs"], 300, 1, 5000),
        feedback: clampedNumberParam(slot, ["feedback"], 0.4, 0, 0.99),
        toneHz: clampedNumberParam(slot, ["toneHz"], 4000, 200, audio.sampleRate / 2 - 1),
        driveDb: clampedNumberParam(slot, ["driveDb"], 6, 0, 36),
        mix: clampedNumberParam(slot, ["mix"], 0.4, 0, 1),
        tailSeconds: automatedTailSeconds(audio, slot, opts, 1.5),
        automation: analogDelayAutomation(slot, opts),
      });
    case "echo":
      return echo(audio, {
        delayMs: clampedNumberParam(slot, ["delayMs"], 300, 1, 5000),
        feedback: clampedNumberParam(slot, ["feedback"], 0.5, 0, 0.95),
        mix: clampedNumberParam(slot, ["mix"], 0.5, 0, 1),
        eqGainsDb: graphicEqGains(slot, [0, 0, 0, 0, 0, -1, -3, -6, -9, -12]),
        eqFreqs: GRAPHIC_EQ_FREQS,
        tailSeconds: automatedTailSeconds(audio, slot, opts, 1.5),
        automation: echoAutomation(slot, opts),
      });
    case "studioReverb":
      return studioReverb(audio, {
        decay: clampedNumberParam(slot, ["decay"], 0.5, 0, 1),
        damping: clampedNumberParam(slot, ["damping"], 0.4, 0, 1),
        earlyMs: clampedNumberParam(slot, ["earlyMs"], 80, 1, 500),
        earlyLevel: clampedNumberParam(slot, ["earlyLevel"], 0.5, 0, 1),
        width: clampedNumberParam(slot, ["width"], 0.7, 0, 1),
        mix: clampedNumberParam(slot, ["mix"], 0.3, 0, 1),
        tailSeconds: clampedNumberParam(slot, ["tailSeconds"], 1.5, 0, 10),
        automation: studioReverbAutomation(slot, opts),
      });
    case "fullReverb":
      return fullReverb(audio, {
        decayMs: clampedNumberParam(slot, ["decayMs"], 1500, 20, 6000),
        perception: clampedNumberParam(slot, ["perception"], 40, 0, 100),
        preDelayMs: clampedNumberParam(slot, ["preDelayMs"], 0, 0, 500),
        absorption: clampedNumberParam(slot, ["absorption"], 0.35, 0, 0.999),
        coloration: {
          lowDb: clampedNumberParam(slot, ["lowDb"], 0, -36, 12),
          lowFreq: clampedNumberParam(slot, ["lowFreq"], 200, 20, audio.sampleRate / 2 - 1),
          midDb: clampedNumberParam(slot, ["midDb"], 0, -36, 12),
          midFreq: clampedNumberParam(slot, ["midFreq"], 1000, 20, audio.sampleRate / 2 - 1),
          midQ: clampedNumberParam(slot, ["midQ"], 1, 0.1, 50),
          highDb: clampedNumberParam(slot, ["highDb"], -6, -36, 12),
          highFreq: clampedNumberParam(slot, ["highFreq"], 6000, 500, audio.sampleRate / 2 - 1),
        },
        mix: clampedNumberParam(slot, ["mix"], 0.3, 0, 1),
        seed: integerParam(slot, ["seed"], 1, 1, 999999),
        automation: fullReverbAutomation(slot, opts),
      });
    case "invertPolarity":
      return invertPolarity(audio);
    case "silence":
      return silence(audio);
    case "nativePlugin":
      return audio;
    default:
      return audio;
  }
}

export function automationValueAt(lane: AutomationLane, time: number, fallback = 0): number {
  return valueAtPoints(sortedPoints(lane), lane.interpolation, time, fallback);
}

export function applyGainAutomation(audio: AudioData, lane: AutomationLane | undefined, offsetSeconds = 0, baseDb = 0): AudioData {
  if (!lane || !lane.enabled || lane.points.length === 0) return baseDb === 0 ? audio : applyGainDb(audio, baseDb);
  const points = sortedPoints(lane);
  const out = cloneAudioData(audio);
  const frames = frameCount(out);
  const sr = out.sampleRate;
  for (const ch of out.channels) {
    for (let i = 0; i < frames; i++) {
      const db = baseDb + valueAtPoints(points, lane.interpolation, offsetSeconds + i / sr, 0);
      ch[i] *= dbToGain(db);
    }
  }
  return out;
}

export function applyPanAutomation(audio: AudioData, lane: AutomationLane | undefined, offsetSeconds = 0, basePan = 0): AudioData {
  if (channelCount(audio) > 2) return audio;
  if (!lane || !lane.enabled || lane.points.length === 0) return basePan === 0 ? audio : applyStereoPan(audio, basePan);
  const points = sortedPoints(lane);
  const out = setChannelCount(audio, 2);
  const frames = frameCount(out);
  const sr = out.sampleRate;
  const left = out.channels[0];
  const right = out.channels[1];
  for (let i = 0; i < frames; i++) {
    const pan = clamp(basePan + valueAtPoints(points, lane.interpolation, offsetSeconds + i / sr, 0), -1, 1);
    const angle = ((pan + 1) / 2) * (Math.PI / 2);
    left[i] *= Math.cos(angle);
    right[i] *= Math.sin(angle);
  }
  return out;
}

function applyStereoPan(audio: AudioData, pan: number): AudioData {
  return channelCount(audio) > 2 ? audio : applyPan(audio, pan);
}

export function applyChannelControls(
  audio: AudioData,
  opts: { gainDb: number; pan: number; automation?: AutomationLane[]; automationOffsetSeconds?: number },
): AudioData {
  const offset = opts.automationOffsetSeconds ?? 0;
  const gainLane = activeAutomationLane(opts.automation, "gainDb");
  const panLane = activeAutomationLane(opts.automation, "pan");
  let out = applyPanAutomation(audio, panLane, offset, opts.pan);
  out = applyGainAutomation(out, gainLane, offset, opts.gainDb);
  return out;
}

function numberParam(slot: EffectSlot, names: string[], fallback: number): number {
  for (const name of names) {
    const value = slot.params[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function clampedNumberParam(slot: EffectSlot, names: string[], fallback: number, min: number, max: number): number {
  return clamp(numberParam(slot, names, fallback), min, max);
}

function automatedTailSeconds(audio: AudioData, slot: EffectSlot, opts: ApplyEffectRackOptions, fallback: number): number {
  const base = clampedNumberParam(slot, ["tailSeconds"], fallback, 0, 10);
  const lane = activeEffectParamLane(opts.automation, slot.id, ["tailSeconds"]);
  if (!lane) return base;
  const points = sortedPoints(lane);
  if (points.length === 0) return base;
  const offset = opts.automationOffsetSeconds ?? 0;
  const sourceSeconds = frameCount(audio) / audio.sampleRate;
  let tail = base;
  for (let guard = 0; guard < 8; guard++) {
    const end = offset + sourceSeconds + tail;
    let next = Math.max(
      tail,
      clamp(valueAtPoints(points, lane.interpolation, offset, base), 0, 10),
      clamp(valueAtPoints(points, lane.interpolation, end, base), 0, 10),
    );
    for (const point of points) {
      if (point.time < offset || point.time > end) continue;
      next = Math.max(
        next,
        clamp(point.value, 0, 10),
        clamp(valueAtPoints(points, lane.interpolation, point.time, base), 0, 10),
      );
    }
    if (next <= tail + 1e-9) return tail;
    tail = next;
  }
  return tail;
}

function integerParam(slot: EffectSlot, names: string[], fallback: number, min: number, max: number): number {
  return Math.round(clampedNumberParam(slot, names, fallback, min, max));
}

function compressorAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): CompressorAutomationOptions | undefined {
  const automation: CompressorAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    thresholdDb: effectParamResolver(opts.automation, slot.id, ["thresholdDb"], -80, 0),
    ratio: effectParamResolver(opts.automation, slot.id, ["ratio"], 1, 20),
    attackMs: effectParamResolver(opts.automation, slot.id, ["attackMs"], 0.1, 200),
    releaseMs: effectParamResolver(opts.automation, slot.id, ["releaseMs"], 5, 1000),
    kneeDb: effectParamResolver(opts.automation, slot.id, ["kneeDb"], 0, 24),
    makeupDb: effectParamResolver(opts.automation, slot.id, ["makeupDb"], -24, 24),
  };
  return automation.thresholdDb || automation.ratio || automation.attackMs || automation.releaseMs || automation.kneeDb || automation.makeupDb
    ? automation
    : undefined;
}

function tubeCompressorAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): TubeCompressorAutomationOptions | undefined {
  const compressor = compressorAutomation(slot, opts);
  const automation: TubeCompressorAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    ...(compressor ?? {}),
    driveDb: effectParamResolver(opts.automation, slot.id, ["driveDb"], 0, 24),
    warmth: effectParamResolver(opts.automation, slot.id, ["warmth"], 0, 1),
  };
  return compressor || automation.driveDb || automation.warmth ? automation : undefined;
}

function hardLimiterAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): HardLimiterAutomationOptions | undefined {
  const automation: HardLimiterAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    ceilingDb: effectParamResolver(opts.automation, slot.id, ["ceilingDb"], -24, 0),
    inputBoostDb: effectParamResolver(opts.automation, slot.id, ["inputBoostDb", "boostDb"], 0, 36),
    lookAheadMs: effectParamResolver(opts.automation, slot.id, ["lookAheadMs"], 0, 50),
    releaseMs: effectParamResolver(opts.automation, slot.id, ["releaseMs"], 5, 1000),
  };
  return automation.ceilingDb || automation.inputBoostDb || automation.lookAheadMs || automation.releaseMs ? automation : undefined;
}

function exciterAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): ExciterAutomationOptions | undefined {
  const automation: ExciterAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    frequency: effectParamResolver(opts.automation, slot.id, ["frequency", "freq"], 200, Number.MAX_SAFE_INTEGER),
    driveDb: effectParamResolver(opts.automation, slot.id, ["driveDb"], 0, 48),
    mix: effectParamResolver(opts.automation, slot.id, ["mix"], 0, 1),
  };
  return automation.frequency || automation.driveDb || automation.mix ? automation : undefined;
}

function guitarSuiteAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): GuitarSuiteAutomationOptions | undefined {
  const automation: GuitarSuiteAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    driveDb: effectParamResolver(opts.automation, slot.id, ["driveDb"], 0, 48),
    bodyHz: effectParamResolver(opts.automation, slot.id, ["bodyHz"], 20, 500),
    toneHz: effectParamResolver(opts.automation, slot.id, ["toneHz"], 500, Number.MAX_SAFE_INTEGER),
    presenceDb: effectParamResolver(opts.automation, slot.id, ["presenceDb"], -12, 12),
    mix: effectParamResolver(opts.automation, slot.id, ["mix"], 0, 1),
    outputDb: effectParamResolver(opts.automation, slot.id, ["outputDb"], -24, 24),
  };
  return automation.driveDb || automation.bodyHz || automation.toneHz || automation.presenceDb || automation.mix || automation.outputDb
    ? automation
    : undefined;
}

function delayAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): DelayAutomationOptions | undefined {
  const automation: DelayAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    delayMs: effectParamResolver(opts.automation, slot.id, ["delayMs"], 1, 5000),
    feedback: effectParamResolver(opts.automation, slot.id, ["feedback"], 0, 0.99),
    mix: effectParamResolver(opts.automation, slot.id, ["mix"], 0, 1),
  };
  return automation.delayMs || automation.feedback || automation.mix ? automation : undefined;
}

function analogDelayAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): AnalogDelayAutomationOptions | undefined {
  const automation: AnalogDelayAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    delayMs: effectParamResolver(opts.automation, slot.id, ["delayMs"], 1, 5000),
    feedback: effectParamResolver(opts.automation, slot.id, ["feedback"], 0, 0.99),
    toneHz: effectParamResolver(opts.automation, slot.id, ["toneHz"], 200, Number.MAX_SAFE_INTEGER),
    driveDb: effectParamResolver(opts.automation, slot.id, ["driveDb"], 0, 36),
    mix: effectParamResolver(opts.automation, slot.id, ["mix"], 0, 1),
  };
  return automation.delayMs || automation.feedback || automation.toneHz || automation.driveDb || automation.mix ? automation : undefined;
}

function echoAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): EchoAutomationOptions | undefined {
  const automation: EchoAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    delayMs: effectParamResolver(opts.automation, slot.id, ["delayMs"], 1, 5000),
    feedback: effectParamResolver(opts.automation, slot.id, ["feedback"], 0, 0.95),
    mix: effectParamResolver(opts.automation, slot.id, ["mix"], 0, 1),
    eqGainsDb: GRAPHIC_EQ_PARAM_NAMES.map((name) => effectParamResolver(opts.automation, slot.id, [name], -36, 36)),
  };
  return automation.delayMs || automation.feedback || automation.mix || automation.eqGainsDb?.some(Boolean) ? automation : undefined;
}

function phaserAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): PhaserAutomationOptions | undefined {
  const automation: PhaserAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    rateHz: effectParamResolver(opts.automation, slot.id, ["rateHz"], 0, 20),
    stages: effectParamResolver(opts.automation, slot.id, ["stages"], 1, 24),
    depth: effectParamResolver(opts.automation, slot.id, ["depth"], 0, 1),
    feedback: effectParamResolver(opts.automation, slot.id, ["feedback"], -0.95, 0.95),
    mix: effectParamResolver(opts.automation, slot.id, ["mix"], 0, 1),
    baseFreqHz: effectParamResolver(opts.automation, slot.id, ["baseFreqHz", "freq"], 20, Number.MAX_SAFE_INTEGER),
    rangeOctaves: effectParamResolver(opts.automation, slot.id, ["rangeOctaves"], 0, 10),
  };
  return automation.rateHz || automation.stages || automation.depth || automation.feedback || automation.mix || automation.baseFreqHz || automation.rangeOctaves
    ? automation
    : undefined;
}

function studioReverbAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): StudioReverbAutomationOptions | undefined {
  const automation: StudioReverbAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    decay: effectParamResolver(opts.automation, slot.id, ["decay"], 0, 1),
    damping: effectParamResolver(opts.automation, slot.id, ["damping"], 0, 1),
    earlyLevel: effectParamResolver(opts.automation, slot.id, ["earlyLevel"], 0, 1),
    width: effectParamResolver(opts.automation, slot.id, ["width"], 0, 1),
    mix: effectParamResolver(opts.automation, slot.id, ["mix"], 0, 1),
  };
  return automation.decay || automation.damping || automation.earlyLevel || automation.width || automation.mix ? automation : undefined;
}

function fullReverbAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): FullReverbAutomationOptions | undefined {
  const automation: FullReverbAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    decayMs: effectParamResolver(opts.automation, slot.id, ["decayMs"], 20, 6000),
    perception: effectParamResolver(opts.automation, slot.id, ["perception"], 0, 100),
    preDelayMs: effectParamResolver(opts.automation, slot.id, ["preDelayMs"], 0, 500),
    absorption: effectParamResolver(opts.automation, slot.id, ["absorption"], 0, 0.999),
    colorLowDb: effectParamResolver(opts.automation, slot.id, ["lowDb"], -36, 12),
    colorLowFreq: effectParamResolver(opts.automation, slot.id, ["lowFreq"], 20, Number.MAX_SAFE_INTEGER),
    colorMidDb: effectParamResolver(opts.automation, slot.id, ["midDb"], -36, 12),
    colorMidFreq: effectParamResolver(opts.automation, slot.id, ["midFreq"], 20, Number.MAX_SAFE_INTEGER),
    colorMidQ: effectParamResolver(opts.automation, slot.id, ["midQ"], 0.1, 50),
    colorHighDb: effectParamResolver(opts.automation, slot.id, ["highDb"], -36, 12),
    colorHighFreq: effectParamResolver(opts.automation, slot.id, ["highFreq"], 500, Number.MAX_SAFE_INTEGER),
    mix: effectParamResolver(opts.automation, slot.id, ["mix"], 0, 1),
  };
  return automation.decayMs ||
    automation.perception ||
    automation.preDelayMs ||
    automation.absorption ||
    automation.colorLowDb ||
    automation.colorLowFreq ||
    automation.colorMidDb ||
    automation.colorMidFreq ||
    automation.colorMidQ ||
    automation.colorHighDb ||
    automation.colorHighFreq ||
    automation.mix
    ? automation
    : undefined;
}

function masteringAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): MasteringAutomationOptions | undefined {
  const automation: MasteringAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    lowShelfDb: effectParamResolver(opts.automation, slot.id, ["lowShelfDb"], -12, 12),
    highShelfDb: effectParamResolver(opts.automation, slot.id, ["highShelfDb"], -12, 12),
    driveDb: effectParamResolver(opts.automation, slot.id, ["driveDb"], 0, 24),
    ceilingDb: effectParamResolver(opts.automation, slot.id, ["ceilingDb"], -24, 0),
    exciteAmount: effectParamResolver(opts.automation, slot.id, ["exciteAmount"], 0, 1),
    width: effectParamResolver(opts.automation, slot.id, ["width"], 0, 3),
    ambience: effectParamResolver(opts.automation, slot.id, ["ambience"], 0, 1),
    amount: effectParamResolver(opts.automation, slot.id, ["amount"], 0, 1),
  };
  return automation.lowShelfDb ||
    automation.highShelfDb ||
    automation.driveDb ||
    automation.ceilingDb ||
    automation.exciteAmount ||
    automation.width ||
    automation.ambience ||
    automation.amount
    ? automation
    : undefined;
}

function deEsserAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): DeEsserAutomationOptions | undefined {
  const automation: DeEsserAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    thresholdDb: effectParamResolver(opts.automation, slot.id, ["thresholdDb"], -80, 0),
    ratio: effectParamResolver(opts.automation, slot.id, ["ratio"], 1, 40),
    attackMs: effectParamResolver(opts.automation, slot.id, ["attackMs"], 0.1, 200),
    releaseMs: effectParamResolver(opts.automation, slot.id, ["releaseMs"], 1, 2000),
    rangeDb: effectParamResolver(opts.automation, slot.id, ["rangeDb"], 0, 48),
  };
  return automation.thresholdDb || automation.ratio || automation.attackMs || automation.releaseMs || automation.rangeDb
    ? automation
    : undefined;
}

function centerChannelAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): CenterChannelAutomationOptions | undefined {
  const automation: CenterChannelAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    centerLevelDb: effectParamResolver(opts.automation, slot.id, ["centerLevelDb"], -80, 24),
    sideLevelDb: effectParamResolver(opts.automation, slot.id, ["sideLevelDb"], -80, 24),
  };
  return automation.centerLevelDb || automation.sideLevelDb ? automation : undefined;
}

function channelMixerAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): ChannelMixerAutomationOptions | undefined {
  const automation: ChannelMixerAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    leftToLeft: effectParamResolver(opts.automation, slot.id, ["leftToLeft"], -200, 200),
    rightToLeft: effectParamResolver(opts.automation, slot.id, ["rightToLeft"], -200, 200),
    leftToRight: effectParamResolver(opts.automation, slot.id, ["leftToRight"], -200, 200),
    rightToRight: effectParamResolver(opts.automation, slot.id, ["rightToRight"], -200, 200),
  };
  return automation.leftToLeft || automation.rightToLeft || automation.leftToRight || automation.rightToRight
    ? automation
    : undefined;
}

function stereoExpanderAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): StereoExpanderAutomationOptions | undefined {
  const automation: StereoExpanderAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    expand: effectParamResolver(opts.automation, slot.id, ["expand"], 0, 300),
    centerPan: effectParamResolver(opts.automation, slot.id, ["centerPan"], -100, 100),
  };
  return automation.expand || automation.centerPan ? automation : undefined;
}

function speechLevelerAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions): SpeechLevelerAutomationOptions | undefined {
  const automation: SpeechLevelerAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    targetDb: effectParamResolver(opts.automation, slot.id, ["targetDb"], -60, 0),
    amount: effectParamResolver(opts.automation, slot.id, ["amount"], 0, 1),
    maxGainDb: effectParamResolver(opts.automation, slot.id, ["maxGainDb"], 0, 60),
    gateDb: effectParamResolver(opts.automation, slot.id, ["gateDb"], -100, 0),
    windowMs: effectParamResolver(opts.automation, slot.id, ["windowMs"], 10, 5000),
  };
  return automation.targetDb || automation.amount || automation.maxGainDb || automation.gateDb || automation.windowMs
    ? automation
    : undefined;
}

function waveshaperAutomation(slot: EffectSlot, opts: ApplyEffectRackOptions, amountFallback: number): WaveshaperAutomationOptions | undefined {
  const amount = effectParamResolver(opts.automation, slot.id, ["amount"], 0, 1);
  const automation: WaveshaperAutomationOptions = {
    offsetSeconds: opts.automationOffsetSeconds ?? 0,
    driveDb: effectParamResolver(opts.automation, slot.id, ["driveDb"], -24, 48),
    mix: effectParamResolver(opts.automation, slot.id, ["mix"], 0, 1),
    curve: amount ? (timeSeconds) => rackWaveshaperCurve(amount(timeSeconds, amountFallback)) : undefined,
  };
  return automation.driveDb || automation.mix || automation.curve ? automation : undefined;
}

function effectParamResolver(
  lanes: AutomationLane[] | undefined,
  slotId: string,
  params: string[],
  min: number,
  max: number,
): ((timeSeconds: number, fallback: number) => number) | undefined {
  const lane = activeEffectParamLane(lanes, slotId, params);
  if (!lane) return undefined;
  const points = sortedPoints(lane);
  if (points.length === 0) return undefined;
  return (timeSeconds, fallback) => clamp(valueAtPoints(points, lane.interpolation, timeSeconds, fallback), min, max);
}

function booleanParam(slot: EffectSlot, name: string, fallback: boolean): boolean {
  const value = slot.params[name];
  return typeof value === "boolean" ? value : fallback;
}

function parametricEqBands(slot: EffectSlot): EQBand[] {
  return [
    {
      type: "peaking",
      freq: clampedNumberParam(slot, ["freq", "frequency"], 1000, 20, Number.MAX_SAFE_INTEGER),
      q: clampedNumberParam(slot, ["q"], 1, 0.1, 50),
      gainDb: clampedNumberParam(slot, ["gainDb"], 0, -36, 36),
    },
  ];
}

const GRAPHIC_EQ_PARAM_NAMES = ["g31", "g62", "g125", "g250", "g500", "g1000", "g2000", "g4000", "g8000", "g16000"] as const;

function graphicEqGains(slot: EffectSlot, fallback: number[] = []): number[] {
  return GRAPHIC_EQ_PARAM_NAMES.map((name, index) => clampedNumberParam(slot, [name], fallback[index] ?? 0, -36, 36));
}

function rackWaveshaperCurve(amount: number) {
  const kneeIn = 0.35 + (1 - amount) * 0.35;
  const kneeOut = 0.35 - amount * 0.1;
  const ceiling = 1 - amount * 0.25;
  return [
    { in: -1, out: -ceiling },
    { in: -kneeIn, out: -kneeOut },
    { in: 0, out: 0 },
    { in: kneeIn, out: kneeOut },
    { in: 1, out: ceiling },
  ];
}

function centerChannelMode(slot: EffectSlot): "remove" | "keep" {
  return slot.params.mode === "keep" ? "keep" : "remove";
}

function phaseShifterChannel(slot: EffectSlot): "both" | "left" | "right" {
  const channel = slot.params.channel;
  return channel === "both" || channel === "right" ? channel : "left";
}

function autoPhaseMode(slot: EffectSlot): "auto" | "global" {
  return slot.params.mode === "global" ? "global" : "auto";
}

function vocalEnhancerMode(slot: EffectSlot): VocalEnhancerMode {
  const mode = slot.params.mode;
  return mode === "female" || mode === "music" ? mode : "male";
}

function activeEffectParamLane(lanes: AutomationLane[] | undefined, slotId: string, params: string[]): AutomationLane | undefined {
  return lanes?.find((lane) => {
    if (!lane.enabled || lane.points.length === 0 || lane.target.kind !== "effectParam") return false;
    if (lane.target.effectSlotId !== slotId) return false;
    return !!lane.target.param && params.includes(lane.target.param);
  });
}

function sortedPoints(lane: AutomationLane): AutomationLane["points"] {
  return [...lane.points].filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value)).sort((a, b) => a.time - b.time);
}

function valueAtPoints(points: AutomationLane["points"], interpolation: AutomationLane["interpolation"], time: number, fallback: number): number {
  if (points.length === 0) return fallback;
  if (time <= points[0].time) return points[0].value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (time <= b.time) {
      if (interpolation === "hold" || b.time <= a.time) return a.value;
      const t = (time - a.time) / (b.time - a.time);
      return a.value + (b.value - a.value) * t;
    }
  }
  return points[points.length - 1].value;
}
