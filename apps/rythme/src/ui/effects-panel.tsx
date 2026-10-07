// ─────────────────────────────────────────────────────────────
// ui/effects-panel — the effects rack
// ─────────────────────────────────────────────────────────────
// Featured parametric effects up top, then the full one-click catalogue grouped
// by family. Everything applies to the current scope: the selected range, the
// selected clips, or the active track.

import { useState } from "react";
import { Button, ScrubbyNumber, Select } from "@monet-ui/monet-react";
import { useEditorState, useStore } from "../state/store-context";
import {
  addBusEffectSlot,
  addClipEffectSlot,
  addMasterEffectSlot,
  addTrackEffectSlot,
  clipById,
  newEffectSlot,
  removeBusEffectSlot,
  removeClipEffectSlot,
  removeMasterEffectSlot,
  removeTrackEffectSlot,
  setBusEffectParamAutomationPoint,
  setBusEffectSlotEnabled,
  setBusEffectSlotParam,
  setClipEffectParamAutomationPoint,
  setClipEffectSlotEnabled,
  setClipEffectSlotParam,
  setMasterEffectParamAutomationPoint,
  setMasterEffectSlotEnabled,
  setMasterEffectSlotParam,
  normalizePanelPreferences,
  setTrackEffectParamAutomationPoint,
  setTrackEffectSlotEnabled,
  setTrackEffectSlotParam,
  setProjectPanelPreferences,
  type EffectsPanelPreferences,
  type EffectParamValue,
  type EffectSlot,
  type ManagedNativeAudioPlugin,
} from "../engine";
import { applyCenterExtract, applyChannelMixer, CHANNEL_MIXER_PRESETS, applyStereoExpander, STEREO_EXPANDER_PRESETS, applySwapChannels, applyGraphicPhaseShifter, GRAPHIC_PHASE_SHIFTER_PRESETS, applyDeClicker, applyDeEsser, applyDeHummer, applyDynamicsProcessing, DYNAMICS_PROCESSING_PRESETS, applyConvolutionReverbFromFile, applyEffectById, applyFFTFilter, FFT_FILTER_PRESETS, splitIntoBands, BAND_SPLIT_PRESETS, applyDeleteSilence, DELETE_SILENCE_PRESETS, applyConvertSampleType, CONVERT_PRESETS, convertProjectSampleRate, SAMPLE_RATE_PRESETS, markAudioRegions, MARK_AUDIO_PRESETS, applyHardLimiter, applyMatchLoudness, applyMultibandCompressor, applyNoiseReduction, applyAdaptiveNoiseReduction, ADAPTIVE_NR_PRESETS, applyDeReverb, DEREVERB_PRESETS, applyDeClipper, DECLIPPER_PRESETS, applyAutoPhaseCorrect, AUTO_PHASE_PRESETS, applyNotchFilter, NOTCH_FILTER_PRESETS, applyScientificFilter, SCIENTIFIC_FILTER_PRESETS, applyGraphicEq, GRAPHIC_EQ_PRESETS, applyParametricEq, PARAMETRIC_EQ_PRESETS, applyExciter, EXCITER_PRESETS, applyGuitarSuite, GUITAR_SUITE_PRESETS, applyHissReduction, HISS_REDUCTION_PRESETS, applyStudioReverb, STUDIO_REVERB_PRESETS, applyFullReverb, FULL_REVERB_PRESETS, applyWaveshaper, WAVESHAPER_PRESETS, applyMastering, MASTERING_PRESETS, applyAnalogDelay, ANALOG_DELAY_PRESETS, applyEcho, ECHO_PRESETS, applyAutoPitchCorrect, AUTO_PITCH_PRESETS, applySpeechLeveler, SPEECH_LEVELER_PRESETS, applyGainEnvelope, GAIN_ENVELOPE_PRESETS, applyEssentialSoundAutoDuck, applyEssentialSoundPreset, ESSENTIAL_SOUND_ROLES, addNativePluginsToProject, addNativePluginSlotToRack, pickNativeAudioPluginRoots, pickNativeAudioPlugins, setManagedNativePluginEnabled, setManagedNativePluginPresetState, applyPitchBend, applyPitchShift, applyTimeStretch, applyTubeCompressor, applyVocalEnhancer, captureNoisePrint, EFFECTS } from "./commands";

const accent = "var(--accent-audio)";
type RackSlotKind =
  | "gain"
  | "pan"
  | "compressor"
  | "limiter"
  | "tubeCompressor"
  | "speechLeveler"
  | "parametricEQ"
  | "graphicEQ"
  | "notchFilter"
  | "dehummer"
  | "declicker"
  | "deesser"
  | "centerChannel"
  | "channelMixer"
  | "graphicPhaseShifter"
  | "autoPhaseCorrect"
  | "phaser"
  | "stereoExpander"
  | "waveshaper"
  | "guitarSuite"
  | "exciter"
  | "vocalEnhancer"
  | "mastering"
  | "delay"
  | "analogDelay"
  | "echo"
  | "studioReverb"
  | "fullReverb"
  | "invertPolarity"
  | "silence";
type RackTarget =
  | { kind: "clip"; id: string; name: string; slots: EffectSlot[] }
  | { kind: "track"; id: string; name: string; slots: EffectSlot[] }
  | { kind: "bus"; id: string; name: string; slots: EffectSlot[] }
  | { kind: "master"; name: string; slots: EffectSlot[] };

function rackSlotName(kind: RackSlotKind): string {
  switch (kind) {
    case "gain":
      return "Gain";
    case "pan":
      return "Pan";
    case "compressor":
      return "Compressor";
    case "limiter":
      return "Limiter";
    case "tubeCompressor":
      return "Tube Compressor";
    case "speechLeveler":
      return "Speech Volume Leveler";
    case "parametricEQ":
      return "Parametric EQ";
    case "graphicEQ":
      return "Graphic EQ";
    case "notchFilter":
      return "Notch Filter";
    case "dehummer":
      return "DeHummer";
    case "declicker":
      return "DeClicker";
    case "deesser":
      return "DeEsser";
    case "centerChannel":
      return "Center Channel Extractor";
    case "channelMixer":
      return "Channel Mixer";
    case "graphicPhaseShifter":
      return "Graphic Phase Shifter";
    case "autoPhaseCorrect":
      return "Auto Phase Correction";
    case "phaser":
      return "Phaser";
    case "stereoExpander":
      return "Stereo Expander";
    case "waveshaper":
      return "Waveshaper";
    case "guitarSuite":
      return "Guitar Suite";
    case "exciter":
      return "Exciter";
    case "vocalEnhancer":
      return "Vocal Enhancer";
    case "mastering":
      return "Mastering";
    case "delay":
      return "Delay";
    case "analogDelay":
      return "Analog Delay";
    case "echo":
      return "Echo";
    case "studioReverb":
      return "Studio Reverb";
    case "fullReverb":
      return "Full Reverb";
    case "invertPolarity":
      return "Invert Polarity";
    case "silence":
      return "Silence";
  }
}

const FLAT_GRAPHIC_EQ_PARAMS = { g31: 0, g62: 0, g125: 0, g250: 0, g500: 0, g1000: 0, g2000: 0, g4000: 0, g8000: 0, g16000: 0 };
const ECHO_EQ_PARAMS = { g31: 0, g62: 0, g125: 0, g250: 0, g500: 0, g1000: -1, g2000: -3, g4000: -6, g8000: -9, g16000: -12 };

function rackSlotParams(kind: RackSlotKind): Record<string, EffectParamValue> {
  if (kind === "gain") return { gainDb: 0 };
  if (kind === "pan") return { pan: 0 };
  if (kind === "compressor") return { thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 120, kneeDb: 6, makeupDb: 0 };
  if (kind === "limiter") return { ceilingDb: -0.3, inputBoostDb: 0, lookAheadMs: 5, releaseMs: 100 };
  if (kind === "tubeCompressor") return { driveDb: 9, warmth: 0.4, thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 150, makeupDb: 3 };
  if (kind === "speechLeveler") return { targetDb: -18, amount: 0.7, maxGainDb: 24, gateDb: -50, windowMs: 300 };
  if (kind === "parametricEQ") return { freq: 1000, q: 1, gainDb: 3 };
  if (kind === "graphicEQ") return { ...FLAT_GRAPHIC_EQ_PARAMS, g1000: 3 };
  if (kind === "notchFilter") return { frequency: 1000, gainDb: -40, q: 30 };
  if (kind === "dehummer") return { frequency: 60, q: 20, reductionDb: -24, harmonics: 10, harmonicFalloff: 1 };
  if (kind === "declicker") return { sensitivity: 5, threshold: 0.02, maxRunLength: 16 };
  if (kind === "deesser") return { centerFreq: 7000, q: 2.5, thresholdDb: -30, ratio: 4, attackMs: 1, releaseMs: 60, rangeDb: 12 };
  if (kind === "centerChannel") return { mode: "remove", centerLevelDb: -80, sideLevelDb: 0, lowFreq: 120, highFreq: 10000 };
  if (kind === "channelMixer") return { leftToLeft: 100, rightToLeft: 0, leftToRight: 0, rightToRight: 100 };
  if (kind === "graphicPhaseShifter") return { channel: "left", lowPhaseDeg: 0, highPhaseDeg: 180 };
  if (kind === "autoPhaseCorrect") return { mode: "auto", maxShiftMs: 5, leftShiftMs: 0, rightShiftMs: 0 };
  if (kind === "phaser") return { rateHz: 0.5, stages: 4, depth: 1, feedback: 0.3, mix: 0.5, baseFreqHz: 300, rangeOctaves: 4 };
  if (kind === "stereoExpander") return { expand: 125, centerPan: 0 };
  if (kind === "waveshaper") return { driveDb: 12, amount: 0.7, mix: 1 };
  if (kind === "guitarSuite") return { driveDb: 12, bodyHz: 90, toneHz: 5000, presenceDb: 3, mix: 1, outputDb: 0 };
  if (kind === "exciter") return { frequency: 3000, driveDb: 12, mix: 0.3 };
  if (kind === "vocalEnhancer") return {};
  if (kind === "mastering") return { lowShelfDb: 1, highShelfDb: 2, exciteAmount: 0.2, width: 1.3, ambience: 0, ambienceDecayMs: 250, ambiencePreDelayMs: 8, driveDb: 3, ceilingDb: -1, amount: 1 };
  if (kind === "delay") return { delayMs: 250, feedback: 0.35, mix: 0.35, tailSeconds: 1.5 };
  if (kind === "analogDelay") return { delayMs: 300, feedback: 0.4, toneHz: 4000, driveDb: 6, mix: 0.4, tailSeconds: 1.5 };
  if (kind === "echo") return { delayMs: 300, feedback: 0.5, mix: 0.5, ...ECHO_EQ_PARAMS, tailSeconds: 1.5 };
  if (kind === "studioReverb") return { decay: 0.5, damping: 0.4, earlyMs: 80, earlyLevel: 0.5, width: 0.7, mix: 0.3, tailSeconds: 1.5 };
  if (kind === "fullReverb") return { decayMs: 1500, perception: 40, preDelayMs: 0, absorption: 0.35, lowDb: 0, lowFreq: 200, midDb: 0, midFreq: 1000, midQ: 1, highDb: -6, highFreq: 6000, mix: 0.3, seed: 1 };
  return {};
}

function numericParam(slot: EffectSlot, name: string, fallback: number): number {
  const value = slot.params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringParam(slot: EffectSlot, name: string, fallback: string): string {
  const value = slot.params[name];
  return typeof value === "string" ? value : fallback;
}

function automatableRackParams(slot: EffectSlot): string[] {
  return Object.entries(slot.params)
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .map(([param]) => param);
}

export function EffectsPanel() {
  const store = useStore();
  const st = useEditorState();
  const [nativePluginBusy, setNativePluginBusy] = useState(false);
  const [rackTargetId, setRackTargetId] = useState("track");
  const [rackAutomationParamBySlot, setRackAutomationParamBySlot] = useState<Record<string, string>>({});
  const noisePrint = store.getNoiseProfile();
  const nativePlugins = st.project.nativePluginManager?.plugins ?? [];
  const effectsPrefs = normalizePanelPreferences(st.project.panelPreferences, st.project.sampleRate).effects;
  const db = effectsPrefs.gainDb;
  const normTarget = effectsPrefs.normalizeTargetDb;
  const cutoff = effectsPrefs.filterCutoffHz;
  const threshold = effectsPrefs.compressorThresholdDb;
  const ratio = effectsPrefs.compressorRatio;
  const reduceByDb = effectsPrefs.noiseReductionReduceByDb;
  const nrAmount = effectsPrefs.noiseReductionAmountPct;
  const humFreq = effectsPrefs.dehummerFrequencyHz;
  const humHarmonics = effectsPrefs.dehummerHarmonics;
  const humReduceDb = effectsPrefs.dehummerReductionDb;
  const essFreq = effectsPrefs.deEsserFrequencyHz;
  const essThreshold = effectsPrefs.deEsserThresholdDb;
  const semitones = effectsPrefs.pitchShiftSemitones;
  const stretchPct = effectsPrefs.timeStretchPercent;
  const ceilingDb = effectsPrefs.limiterCeilingDb;
  const boostDb = effectsPrefs.limiterBoostDb;
  const targetLufs = effectsPrefs.matchLoudnessTargetLufs;
  const dopplerSpeed = effectsPrefs.dopplerSpeedMps;
  const dopplerDist = effectsPrefs.dopplerDistanceM;
  const bendStart = effectsPrefs.pitchBendStartSemitones;
  const bendEnd = effectsPrefs.pitchBendEndSemitones;
  const tubeThreshold = effectsPrefs.tubeThresholdDb;
  const tubeWarmth = effectsPrefs.tubeWarmthPct;
  const reverbDecayMs = effectsPrefs.convolutionDecayMs;
  const reverbMix = effectsPrefs.convolutionMixPct;
  const setEffectsPrefs = (patch: Partial<EffectsPanelPreferences>, label: string) => {
    store.dispatch(setProjectPanelPreferences({ effects: patch }), { history: false, dirty: true, label });
  };
  const setDb = (gainDb: number) => setEffectsPrefs({ gainDb }, "Effects gain default");
  const setNormTarget = (normalizeTargetDb: number) => setEffectsPrefs({ normalizeTargetDb }, "Effects normalize default");
  const setCutoff = (filterCutoffHz: number) => setEffectsPrefs({ filterCutoffHz }, "Effects filter default");
  const setThreshold = (compressorThresholdDb: number) => setEffectsPrefs({ compressorThresholdDb }, "Effects compressor threshold");
  const setRatio = (compressorRatio: number) => setEffectsPrefs({ compressorRatio }, "Effects compressor ratio");
  const setReduceByDb = (noiseReductionReduceByDb: number) => setEffectsPrefs({ noiseReductionReduceByDb }, "Effects noise reduction");
  const setNrAmount = (noiseReductionAmountPct: number) => setEffectsPrefs({ noiseReductionAmountPct }, "Effects noise amount");
  const setHumFreq = (dehummerFrequencyHz: number) => setEffectsPrefs({ dehummerFrequencyHz }, "Effects dehummer frequency");
  const setHumHarmonics = (dehummerHarmonics: number) => setEffectsPrefs({ dehummerHarmonics }, "Effects dehummer harmonics");
  const setHumReduceDb = (dehummerReductionDb: number) => setEffectsPrefs({ dehummerReductionDb }, "Effects dehummer reduction");
  const setEssFreq = (deEsserFrequencyHz: number) => setEffectsPrefs({ deEsserFrequencyHz }, "Effects de-esser frequency");
  const setEssThreshold = (deEsserThresholdDb: number) => setEffectsPrefs({ deEsserThresholdDb }, "Effects de-esser threshold");
  const setSemitones = (pitchShiftSemitones: number) => setEffectsPrefs({ pitchShiftSemitones }, "Effects pitch shift");
  const setStretchPct = (timeStretchPercent: number) => setEffectsPrefs({ timeStretchPercent }, "Effects time stretch");
  const setCeilingDb = (limiterCeilingDb: number) => setEffectsPrefs({ limiterCeilingDb }, "Effects limiter ceiling");
  const setBoostDb = (limiterBoostDb: number) => setEffectsPrefs({ limiterBoostDb }, "Effects limiter boost");
  const setTargetLufs = (matchLoudnessTargetLufs: number) => setEffectsPrefs({ matchLoudnessTargetLufs }, "Effects loudness target");
  const setDopplerSpeed = (dopplerSpeedMps: number) => setEffectsPrefs({ dopplerSpeedMps }, "Effects doppler speed");
  const setDopplerDist = (dopplerDistanceM: number) => setEffectsPrefs({ dopplerDistanceM }, "Effects doppler distance");
  const setBendStart = (pitchBendStartSemitones: number) => setEffectsPrefs({ pitchBendStartSemitones }, "Effects pitch bend start");
  const setBendEnd = (pitchBendEndSemitones: number) => setEffectsPrefs({ pitchBendEndSemitones }, "Effects pitch bend end");
  const setTubeThreshold = (tubeThresholdDb: number) => setEffectsPrefs({ tubeThresholdDb }, "Effects tube threshold");
  const setTubeWarmth = (tubeWarmthPct: number) => setEffectsPrefs({ tubeWarmthPct }, "Effects tube warmth");
  const setReverbDecayMs = (convolutionDecayMs: number) => setEffectsPrefs({ convolutionDecayMs }, "Effects convolution decay");
  const setReverbMix = (convolutionMixPct: number) => setEffectsPrefs({ convolutionMixPct }, "Effects convolution mix");

  const scope = st.selection.range
    ? "selected range"
    : st.selection.clipIds.length
      ? `${st.selection.clipIds.length} clip(s)`
      : st.activeTrackId
        ? "active track"
        : "nothing";

  const groups = Array.from(new Set(EFFECTS.map((e) => e.group)));
  const canEssentialDuck = st.project.tracks.some((t) => t.audioRole === "dialogue") && st.project.tracks.some((t) => t.audioRole === "music");
  const activeTrack = st.project.tracks.find((t) => t.id === st.activeTrackId) ?? null;
  const selectedClip = st.selection.clipIds.length === 1 ? clipById(st.project, st.selection.clipIds[0]) : null;
  const buses = st.project.buses ?? [];
  const rackOptions = [
    { value: "clip", label: selectedClip ? `Clip: ${selectedClip.clip.name}` : "Clip: none" },
    { value: "track", label: activeTrack ? `Track: ${activeTrack.name}` : "Track: none" },
    ...buses.map((bus) => ({ value: `bus:${bus.id}`, label: `Bus: ${bus.name}` })),
    { value: "master", label: "Master" },
  ];
  const rackTarget: RackTarget | null = (() => {
    if (rackTargetId === "clip") {
      return selectedClip ? { kind: "clip", id: selectedClip.clip.id, name: selectedClip.clip.name, slots: selectedClip.clip.effectRack?.slots ?? [] } : null;
    }
    if (rackTargetId === "track") {
      return activeTrack ? { kind: "track", id: activeTrack.id, name: activeTrack.name, slots: activeTrack.effectRack?.slots ?? [] } : null;
    }
    if (rackTargetId.startsWith("bus:")) {
      const bus = buses.find((item) => item.id === rackTargetId.slice(4));
      return bus ? { kind: "bus", id: bus.id, name: bus.name, slots: bus.effectRack?.slots ?? [] } : null;
    }
    return { kind: "master", name: "Master", slots: st.project.masterEffectRack?.slots ?? [] };
  })();

  const addRackSlot = (kind: RackSlotKind) => {
    if (!rackTarget) return;
    const name = rackSlotName(kind);
    const slot = newEffectSlot(kind, { name, params: rackSlotParams(kind) });
    if (rackTarget.kind === "clip") store.dispatch(addClipEffectSlot(rackTarget.id, slot), { label: `Add ${name} rack slot` });
    else if (rackTarget.kind === "track") store.dispatch(addTrackEffectSlot(rackTarget.id, slot), { label: `Add ${name} rack slot` });
    else if (rackTarget.kind === "bus") store.dispatch(addBusEffectSlot(rackTarget.id, slot), { label: `Add ${name} rack slot` });
    else store.dispatch(addMasterEffectSlot(slot), { label: `Add ${name} rack slot` });
  };

  const addNativePluginRackSlot = (plugin: ManagedNativeAudioPlugin) => {
    if (!rackTarget) return;
    const target = rackTarget.kind === "master" ? { kind: "master" as const } : { kind: rackTarget.kind, id: rackTarget.id };
    addNativePluginSlotToRack(store, plugin.id, target);
  };

  const setRackSlotEnabled = (slot: EffectSlot, enabled: boolean) => {
    if (!rackTarget) return;
    if (rackTarget.kind === "clip") store.dispatch(setClipEffectSlotEnabled(rackTarget.id, slot.id, enabled), { label: `${enabled ? "Enable" : "Bypass"} ${slot.name}` });
    else if (rackTarget.kind === "track") store.dispatch(setTrackEffectSlotEnabled(rackTarget.id, slot.id, enabled), { label: `${enabled ? "Enable" : "Bypass"} ${slot.name}` });
    else if (rackTarget.kind === "bus") store.dispatch(setBusEffectSlotEnabled(rackTarget.id, slot.id, enabled), { label: `${enabled ? "Enable" : "Bypass"} ${slot.name}` });
    else store.dispatch(setMasterEffectSlotEnabled(slot.id, enabled), { label: `${enabled ? "Enable" : "Bypass"} ${slot.name}` });
  };

  const setRackSlotParam = (slot: EffectSlot, param: string, value: EffectParamValue) => {
    if (!rackTarget) return;
    const coalesceKey = `rack:${rackTarget.kind}:${"id" in rackTarget ? rackTarget.id : "master"}:${slot.id}:${param}`;
    if (rackTarget.kind === "clip") store.dispatch(setClipEffectSlotParam(rackTarget.id, slot.id, param, value), { coalesceKey, label: slot.name });
    else if (rackTarget.kind === "track") store.dispatch(setTrackEffectSlotParam(rackTarget.id, slot.id, param, value), { coalesceKey, label: slot.name });
    else if (rackTarget.kind === "bus") store.dispatch(setBusEffectSlotParam(rackTarget.id, slot.id, param, value), { coalesceKey, label: slot.name });
    else store.dispatch(setMasterEffectSlotParam(slot.id, param, value), { coalesceKey, label: slot.name });
  };

  const writeRackAutomation = (slot: EffectSlot, param: string) => {
    if (!rackTarget || !param) return;
    const value = numericParam(slot, param, 0);
    const time = st.transport.playhead;
    const label = `Write ${slot.name} automation`;
    if (rackTarget.kind === "clip") store.dispatch(setClipEffectParamAutomationPoint(rackTarget.id, slot.id, param, time, value), { label });
    else if (rackTarget.kind === "track") store.dispatch(setTrackEffectParamAutomationPoint(rackTarget.id, slot.id, param, time, value), { label });
    else if (rackTarget.kind === "bus") store.dispatch(setBusEffectParamAutomationPoint(rackTarget.id, slot.id, param, time, value), { label });
    else store.dispatch(setMasterEffectParamAutomationPoint(slot.id, param, time, value), { label });
  };

  const removeRackSlot = (slot: EffectSlot) => {
    if (!rackTarget) return;
    if (rackTarget.kind === "clip") store.dispatch(removeClipEffectSlot(rackTarget.id, slot.id), { label: `Remove ${slot.name}` });
    else if (rackTarget.kind === "track") store.dispatch(removeTrackEffectSlot(rackTarget.id, slot.id), { label: `Remove ${slot.name}` });
    else if (rackTarget.kind === "bus") store.dispatch(removeBusEffectSlot(rackTarget.id, slot.id), { label: `Remove ${slot.name}` });
    else store.dispatch(removeMasterEffectSlot(slot.id), { label: `Remove ${slot.name}` });
  };

  const addNativePlugins = async () => {
    setNativePluginBusy(true);
    try {
      const selected = await pickNativeAudioPlugins();
      if (selected.length) addNativePluginsToProject(store, selected);
    } finally {
      setNativePluginBusy(false);
    }
  };
  const scanNativePluginFolders = async () => {
    setNativePluginBusy(true);
    try {
      const selected = await pickNativeAudioPluginRoots();
      if (selected.plugins.length) addNativePluginsToProject(store, selected.plugins, selected.roots);
    } finally {
      setNativePluginBusy(false);
    }
  };

  return (
    <div className="rh-panel" data-panel="effects">
      <div className="rh-scope">Applies to: <b>{scope}</b></div>

      <div className="monet-section-label">Effects Rack</div>
      <div className="rh-fx-param">
        <Select options={rackOptions} value={rackTargetId} size="sm" block onChange={setRackTargetId} />
      </div>
      <div className="rh-scope">Rack: <b>{rackTarget?.name ?? "none"}</b></div>
      <div className="rh-btn-grid">
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("gain")}>Gain</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("pan")}>Pan</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("compressor")}>Compressor</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("limiter")}>Limiter</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("tubeCompressor")}>Tube</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("speechLeveler")}>Leveler</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("parametricEQ")}>Param EQ</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("graphicEQ")}>Graphic EQ</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("notchFilter")}>Notch</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("dehummer")}>DeHum</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("declicker")}>DeClick</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("deesser")}>DeEss</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("centerChannel")}>Center</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("channelMixer")}>Mixer</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("graphicPhaseShifter")}>Phase</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("autoPhaseCorrect")}>AutoPhase</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("phaser")}>Phaser</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("stereoExpander")}>Width</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("waveshaper")}>Shape</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("guitarSuite")}>Guitar</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("exciter")}>Exciter</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("vocalEnhancer")}>Vocal</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("mastering")}>Master</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("delay")}>Delay</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("analogDelay")}>Analog</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("echo")}>Echo</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("studioReverb")}>Reverb</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("fullReverb")}>Full Rev</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("invertPolarity")}>Invert</Button>
        <Button size="sm" disabled={!rackTarget} onClick={() => addRackSlot("silence")}>Silence</Button>
      </div>
      {rackTarget && rackTarget.slots.length > 0 ? (
        <div className="rh-rack-list">
          {rackTarget.slots.map((slot) => {
            const automationParams = automatableRackParams(slot);
            const automationParam = automationParams.includes(rackAutomationParamBySlot[slot.id]) ? rackAutomationParamBySlot[slot.id] : (automationParams[0] ?? "");
            return (
              <div key={slot.id} className={`rh-rack-slot ${slot.enabled ? "" : "is-bypassed"}`}>
                <div className="rh-rack-slot-head">
                  <button className={`rh-rack-power ${slot.enabled ? "is-on" : ""}`} onClick={() => setRackSlotEnabled(slot, !slot.enabled)}>
                    {slot.enabled ? "On" : "Byp"}
                  </button>
                  <div className="rh-rack-name">{slot.name}</div>
                  <Button size="sm" onClick={() => removeRackSlot(slot)}>Remove</Button>
                </div>
                {automationParams.length > 0 && (
                  <div className="rh-rack-automation" data-rack-automation={slot.id}>
                    <Select
                      options={automationParams.map((param) => ({ value: param, label: param }))}
                      value={automationParam}
                      size="sm"
                      onChange={(param) => setRackAutomationParamBySlot((prev) => ({ ...prev, [slot.id]: param }))}
                    />
                    <Button
                      size="sm"
                      data-action="write-rack-automation"
                      disabled={!automationParam}
                      title="Write automation point"
                      onClick={() => writeRackAutomation(slot, automationParam)}
                    >
                      A
                    </Button>
                  </div>
                )}
              {slot.kind === "gain" && (
                <div className="rh-fx-param">
                  <ScrubbyNumber value={numericParam(slot, "gainDb", 0)} min={-60} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "gainDb", v)} />
                </div>
              )}
              {slot.kind === "pan" && (
                <div className="rh-fx-param">
                  <ScrubbyNumber value={numericParam(slot, "pan", 0)} min={-1} max={1} step={0.05} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "pan", v)} />
                </div>
              )}
              {slot.kind === "compressor" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "thresholdDb", -18)} min={-80} max={0} step={1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "thresholdDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "ratio", 4)} min={1} max={20} step={0.5} suffix=":1" accent={accent} onChange={(v) => setRackSlotParam(slot, "ratio", v)} />
                    <ScrubbyNumber value={numericParam(slot, "makeupDb", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "makeupDb", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "attackMs", 10)} min={0.1} max={200} step={1} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "attackMs", v)} />
                    <ScrubbyNumber value={numericParam(slot, "releaseMs", 120)} min={5} max={1000} step={5} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "releaseMs", v)} />
                    <ScrubbyNumber value={numericParam(slot, "kneeDb", 6)} min={0} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "kneeDb", v)} />
                  </div>
                </>
              )}
              {slot.kind === "limiter" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "ceilingDb", -0.3)} min={-24} max={0} step={0.1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "ceilingDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "inputBoostDb", 0)} min={0} max={36} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "inputBoostDb", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "lookAheadMs", 5)} min={0} max={50} step={1} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "lookAheadMs", v)} />
                    <ScrubbyNumber value={numericParam(slot, "releaseMs", 100)} min={5} max={1000} step={5} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "releaseMs", v)} />
                  </div>
                </>
              )}
              {slot.kind === "tubeCompressor" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "driveDb", 9)} min={0} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "driveDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "warmth", 0.4)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "warmth", v)} />
                    <ScrubbyNumber value={numericParam(slot, "makeupDb", 3)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "makeupDb", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "thresholdDb", -18)} min={-80} max={0} step={1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "thresholdDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "ratio", 3)} min={1} max={20} step={0.5} suffix=":1" accent={accent} onChange={(v) => setRackSlotParam(slot, "ratio", v)} />
                    <ScrubbyNumber value={numericParam(slot, "releaseMs", 150)} min={5} max={1000} step={5} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "releaseMs", v)} />
                  </div>
                </>
              )}
              {slot.kind === "speechLeveler" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "targetDb", -18)} min={-60} max={0} step={1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "targetDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "amount", 0.7)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "amount", v)} />
                    <ScrubbyNumber value={numericParam(slot, "maxGainDb", 24)} min={0} max={60} step={1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "maxGainDb", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "gateDb", -50)} min={-100} max={0} step={1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "gateDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "windowMs", 300)} min={10} max={5000} step={10} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "windowMs", v)} />
                  </div>
                </>
              )}
              {slot.kind === "parametricEQ" && (
                <div className="rh-fx-param">
                  <ScrubbyNumber value={numericParam(slot, "freq", 1000)} min={20} max={20000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "freq", v)} />
                  <ScrubbyNumber value={numericParam(slot, "gainDb", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "gainDb", v)} />
                  <ScrubbyNumber value={numericParam(slot, "q", 1)} min={0.1} max={20} step={0.1} precision={1} accent={accent} onChange={(v) => setRackSlotParam(slot, "q", v)} />
                </div>
              )}
              {slot.kind === "graphicEQ" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "g31", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g31", v)} />
                    <ScrubbyNumber value={numericParam(slot, "g62", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g62", v)} />
                    <ScrubbyNumber value={numericParam(slot, "g125", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g125", v)} />
                    <ScrubbyNumber value={numericParam(slot, "g250", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g250", v)} />
                    <ScrubbyNumber value={numericParam(slot, "g500", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g500", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "g1000", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g1000", v)} />
                    <ScrubbyNumber value={numericParam(slot, "g2000", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g2000", v)} />
                    <ScrubbyNumber value={numericParam(slot, "g4000", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g4000", v)} />
                    <ScrubbyNumber value={numericParam(slot, "g8000", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g8000", v)} />
                    <ScrubbyNumber value={numericParam(slot, "g16000", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g16000", v)} />
                  </div>
                </>
              )}
              {slot.kind === "notchFilter" && (
                <div className="rh-fx-param">
                  <ScrubbyNumber value={numericParam(slot, "frequency", 1000)} min={20} max={20000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "frequency", v)} />
                  <ScrubbyNumber value={numericParam(slot, "gainDb", -40)} min={-80} max={0} step={1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "gainDb", v)} />
                  <ScrubbyNumber value={numericParam(slot, "q", 30)} min={0.1} max={100} step={0.5} precision={1} accent={accent} onChange={(v) => setRackSlotParam(slot, "q", v)} />
                </div>
              )}
              {slot.kind === "dehummer" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "frequency", 60)} min={40} max={400} step={1} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "frequency", v)} />
                    <ScrubbyNumber value={numericParam(slot, "reductionDb", -24)} min={-80} max={0} step={1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "reductionDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "harmonics", 10)} min={1} max={64} step={1} accent={accent} onChange={(v) => setRackSlotParam(slot, "harmonics", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "q", 20)} min={0.1} max={100} step={0.5} precision={1} accent={accent} onChange={(v) => setRackSlotParam(slot, "q", v)} />
                    <ScrubbyNumber value={numericParam(slot, "harmonicFalloff", 1)} min={0} max={1} step={0.05} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "harmonicFalloff", v)} />
                  </div>
                </>
              )}
              {slot.kind === "declicker" && (
                <div className="rh-fx-param">
                  <ScrubbyNumber value={numericParam(slot, "sensitivity", 5)} min={0} max={50} step={0.5} accent={accent} onChange={(v) => setRackSlotParam(slot, "sensitivity", v)} />
                  <ScrubbyNumber value={numericParam(slot, "threshold", 0.02)} min={0} max={1} step={0.005} precision={3} accent={accent} onChange={(v) => setRackSlotParam(slot, "threshold", v)} />
                  <ScrubbyNumber value={numericParam(slot, "maxRunLength", 16)} min={1} max={1024} step={1} accent={accent} onChange={(v) => setRackSlotParam(slot, "maxRunLength", v)} />
                </div>
              )}
              {slot.kind === "deesser" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "centerFreq", 7000)} min={1000} max={16000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "centerFreq", v)} />
                    <ScrubbyNumber value={numericParam(slot, "thresholdDb", -30)} min={-80} max={0} step={1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "thresholdDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "ratio", 4)} min={1} max={40} step={0.5} suffix=":1" accent={accent} onChange={(v) => setRackSlotParam(slot, "ratio", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "q", 2.5)} min={0.1} max={20} step={0.1} precision={1} accent={accent} onChange={(v) => setRackSlotParam(slot, "q", v)} />
                    <ScrubbyNumber value={numericParam(slot, "rangeDb", 12)} min={0} max={48} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "rangeDb", v)} />
                  </div>
                </>
              )}
              {slot.kind === "centerChannel" && (
                <>
                  <div className="rh-fx-param">
                    <Select
                      options={[
                        { value: "remove", label: "Remove Center" },
                        { value: "keep", label: "Keep Center" },
                      ]}
                      value={stringParam(slot, "mode", "remove")}
                      size="sm"
                      onChange={(v) => setRackSlotParam(slot, "mode", v)}
                    />
                    <ScrubbyNumber value={numericParam(slot, "centerLevelDb", -80)} min={-80} max={24} step={1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "centerLevelDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "sideLevelDb", 0)} min={-80} max={24} step={1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "sideLevelDb", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "lowFreq", 120)} min={20} max={20000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "lowFreq", v)} />
                    <ScrubbyNumber value={numericParam(slot, "highFreq", 10000)} min={20} max={20000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "highFreq", v)} />
                  </div>
                </>
              )}
              {slot.kind === "channelMixer" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "leftToLeft", 100)} min={-200} max={200} step={1} suffix="%" accent={accent} onChange={(v) => setRackSlotParam(slot, "leftToLeft", v)} />
                    <ScrubbyNumber value={numericParam(slot, "rightToLeft", 0)} min={-200} max={200} step={1} suffix="%" accent={accent} onChange={(v) => setRackSlotParam(slot, "rightToLeft", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "leftToRight", 0)} min={-200} max={200} step={1} suffix="%" accent={accent} onChange={(v) => setRackSlotParam(slot, "leftToRight", v)} />
                    <ScrubbyNumber value={numericParam(slot, "rightToRight", 100)} min={-200} max={200} step={1} suffix="%" accent={accent} onChange={(v) => setRackSlotParam(slot, "rightToRight", v)} />
                  </div>
                </>
              )}
              {slot.kind === "graphicPhaseShifter" && (
                <>
                  <div className="rh-fx-param">
                    <Select
                      options={[
                        { value: "left", label: "Left" },
                        { value: "right", label: "Right" },
                        { value: "both", label: "Both" },
                      ]}
                      value={stringParam(slot, "channel", "left")}
                      size="sm"
                      onChange={(v) => setRackSlotParam(slot, "channel", v)}
                    />
                    <ScrubbyNumber value={numericParam(slot, "lowPhaseDeg", 0)} min={-180} max={180} step={1} suffix="deg" accent={accent} onChange={(v) => setRackSlotParam(slot, "lowPhaseDeg", v)} />
                    <ScrubbyNumber value={numericParam(slot, "highPhaseDeg", 180)} min={-180} max={180} step={1} suffix="deg" accent={accent} onChange={(v) => setRackSlotParam(slot, "highPhaseDeg", v)} />
                  </div>
                </>
              )}
              {slot.kind === "autoPhaseCorrect" && (
                <>
                  <div className="rh-fx-param">
                    <Select
                      options={[
                        { value: "auto", label: "Auto" },
                        { value: "global", label: "Global" },
                      ]}
                      value={stringParam(slot, "mode", "auto")}
                      size="sm"
                      onChange={(v) => setRackSlotParam(slot, "mode", v)}
                    />
                    <ScrubbyNumber value={numericParam(slot, "maxShiftMs", 5)} min={0} max={100} step={1} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "maxShiftMs", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "leftShiftMs", 0)} min={-100} max={100} step={0.1} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "leftShiftMs", v)} />
                    <ScrubbyNumber value={numericParam(slot, "rightShiftMs", 0)} min={-100} max={100} step={0.1} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "rightShiftMs", v)} />
                  </div>
                </>
              )}
              {slot.kind === "phaser" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "rateHz", 0.5)} min={0} max={20} step={0.05} precision={2} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "rateHz", v)} />
                    <ScrubbyNumber value={numericParam(slot, "stages", 4)} min={1} max={24} step={1} accent={accent} onChange={(v) => setRackSlotParam(slot, "stages", v)} />
                    <ScrubbyNumber value={numericParam(slot, "mix", 0.5)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "mix", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "baseFreqHz", 300)} min={20} max={16000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "baseFreqHz", v)} />
                    <ScrubbyNumber value={numericParam(slot, "rangeOctaves", 4)} min={0} max={10} step={0.1} precision={1} accent={accent} onChange={(v) => setRackSlotParam(slot, "rangeOctaves", v)} />
                    <ScrubbyNumber value={numericParam(slot, "feedback", 0.3)} min={-0.95} max={0.95} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "feedback", v)} />
                  </div>
                </>
              )}
              {slot.kind === "stereoExpander" && (
                <div className="rh-fx-param">
                  <ScrubbyNumber value={numericParam(slot, "expand", 125)} min={0} max={300} step={1} suffix="%" accent={accent} onChange={(v) => setRackSlotParam(slot, "expand", v)} />
                  <ScrubbyNumber value={numericParam(slot, "centerPan", 0)} min={-100} max={100} step={1} accent={accent} onChange={(v) => setRackSlotParam(slot, "centerPan", v)} />
                </div>
              )}
              {slot.kind === "waveshaper" && (
                <div className="rh-fx-param">
                  <ScrubbyNumber value={numericParam(slot, "driveDb", 12)} min={-24} max={48} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "driveDb", v)} />
                  <ScrubbyNumber value={numericParam(slot, "amount", 0.7)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "amount", v)} />
                  <ScrubbyNumber value={numericParam(slot, "mix", 1)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "mix", v)} />
                </div>
              )}
              {slot.kind === "guitarSuite" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "driveDb", 12)} min={0} max={48} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "driveDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "toneHz", 5000)} min={500} max={20000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "toneHz", v)} />
                    <ScrubbyNumber value={numericParam(slot, "mix", 1)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "mix", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "bodyHz", 90)} min={20} max={500} step={1} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "bodyHz", v)} />
                    <ScrubbyNumber value={numericParam(slot, "presenceDb", 3)} min={-12} max={12} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "presenceDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "outputDb", 0)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "outputDb", v)} />
                  </div>
                </>
              )}
              {slot.kind === "exciter" && (
                <div className="rh-fx-param">
                  <ScrubbyNumber value={numericParam(slot, "frequency", 3000)} min={200} max={20000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "frequency", v)} />
                  <ScrubbyNumber value={numericParam(slot, "driveDb", 12)} min={0} max={48} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "driveDb", v)} />
                  <ScrubbyNumber value={numericParam(slot, "mix", 0.3)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "mix", v)} />
                </div>
              )}
              {slot.kind === "vocalEnhancer" && (
                <div className="rh-fx-param">
                  <Select
                    options={[
                      { value: "male", label: "Male" },
                      { value: "female", label: "Female" },
                      { value: "music", label: "Music" },
                    ]}
                    value={stringParam(slot, "mode", "male")}
                    size="sm"
                    onChange={(v) => setRackSlotParam(slot, "mode", v)}
                  />
                </div>
              )}
              {slot.kind === "mastering" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "lowShelfDb", 1)} min={-12} max={12} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "lowShelfDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "highShelfDb", 2)} min={-12} max={12} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "highShelfDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "driveDb", 3)} min={0} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "driveDb", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "exciteAmount", 0.2)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "exciteAmount", v)} />
                    <ScrubbyNumber value={numericParam(slot, "width", 1.3)} min={0} max={3} step={0.05} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "width", v)} />
                    <ScrubbyNumber value={numericParam(slot, "amount", 1)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "amount", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "ambience", 0)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "ambience", v)} />
                    <ScrubbyNumber value={numericParam(slot, "ceilingDb", -1)} min={-24} max={0} step={0.1} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "ceilingDb", v)} />
                  </div>
                </>
              )}
              {(slot.kind === "delay" || slot.kind === "analogDelay" || slot.kind === "echo") && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "delayMs", slot.kind === "delay" ? 250 : 300)} min={1} max={5000} step={1} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "delayMs", v)} />
                    <ScrubbyNumber value={numericParam(slot, "feedback", slot.kind === "delay" ? 0.35 : slot.kind === "analogDelay" ? 0.4 : 0.5)} min={0} max={0.95} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "feedback", v)} />
                    <ScrubbyNumber value={numericParam(slot, "mix", slot.kind === "delay" ? 0.35 : slot.kind === "analogDelay" ? 0.4 : 0.5)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "mix", v)} />
                    <ScrubbyNumber value={numericParam(slot, "tailSeconds", 1.5)} min={0} max={10} step={0.1} suffix="s" accent={accent} onChange={(v) => setRackSlotParam(slot, "tailSeconds", v)} />
                  </div>
                  {slot.kind === "analogDelay" && (
                    <div className="rh-fx-param">
                      <ScrubbyNumber value={numericParam(slot, "toneHz", 4000)} min={200} max={20000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "toneHz", v)} />
                      <ScrubbyNumber value={numericParam(slot, "driveDb", 6)} min={0} max={36} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "driveDb", v)} />
                    </div>
                  )}
                  {slot.kind === "echo" && (
                    <div className="rh-fx-param">
                      <ScrubbyNumber value={numericParam(slot, "g1000", -1)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g1000", v)} />
                      <ScrubbyNumber value={numericParam(slot, "g4000", -6)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g4000", v)} />
                      <ScrubbyNumber value={numericParam(slot, "g16000", -12)} min={-24} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "g16000", v)} />
                    </div>
                  )}
                </>
              )}
              {slot.kind === "studioReverb" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "decay", 0.5)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "decay", v)} />
                    <ScrubbyNumber value={numericParam(slot, "damping", 0.4)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "damping", v)} />
                    <ScrubbyNumber value={numericParam(slot, "mix", 0.3)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "mix", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "earlyMs", 80)} min={1} max={500} step={1} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "earlyMs", v)} />
                    <ScrubbyNumber value={numericParam(slot, "width", 0.7)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "width", v)} />
                    <ScrubbyNumber value={numericParam(slot, "tailSeconds", 1.5)} min={0} max={10} step={0.1} suffix="s" accent={accent} onChange={(v) => setRackSlotParam(slot, "tailSeconds", v)} />
                  </div>
                </>
              )}
              {slot.kind === "fullReverb" && (
                <>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "decayMs", 1500)} min={20} max={6000} step={10} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "decayMs", v)} />
                    <ScrubbyNumber value={numericParam(slot, "perception", 40)} min={0} max={100} step={1} accent={accent} onChange={(v) => setRackSlotParam(slot, "perception", v)} />
                    <ScrubbyNumber value={numericParam(slot, "mix", 0.3)} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "mix", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "preDelayMs", 0)} min={0} max={500} step={1} suffix="ms" accent={accent} onChange={(v) => setRackSlotParam(slot, "preDelayMs", v)} />
                    <ScrubbyNumber value={numericParam(slot, "absorption", 0.35)} min={0} max={0.999} step={0.01} precision={2} accent={accent} onChange={(v) => setRackSlotParam(slot, "absorption", v)} />
                    <ScrubbyNumber value={numericParam(slot, "lowDb", 0)} min={-36} max={12} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "lowDb", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "lowFreq", 200)} min={20} max={20000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "lowFreq", v)} />
                    <ScrubbyNumber value={numericParam(slot, "midDb", 0)} min={-36} max={12} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "midDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "midFreq", 1000)} min={20} max={20000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "midFreq", v)} />
                  </div>
                  <div className="rh-fx-param">
                    <ScrubbyNumber value={numericParam(slot, "midQ", 1)} min={0.1} max={50} step={0.1} precision={1} accent={accent} onChange={(v) => setRackSlotParam(slot, "midQ", v)} />
                    <ScrubbyNumber value={numericParam(slot, "highDb", -6)} min={-36} max={12} step={0.5} suffix="dB" accent={accent} onChange={(v) => setRackSlotParam(slot, "highDb", v)} />
                    <ScrubbyNumber value={numericParam(slot, "highFreq", 6000)} min={500} max={20000} step={10} suffix="Hz" accent={accent} onChange={(v) => setRackSlotParam(slot, "highFreq", v)} />
                  </div>
                </>
              )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rh-empty rh-rack-empty">No rack slots</div>
      )}

      <div className="monet-section-label">Amplitude</div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={db} min={-48} max={48} step={0.5} suffix="dB" accent={accent} onChange={setDb} />
        <Button size="sm" onClick={() => applyEffectById(store, "amplify", { db })}>Amplify</Button>
      </div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={normTarget} min={-24} max={0} step={0.1} suffix="dB" accent={accent} onChange={setNormTarget} />
        <Button size="sm" onClick={() => applyEffectById(store, "normalize", { targetDb: normTarget })}>Normalize</Button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Filter</div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={cutoff} min={20} max={20000} step={10} suffix="Hz" accent={accent} onChange={setCutoff} />
        <Button size="sm" onClick={() => applyEffectById(store, "lowpass", { freq: cutoff })}>Low-pass</Button>
        <Button size="sm" onClick={() => applyEffectById(store, "highpass", { freq: cutoff })}>High-pass</Button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Compressor</div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={threshold} min={-60} max={0} step={1} suffix="dB" accent={accent} onChange={setThreshold} />
        <ScrubbyNumber value={ratio} min={1} max={20} step={0.5} suffix=":1" accent={accent} onChange={setRatio} />
        <Button size="sm" onClick={() => applyEffectById(store, "compress", { thresholdDb: threshold, ratio })}>Compress</Button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Dynamics Processing</div>
      <div className="rh-btn-grid">
        {DYNAMICS_PROCESSING_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyDynamicsProcessing(store, p.opts, `Dynamics Processing — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Speech Volume Leveler</div>
      <div className="rh-btn-grid">
        {SPEECH_LEVELER_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applySpeechLeveler(store, p.opts, `Speech Volume Leveler — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Gain Envelope</div>
      <div className="rh-btn-grid">
        {GAIN_ENVELOPE_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyGainEnvelope(store, p.opts, `Gain Envelope — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Essential Sound</div>
      <div className="rh-btn-grid">
        {ESSENTIAL_SOUND_ROLES.map((r) => (
          <Button key={r.role} size="sm" onClick={() => applyEssentialSoundPreset(store, r.role)}>{r.preset}</Button>
        ))}
        <Button size="sm" disabled={!canEssentialDuck} onClick={() => applyEssentialSoundAutoDuck(store)}>
          Auto-Duck
        </Button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Native Plug-ins</div>
      <div className="rh-fx-param">
        <Button size="sm" disabled={nativePluginBusy} onClick={() => { void addNativePlugins(); }}>
          {nativePluginBusy ? "Scanning..." : "Add Plug-ins..."}
        </Button>
        <Button size="sm" disabled={nativePluginBusy} onClick={() => { void scanNativePluginFolders(); }}>
          Scan Folders...
        </Button>
        <div className="rh-scope" style={{ marginBottom: 0 }}>Inventory: <b>{nativePlugins.length}</b></div>
      </div>
      {nativePlugins.length > 0 && (
        <div className="rh-plugin-list">
          {nativePlugins.map((p) => (
            <div key={p.id} className="rh-plugin-row" title={p.path}>
              <div className="rh-plugin-main">
                <label className="rh-plugin-toggle">
                  <input type="checkbox" checked={p.enabled} onChange={(e) => setManagedNativePluginEnabled(store, p.id, e.currentTarget.checked)} />
                  <span className="rh-plugin-name">{p.name}</span>
                </label>
                <Button size="sm" disabled={!rackTarget} onClick={() => addNativePluginRackSlot(p)}>Rack</Button>
                <Button size="sm" onClick={() => setManagedNativePluginPresetState(store, p.id, p.presetName ?? "Default")}>Preset</Button>
              </div>
              <div className="rh-plugin-meta">
                {pluginKindShortLabel(p.kind)} · {p.hostStatus} · {pluginValidationLabel(p.validationStatus)} · {p.enabled ? "enabled" : "disabled"}
                {p.version ? ` · ${p.version}` : ""}
                {p.entryPointVerified ? " · entry point" : ""}
                {p.presetName ? ` · ${p.presetName}` : ""}
                {p.validationIssues?.length ? ` · ${p.validationIssues.length} issue(s)` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="monet-section-label" style={{ marginTop: 8 }}>Noise Reduction / Restoration</div>
      <div className="rh-scope" style={{ marginBottom: 6 }}>
        Noise print: <b>{noisePrint ? `captured (${noisePrint.fftSize}-pt FFT)` : "none — select noise, then Capture"}</b>
      </div>
      <div className="rh-fx-param">
        <Button size="sm" onClick={() => captureNoisePrint(store)}>Capture Noise Print</Button>
      </div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={reduceByDb} min={0} max={48} step={1} suffix="dB" accent={accent} onChange={setReduceByDb} />
        <ScrubbyNumber value={nrAmount} min={0} max={100} step={1} suffix="%" accent={accent} onChange={setNrAmount} />
        <Button
          size="sm"
          disabled={!noisePrint}
          onClick={() => applyNoiseReduction(store, { reduceByDb, amount: nrAmount / 100 })}
        >
          Reduce Noise
        </Button>
      </div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={humFreq} min={20} max={500} step={1} suffix="Hz" accent={accent} onChange={setHumFreq} />
        <ScrubbyNumber value={humHarmonics} min={1} max={40} step={1} suffix="×" accent={accent} onChange={setHumHarmonics} />
        <ScrubbyNumber value={humReduceDb} min={0} max={48} step={1} suffix="dB" accent={accent} onChange={setHumReduceDb} />
        <Button size="sm" onClick={() => applyDeHummer(store, { frequency: humFreq, harmonics: humHarmonics, reductionDb: -humReduceDb })}>
          Remove Hum
        </Button>
        <Button size="sm" onClick={() => applyDeClicker(store)}>DeClick</Button>
      </div>
      <div className="rh-btn-grid">
        {HISS_REDUCTION_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyHissReduction(store, p.opts, `Hiss Reduction — ${p.label}`)}>Hiss: {p.label}</Button>
        ))}
        {ADAPTIVE_NR_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyAdaptiveNoiseReduction(store, p.opts, `Adaptive Noise Reduction — ${p.label}`)}>Adaptive: {p.label}</Button>
        ))}
        {DEREVERB_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyDeReverb(store, p.opts, `DeReverb — ${p.label}`)}>DeReverb: {p.label}</Button>
        ))}
        {DECLIPPER_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyDeClipper(store, p.opts, `DeClipper — ${p.label}`)}>DeClip: {p.label}</Button>
        ))}
        {AUTO_PHASE_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyAutoPhaseCorrect(store, p.opts, `Auto Phase Correction — ${p.label}`)}>Phase: {p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Stereo Imagery</div>
      <div className="rh-fx-param">
        <Button size="sm" onClick={() => applyCenterExtract(store, { mode: "remove" })}>Remove Vocals</Button>
        <Button size="sm" onClick={() => applyCenterExtract(store, { mode: "keep" })}>Isolate Vocals</Button>
        <Button size="sm" onClick={() => applySwapChannels(store)}>Swap Channels</Button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Channel Mixer</div>
      <div className="rh-btn-grid">
        {CHANNEL_MIXER_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyChannelMixer(store, p.opts, `Channel Mixer — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Stereo Expander</div>
      <div className="rh-btn-grid">
        {STEREO_EXPANDER_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyStereoExpander(store, p.opts, `Stereo Expander — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Graphic Phase Shifter</div>
      <div className="rh-btn-grid">
        {GRAPHIC_PHASE_SHIFTER_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyGraphicPhaseShifter(store, p.opts, `Graphic Phase Shifter — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Vocal Enhancer</div>
      <div className="rh-fx-param">
        <Button size="sm" onClick={() => applyVocalEnhancer(store, "male")}>Male</Button>
        <Button size="sm" onClick={() => applyVocalEnhancer(store, "female")}>Female</Button>
        <Button size="sm" onClick={() => applyVocalEnhancer(store, "music")}>Music</Button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>FFT Filter</div>
      <div className="rh-btn-grid">
        {FFT_FILTER_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyFFTFilter(store, p.curve, `FFT Filter — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Frequency Band Splitter</div>
      <div className="rh-btn-grid">
        {BAND_SPLIT_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => splitIntoBands(store, p.crossovers, `Frequency Band Splitter — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Delete Silence</div>
      <div className="rh-btn-grid">
        {DELETE_SILENCE_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyDeleteSilence(store, p.opts, `Delete Silence — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Convert Sample Type</div>
      <div className="rh-btn-grid">
        {CONVERT_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyConvertSampleType(store, p.opts, `Convert Sample Type — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Project Sample Rate</div>
      <div className="rh-btn-grid">
        {SAMPLE_RATE_PRESETS.map((p) => (
          <Button key={p.id} size="sm" disabled={st.project.sampleRate === p.rate} onClick={() => convertProjectSampleRate(store, p.rate, `Convert Sample Rate — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Mark Audio</div>
      <div className="rh-btn-grid">
        {MARK_AUDIO_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => markAudioRegions(store, p.opts, `Mark Audio — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Graphic Equalizer</div>
      <div className="rh-btn-grid">
        {GRAPHIC_EQ_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyGraphicEq(store, p.gainsDb, `Graphic Equalizer — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Parametric Equalizer</div>
      <div className="rh-btn-grid">
        {PARAMETRIC_EQ_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyParametricEq(store, p.bands, `Parametric Equalizer — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Notch Filter</div>
      <div className="rh-btn-grid">
        {NOTCH_FILTER_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyNotchFilter(store, p.opts, `Notch Filter — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Scientific Filter</div>
      <div className="rh-btn-grid">
        {SCIENTIFIC_FILTER_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyScientificFilter(store, p.opts, `Scientific Filter — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Exciter</div>
      <div className="rh-btn-grid">
        {EXCITER_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyExciter(store, p.opts, `Exciter — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Guitar Suite</div>
      <div className="rh-btn-grid">
        {GUITAR_SUITE_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyGuitarSuite(store, p.opts, `Guitar Suite — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Convolution Reverb</div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={reverbDecayMs} min={100} max={3000} step={50} suffix="ms" accent={accent} onChange={setReverbDecayMs} />
        <ScrubbyNumber value={reverbMix} min={0} max={100} step={1} suffix="%" accent={accent} onChange={setReverbMix} />
        <Button size="sm" onClick={() => applyEffectById(store, "convReverb", { decayMs: reverbDecayMs, mix: reverbMix })}>Convolve</Button>
        <Button size="sm" onClick={() => { void applyConvolutionReverbFromFile(store, { mix: reverbMix / 100 }); }}>Load IR</Button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Studio Reverb</div>
      <div className="rh-btn-grid">
        {STUDIO_REVERB_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyStudioReverb(store, p.opts, `Studio Reverb — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Full Reverb</div>
      <div className="rh-btn-grid">
        {FULL_REVERB_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyFullReverb(store, p.opts, `Full Reverb — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Mastering</div>
      <div className="rh-btn-grid">
        {MASTERING_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyMastering(store, p.opts, `Mastering — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Waveshaper</div>
      <div className="rh-btn-grid">
        {WAVESHAPER_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyWaveshaper(store, p.opts, `Waveshaper — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Analog Delay</div>
      <div className="rh-btn-grid">
        {ANALOG_DELAY_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyAnalogDelay(store, p.opts, `Analog Delay — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Echo</div>
      <div className="rh-btn-grid">
        {ECHO_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyEcho(store, p.opts, `Echo — ${p.label}`)}>{p.label}</Button>
        ))}
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>De-Esser</div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={essFreq} min={2000} max={16000} step={100} suffix="Hz" accent={accent} onChange={setEssFreq} />
        <ScrubbyNumber value={essThreshold} min={-60} max={0} step={1} suffix="dB" accent={accent} onChange={setEssThreshold} />
        <Button size="sm" onClick={() => applyDeEsser(store, { centerFreq: essFreq, thresholdDb: essThreshold })}>
          Reduce Sibilance
        </Button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Time &amp; Pitch</div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={semitones} min={-24} max={24} step={1} suffix="st" accent={accent} onChange={setSemitones} />
        <Button size="sm" onClick={() => applyPitchShift(store, semitones)}>Pitch Shift</Button>
      </div>
      <div className="rh-btn-grid">
        {AUTO_PITCH_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => applyAutoPitchCorrect(store, p.opts, `Auto Pitch Correct — ${p.label}`)}>Auto-Tune: {p.label}</Button>
        ))}
      </div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={stretchPct} min={25} max={400} step={5} suffix="%" accent={accent} onChange={setStretchPct} />
        <Button size="sm" onClick={() => applyTimeStretch(store, stretchPct / 100)}>Stretch</Button>
      </div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={bendStart} min={-24} max={24} step={1} suffix="st" accent={accent} onChange={setBendStart} />
        <ScrubbyNumber value={bendEnd} min={-24} max={24} step={1} suffix="st" accent={accent} onChange={setBendEnd} />
        <Button size="sm" onClick={() => applyPitchBend(store, { startSemitones: bendStart, endSemitones: bendEnd })}>Pitch Bend</Button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Hard Limiter</div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={ceilingDb} min={-12} max={0} step={0.1} suffix="dB" accent={accent} onChange={setCeilingDb} />
        <ScrubbyNumber value={boostDb} min={0} max={36} step={0.5} suffix="dB" accent={accent} onChange={setBoostDb} />
        <Button size="sm" onClick={() => applyHardLimiter(store, { ceilingDb, inputBoostDb: boostDb })}>Limit</Button>
        <Button size="sm" onClick={() => applyMultibandCompressor(store)}>Multiband Master</Button>
      </div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={tubeThreshold} min={-60} max={0} step={1} suffix="dB" accent={accent} onChange={setTubeThreshold} />
        <ScrubbyNumber value={tubeWarmth} min={0} max={100} step={1} suffix="%" accent={accent} onChange={setTubeWarmth} />
        <Button size="sm" onClick={() => applyTubeCompressor(store, { thresholdDb: tubeThreshold, warmth: tubeWarmth / 100, driveDb: 9, ratio: 3, makeupDb: 3 })}>Tube Comp</Button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Match Loudness</div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={targetLufs} min={-40} max={-6} step={1} suffix="LUFS" accent={accent} onChange={setTargetLufs} />
        <Button size="sm" onClick={() => applyMatchLoudness(store, { targetLufs, peakCeilingDb: -1 })}>Match</Button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Doppler Shifter</div>
      <div className="rh-fx-param">
        <ScrubbyNumber value={dopplerSpeed} min={0} max={150} step={5} suffix="m/s" accent={accent} onChange={setDopplerSpeed} />
        <ScrubbyNumber value={dopplerDist} min={1} max={50} step={1} suffix="m" accent={accent} onChange={setDopplerDist} />
        <Button size="sm" onClick={() => applyEffectById(store, "doppler", { speed: dopplerSpeed, closest: dopplerDist })}>Doppler</Button>
      </div>

      {groups.map((g) => (
        <div key={g}>
          <div className="monet-section-label" style={{ marginTop: 10 }}>{g}</div>
          <div className="rh-btn-grid">
            {EFFECTS.filter((e) => e.group === g).map((e) => (
              <Button key={e.id} size="sm" onClick={() => applyEffectById(store, e.id)}>{e.label.replace(/[.…]+$/, "")}</Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function pluginKindShortLabel(kind: ManagedNativeAudioPlugin["kind"]): string {
  if (kind === "audioUnit") return "AU";
  if (kind === "vst3") return "VST3";
  if (kind === "vst2") return "VST";
  return "Unknown";
}

function pluginValidationLabel(status: ManagedNativeAudioPlugin["validationStatus"]): string {
  if (status === "metadataVerified") return "metadata verified";
  if (status === "invalid") return "invalid";
  return "path only";
}
