// ─────────────────────────────────────────────────────────────
// engine/store/actions — Command creators for non-DSP state changes
// ─────────────────────────────────────────────────────────────
// Selection, transport, view, and structural track/marker edits. Each returns
// a pure Command `(state) => state` that the store dispatches. Edit/DSP-heavy
// operations live in engine/ops and are wrapped as commands in store/edit.

import type { AudioData } from "../audio/types";
import { defaultAudioHardwareSettings, newAutomationLane, newBus, newClip, newMarker, newSend, newTrack, newVideoClip, newVideoTrack, normalizeEditorPreferences, normalizePanelPreferences } from "../model/factory";
import type {
  AnalyzePanelPreferences,
  AudioHardwareSettings,
  AudioRole,
  AutomationLane,
  AutomationMode,
  Bus,
  Clip,
  CustomWorkspace,
  EditorMode,
  EditorPreferences,
  EditorState,
  EffectRack,
  EffectParamValue,
  EffectSlot,
  EffectsPanelPreferences,
  FavoriteEffectChain,
  FavoriteEffectStep,
  KeyboardShortcut,
  KeyboardShortcutAction,
  KeyboardShortcutPreset,
  Marker,
  ManagedNativeAudioPlugin,
  ManagedNativeAudioPluginKind,
  ManagedNativeAudioPluginValidationStatus,
  NativePluginManager,
  PanelPreferences,
  Project,
  ProjectMeta,
  RecordingInputLevel,
  Selection,
  Send,
  SpectralSelection,
  SurroundPan,
  TimeRange,
  ToolId,
  Track,
  TrackInputAssignment,
  TrackInputChannel,
  VideoAsset,
  WorkspaceLayoutData,
} from "../model/types";
import { MASTER_BUS_ID } from "../model/types";
import { clamp } from "../audio/db";
import { busById, clipById, projectDuration } from "../model/query";
import type { Command } from "./store";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Replace one track by id, returning a new project (structural sharing). */
export function updateTrack(p: Project, trackId: string, fn: (t: Track) => Track): Project {
  let changed = false;
  const tracks = p.tracks.map((t) => {
    if (t.id !== trackId) return t;
    changed = true;
    return fn(t);
  });
  return changed ? { ...p, tracks } : p;
}

/** Replace one bus by id, returning a new project (structural sharing). */
export function updateBus(p: Project, busId: string, fn: (b: Bus) => Bus): Project {
  let changed = false;
  const buses = (p.buses ?? []).map((b) => {
    if (b.id !== busId) return b;
    changed = true;
    return fn(b);
  });
  return changed ? { ...p, buses } : p;
}

/** Replace one clip by id, returning the same project when the clip is missing or unchanged. */
export function updateClip(p: Project, clipId: string, fn: (c: Clip) => Clip): Project {
  let changed = false;
  const tracks = p.tracks.map((track) => {
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      const next = fn(clip);
      if (next !== clip) {
        changed = true;
        trackChanged = true;
      }
      return next;
    });
    return trackChanged ? { ...track, clips } : track;
  });
  return changed ? { ...p, tracks } : p;
}

function touch(p: Project): Project {
  return { ...p, meta: { ...p.meta, modified: Date.now() } };
}

function withProject(s: EditorState, p: Project): EditorState {
  return p === s.project ? s : { ...s, project: touch(p) };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeSpectralSelection(project: Project, spectral: SpectralSelection): SpectralSelection | null {
  let a = Math.max(0, finiteOr(spectral.time.start, 0));
  let b = Math.max(0, finiteOr(spectral.time.end, a));
  if (b < a) [a, b] = [b, a];
  const duration = projectDuration(project);
  if (duration > 0) {
    a = clamp(a, 0, duration);
    b = clamp(b, 0, duration);
  }
  if (b <= a) return null;

  const nyquist = Math.max(1, project.sampleRate / 2);
  let minHz = finiteOr(spectral.frequency.minHz, 0);
  let maxHz = finiteOr(spectral.frequency.maxHz, nyquist);
  if (maxHz < minHz) [minHz, maxHz] = [maxHz, minHz];
  minHz = clamp(minHz, 0, nyquist);
  maxHz = clamp(maxHz, 0, nyquist);
  if (maxHz <= minHz) return null;

  return {
    time: { start: a, end: b },
    frequency: { minHz, maxHz },
    channel: spectral.channel ?? "all",
  };
}

const AUDIO_ROLES = new Set<AudioRole>(["dialogue", "music", "sfx", "ambience"]);
const INPUT_CHANNELS = new Set<TrackInputChannel>([
  "mono",
  "left",
  "right",
  "stereo",
  "input1",
  "input2",
  "input3",
  "input4",
  "input5",
  "input6",
  "input7",
  "input8",
]);
const INPUT_MONITORING = new Set(["off", "armed", "always"]);
const NATIVE_PLUGIN_KINDS = new Set<ManagedNativeAudioPluginKind>(["vst3", "vst2", "audioUnit", "unknown"]);
const NATIVE_PLUGIN_VALIDATION_STATUSES = new Set<ManagedNativeAudioPluginValidationStatus>(["pathOnly", "metadataVerified", "invalid"]);
const AUTOMATION_MODES = new Set<AutomationMode>(["read", "off", "write", "touch", "latch"]);

function ampToDb(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}

function normalizeRecordingInputLevel(level: RecordingInputLevel): RecordingInputLevel {
  const peak = clamp(finiteOr(level.peak, 0), 0, 4);
  const rms = clamp(finiteOr(level.rms, 0), 0, peak);
  return {
    peak,
    rms,
    peakDb: ampToDb(peak),
    rmsDb: ampToDb(rms),
    channels: Math.max(1, Math.round(clamp(finiteOr(level.channels, 1), 1, 64))),
    clipped: level.clipped || peak >= 0.999,
  };
}

function sameRecordingInputLevel(a: RecordingInputLevel | null, b: RecordingInputLevel | null): boolean {
  return (
    a?.peak === b?.peak &&
    a?.rms === b?.rms &&
    a?.peakDb === b?.peakDb &&
    a?.rmsDb === b?.rmsDb &&
    a?.channels === b?.channels &&
    a?.clipped === b?.clipped
  );
}

function normalizeAudioRole(role: AudioRole | null | undefined): AudioRole | null | undefined {
  if (role == null) return null;
  return AUDIO_ROLES.has(role) ? role : undefined;
}

function normalizeAutomationMode(mode: AutomationMode): AutomationMode | undefined {
  return AUTOMATION_MODES.has(mode) ? mode : undefined;
}

function normalizeFavoriteParamValue(value: unknown): EffectParamValue | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" || typeof value === "boolean" || value === null) return value;
  return undefined;
}

function normalizeFavoriteEffectStep(step: FavoriteEffectStep): FavoriteEffectStep | null {
  const kind = typeof step.kind === "string" ? step.kind.trim() : "";
  if (!kind) return null;
  const params: Record<string, EffectParamValue> = {};
  for (const [key, value] of Object.entries(step.params ?? {})) {
    const normalized = normalizeFavoriteParamValue(value);
    if (normalized !== undefined) params[key] = normalized;
  }
  return {
    kind,
    name: typeof step.name === "string" && step.name.trim() ? step.name.trim() : kind,
    enabled: step.enabled ?? true,
    params,
  };
}

function normalizeFavoriteEffectChain(chain: FavoriteEffectChain): FavoriteEffectChain | null {
  const id = typeof chain.id === "string" ? chain.id.trim() : "";
  const name = typeof chain.name === "string" && chain.name.trim() ? chain.name.trim() : "";
  if (!id || !name) return null;
  const steps = chain.steps.map(normalizeFavoriteEffectStep).filter((step): step is FavoriteEffectStep => !!step);
  if (steps.length === 0) return null;
  return { id, name, steps };
}

function normalizePluginStateValue(value: unknown): EffectParamValue | undefined {
  return normalizeFavoriteParamValue(value);
}

function normalizeManagedNativePlugin(plugin: ManagedNativeAudioPlugin): ManagedNativeAudioPlugin | null {
  const id = typeof plugin.id === "string" ? plugin.id.trim() : "";
  const path = typeof plugin.path === "string" ? plugin.path.trim() : "";
  const name = typeof plugin.name === "string" && plugin.name.trim() ? plugin.name.trim() : "";
  if (!id || !path || !name) return null;
  const state: Record<string, EffectParamValue> = {};
  for (const [key, value] of Object.entries(plugin.state ?? {})) {
    const normalized = normalizePluginStateValue(value);
    if (normalized !== undefined) state[key] = normalized;
  }
  const validationIssues = (plugin.validationIssues ?? [])
    .map((issue) => (typeof issue === "string" ? issue.trim() : ""))
    .filter(Boolean);
  const validationStatus = NATIVE_PLUGIN_VALIDATION_STATUSES.has(plugin.validationStatus as ManagedNativeAudioPluginValidationStatus)
    ? plugin.validationStatus
    : validationIssues.length ? "invalid" : "pathOnly";
  return {
    id,
    kind: NATIVE_PLUGIN_KINDS.has(plugin.kind) ? plugin.kind : "unknown",
    name,
    vendor: stringOrUndefined(plugin.vendor),
    version: stringOrUndefined(plugin.version),
    bundleIdentifier: stringOrUndefined(plugin.bundleIdentifier),
    path,
    extension: typeof plugin.extension === "string" ? plugin.extension.trim().toLowerCase() : "",
    canProcess: false,
    hostStatus: "inventoryOnly",
    validationStatus,
    entryPointVerified: plugin.entryPointVerified === true,
    enabled: plugin.enabled ?? true,
    lastScannedAt: Number.isFinite(plugin.lastScannedAt) ? plugin.lastScannedAt : undefined,
    validationIssues,
    presetName: stringOrUndefined(plugin.presetName),
    state,
  };
}

function normalizeNativePluginManager(manager: NativePluginManager): NativePluginManager {
  const plugins = manager.plugins.map(normalizeManagedNativePlugin).filter((plugin): plugin is ManagedNativeAudioPlugin => !!plugin);
  const deduped = new Map<string, ManagedNativeAudioPlugin>();
  for (const plugin of plugins) deduped.set(plugin.id, plugin);
  return {
    plugins: Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path)),
    scanRoots: (manager.scanRoots ?? []).map((root) => (typeof root === "string" ? root.trim() : "")).filter(Boolean),
    lastScanAt: Number.isFinite(manager.lastScanAt) ? manager.lastScanAt : undefined,
  };
}

function stringOrUndefined(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function monitoringMode(value: AudioHardwareSettings["inputMonitoring"] | undefined, fallback: AudioHardwareSettings["inputMonitoring"]): AudioHardwareSettings["inputMonitoring"] {
  return value && INPUT_MONITORING.has(value) ? value : fallback;
}

function normalizeTrackInput(input: TrackInputAssignment): TrackInputAssignment {
  const channel = INPUT_CHANNELS.has(input.channel) ? input.channel : "stereo";
  const deviceId = stringOrUndefined(input.deviceId);
  const label = stringOrUndefined(input.label);
  const monitoring = input.monitoring && INPUT_MONITORING.has(input.monitoring) ? input.monitoring : undefined;
  return { channel, ...(deviceId ? { deviceId } : {}), ...(label ? { label } : {}), ...(monitoring ? { monitoring } : {}) };
}

function sameTrackInput(a: TrackInputAssignment | undefined, b: TrackInputAssignment | undefined): boolean {
  return (
    (a?.channel ?? "stereo") === (b?.channel ?? "stereo") &&
    a?.deviceId === b?.deviceId &&
    a?.label === b?.label &&
    a?.monitoring === b?.monitoring
  );
}

function normalizePunchRange(range: AudioHardwareSettings["punchIn"] | undefined): AudioHardwareSettings["punchIn"] {
  if (!range) return null;
  let start = Math.max(0, finiteOr(range.start, 0));
  let end = Math.max(0, finiteOr(range.end, start));
  if (end < start) [start, end] = [end, start];
  return end > start ? { start, end } : null;
}

function normalizeAudioHardware(settings: Partial<AudioHardwareSettings>, fallbackSampleRate: number): AudioHardwareSettings {
  const defaults = defaultAudioHardwareSettings(fallbackSampleRate);
  return {
    inputDeviceId: stringOrUndefined(settings.inputDeviceId),
    outputDeviceId: stringOrUndefined(settings.outputDeviceId),
    hardwareSampleRate: Math.round(clamp(finiteOr(settings.hardwareSampleRate ?? defaults.hardwareSampleRate, fallbackSampleRate), 8000, 192000)),
    inputChannels: Math.round(clamp(finiteOr(settings.inputChannels ?? defaults.inputChannels, defaults.inputChannels), 1, 8)),
    inputMonitoring: monitoringMode(settings.inputMonitoring, defaults.inputMonitoring),
    latencyCompensationMs: clamp(finiteOr(settings.latencyCompensationMs ?? defaults.latencyCompensationMs, 0), -1000, 1000),
    preRollSeconds: clamp(finiteOr(settings.preRollSeconds ?? defaults.preRollSeconds, 0), 0, 30),
    countInBars: Math.round(clamp(finiteOr(settings.countInBars ?? defaults.countInBars, 0), 0, 8)),
    punchIn: normalizePunchRange(settings.punchIn ?? defaults.punchIn),
    meterCalibrationDb: clamp(finiteOr(settings.meterCalibrationDb ?? defaults.meterCalibrationDb, 0), -60, 60),
    meterPeakHoldMs: Math.round(clamp(finiteOr(settings.meterPeakHoldMs ?? defaults.meterPeakHoldMs, defaults.meterPeakHoldMs), 0, 10000)),
  };
}

function sameAudioHardware(a: AudioHardwareSettings, b: AudioHardwareSettings): boolean {
  return (
    a.inputDeviceId === b.inputDeviceId &&
    a.outputDeviceId === b.outputDeviceId &&
    a.hardwareSampleRate === b.hardwareSampleRate &&
    a.inputChannels === b.inputChannels &&
    a.inputMonitoring === b.inputMonitoring &&
    a.latencyCompensationMs === b.latencyCompensationMs &&
    a.preRollSeconds === b.preRollSeconds &&
    a.countInBars === b.countInBars &&
    a.meterCalibrationDb === b.meterCalibrationDb &&
    a.meterPeakHoldMs === b.meterPeakHoldMs &&
    (a.punchIn?.start ?? null) === (b.punchIn?.start ?? null) &&
    (a.punchIn?.end ?? null) === (b.punchIn?.end ?? null)
  );
}

function sameEditorPreferences(a: EditorPreferences, b: EditorPreferences): boolean {
  return (
    a.editorMode === b.editorMode &&
    a.tool === b.tool &&
    a.snap === b.snap &&
    a.displayTimeFormat === b.displayTimeFormat &&
    a.spectralMinHz === b.spectralMinHz &&
    a.spectralMaxHz === b.spectralMaxHz &&
    a.activeWorkspaceId === b.activeWorkspaceId &&
    sameCustomWorkspaces(a.customWorkspaces, b.customWorkspaces) &&
    sameKeyboardShortcuts(a.keyboardShortcuts, b.keyboardShortcuts) &&
    sameKeyboardShortcutPresets(a.keyboardShortcutPresets, b.keyboardShortcutPresets)
  );
}

function sameCustomWorkspaces(a: CustomWorkspace[], b: CustomWorkspace[]): boolean {
  return a.length === b.length && a.every((workspace, i) => (
    workspace.id === b[i].id &&
    workspace.name === b[i].name &&
    JSON.stringify(workspace.layout) === JSON.stringify(b[i].layout)
  ));
}

function sameKeyboardShortcuts(a: KeyboardShortcut[], b: KeyboardShortcut[]): boolean {
  return a.length === b.length && a.every((shortcut, i) => (
    shortcut.action === b[i].action &&
    shortcut.key === b[i].key &&
    shortcut.mod === b[i].mod &&
    shortcut.shift === b[i].shift &&
    shortcut.alt === b[i].alt
  ));
}

function sameKeyboardShortcutPresets(a: KeyboardShortcutPreset[], b: KeyboardShortcutPreset[]): boolean {
  return a.length === b.length && a.every((preset, i) => (
    preset.id === b[i].id &&
    preset.name === b[i].name &&
    sameKeyboardShortcuts(preset.shortcuts, b[i].shortcuts)
  ));
}

function samePanelPreferences(a: PanelPreferences, b: PanelPreferences): boolean {
  return (
    a.analyze.spectralMinHz === b.analyze.spectralMinHz &&
    a.analyze.spectralMaxHz === b.analyze.spectralMaxHz &&
    a.analyze.spectralGainDb === b.analyze.spectralGainDb &&
    JSON.stringify(a.effects) === JSON.stringify(b.effects)
  );
}

function normalizeVideoAsset(asset: VideoAsset): VideoAsset {
  const name = stringOrUndefined(asset.name) ?? stringOrUndefined(asset.sourceName) ?? "Video";
  return {
    ...asset,
    name,
    sourceName: stringOrUndefined(asset.sourceName) ?? name,
    sourcePath: stringOrUndefined(asset.sourcePath),
    mimeType: stringOrUndefined(asset.mimeType),
    duration: asset.duration != null && Number.isFinite(asset.duration) && asset.duration > 0 ? asset.duration : undefined,
    width: asset.width != null && Number.isFinite(asset.width) && asset.width > 0 ? Math.round(asset.width) : undefined,
    height: asset.height != null && Number.isFinite(asset.height) && asset.height > 0 ? Math.round(asset.height) : undefined,
    frameRate: asset.frameRate != null && Number.isFinite(asset.frameRate) && asset.frameRate > 0 ? asset.frameRate : undefined,
  };
}

function sameVideoAsset(a: VideoAsset, b: VideoAsset): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.sourceName === b.sourceName &&
    a.sourcePath === b.sourcePath &&
    a.mimeType === b.mimeType &&
    a.duration === b.duration &&
    a.width === b.width &&
    a.height === b.height &&
    a.frameRate === b.frameRate &&
    a.hasAudio === b.hasAudio
  );
}

function normalizeSlotParam(slot: EffectSlot, param: string, value: EffectParamValue): EffectParamValue {
  if (typeof value !== "number") return value;
  if (!Number.isFinite(value)) return slot.params[param] ?? 0;
  if (slot.kind === "gain" && (param === "gainDb" || param === "db")) return clamp(value, -60, 24);
  if (slot.kind === "pan" && param === "pan") return clamp(value, -1, 1);
  if (slot.kind === "compressor") {
    if (param === "thresholdDb") return clamp(value, -80, 0);
    if (param === "ratio") return clamp(value, 1, 20);
    if (param === "attackMs") return clamp(value, 0.1, 200);
    if (param === "releaseMs") return clamp(value, 5, 1000);
    if (param === "kneeDb") return clamp(value, 0, 24);
    if (param === "makeupDb") return clamp(value, -24, 24);
  }
  if (slot.kind === "limiter") {
    if (param === "ceilingDb") return clamp(value, -24, 0);
    if (param === "inputBoostDb" || param === "boostDb") return clamp(value, 0, 36);
    if (param === "lookAheadMs") return clamp(value, 0, 50);
    if (param === "releaseMs") return clamp(value, 5, 1000);
  }
  if (slot.kind === "tubeCompressor") {
    if (param === "driveDb") return clamp(value, 0, 24);
    if (param === "warmth") return clamp(value, 0, 1);
    if (param === "thresholdDb") return clamp(value, -80, 0);
    if (param === "ratio") return clamp(value, 1, 20);
    if (param === "attackMs") return clamp(value, 0.1, 200);
    if (param === "releaseMs") return clamp(value, 5, 1000);
    if (param === "makeupDb") return clamp(value, -24, 24);
  }
  if (slot.kind === "speechLeveler") {
    if (param === "targetDb") return clamp(value, -60, 0);
    if (param === "amount") return clamp(value, 0, 1);
    if (param === "maxGainDb") return clamp(value, 0, 60);
    if (param === "gateDb") return clamp(value, -100, 0);
    if (param === "windowMs") return clamp(value, 10, 5000);
  }
  if (slot.kind === "centerChannel") {
    if (param === "centerLevelDb" || param === "sideLevelDb") return clamp(value, -80, 24);
    if (param === "lowFreq" || param === "highFreq") return clamp(value, 20, 20000);
  }
  if (slot.kind === "channelMixer") {
    if (param === "leftToLeft" || param === "rightToLeft" || param === "leftToRight" || param === "rightToRight") return clamp(value, -200, 200);
  }
  if (slot.kind === "graphicPhaseShifter") {
    if (param === "lowPhaseDeg" || param === "highPhaseDeg" || param === "phaseDeg") return clamp(value, -180, 180);
  }
  if (slot.kind === "autoPhaseCorrect") {
    if (param === "maxShiftMs") return clamp(value, 0, 100);
    if (param === "leftShiftMs" || param === "rightShiftMs") return clamp(value, -100, 100);
  }
  if (slot.kind === "phaser") {
    if (param === "rateHz") return clamp(value, 0, 20);
    if (param === "stages") return Math.round(clamp(value, 1, 24));
    if (param === "depth" || param === "mix") return clamp(value, 0, 1);
    if (param === "feedback") return clamp(value, -0.95, 0.95);
    if (param === "baseFreqHz" || param === "freq") return clamp(value, 20, 20000);
    if (param === "rangeOctaves") return clamp(value, 0, 10);
  }
  if (slot.kind === "waveshaper") {
    if (param === "driveDb") return clamp(value, -24, 48);
    if (param === "amount" || param === "mix") return clamp(value, 0, 1);
  }
  if (slot.kind === "guitarSuite") {
    if (param === "driveDb") return clamp(value, 0, 48);
    if (param === "bodyHz") return clamp(value, 20, 500);
    if (param === "toneHz") return clamp(value, 500, 20000);
    if (param === "presenceDb") return clamp(value, -12, 12);
    if (param === "mix") return clamp(value, 0, 1);
    if (param === "outputDb") return clamp(value, -24, 24);
  }
  if (slot.kind === "exciter") {
    if (param === "frequency" || param === "freq") return clamp(value, 200, 20000);
    if (param === "driveDb") return clamp(value, 0, 48);
    if (param === "mix") return clamp(value, 0, 1);
  }
  if (slot.kind === "fullReverb") {
    if (param === "decayMs") return clamp(value, 20, 6000);
    if (param === "perception") return clamp(value, 0, 100);
    if (param === "preDelayMs") return clamp(value, 0, 500);
    if (param === "absorption") return clamp(value, 0, 0.999);
    if (param === "lowDb") return clamp(value, -36, 12);
    if (param === "lowFreq") return clamp(value, 20, 20000);
    if (param === "midDb") return clamp(value, -36, 12);
    if (param === "midFreq") return clamp(value, 20, 20000);
    if (param === "midQ") return clamp(value, 0.1, 50);
    if (param === "highDb") return clamp(value, -36, 12);
    if (param === "highFreq") return clamp(value, 500, 20000);
    if (param === "mix") return clamp(value, 0, 1);
    if (param === "seed") return Math.round(clamp(value, 1, 999999));
  }
  if (slot.kind === "mastering") {
    if (param === "lowShelfDb" || param === "highShelfDb") return clamp(value, -12, 12);
    if (param === "exciteAmount" || param === "ambience" || param === "amount") return clamp(value, 0, 1);
    if (param === "width") return clamp(value, 0, 3);
    if (param === "ambienceDecayMs") return clamp(value, 10, 2000);
    if (param === "ambiencePreDelayMs") return clamp(value, 0, 250);
    if (param === "driveDb") return clamp(value, 0, 24);
    if (param === "ceilingDb") return clamp(value, -24, 0);
  }
  return value;
}

function updateTrackSend(s: EditorState, trackId: string, sendId: string, fn: (send: Send) => Send): EditorState {
  const track = s.project.tracks.find((t) => t.id === trackId);
  const send = track?.sends?.find((x) => x.id === sendId);
  if (!send) return s;
  const nextSend = fn(send);
  if (nextSend === send) return s;
  return withProject(
    s,
    updateTrack(s.project, trackId, (t) => ({
      ...t,
      sends: (t.sends ?? []).map((x) => (x.id === sendId ? nextSend : x)),
    })),
  );
}

function updateBusSend(s: EditorState, busId: string, sendId: string, fn: (send: Send) => Send): EditorState {
  const bus = busById(s.project, busId);
  const send = bus?.sends?.find((x) => x.id === sendId);
  if (!send) return s;
  const nextSend = fn(send);
  if (nextSend === send) return s;
  return withProject(
    s,
    updateBus(s.project, busId, (b) => ({
      ...b,
      sends: (b.sends ?? []).map((x) => (x.id === sendId ? nextSend : x)),
    })),
  );
}

function sameAutomationPoint(a: AutomationLane["points"][number], b: AutomationLane["points"][number]): boolean {
  return Math.abs(a.time - b.time) < 1e-3 && a.value === b.value;
}

function sameAutomationTarget(a: AutomationLane["target"], b: AutomationLane["target"]): boolean {
  return a.kind === b.kind && a.sendId === b.sendId && a.effectSlotId === b.effectSlotId && a.param === b.param;
}

function withAutomationPoint(lanes: AutomationLane[] | undefined, target: AutomationLane["target"], name: string, time: number, value: number): AutomationLane[] | null {
  const point = { time: Math.max(0, finiteOr(time, 0)), value: finiteOr(value, 0) };
  const current = lanes ?? [];
  const laneIndex = current.findIndex((lane) => sameAutomationTarget(lane.target, target));
  const lane = laneIndex >= 0 ? current[laneIndex] : newAutomationLane({ name, target });
  const replaceIndex = lane.points.findIndex((p) => Math.abs(p.time - point.time) < 1e-3);
  const points = replaceIndex >= 0 ? [...lane.points] : [...lane.points, point];
  if (replaceIndex >= 0) {
    if (sameAutomationPoint(points[replaceIndex], point)) return null;
    points[replaceIndex] = point;
  }
  points.sort((a, b) => a.time - b.time);
  const nextLane: AutomationLane = { ...lane, enabled: true, interpolation: lane.interpolation ?? "linear", points };
  return laneIndex >= 0 ? current.map((x, i) => (i === laneIndex ? nextLane : x)) : [...current, nextLane];
}

function automatableEffectParamValue(slot: EffectSlot, param: string, value: number): number | null {
  const supportsParam =
    (slot.kind === "gain" && (param === "gainDb" || param === "db")) ||
    (slot.kind === "pan" && param === "pan") ||
    (typeof slot.params[param] === "number" && Number.isFinite(slot.params[param]));
  if (!supportsParam) return null;
  const nextValue = normalizeSlotParam(slot, param, value);
  return typeof nextValue === "number" && Number.isFinite(nextValue) ? nextValue : null;
}

function effectParamAutomationTarget(slotId: string, param: string): AutomationLane["target"] {
  return { kind: "effectParam", effectSlotId: slotId, param };
}

function effectParamAutomationName(slot: EffectSlot, param: string): string {
  return `${slot.name} ${param}`;
}

function sendAutomationTarget(sendId: string, kind: "sendGainDb" | "sendPan"): AutomationLane["target"] {
  return { kind, sendId };
}

function sendAutomationName(send: Send, label: string): string {
  return `${send.name} ${label}`;
}

// ── tool / view ────────────────────────────────────────────────────────────

export const setProjectEditorPreferences = (patch: Partial<EditorPreferences>): Command => (s) => {
  const current = normalizeEditorPreferences(s.project.editorPreferences, s.project.sampleRate);
  const next = normalizeEditorPreferences({ ...current, ...patch }, s.project.sampleRate);
  const project = sameEditorPreferences(current, next) ? s.project : { ...s.project, editorPreferences: next };
  const mode = patch.editorMode !== undefined ? next.editorMode : s.mode;
  const tool = patch.tool !== undefined ? next.tool : s.tool;
  const snap = patch.snap !== undefined ? next.snap : s.view.snap;
  if (
    project === s.project &&
    s.mode === mode &&
    s.tool === tool &&
    s.view.snap === snap
  ) {
    return s;
  }
  return {
    ...withProject(s, project),
    mode,
    tool,
    view: { ...s.view, snap },
  };
};

export const setEditorMode = (mode: EditorMode): Command => (s) => setProjectEditorPreferences({ editorMode: mode })(s);

export const setTool = (tool: ToolId): Command => (s) => (s.tool === tool ? s : { ...s, tool });

export const setProjectKeyboardShortcut = (shortcut: KeyboardShortcut): Command => (s) => {
  const current = normalizeEditorPreferences(s.project.editorPreferences, s.project.sampleRate);
  const keyboardShortcuts = [...current.keyboardShortcuts.filter((entry) => entry.action !== shortcut.action), shortcut];
  return setProjectEditorPreferences({ keyboardShortcuts })(s);
};

export const removeProjectKeyboardShortcut = (action: KeyboardShortcutAction): Command => (s) => {
  const current = normalizeEditorPreferences(s.project.editorPreferences, s.project.sampleRate);
  const keyboardShortcuts = current.keyboardShortcuts.filter((entry) => entry.action !== action);
  return keyboardShortcuts.length === current.keyboardShortcuts.length ? s : setProjectEditorPreferences({ keyboardShortcuts })(s);
};

export function keyboardShortcutPresetIdForName(name: string, existing: KeyboardShortcutPreset[] = []): string {
  const base = (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "shortcut-preset").slice(0, 48);
  const used = new Set(existing.map((preset) => preset.id));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id;
  }
  return `${base}-${Date.now()}`;
}

export const saveProjectKeyboardShortcutPreset = (preset: { id?: string; name: string; shortcuts?: KeyboardShortcut[] }): Command => (s) => {
  const current = normalizeEditorPreferences(s.project.editorPreferences, s.project.sampleRate);
  const shortcuts = preset.shortcuts ?? current.keyboardShortcuts;
  if (shortcuts.length === 0) return s;
  const name = preset.name.trim() || `Shortcut Preset ${current.keyboardShortcutPresets.length + 1}`;
  const id = preset.id?.trim() || keyboardShortcutPresetIdForName(name, current.keyboardShortcutPresets);
  const saved: KeyboardShortcutPreset = { id, name, shortcuts };
  const keyboardShortcutPresets = [...current.keyboardShortcutPresets.filter((entry) => entry.id !== id), saved];
  return setProjectEditorPreferences({ keyboardShortcutPresets })(s);
};

export const applyProjectKeyboardShortcutPreset = (id: string): Command => (s) => {
  const current = normalizeEditorPreferences(s.project.editorPreferences, s.project.sampleRate);
  const preset = current.keyboardShortcutPresets.find((entry) => entry.id === id);
  return preset ? setProjectEditorPreferences({ keyboardShortcuts: preset.shortcuts })(s) : s;
};

export const deleteProjectKeyboardShortcutPreset = (id: string): Command => (s) => {
  const current = normalizeEditorPreferences(s.project.editorPreferences, s.project.sampleRate);
  const keyboardShortcutPresets = current.keyboardShortcutPresets.filter((preset) => preset.id !== id);
  return keyboardShortcutPresets.length === current.keyboardShortcutPresets.length ? s : setProjectEditorPreferences({ keyboardShortcutPresets })(s);
};

export function customWorkspaceIdForName(name: string, existing: CustomWorkspace[] = []): string {
  const base = (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom-workspace").slice(0, 48);
  const used = new Set(existing.map((workspace) => workspace.id));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id;
  }
  return `${base}-${Date.now()}`;
}

export const saveProjectWorkspace = (workspace: { id?: string; name: string; layout: WorkspaceLayoutData }): Command => (s) => {
  const current = normalizeEditorPreferences(s.project.editorPreferences, s.project.sampleRate);
  const name = workspace.name.trim() || `Custom Workspace ${current.customWorkspaces.length + 1}`;
  const id = workspace.id?.trim() || customWorkspaceIdForName(name, current.customWorkspaces);
  const saved: CustomWorkspace = { id, name, layout: workspace.layout };
  const customWorkspaces = [...current.customWorkspaces.filter((entry) => entry.id !== id), saved];
  return setProjectEditorPreferences({ customWorkspaces, activeWorkspaceId: id })(s);
};

export const deleteProjectWorkspace = (id: string): Command => (s) => {
  const current = normalizeEditorPreferences(s.project.editorPreferences, s.project.sampleRate);
  const customWorkspaces = current.customWorkspaces.filter((workspace) => workspace.id !== id);
  if (customWorkspaces.length === current.customWorkspaces.length) return s;
  return setProjectEditorPreferences({
    customWorkspaces,
    activeWorkspaceId: current.activeWorkspaceId === id ? "default" : current.activeWorkspaceId,
  })(s);
};

export const setActiveWorkspace = (id: string): Command => (s) => setProjectEditorPreferences({ activeWorkspaceId: id.trim() || "default" })(s);

export const setProjectPanelPreferences = (patch: { analyze?: Partial<AnalyzePanelPreferences>; effects?: Partial<EffectsPanelPreferences> }): Command => (s) => {
  const current = normalizePanelPreferences(s.project.panelPreferences, s.project.sampleRate);
  const next = normalizePanelPreferences({
    ...current,
    analyze: { ...current.analyze, ...(patch.analyze ?? {}) },
    effects: { ...current.effects, ...(patch.effects ?? {}) },
  }, s.project.sampleRate);
  if (samePanelPreferences(current, next)) return s;
  return withProject(s, { ...s.project, panelPreferences: next });
};

export const setActiveTrack = (trackId: string | null): Command => (s) =>
  s.activeTrackId === trackId ? s : { ...s, activeTrackId: trackId };

export const setZoom = (pxPerSecond: number): Command => (s) => ({
  ...s,
  view: { ...s.view, pxPerSecond: clamp(pxPerSecond, 2, 8000) },
});

export const zoomBy = (factor: number): Command => (s) => ({
  ...s,
  view: { ...s.view, pxPerSecond: clamp(s.view.pxPerSecond * factor, 2, 8000) },
});

export const setScroll = (scrollSec: number, scrollY?: number): Command => (s) => ({
  ...s,
  view: { ...s.view, scrollSec: Math.max(0, scrollSec), scrollY: scrollY ?? s.view.scrollY },
});

/** Toggle snap-to-edges for clip drags (Edit ▸ Snapping). No-op (same ref) when unchanged. */
export const setSnap = (snap: boolean): Command => (s) => setProjectEditorPreferences({ snap })(s);

/** Record the timeline's usable width (px, minus headers) so zoom-to-fit can size to the window. */
export const setViewportWidth = (px: number): Command => (s) => {
  const viewportPx = Math.max(1, Math.round(px));
  return s.view.viewportPx === viewportPx ? s : { ...s, view: { ...s.view, viewportPx } };
};

/** Zoom + scroll so the current time selection fills the timeline (View ▸ Zoom ▸ Zoom to Selection). */
export const zoomToSelection = (): Command => (s) => {
  const range = s.selection.range;
  if (!range) return s;
  const dur = range.end - range.start;
  if (dur <= 0) return s;
  const pxPerSecond = clamp(s.view.viewportPx / dur, 2, 8000);
  return { ...s, view: { ...s.view, pxPerSecond, scrollSec: Math.max(0, range.start) } };
};

/** Zoom out so the whole session fits the timeline (View ▸ Zoom ▸ Zoom Out Full). */
export const zoomToFit = (): Command => (s) => {
  const total = projectDuration(s.project);
  if (total <= 0) return s;
  const pxPerSecond = clamp(s.view.viewportPx / total, 2, 8000);
  return { ...s, view: { ...s.view, pxPerSecond, scrollSec: 0 } };
};

// ── transport ────────────────────────────────────────────────────────────────

export const setPlayhead = (seconds: number): Command => (s) => ({
  ...s,
  transport: { ...s.transport, playhead: Math.max(0, seconds) },
});

export const setPlaying = (playing: boolean): Command => (s) => ({
  ...s,
  transport: { ...s.transport, playing },
});

export const setRecording = (recording: boolean): Command => (s) => ({
  ...s,
  transport: { ...s.transport, recording, recordingInput: recording ? s.transport.recordingInput : null },
});

export const setRecordingInputLevel = (level: RecordingInputLevel | null): Command => (s) => {
  const next = level ? normalizeRecordingInputLevel(level) : null;
  return sameRecordingInputLevel(s.transport.recordingInput, next) ? s : { ...s, transport: { ...s.transport, recordingInput: next } };
};

export const toggleMetronome = (): Command => (s) => ({
  ...s,
  transport: { ...s.transport, metronome: !s.transport.metronome },
});

export const setLoop = (loop: TimeRange | null): Command => (s) => ({
  ...s,
  transport: { ...s.transport, loop, loopEnabled: loop != null ? true : s.transport.loopEnabled },
});

export const setLoopEnabled = (loopEnabled: boolean): Command => (s) => ({
  ...s,
  transport: { ...s.transport, loopEnabled },
});

// ── selection ────────────────────────────────────────────────────────────────

export const clearSelection = (): Command => (s) =>
  s.selection.clipIds.length === 0 && s.selection.trackIds.length === 0 && !s.selection.range && !s.selection.spectral
    ? s
    : { ...s, selection: { clipIds: [], trackIds: [], range: null, spectral: null } };

export const selectRange = (range: TimeRange | null, trackIds: string[]): Command => (s) => {
  const sel: Selection = { ...s.selection, range, trackIds, spectral: null };
  return { ...s, selection: sel };
};

export const selectClips = (clipIds: string[], additive = false): Command => (s) => {
  const set = additive ? new Set([...s.selection.clipIds, ...clipIds]) : new Set(clipIds);
  return { ...s, selection: { ...s.selection, clipIds: [...set], spectral: null } };
};

export const selectSpectralRange = (spectral: SpectralSelection | null): Command => (s) => {
  if (!spectral) return s.selection.spectral ? { ...s, selection: { ...s.selection, spectral: null } } : s;
  const normalized = normalizeSpectralSelection(s.project, spectral);
  if (!normalized) return s.selection.spectral ? { ...s, selection: { ...s.selection, spectral: null } } : s;
  return { ...s, selection: { ...s.selection, range: normalized.time, spectral: normalized } };
};

export const selectAll = (): Command => (s) => {
  const clipIds = s.project.tracks.flatMap((t) => t.clips.map((c) => c.id));
  const trackIds = s.project.tracks.map((t) => t.id);
  let end = 0;
  for (const t of s.project.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.duration);
  return { ...s, selection: { clipIds, trackIds, range: end > 0 ? { start: 0, end } : null, spectral: null } };
};

// ── track structure & mixer ──────────────────────────────────────────────────

export const setTrackGain = (trackId: string, gainDb: number): Command => (s) =>
  withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, gainDb: clamp(gainDb, -60, 12) })));

export const setTrackPan = (trackId: string, pan: number): Command => (s) =>
  withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, pan: clamp(pan, -1, 1) })));

export const setTrackAutomationMode = (trackId: string, mode: AutomationMode): Command => (s) => {
  const normalized = normalizeAutomationMode(mode);
  if (!normalized) return s;
  const track = s.project.tracks.find((t) => t.id === trackId);
  if (!track || (track.automationMode ?? "read") === normalized) return s;
  return withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, automationMode: normalized })));
};

export const setTrackSurroundPan = (trackId: string, patch: Partial<SurroundPan>): Command => (s) =>
  withProject(
    s,
    updateTrack(s.project, trackId, (t) => {
      const current = t.surroundPan ?? { x: 0, y: 1, center: 0, lfe: 0, divergence: 1 };
      return {
        ...t,
        surroundPan: {
          x: clamp(patch.x ?? current.x, -1, 1),
          y: clamp(patch.y ?? current.y, -1, 1),
          center: clamp(patch.center ?? current.center, 0, 1),
          lfe: clamp(patch.lfe ?? current.lfe, 0, 1),
          divergence: clamp(patch.divergence ?? current.divergence, 0, 1),
        },
      };
    }),
  );

export const setTrackAudioRole = (trackId: string, role: AudioRole | null | undefined): Command => (s) => {
  const normalized = normalizeAudioRole(role);
  if (normalized === undefined) return s;
  const idx = s.project.tracks.findIndex((t) => t.id === trackId);
  if (idx < 0) return s;
  const track = s.project.tracks[idx];
  let nextTrack: Track;
  if (normalized === null) {
    if (!track.audioRole) return s;
    const { audioRole: _audioRole, ...rest } = track;
    nextTrack = rest;
  } else {
    if (track.audioRole === normalized) return s;
    nextTrack = { ...track, audioRole: normalized };
  }
  const tracks = [...s.project.tracks];
  tracks[idx] = nextTrack;
  return withProject(s, { ...s.project, tracks });
};

export const setTrackInput = (trackId: string, patch: Partial<TrackInputAssignment> | null): Command => (s) => {
  const track = s.project.tracks.find((t) => t.id === trackId);
  if (!track) return s;
  if (patch === null) {
    if (!track.input) return s;
    return withProject(
      s,
      updateTrack(s.project, trackId, (t) => {
        const { input: _input, ...rest } = t;
        return rest;
      }),
    );
  }
  const nextInput = normalizeTrackInput({ ...(track.input ?? { channel: "stereo" }), ...patch });
  if (sameTrackInput(track.input, nextInput)) return s;
  return withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, input: nextInput })));
};

export const toggleMute = (trackId: string): Command => (s) =>
  withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, mute: !t.mute })));

export const toggleSolo = (trackId: string): Command => (s) =>
  withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, solo: !t.solo })));

export const toggleArm = (trackId: string): Command => (s) =>
  withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, recordArm: !t.recordArm })));

export const renameTrack = (trackId: string, name: string): Command => (s) =>
  withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, name })));

export const setTrackHeight = (trackId: string, height: number): Command => (s) =>
  withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, height: clamp(height, 40, 600) })));

export const setMasterGain = (gainDb: number): Command => (s) =>
  withProject(s, { ...s.project, masterGainDb: clamp(gainDb, -60, 12) });

export const setMasterAutomationMode = (mode: AutomationMode): Command => (s) => {
  const normalized = normalizeAutomationMode(mode);
  if (!normalized || (s.project.masterAutomationMode ?? "read") === normalized) return s;
  return withProject(s, { ...s.project, masterAutomationMode: normalized });
};

export const setTempo = (tempo: number): Command => (s) =>
  withProject(s, { ...s.project, tempo: clamp(tempo, 20, 400) });

export const setProjectChannelCount = (channelCount: number): Command => (s) =>
  withProject(s, { ...s.project, channelCount: Math.round(clamp(channelCount, 1, 8)) });

export const setProjectAudioHardware = (patch: Partial<AudioHardwareSettings>): Command => (s) => {
  const current = normalizeAudioHardware(s.project.audioHardware ?? defaultAudioHardwareSettings(s.project.sampleRate), s.project.sampleRate);
  const next = normalizeAudioHardware({ ...current, ...patch }, s.project.sampleRate);
  if (sameAudioHardware(current, next)) return s;
  return withProject(s, { ...s.project, audioHardware: next });
};

export const updateProjectMeta = (patch: Partial<ProjectMeta>): Command => (s) =>
  withProject(s, { ...s.project, meta: { ...s.project.meta, ...patch } });

export const setFavoriteEffectChains = (chains: FavoriteEffectChain[]): Command => (s) => {
  const normalized = chains.map(normalizeFavoriteEffectChain).filter((chain): chain is FavoriteEffectChain => !!chain);
  return withProject(s, { ...s.project, favoriteEffectChains: normalized });
};

export const upsertFavoriteEffectChain = (chain: FavoriteEffectChain): Command => (s) => {
  const normalized = normalizeFavoriteEffectChain(chain);
  if (!normalized) return s;
  const chains = s.project.favoriteEffectChains ?? [];
  const next = [...chains.filter((existing) => existing.id !== normalized.id), normalized];
  return withProject(s, { ...s.project, favoriteEffectChains: next });
};

export const removeFavoriteEffectChain = (id: string): Command => (s) => {
  const chains = s.project.favoriteEffectChains ?? [];
  const next = chains.filter((chain) => chain.id !== id);
  return next.length === chains.length ? s : withProject(s, { ...s.project, favoriteEffectChains: next });
};

export const setNativePluginManager = (manager: NativePluginManager): Command => (s) =>
  withProject(s, { ...s.project, nativePluginManager: normalizeNativePluginManager(manager) });

export const upsertNativePlugins = (plugins: ManagedNativeAudioPlugin[], scanRoots: string[] = []): Command => (s) => {
  const current = normalizeNativePluginManager(s.project.nativePluginManager ?? { plugins: [] });
  const incoming = normalizeNativePluginManager({ plugins, scanRoots, lastScanAt: Date.now() });
  const byId = new Map(current.plugins.map((plugin) => [plugin.id, plugin]));
  for (const plugin of incoming.plugins) {
    const existing = byId.get(plugin.id);
    byId.set(plugin.id, existing ? { ...existing, ...plugin, enabled: existing.enabled, presetName: existing.presetName, state: existing.state } : plugin);
  }
  return withProject(s, {
    ...s.project,
    nativePluginManager: normalizeNativePluginManager({
      plugins: Array.from(byId.values()),
      scanRoots: [...(current.scanRoots ?? []), ...(incoming.scanRoots ?? [])],
      lastScanAt: incoming.lastScanAt,
    }),
  });
};

export const setNativePluginEnabled = (pluginId: string, enabled: boolean): Command => (s) => {
  const manager = normalizeNativePluginManager(s.project.nativePluginManager ?? { plugins: [] });
  let changed = false;
  const plugins = manager.plugins.map((plugin) => {
    if (plugin.id !== pluginId) return plugin;
    if (plugin.enabled === enabled) return plugin;
    changed = true;
    return { ...plugin, enabled };
  });
  return changed ? withProject(s, { ...s.project, nativePluginManager: { ...manager, plugins } }) : s;
};

export const setNativePluginPresetState = (pluginId: string, presetName: string, state: Record<string, EffectParamValue> = {}): Command => (s) => {
  const manager = normalizeNativePluginManager(s.project.nativePluginManager ?? { plugins: [] });
  let changed = false;
  const plugins = manager.plugins.map((plugin) => {
    if (plugin.id !== pluginId) return plugin;
    changed = true;
    return normalizeManagedNativePlugin({ ...plugin, presetName, state }) ?? plugin;
  });
  return changed ? withProject(s, { ...s.project, nativePluginManager: { ...manager, plugins } }) : s;
};

export const removeNativePlugin = (pluginId: string): Command => (s) => {
  const manager = normalizeNativePluginManager(s.project.nativePluginManager ?? { plugins: [] });
  const plugins = manager.plugins.filter((plugin) => plugin.id !== pluginId);
  return plugins.length === manager.plugins.length ? s : withProject(s, { ...s.project, nativePluginManager: { ...manager, plugins } });
};

export const addTrack = (opts: Partial<Track> = {}): Command => (s) => {
  const track = newTrack(s.project.tracks.length, opts);
  return { ...withProject(s, { ...s.project, tracks: [...s.project.tracks, track] }), activeTrackId: track.id };
};

export const addVideoReference = (
  asset: VideoAsset,
  opts: { start?: number; duration?: number; trackId?: string } = {},
): Command => (s) => {
  const nextAsset = normalizeVideoAsset(asset);
  const videoAssets = [...(s.project.videoAssets ?? []).filter((a) => a.id !== nextAsset.id), nextAsset];
  let videoTracks = [...(s.project.videoTracks ?? [])];
  let track = opts.trackId ? videoTracks.find((t) => t.id === opts.trackId) : videoTracks[0];
  if (!track) {
    track = newVideoTrack(videoTracks.length);
    videoTracks = [...videoTracks, track];
  }
  const duration = Math.max(0.001, finiteOr(opts.duration ?? nextAsset.duration ?? 10, 10));
  const clip = newVideoClip(nextAsset, {
    trackId: track.id,
    start: Math.max(0, finiteOr(opts.start ?? s.transport.playhead, s.transport.playhead)),
    duration,
  });
  videoTracks = videoTracks.map((t) => (t.id === track.id ? { ...t, clips: [...t.clips, clip].sort((a, b) => a.start - b.start) } : t));
  return withProject(s, { ...s.project, videoAssets, videoTracks });
};

export const addVideoReferenceWithExtractedAudio = (
  asset: VideoAsset,
  audio: AudioData,
  opts: { start?: number; duration?: number; videoTrackId?: string; audioTrackName?: string; audioClipName?: string } = {},
): Command => (s) => {
  const start = Math.max(0, finiteOr(opts.start ?? s.transport.playhead, s.transport.playhead));
  const withVideo = addVideoReference(asset, { start, duration: opts.duration, trackId: opts.videoTrackId })(s);
  const baseName = stringOrUndefined(asset.name) ?? stringOrUndefined(asset.sourceName) ?? "Video";
  const audioTrack = newTrack(withVideo.project.tracks.length, { name: opts.audioTrackName ?? `${baseName.replace(/\.[^.]+$/, "")} Audio` });
  const clip = newClip(audio, { trackId: audioTrack.id, start, name: opts.audioClipName ?? `${baseName} audio` });
  return {
    ...withProject(withVideo, { ...withVideo.project, tracks: [...withVideo.project.tracks, { ...audioTrack, clips: [clip] }] }),
    activeTrackId: audioTrack.id,
  };
};

export const updateVideoAsset = (assetId: string, patch: Partial<VideoAsset>): Command => (s) => {
  let changed = false;
  const videoAssets = (s.project.videoAssets ?? []).map((asset) => {
    if (asset.id !== assetId) return asset;
    const next = normalizeVideoAsset({ ...asset, ...patch, id: asset.id });
    if (!sameVideoAsset(asset, next)) changed = true;
    return next;
  });
  return changed ? withProject(s, { ...s.project, videoAssets }) : s;
};

export const setVideoClipLocked = (clipId: string, locked: boolean): Command => (s) => {
  let changed = false;
  const videoTracks = (s.project.videoTracks ?? []).map((track) => {
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      if ((clip.locked ?? false) === locked) return clip;
      changed = true;
      trackChanged = true;
      return { ...clip, locked: locked || undefined };
    });
    return trackChanged ? { ...track, clips } : track;
  });
  return changed ? withProject(s, { ...s.project, videoTracks }) : s;
};

export const removeTrack = (trackId: string): Command => (s) => {
  const tracks = s.project.tracks.filter((t) => t.id !== trackId);
  if (tracks.length === s.project.tracks.length) return s;
  const next = withProject(s, { ...s.project, tracks });
  return next.activeTrackId === trackId ? { ...next, activeTrackId: tracks[0]?.id ?? null } : next;
};

export const moveTrack = (trackId: string, toIndex: number): Command => (s) => {
  const from = s.project.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return s;
  const tracks = [...s.project.tracks];
  const [t] = tracks.splice(from, 1);
  tracks.splice(clamp(toIndex, 0, tracks.length), 0, t);
  return withProject(s, { ...s.project, tracks });
};

// ── advanced session graph: buses, sends, racks, automation ────────────────

export const addBus = (opts: Partial<Bus> = {}): Command => (s) => {
  const bus = newBus(s.project.buses?.length ?? 0, opts);
  return withProject(s, { ...s.project, buses: [...(s.project.buses ?? []), bus] });
};

export const removeBus = (busId: string): Command => (s) => {
  const buses = (s.project.buses ?? []).filter((b) => b.id !== busId);
  if (buses.length === (s.project.buses ?? []).length) return s;
  const cleanSends = (sends: Send[] | undefined): Send[] => (sends ?? []).filter((send) => send.targetBusId !== busId);
  const tracks = s.project.tracks.map((t) => ({
    ...t,
    outputId: t.outputId === busId ? MASTER_BUS_ID : t.outputId,
    sends: cleanSends(t.sends),
  }));
  const cleanedBuses = buses.map((b) => ({
    ...b,
    outputId: b.outputId === busId ? MASTER_BUS_ID : b.outputId,
    sends: cleanSends(b.sends),
  }));
  return withProject(s, { ...s.project, tracks, buses: cleanedBuses });
};

export const setTrackOutput = (trackId: string, outputId: string): Command => (s) => {
  if (outputId !== MASTER_BUS_ID && !busById(s.project, outputId)) return s;
  return withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, outputId })));
};

export const setBusOutput = (busId: string, outputId: string): Command => (s) => {
  if (outputId !== MASTER_BUS_ID && !busById(s.project, outputId)) return s;
  if (outputId === busId) return s;
  return withProject(s, updateBus(s.project, busId, (b) => ({ ...b, outputId })));
};

export const setBusGain = (busId: string, gainDb: number): Command => (s) =>
  withProject(s, updateBus(s.project, busId, (b) => ({ ...b, gainDb: clamp(gainDb, -60, 12) })));

export const setBusPan = (busId: string, pan: number): Command => (s) =>
  withProject(s, updateBus(s.project, busId, (b) => ({ ...b, pan: clamp(pan, -1, 1) })));

export const setBusAutomationMode = (busId: string, mode: AutomationMode): Command => (s) => {
  const normalized = normalizeAutomationMode(mode);
  if (!normalized) return s;
  const bus = busById(s.project, busId);
  if (!bus || (bus.automationMode ?? "read") === normalized) return s;
  return withProject(s, updateBus(s.project, busId, (b) => ({ ...b, automationMode: normalized })));
};

export const toggleBusMute = (busId: string): Command => (s) =>
  withProject(s, updateBus(s.project, busId, (b) => ({ ...b, mute: !b.mute })));

export const toggleBusSolo = (busId: string): Command => (s) =>
  withProject(s, updateBus(s.project, busId, (b) => ({ ...b, solo: !b.solo })));

export const addTrackSend = (trackId: string, targetBusId: string, opts: Partial<Send> = {}): Command => (s) => {
  if (!busById(s.project, targetBusId)) return s;
  const send = newSend(targetBusId, opts);
  return withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, sends: [...(t.sends ?? []), send] })));
};

export const removeTrackSend = (trackId: string, sendId: string): Command => (s) =>
  withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, sends: (t.sends ?? []).filter((send) => send.id !== sendId) })));

export const setTrackSendGain = (trackId: string, sendId: string, gainDb: number): Command => (s) =>
  updateTrackSend(s, trackId, sendId, (send) => ({ ...send, gainDb: clamp(gainDb, -60, 12) }));

export const setTrackSendPan = (trackId: string, sendId: string, pan: number): Command => (s) =>
  updateTrackSend(s, trackId, sendId, (send) => ({ ...send, pan: clamp(pan, -1, 1) }));

export const setTrackSendEnabled = (trackId: string, sendId: string, enabled: boolean): Command => (s) =>
  updateTrackSend(s, trackId, sendId, (send) => (send.enabled === enabled ? send : { ...send, enabled }));

export const setTrackSendPreFader = (trackId: string, sendId: string, preFader: boolean): Command => (s) =>
  updateTrackSend(s, trackId, sendId, (send) => (send.preFader === preFader ? send : { ...send, preFader }));

function setTrackSendAutomationPoint(trackId: string, sendId: string, kind: "sendGainDb" | "sendPan", label: string, time: number, value: number, min: number, max: number): Command {
  return (s) => {
    const track = s.project.tracks.find((t) => t.id === trackId);
    const send = track?.sends?.find((x) => x.id === sendId);
    if (!track || !send) return s;
    const automation = withAutomationPoint(track.automation, sendAutomationTarget(send.id, kind), sendAutomationName(send, label), time, clamp(finiteOr(value, 0), min, max));
    if (!automation) return s;
    return withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, automation })));
  };
}

export const setTrackSendGainAutomationPoint = (trackId: string, sendId: string, time: number, gainDb: number): Command =>
  setTrackSendAutomationPoint(trackId, sendId, "sendGainDb", "Send Gain", time, gainDb, -60, 12);

export const setTrackSendPanAutomationPoint = (trackId: string, sendId: string, time: number, pan: number): Command =>
  setTrackSendAutomationPoint(trackId, sendId, "sendPan", "Send Pan", time, pan, -1, 1);

export const addBusSend = (busId: string, targetBusId: string, opts: Partial<Send> = {}): Command => (s) => {
  if (busId === targetBusId || !busById(s.project, targetBusId)) return s;
  const send = newSend(targetBusId, opts);
  return withProject(s, updateBus(s.project, busId, (b) => ({ ...b, sends: [...(b.sends ?? []), send] })));
};

export const removeBusSend = (busId: string, sendId: string): Command => (s) =>
  withProject(s, updateBus(s.project, busId, (b) => ({ ...b, sends: (b.sends ?? []).filter((send) => send.id !== sendId) })));

export const setBusSendGain = (busId: string, sendId: string, gainDb: number): Command => (s) =>
  updateBusSend(s, busId, sendId, (send) => ({ ...send, gainDb: clamp(gainDb, -60, 12) }));

export const setBusSendPan = (busId: string, sendId: string, pan: number): Command => (s) =>
  updateBusSend(s, busId, sendId, (send) => ({ ...send, pan: clamp(pan, -1, 1) }));

export const setBusSendEnabled = (busId: string, sendId: string, enabled: boolean): Command => (s) =>
  updateBusSend(s, busId, sendId, (send) => (send.enabled === enabled ? send : { ...send, enabled }));

export const setBusSendPreFader = (busId: string, sendId: string, preFader: boolean): Command => (s) =>
  updateBusSend(s, busId, sendId, (send) => (send.preFader === preFader ? send : { ...send, preFader }));

function setBusSendAutomationPoint(busId: string, sendId: string, kind: "sendGainDb" | "sendPan", label: string, time: number, value: number, min: number, max: number): Command {
  return (s) => {
    const bus = busById(s.project, busId);
    const send = bus?.sends?.find((x) => x.id === sendId);
    if (!bus || !send) return s;
    const automation = withAutomationPoint(bus.automation, sendAutomationTarget(send.id, kind), sendAutomationName(send, label), time, clamp(finiteOr(value, 0), min, max));
    if (!automation) return s;
    return withProject(s, updateBus(s.project, busId, (b) => ({ ...b, automation })));
  };
}

export const setBusSendGainAutomationPoint = (busId: string, sendId: string, time: number, gainDb: number): Command =>
  setBusSendAutomationPoint(busId, sendId, "sendGainDb", "Send Gain", time, gainDb, -60, 12);

export const setBusSendPanAutomationPoint = (busId: string, sendId: string, time: number, pan: number): Command =>
  setBusSendAutomationPoint(busId, sendId, "sendPan", "Send Pan", time, pan, -1, 1);

function setBusAutomationPoint(busId: string, target: AutomationLane["target"], name: string, time: number, value: number, min: number, max: number): Command {
  return (s) => {
    const bus = busById(s.project, busId);
    if (!bus) return s;
    const automation = withAutomationPoint(bus.automation, target, name, time, clamp(finiteOr(value, 0), min, max));
    if (!automation) return s;
    return withProject(s, updateBus(s.project, busId, (b) => ({ ...b, automation })));
  };
}

export const setBusGainAutomationPoint = (busId: string, time: number, gainDb: number): Command =>
  setBusAutomationPoint(busId, { kind: "gainDb" }, "Bus Volume", time, gainDb, -60, 12);

export const setBusPanAutomationPoint = (busId: string, time: number, pan: number): Command =>
  setBusAutomationPoint(busId, { kind: "pan" }, "Bus Pan", time, pan, -1, 1);

export const setClipAutomationMode = (clipId: string, mode: AutomationMode): Command => (s) => {
  const normalized = normalizeAutomationMode(mode);
  if (!normalized) return s;
  const clip = clipById(s.project, clipId)?.clip;
  if (!clip || (clip.automationMode ?? "read") === normalized) return s;
  return withProject(s, updateClip(s.project, clipId, (c) => ({ ...c, automationMode: normalized })));
};

export const setClipEffectRack = (clipId: string, effectRack: EffectRack): Command => (s) =>
  withProject(s, updateClip(s.project, clipId, (c) => ({ ...c, effectRack })));

export const addClipEffectSlot = (clipId: string, slot: EffectSlot): Command => (s) =>
  withProject(
    s,
    updateClip(s.project, clipId, (c) => ({
      ...c,
      effectRack: { slots: [...(c.effectRack?.slots ?? []), slot], bypassed: c.effectRack?.bypassed ?? false },
    })),
  );

export const removeClipEffectSlot = (clipId: string, slotId: string): Command => (s) => {
  const clip = clipById(s.project, clipId)?.clip;
  if (!clip?.effectRack?.slots.some((slot) => slot.id === slotId)) return s;
  return withProject(
    s,
    updateClip(s.project, clipId, (c) => ({
      ...c,
      effectRack: { slots: (c.effectRack?.slots ?? []).filter((slot) => slot.id !== slotId), bypassed: c.effectRack?.bypassed ?? false },
    })),
  );
};

export const setClipEffectSlotEnabled = (clipId: string, slotId: string, enabled: boolean): Command => (s) => {
  const slot = clipById(s.project, clipId)?.clip.effectRack?.slots.find((x) => x.id === slotId);
  if (!slot || slot.enabled === enabled) return s;
  return withProject(
    s,
    updateClip(s.project, clipId, (c) => ({
      ...c,
      effectRack: {
        slots: (c.effectRack?.slots ?? []).map((x) => (x.id === slotId ? { ...x, enabled } : x)),
        bypassed: c.effectRack?.bypassed ?? false,
      },
    })),
  );
};

export const setClipEffectSlotParam = (clipId: string, slotId: string, param: string, value: EffectParamValue): Command => (s) => {
  const slot = clipById(s.project, clipId)?.clip.effectRack?.slots.find((x) => x.id === slotId);
  if (!slot) return s;
  const nextValue = normalizeSlotParam(slot, param, value);
  if (slot.params[param] === nextValue) return s;
  return withProject(
    s,
    updateClip(s.project, clipId, (c) => ({
      ...c,
      effectRack: {
        slots: (c.effectRack?.slots ?? []).map((x) => (x.id === slotId ? { ...x, params: { ...x.params, [param]: nextValue } } : x)),
        bypassed: c.effectRack?.bypassed ?? false,
      },
    })),
  );
};

export const setTrackEffectRack = (trackId: string, effectRack: EffectRack): Command => (s) =>
  withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, effectRack })));

export const addTrackEffectSlot = (trackId: string, slot: EffectSlot): Command => (s) =>
  withProject(
    s,
    updateTrack(s.project, trackId, (t) => ({
      ...t,
      effectRack: { slots: [...(t.effectRack?.slots ?? []), slot], bypassed: t.effectRack?.bypassed ?? false },
    })),
  );

export const removeTrackEffectSlot = (trackId: string, slotId: string): Command => (s) =>
  withProject(
    s,
    updateTrack(s.project, trackId, (t) => ({
      ...t,
      effectRack: { slots: (t.effectRack?.slots ?? []).filter((slot) => slot.id !== slotId), bypassed: t.effectRack?.bypassed ?? false },
    })),
  );

export const setTrackEffectSlotEnabled = (trackId: string, slotId: string, enabled: boolean): Command => (s) => {
  const track = s.project.tracks.find((t) => t.id === trackId);
  const slot = track?.effectRack?.slots.find((x) => x.id === slotId);
  if (!slot || slot.enabled === enabled) return s;
  return withProject(
    s,
    updateTrack(s.project, trackId, (t) => ({
      ...t,
      effectRack: {
        slots: (t.effectRack?.slots ?? []).map((x) => (x.id === slotId ? { ...x, enabled } : x)),
        bypassed: t.effectRack?.bypassed ?? false,
      },
    })),
  );
};

export const setTrackEffectSlotParam = (trackId: string, slotId: string, param: string, value: EffectParamValue): Command => (s) => {
  const track = s.project.tracks.find((t) => t.id === trackId);
  const slot = track?.effectRack?.slots.find((x) => x.id === slotId);
  if (!slot) return s;
  const nextValue = normalizeSlotParam(slot, param, value);
  if (slot.params[param] === nextValue) return s;
  return withProject(
    s,
    updateTrack(s.project, trackId, (t) => ({
      ...t,
      effectRack: {
        slots: (t.effectRack?.slots ?? []).map((x) => (x.id === slotId ? { ...x, params: { ...x.params, [param]: nextValue } } : x)),
        bypassed: t.effectRack?.bypassed ?? false,
      },
    })),
  );
};

export const addTrackAutomationLane = (trackId: string, lane: AutomationLane): Command => (s) =>
  withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, automation: [...(t.automation ?? []), lane] })));

function setTrackAutomationPoint(trackId: string, target: AutomationLane["target"], name: string, time: number, value: number, min: number, max: number): Command {
  return (s) => {
    const track = s.project.tracks.find((t) => t.id === trackId);
    if (!track) return s;
    const automation = withAutomationPoint(track.automation, target, name, time, clamp(finiteOr(value, 0), min, max));
    if (!automation) return s;
    return withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, automation })));
  };
}

export const setTrackGainAutomationPoint = (trackId: string, time: number, gainDb: number): Command =>
  setTrackAutomationPoint(trackId, { kind: "gainDb" }, "Volume", time, gainDb, -60, 12);

export const setTrackPanAutomationPoint = (trackId: string, time: number, pan: number): Command =>
  setTrackAutomationPoint(trackId, { kind: "pan" }, "Pan", time, pan, -1, 1);

function setClipAutomationPoint(clipId: string, target: AutomationLane["target"], name: string, time: number, value: number, min: number, max: number): Command {
  return (s) => {
    const clip = clipById(s.project, clipId)?.clip;
    if (!clip) return s;
    const automation = withAutomationPoint(clip.automation, target, name, time, clamp(finiteOr(value, 0), min, max));
    if (!automation) return s;
    return withProject(s, updateClip(s.project, clipId, (c) => ({ ...c, automation })));
  };
}

export const setClipGainAutomationPoint = (clipId: string, time: number, gainDb: number): Command =>
  setClipAutomationPoint(clipId, { kind: "gainDb" }, "Clip Volume", time, gainDb, -60, 12);

export const setClipPanAutomationPoint = (clipId: string, time: number, pan: number): Command =>
  setClipAutomationPoint(clipId, { kind: "pan" }, "Clip Pan", time, pan, -1, 1);

export const setClipEffectParamAutomationPoint = (clipId: string, slotId: string, param: string, time: number, value: number): Command => (s) => {
  const clip = clipById(s.project, clipId)?.clip;
  if (!clip) return s;
  const slot = clip.effectRack?.slots.find((x) => x.id === slotId);
  if (!slot) return s;
  const pointValue = automatableEffectParamValue(slot, param, value);
  if (pointValue == null) return s;
  const target = effectParamAutomationTarget(slot.id, param);
  const automation = withAutomationPoint(clip.automation, target, effectParamAutomationName(slot, param), time, pointValue);
  if (!automation) return s;
  return withProject(s, updateClip(s.project, clipId, (c) => ({ ...c, automation })));
};

export const setTrackEffectParamAutomationPoint = (trackId: string, slotId: string, param: string, time: number, value: number): Command => (s) => {
  const track = s.project.tracks.find((t) => t.id === trackId);
  const slot = track?.effectRack?.slots.find((x) => x.id === slotId);
  if (!slot) return s;
  const pointValue = automatableEffectParamValue(slot, param, value);
  if (pointValue == null) return s;
  const target = effectParamAutomationTarget(slot.id, param);
  const automation = withAutomationPoint(track?.automation, target, effectParamAutomationName(slot, param), time, pointValue);
  if (!automation) return s;
  return withProject(s, updateTrack(s.project, trackId, (t) => ({ ...t, automation })));
};

export const setBusEffectRack = (busId: string, effectRack: EffectRack): Command => (s) =>
  withProject(s, updateBus(s.project, busId, (b) => ({ ...b, effectRack })));

export const addBusEffectSlot = (busId: string, slot: EffectSlot): Command => (s) =>
  withProject(
    s,
    updateBus(s.project, busId, (b) => ({
      ...b,
      effectRack: { slots: [...(b.effectRack?.slots ?? []), slot], bypassed: b.effectRack?.bypassed ?? false },
    })),
  );

export const removeBusEffectSlot = (busId: string, slotId: string): Command => (s) => {
  const bus = busById(s.project, busId);
  if (!bus?.effectRack?.slots.some((slot) => slot.id === slotId)) return s;
  return withProject(
    s,
    updateBus(s.project, busId, (b) => ({
      ...b,
      effectRack: { slots: (b.effectRack?.slots ?? []).filter((slot) => slot.id !== slotId), bypassed: b.effectRack?.bypassed ?? false },
    })),
  );
};

export const setBusEffectSlotEnabled = (busId: string, slotId: string, enabled: boolean): Command => (s) => {
  const bus = busById(s.project, busId);
  const slot = bus?.effectRack?.slots.find((x) => x.id === slotId);
  if (!slot || slot.enabled === enabled) return s;
  return withProject(
    s,
    updateBus(s.project, busId, (b) => ({
      ...b,
      effectRack: {
        slots: (b.effectRack?.slots ?? []).map((x) => (x.id === slotId ? { ...x, enabled } : x)),
        bypassed: b.effectRack?.bypassed ?? false,
      },
    })),
  );
};

export const setBusEffectSlotParam = (busId: string, slotId: string, param: string, value: EffectParamValue): Command => (s) => {
  const bus = busById(s.project, busId);
  const slot = bus?.effectRack?.slots.find((x) => x.id === slotId);
  if (!slot) return s;
  const nextValue = normalizeSlotParam(slot, param, value);
  if (slot.params[param] === nextValue) return s;
  return withProject(
    s,
    updateBus(s.project, busId, (b) => ({
      ...b,
      effectRack: {
        slots: (b.effectRack?.slots ?? []).map((x) => (x.id === slotId ? { ...x, params: { ...x.params, [param]: nextValue } } : x)),
        bypassed: b.effectRack?.bypassed ?? false,
      },
    })),
  );
};

export const addBusAutomationLane = (busId: string, lane: AutomationLane): Command => (s) =>
  withProject(s, updateBus(s.project, busId, (b) => ({ ...b, automation: [...(b.automation ?? []), lane] })));

export const setBusEffectParamAutomationPoint = (busId: string, slotId: string, param: string, time: number, value: number): Command => (s) => {
  const bus = busById(s.project, busId);
  const slot = bus?.effectRack?.slots.find((x) => x.id === slotId);
  if (!slot) return s;
  const pointValue = automatableEffectParamValue(slot, param, value);
  if (pointValue == null) return s;
  const target = effectParamAutomationTarget(slot.id, param);
  const automation = withAutomationPoint(bus?.automation, target, effectParamAutomationName(slot, param), time, pointValue);
  if (!automation) return s;
  return withProject(s, updateBus(s.project, busId, (b) => ({ ...b, automation })));
};

export const setMasterEffectRack = (effectRack: EffectRack): Command => (s) =>
  withProject(s, { ...s.project, masterEffectRack: effectRack });

export const addMasterEffectSlot = (slot: EffectSlot): Command => (s) =>
  withProject(s, {
    ...s.project,
    masterEffectRack: { slots: [...(s.project.masterEffectRack?.slots ?? []), slot], bypassed: s.project.masterEffectRack?.bypassed ?? false },
  });

export const removeMasterEffectSlot = (slotId: string): Command => (s) => {
  if (!s.project.masterEffectRack?.slots.some((slot) => slot.id === slotId)) return s;
  return withProject(s, {
    ...s.project,
    masterEffectRack: {
      slots: (s.project.masterEffectRack?.slots ?? []).filter((slot) => slot.id !== slotId),
      bypassed: s.project.masterEffectRack?.bypassed ?? false,
    },
  });
};

export const setMasterEffectSlotEnabled = (slotId: string, enabled: boolean): Command => (s) => {
  const slot = s.project.masterEffectRack?.slots.find((x) => x.id === slotId);
  if (!slot || slot.enabled === enabled) return s;
  return withProject(s, {
    ...s.project,
    masterEffectRack: {
      slots: (s.project.masterEffectRack?.slots ?? []).map((x) => (x.id === slotId ? { ...x, enabled } : x)),
      bypassed: s.project.masterEffectRack?.bypassed ?? false,
    },
  });
};

export const setMasterEffectSlotParam = (slotId: string, param: string, value: EffectParamValue): Command => (s) => {
  const slot = s.project.masterEffectRack?.slots.find((x) => x.id === slotId);
  if (!slot) return s;
  const nextValue = normalizeSlotParam(slot, param, value);
  if (slot.params[param] === nextValue) return s;
  return withProject(s, {
    ...s.project,
    masterEffectRack: {
      slots: (s.project.masterEffectRack?.slots ?? []).map((x) => (x.id === slotId ? { ...x, params: { ...x.params, [param]: nextValue } } : x)),
      bypassed: s.project.masterEffectRack?.bypassed ?? false,
    },
  });
};

export const addMasterAutomationLane = (lane: AutomationLane): Command => (s) =>
  withProject(s, { ...s.project, masterAutomation: [...(s.project.masterAutomation ?? []), lane] });

function setMasterAutomationPoint(target: AutomationLane["target"], name: string, time: number, value: number, min: number, max: number): Command {
  return (s) => {
    const automation = withAutomationPoint(s.project.masterAutomation, target, name, time, clamp(finiteOr(value, 0), min, max));
    if (!automation) return s;
    return withProject(s, { ...s.project, masterAutomation: automation });
  };
}

export const setMasterGainAutomationPoint = (time: number, gainDb: number): Command =>
  setMasterAutomationPoint({ kind: "gainDb" }, "Master Volume", time, gainDb, -60, 12);

export const setMasterPanAutomationPoint = (time: number, pan: number): Command =>
  setMasterAutomationPoint({ kind: "pan" }, "Master Pan", time, pan, -1, 1);

export const setMasterEffectParamAutomationPoint = (slotId: string, param: string, time: number, value: number): Command => (s) => {
  const slot = s.project.masterEffectRack?.slots.find((x) => x.id === slotId);
  if (!slot) return s;
  const pointValue = automatableEffectParamValue(slot, param, value);
  if (pointValue == null) return s;
  const target = effectParamAutomationTarget(slot.id, param);
  const automation = withAutomationPoint(s.project.masterAutomation, target, effectParamAutomationName(slot, param), time, pointValue);
  if (!automation) return s;
  return withProject(s, { ...s.project, masterAutomation: automation });
};

// ── markers ───────────────────────────────────────────────────────────────────

export const addMarker = (marker: Partial<Marker> & { time: number }): Command => (s) => {
  const m = newMarker(marker);
  return withProject(s, { ...s.project, markers: [...s.project.markers, m] });
};

export const removeMarker = (id: string): Command => (s) => {
  const markers = s.project.markers.filter((m) => m.id !== id);
  return markers.length === s.project.markers.length ? s : withProject(s, { ...s.project, markers });
};

export const renameMarker = (id: string, name: string): Command => (s) =>
  withProject(s, { ...s.project, markers: s.project.markers.map((m) => (m.id === id ? { ...m, name } : m)) });

export const moveMarker = (id: string, time: number): Command => (s) =>
  withProject(s, {
    ...s.project,
    markers: s.project.markers.map((m) => (m.id === id ? { ...m, time: Math.max(0, time) } : m)),
  });
