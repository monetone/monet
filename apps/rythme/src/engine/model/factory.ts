// ─────────────────────────────────────────────────────────────
// engine/model/factory — constructors for model entities
// ─────────────────────────────────────────────────────────────
// Every entity is built here so defaults live in one place. Factories take a
// small `Partial`-style options object and fill the rest with sane defaults.

import { createAudioData } from "../audio/buffer";
import { durationSeconds, type AudioData } from "../audio/types";
import { nextId } from "./ids";
import { KEYBOARD_SHORTCUT_ACTIONS, MASTER_BUS_ID, type AnalyzePanelPreferences, type AudioHardwareSettings, type AutomationLane, type Bus, type Clip, type CustomWorkspace, type DisplayTimeFormat, type EditorMode, type EditorPreferences, type EffectRack, type EffectSlot, type EffectsPanelPreferences, type KeyboardShortcut, type KeyboardShortcutAction, type KeyboardShortcutPreset, type Marker, type PanelPreferences, type Project, type Send, type ToolId, type Track, type VideoAsset, type VideoClip, type VideoTrack, type WorkspaceLayoutData } from "./types";

/** Default lane colors, cycled as tracks are added (matches the Audio accent family). */
export const TRACK_COLORS = [
  "var(--accent-audio)",
  "oklch(0.74 0.16 280)",
  "oklch(0.74 0.16 330)",
  "oklch(0.78 0.14 200)",
  "oklch(0.70 0.12 140)",
  "oklch(0.78 0.14 240)",
  "oklch(0.80 0.14 90)",
  "oklch(0.70 0.16 30)",
];

export const MARKER_COLORS = [
  "var(--accent-audio)",
  "oklch(0.78 0.14 200)",
  "oklch(0.74 0.16 330)",
  "oklch(0.70 0.12 140)",
  "oklch(0.78 0.14 240)",
];

export const DEFAULT_SAMPLE_RATE = 48000;
export const DEFAULT_VIDEO_FRAME_RATE = 24;

const EDITOR_MODES = new Set<EditorMode>(["multitrack", "waveform"]);
const TOOL_IDS = new Set<ToolId>(["select", "razor", "marquee", "envelope", "fade", "marker", "hand", "zoom"]);
const DISPLAY_TIME_FORMATS = new Set<DisplayTimeFormat>(["decimal", "smpte30", "samples", "barsBeats"]);
const KEYBOARD_SHORTCUT_ACTION_IDS = new Set<KeyboardShortcutAction>(KEYBOARD_SHORTCUT_ACTIONS);

export function defaultAudioHardwareSettings(sampleRate = DEFAULT_SAMPLE_RATE): AudioHardwareSettings {
  return {
    hardwareSampleRate: sampleRate,
    inputChannels: 2,
    inputMonitoring: "off",
    latencyCompensationMs: 0,
    preRollSeconds: 0,
    countInBars: 0,
    punchIn: null,
    meterCalibrationDb: 0,
    meterPeakHoldMs: 1200,
  };
}

export function defaultEditorPreferences(sampleRate = DEFAULT_SAMPLE_RATE): EditorPreferences {
  return {
    editorMode: "multitrack",
    tool: "select",
    snap: true,
    displayTimeFormat: "decimal",
    spectralMinHz: 0,
    spectralMaxHz: Math.max(1, sampleRate / 2),
    activeWorkspaceId: "default",
    customWorkspaces: [],
    keyboardShortcuts: [],
    keyboardShortcutPresets: [],
  };
}

export function normalizeEditorPreferences(settings: Partial<EditorPreferences> | undefined, sampleRate = DEFAULT_SAMPLE_RATE): EditorPreferences {
  const defaults = defaultEditorPreferences(sampleRate);
  const nyquist = Math.max(1, sampleRate / 2);
  let minHz = clampNumber(settings?.spectralMinHz ?? defaults.spectralMinHz, 0, nyquist);
  let maxHz = clampNumber(settings?.spectralMaxHz ?? defaults.spectralMaxHz, 1, nyquist);
  if (maxHz <= minHz) {
    minHz = defaults.spectralMinHz;
    maxHz = defaults.spectralMaxHz;
  }
  return {
    editorMode: settings?.editorMode && EDITOR_MODES.has(settings.editorMode) ? settings.editorMode : defaults.editorMode,
    tool: settings?.tool && TOOL_IDS.has(settings.tool) ? settings.tool : defaults.tool,
    snap: typeof settings?.snap === "boolean" ? settings.snap : defaults.snap,
    displayTimeFormat: settings?.displayTimeFormat && DISPLAY_TIME_FORMATS.has(settings.displayTimeFormat) ? settings.displayTimeFormat : defaults.displayTimeFormat,
    spectralMinHz: minHz,
    spectralMaxHz: maxHz,
    activeWorkspaceId: normalizeText(settings?.activeWorkspaceId, 80) ?? defaults.activeWorkspaceId,
    customWorkspaces: normalizeCustomWorkspaces(settings?.customWorkspaces),
    keyboardShortcuts: normalizeKeyboardShortcuts(settings?.keyboardShortcuts),
    keyboardShortcutPresets: normalizeKeyboardShortcutPresets(settings?.keyboardShortcutPresets),
  };
}

export function defaultPanelPreferences(sampleRate = DEFAULT_SAMPLE_RATE): PanelPreferences {
  const nyquist = Math.max(1, sampleRate / 2);
  return {
    analyze: {
      spectralMinHz: Math.min(1000, Math.max(0, nyquist - 1)),
      spectralMaxHz: Math.min(8000, nyquist),
      spectralGainDb: -24,
    },
    effects: {
      gainDb: 6,
      normalizeTargetDb: -0.3,
      filterCutoffHz: 1000,
      compressorThresholdDb: -18,
      compressorRatio: 4,
      noiseReductionReduceByDb: 18,
      noiseReductionAmountPct: 90,
      dehummerFrequencyHz: 60,
      dehummerHarmonics: 8,
      dehummerReductionDb: 24,
      deEsserFrequencyHz: 7000,
      deEsserThresholdDb: -30,
      pitchShiftSemitones: 0,
      timeStretchPercent: 100,
      pitchBendStartSemitones: 0,
      pitchBendEndSemitones: 12,
      limiterCeilingDb: -0.3,
      limiterBoostDb: 6,
      tubeThresholdDb: -18,
      tubeWarmthPct: 40,
      matchLoudnessTargetLufs: -16,
      dopplerSpeedMps: 30,
      dopplerDistanceM: 4,
      convolutionDecayMs: 800,
      convolutionMixPct: 30,
    },
  };
}

export function normalizePanelPreferences(settings: Partial<PanelPreferences> | undefined, sampleRate = DEFAULT_SAMPLE_RATE): PanelPreferences {
  const defaults = defaultPanelPreferences(sampleRate);
  return {
    analyze: normalizeAnalyzePanelPreferences(settings?.analyze, defaults.analyze, sampleRate),
    effects: normalizeEffectsPanelPreferences(settings?.effects, defaults.effects),
  };
}

function normalizeAnalyzePanelPreferences(settings: Partial<AnalyzePanelPreferences> | undefined, defaults: AnalyzePanelPreferences, sampleRate: number): AnalyzePanelPreferences {
  const nyquist = Math.max(1, sampleRate / 2);
  let minHz = clampNumber(settings?.spectralMinHz ?? defaults.spectralMinHz, 0, Math.max(0, nyquist - 1));
  let maxHz = clampNumber(settings?.spectralMaxHz ?? defaults.spectralMaxHz, 1, nyquist);
  if (maxHz <= minHz) {
    minHz = Math.max(0, Math.min(minHz, nyquist - 1));
    maxHz = Math.min(nyquist, minHz + 1);
  }
  return {
    spectralMinHz: minHz,
    spectralMaxHz: maxHz,
    spectralGainDb: clampNumber(settings?.spectralGainDb ?? defaults.spectralGainDb, -60, 24),
  };
}

function normalizeEffectsPanelPreferences(settings: Partial<EffectsPanelPreferences> | undefined, defaults: EffectsPanelPreferences): EffectsPanelPreferences {
  return {
    gainDb: clampNumber(settings?.gainDb ?? defaults.gainDb, -48, 48),
    normalizeTargetDb: clampNumber(settings?.normalizeTargetDb ?? defaults.normalizeTargetDb, -24, 0),
    filterCutoffHz: clampNumber(settings?.filterCutoffHz ?? defaults.filterCutoffHz, 20, 20000),
    compressorThresholdDb: clampNumber(settings?.compressorThresholdDb ?? defaults.compressorThresholdDb, -60, 0),
    compressorRatio: clampNumber(settings?.compressorRatio ?? defaults.compressorRatio, 1, 20),
    noiseReductionReduceByDb: clampNumber(settings?.noiseReductionReduceByDb ?? defaults.noiseReductionReduceByDb, 0, 48),
    noiseReductionAmountPct: clampNumber(settings?.noiseReductionAmountPct ?? defaults.noiseReductionAmountPct, 0, 100),
    dehummerFrequencyHz: clampNumber(settings?.dehummerFrequencyHz ?? defaults.dehummerFrequencyHz, 20, 500),
    dehummerHarmonics: Math.round(clampNumber(settings?.dehummerHarmonics ?? defaults.dehummerHarmonics, 1, 40)),
    dehummerReductionDb: clampNumber(settings?.dehummerReductionDb ?? defaults.dehummerReductionDb, 0, 48),
    deEsserFrequencyHz: clampNumber(settings?.deEsserFrequencyHz ?? defaults.deEsserFrequencyHz, 2000, 16000),
    deEsserThresholdDb: clampNumber(settings?.deEsserThresholdDb ?? defaults.deEsserThresholdDb, -60, 0),
    pitchShiftSemitones: clampNumber(settings?.pitchShiftSemitones ?? defaults.pitchShiftSemitones, -24, 24),
    timeStretchPercent: clampNumber(settings?.timeStretchPercent ?? defaults.timeStretchPercent, 25, 400),
    pitchBendStartSemitones: clampNumber(settings?.pitchBendStartSemitones ?? defaults.pitchBendStartSemitones, -24, 24),
    pitchBendEndSemitones: clampNumber(settings?.pitchBendEndSemitones ?? defaults.pitchBendEndSemitones, -24, 24),
    limiterCeilingDb: clampNumber(settings?.limiterCeilingDb ?? defaults.limiterCeilingDb, -12, 0),
    limiterBoostDb: clampNumber(settings?.limiterBoostDb ?? defaults.limiterBoostDb, 0, 36),
    tubeThresholdDb: clampNumber(settings?.tubeThresholdDb ?? defaults.tubeThresholdDb, -60, 0),
    tubeWarmthPct: clampNumber(settings?.tubeWarmthPct ?? defaults.tubeWarmthPct, 0, 100),
    matchLoudnessTargetLufs: clampNumber(settings?.matchLoudnessTargetLufs ?? defaults.matchLoudnessTargetLufs, -40, -6),
    dopplerSpeedMps: clampNumber(settings?.dopplerSpeedMps ?? defaults.dopplerSpeedMps, 0, 150),
    dopplerDistanceM: clampNumber(settings?.dopplerDistanceM ?? defaults.dopplerDistanceM, 1, 50),
    convolutionDecayMs: clampNumber(settings?.convolutionDecayMs ?? defaults.convolutionDecayMs, 100, 3000),
    convolutionMixPct: clampNumber(settings?.convolutionMixPct ?? defaults.convolutionMixPct, 0, 100),
  };
}

function clampNumber(value: number, lo: number, hi: number): number {
  const finite = Number.isFinite(value) ? value : lo;
  return finite < lo ? lo : finite > hi ? hi : finite;
}

function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeCustomWorkspaces(value: unknown): CustomWorkspace[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CustomWorkspace[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Partial<CustomWorkspace>;
    const id = normalizeText(rec.id, 80);
    const name = normalizeText(rec.name, 80);
    const layout = cloneWorkspaceLayout(rec.layout);
    if (!id || !name || !layout || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, layout });
    if (out.length >= 24) break;
  }
  return out;
}

export function normalizeShortcutKey(value: unknown): string | null {
  if (value === " ") return "space";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  if (key === "spacebar") return "space";
  return key.length <= 32 ? key : null;
}

export function normalizeKeyboardShortcuts(value: unknown): KeyboardShortcut[] {
  if (!Array.isArray(value)) return [];
  const out: KeyboardShortcut[] = [];
  const byAction = new Map<KeyboardShortcutAction, number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Partial<KeyboardShortcut>;
    const action = rec.action;
    if (!action || !KEYBOARD_SHORTCUT_ACTION_IDS.has(action)) continue;
    const key = normalizeShortcutKey(rec.key);
    if (!key) continue;
    const shortcut: KeyboardShortcut = {
      action,
      key,
      mod: rec.mod === true,
      shift: rec.shift === true,
      alt: rec.alt === true,
    };
    const existing = byAction.get(action);
    if (existing === undefined) {
      byAction.set(action, out.length);
      out.push(shortcut);
    } else {
      out[existing] = shortcut;
    }
    if (out.length >= 64) break;
  }
  return out;
}

function normalizeKeyboardShortcutPresets(value: unknown): KeyboardShortcutPreset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: KeyboardShortcutPreset[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Partial<KeyboardShortcutPreset>;
    const id = normalizeText(rec.id, 80);
    const name = normalizeText(rec.name, 80);
    const shortcuts = normalizeKeyboardShortcuts(rec.shortcuts);
    if (!id || !name || shortcuts.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, shortcuts });
    if (out.length >= 24) break;
  }
  return out;
}

function cloneWorkspaceLayout(value: unknown): WorkspaceLayoutData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;
    return cloned && typeof cloned === "object" && !Array.isArray(cloned) ? cloned as WorkspaceLayoutData : null;
  } catch {
    return null;
  }
}

export function newEffectRack(opts: Partial<EffectRack> = {}): EffectRack {
  return {
    slots: opts.slots ?? [],
    bypassed: opts.bypassed ?? false,
  };
}

export function newEffectSlot(kind: string, opts: Partial<EffectSlot> = {}): EffectSlot {
  return {
    id: opts.id ?? nextId("fx"),
    kind: opts.kind ?? kind,
    name: opts.name ?? kind,
    enabled: opts.enabled ?? true,
    params: opts.params ?? {},
  };
}

export function newAutomationLane(opts: Partial<AutomationLane> & { target: AutomationLane["target"] }): AutomationLane {
  return {
    id: opts.id ?? nextId("auto"),
    name: opts.name ?? opts.target.kind,
    target: opts.target,
    points: opts.points ?? [],
    enabled: opts.enabled ?? true,
    interpolation: opts.interpolation ?? "linear",
  };
}

export function newSend(targetBusId: string, opts: Partial<Send> = {}): Send {
  return {
    id: opts.id ?? nextId("send"),
    name: opts.name ?? "Send",
    targetBusId,
    gainDb: opts.gainDb ?? 0,
    pan: opts.pan ?? 0,
    preFader: opts.preFader ?? false,
    enabled: opts.enabled ?? true,
  };
}

export function newClip(buffer: AudioData, opts: Partial<Clip> & { trackId: string }): Clip {
  const dur = durationSeconds(buffer);
  return {
    id: opts.id ?? nextId("clip"),
    trackId: opts.trackId,
    name: opts.name ?? "Clip",
    start: opts.start ?? 0,
    duration: opts.duration ?? dur,
    inPoint: opts.inPoint ?? 0,
    speed: opts.speed ?? 1,
    enabled: opts.enabled ?? true,
    gainDb: opts.gainDb ?? 0,
    fadeIn: opts.fadeIn ?? 0,
    fadeOut: opts.fadeOut ?? 0,
    fadeInShape: opts.fadeInShape ?? "equalPower",
    fadeOutShape: opts.fadeOutShape ?? "equalPower",
    groupId: opts.groupId,
    muted: opts.muted,
    locked: opts.locked,
    looped: opts.looped,
    effectRack: opts.effectRack ?? newEffectRack(),
    automation: opts.automation ?? [],
    automationMode: opts.automationMode,
    buffer,
  };
}

export function newVideoAsset(opts: Partial<VideoAsset> & { name: string }): VideoAsset {
  return {
    id: opts.id ?? nextId("vasset"),
    name: opts.name,
    sourceName: opts.sourceName ?? opts.name,
    sourcePath: opts.sourcePath,
    mimeType: opts.mimeType,
    duration: opts.duration,
    width: opts.width,
    height: opts.height,
    frameRate: opts.frameRate,
    hasAudio: opts.hasAudio,
  };
}

export function newVideoClip(asset: VideoAsset, opts: Partial<VideoClip> & { trackId: string }): VideoClip {
  return {
    id: opts.id ?? nextId("vclip"),
    trackId: opts.trackId,
    assetId: opts.assetId ?? asset.id,
    name: opts.name ?? asset.name,
    start: opts.start ?? 0,
    duration: opts.duration ?? Math.max(0, asset.duration ?? 0),
    inPoint: opts.inPoint ?? 0,
    speed: opts.speed ?? 1,
    enabled: opts.enabled ?? true,
    locked: opts.locked,
  };
}

export function newVideoTrack(index: number, opts: Partial<VideoTrack> = {}): VideoTrack {
  return {
    id: opts.id ?? nextId("vtrack"),
    name: opts.name ?? `Video ${index + 1}`,
    kind: "video",
    color: opts.color ?? "oklch(0.72 0.14 75)",
    clips: opts.clips ?? [],
    height: opts.height ?? 64,
    locked: opts.locked,
    visible: opts.visible ?? true,
  };
}

export function newTrack(index: number, opts: Partial<Track> = {}): Track {
  return {
    id: opts.id ?? nextId("track"),
    name: opts.name ?? `Track ${index + 1}`,
    kind: "audio",
    color: opts.color ?? TRACK_COLORS[index % TRACK_COLORS.length],
    clips: opts.clips ?? [],
    gainDb: opts.gainDb ?? 0,
    pan: opts.pan ?? 0,
    surroundPan: opts.surroundPan,
    audioRole: opts.audioRole,
    input: opts.input,
    mute: opts.mute ?? false,
    solo: opts.solo ?? false,
    recordArm: opts.recordArm ?? false,
    effectRack: opts.effectRack ?? newEffectRack(),
    automation: opts.automation ?? [],
    automationMode: opts.automationMode,
    sends: opts.sends ?? [],
    outputId: opts.outputId ?? MASTER_BUS_ID,
    height: opts.height ?? 96,
  };
}

export function newBus(index: number, opts: Partial<Bus> = {}): Bus {
  return {
    id: opts.id ?? nextId("bus"),
    name: opts.name ?? `Bus ${index + 1}`,
    color: opts.color ?? TRACK_COLORS[index % TRACK_COLORS.length],
    gainDb: opts.gainDb ?? 0,
    pan: opts.pan ?? 0,
    mute: opts.mute ?? false,
    solo: opts.solo ?? false,
    effectRack: opts.effectRack ?? newEffectRack(),
    automation: opts.automation ?? [],
    automationMode: opts.automationMode,
    sends: opts.sends ?? [],
    outputId: opts.outputId ?? MASTER_BUS_ID,
  };
}

export function newMarker(opts: Partial<Marker> & { time: number }): Marker {
  return {
    id: opts.id ?? nextId("marker"),
    time: opts.time,
    end: opts.end,
    name: opts.name ?? "Marker",
    color: opts.color ?? MARKER_COLORS[0],
    kind: opts.kind ?? (opts.end != null ? "region" : "cue"),
  };
}

export function newProject(opts: Partial<Project> = {}): Project {
  const now = nowMs();
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  return {
    id: opts.id ?? nextId("project"),
    name: opts.name ?? "Untitled",
    sampleRate,
    channelCount: opts.channelCount ?? 2,
    tempo: opts.tempo ?? 120,
    timeSignature: opts.timeSignature ?? [4, 4],
    videoFrameRate: opts.videoFrameRate ?? DEFAULT_VIDEO_FRAME_RATE,
    masterGainDb: opts.masterGainDb ?? 0,
    masterEffectRack: opts.masterEffectRack ?? newEffectRack(),
    masterAutomation: opts.masterAutomation ?? [],
    masterAutomationMode: opts.masterAutomationMode,
    audioHardware: opts.audioHardware ?? defaultAudioHardwareSettings(sampleRate),
    editorPreferences: normalizeEditorPreferences(opts.editorPreferences, sampleRate),
    panelPreferences: normalizePanelPreferences(opts.panelPreferences, sampleRate),
    nativePluginManager: opts.nativePluginManager ?? { plugins: [] },
    videoAssets: opts.videoAssets ?? [],
    videoTracks: opts.videoTracks ?? [],
    tracks: opts.tracks ?? [],
    buses: opts.buses ?? [],
    favoriteEffectChains: opts.favoriteEffectChains ?? [],
    markers: opts.markers ?? [],
    meta: opts.meta ?? { created: now, modified: now },
  };
}

/** A fresh project with `n` empty tracks. */
export function emptyProject(name = "Untitled", trackCount = 4, sampleRate = DEFAULT_SAMPLE_RATE, channelCount = 2): Project {
  const tracks: Track[] = [];
  for (let i = 0; i < trackCount; i++) tracks.push(newTrack(i));
  return newProject({ name, sampleRate, channelCount, tracks });
}

/** An empty silent buffer at the given rate (helper for tests/new tracks). */
export function silentBuffer(seconds: number, channels = 2, sampleRate = DEFAULT_SAMPLE_RATE): AudioData {
  return createAudioData(channels, Math.round(seconds * sampleRate), sampleRate);
}

// Date.now is wrapped so tests can stub it if needed and so the engine has a
// single time source.
function nowMs(): number {
  return Date.now();
}
