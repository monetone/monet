// ─────────────────────────────────────────────────────────────
// engine/model/types — the Rythme project document model
// ─────────────────────────────────────────────────────────────
// A Project is a multitrack timeline: tracks hold clips, clips reference a
// chunk of sample data positioned on the timeline (Audition-style
// non-destructive multitrack). The simple Audacity-style case is just one clip
// per track spanning the whole recording. Time is measured in SECONDS
// throughout the model; sample-rate conversions happen at the buffer edge.

import type { TimelineClip, TimelineTrack } from "@monet-ui/monet-timeline";
import type { AudioData } from "../audio/types";

export type Seconds = number;

/** Opaque `.monet` payload owned by ANOTHER app (foreign `data.<app>` bags plus
 *  unknown/forward-compat fields). Rythme carries it verbatim from load to save
 *  and never reads into it — the courier rule, so a Cinema/Anime document keeps
 *  its transform/color/effects through a Rythme round-trip. */
export type ForeignPayload = Record<string, unknown>;

/** Shape of a clip fade ramp. */
export type FadeShape = "linear" | "equalPower" | "exponential" | "logarithmic";

export const MASTER_BUS_ID = "master";

export type EffectSlotKind = "gain" | "pan" | "invertPolarity" | "silence" | "nativePlugin" | string;

export type EffectParamValue = number | string | boolean | null;

/** A persistent, reorderable, nondestructive processor in a clip/track/bus rack. */
export interface EffectSlot {
  id: string;
  kind: EffectSlotKind;
  name: string;
  enabled: boolean;
  params: Record<string, EffectParamValue>;
}

/** Audition-style effects rack saved with the document. */
export interface EffectRack {
  slots: EffectSlot[];
  bypassed?: boolean;
}

/** A saved effects-rack macro exposed under Favorites. */
export interface FavoriteEffectStep {
  kind: EffectSlotKind;
  name?: string;
  enabled?: boolean;
  params?: Record<string, EffectParamValue>;
}

export interface FavoriteEffectChain {
  id: string;
  name: string;
  steps: FavoriteEffectStep[];
}

export type ManagedNativeAudioPluginKind = "vst3" | "vst2" | "audioUnit" | "unknown";
export type ManagedNativeAudioPluginHostStatus = "inventoryOnly";
export type ManagedNativeAudioPluginValidationStatus = "pathOnly" | "metadataVerified" | "invalid";

/** Project-persisted Audio Plug-In Manager entry. Hosting is still inventory-only. */
export interface ManagedNativeAudioPlugin {
  id: string;
  kind: ManagedNativeAudioPluginKind;
  name: string;
  vendor?: string;
  version?: string;
  bundleIdentifier?: string;
  path: string;
  extension: string;
  canProcess: false;
  hostStatus: ManagedNativeAudioPluginHostStatus;
  validationStatus?: ManagedNativeAudioPluginValidationStatus;
  entryPointVerified?: boolean;
  enabled: boolean;
  lastScannedAt?: number;
  validationIssues?: string[];
  presetName?: string;
  state?: Record<string, EffectParamValue>;
}

export interface NativePluginManager {
  plugins: ManagedNativeAudioPlugin[];
  scanRoots?: string[];
  lastScanAt?: number;
}

export type AutomationInterpolation = "linear" | "hold";
export type AutomationTargetKind = "gainDb" | "pan" | "effectParam" | "sendGainDb" | "sendPan";
export type AutomationMode = "read" | "off" | "write" | "touch" | "latch";

export interface AutomationTarget {
  kind: AutomationTargetKind;
  /** Used when kind = "sendGainDb" or "sendPan". */
  sendId?: string;
  /** Used when kind = "effectParam". */
  effectSlotId?: string;
  /** Used when kind = "effectParam". */
  param?: string;
}

export interface AutomationPoint {
  time: Seconds;
  value: number;
}

/** Persistent clip/track/bus/master envelope data. */
export interface AutomationLane {
  id: string;
  name: string;
  target: AutomationTarget;
  points: AutomationPoint[];
  enabled: boolean;
  interpolation: AutomationInterpolation;
}

/** A track or bus send. `preFader` taps before the channel fader/pan stage. */
export interface Send {
  id: string;
  name: string;
  targetBusId: string;
  gainDb: number;
  pan: number;
  preFader: boolean;
  enabled: boolean;
}

/** Object-style 5.1 panner for mono/stereo clips on a track.
 *  x: -1 left … +1 right; y: -1 rear … +1 front; center/lfe/divergence: 0..1. */
export interface SurroundPan {
  x: number;
  y: number;
  center: number;
  lfe: number;
  divergence: number;
}

/** Essential Sound role assigned to a track for role-aware workflows. */
export type AudioRole = "dialogue" | "music" | "sfx" | "ambience";

/** Active editor surface. Audition exposes separate Waveform and Multitrack modes. */
export type EditorMode = "multitrack" | "waveform";

export type ToolId = "select" | "razor" | "marquee" | "envelope" | "fade" | "marker" | "hand" | "zoom";

export type DisplayTimeFormat = "decimal" | "smpte30" | "samples" | "barsBeats";

export interface WorkspaceLayoutData {
  [key: string]: unknown;
}

export interface CustomWorkspace {
  id: string;
  name: string;
  layout: WorkspaceLayoutData;
}

export const KEYBOARD_SHORTCUT_ACTIONS = [
  "transport.playPause",
  "transport.returnToStart",
  "clip.nudgeLeft",
  "clip.nudgeRight",
  "edit.undo",
  "edit.redo",
  "edit.selectAll",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.split",
  "edit.duplicate",
  "edit.silence",
  "edit.trim",
  "edit.delete",
  "project.save",
  "effect.noiseReduction",
  "effect.captureNoisePrint",
  "view.zoomIn",
  "view.zoomOut",
  "tool.select",
  "tool.razor",
  "tool.marquee",
  "tool.envelope",
  "tool.fade",
  "tool.marker",
  "tool.hand",
  "tool.zoom",
] as const;

export type KeyboardShortcutAction = typeof KEYBOARD_SHORTCUT_ACTIONS[number];

export interface KeyboardShortcut {
  action: KeyboardShortcutAction;
  key: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyboardShortcutPreset {
  id: string;
  name: string;
  shortcuts: KeyboardShortcut[];
}

/** Session-persisted editor preferences for display and editing defaults. */
export interface EditorPreferences {
  editorMode: EditorMode;
  tool: ToolId;
  snap: boolean;
  displayTimeFormat: DisplayTimeFormat;
  spectralMinHz: number;
  spectralMaxHz: number;
  activeWorkspaceId: string;
  customWorkspaces: CustomWorkspace[];
  keyboardShortcuts: KeyboardShortcut[];
  keyboardShortcutPresets: KeyboardShortcutPreset[];
}

export interface AnalyzePanelPreferences {
  spectralMinHz: number;
  spectralMaxHz: number;
  spectralGainDb: number;
}

export interface EffectsPanelPreferences {
  gainDb: number;
  normalizeTargetDb: number;
  filterCutoffHz: number;
  compressorThresholdDb: number;
  compressorRatio: number;
  noiseReductionReduceByDb: number;
  noiseReductionAmountPct: number;
  dehummerFrequencyHz: number;
  dehummerHarmonics: number;
  dehummerReductionDb: number;
  deEsserFrequencyHz: number;
  deEsserThresholdDb: number;
  pitchShiftSemitones: number;
  timeStretchPercent: number;
  pitchBendStartSemitones: number;
  pitchBendEndSemitones: number;
  limiterCeilingDb: number;
  limiterBoostDb: number;
  tubeThresholdDb: number;
  tubeWarmthPct: number;
  matchLoudnessTargetLufs: number;
  dopplerSpeedMps: number;
  dopplerDistanceM: number;
  convolutionDecayMs: number;
  convolutionMixPct: number;
}

/** Session-persisted panel defaults for advanced panel controls. */
export interface PanelPreferences {
  analyze: AnalyzePanelPreferences;
  effects: EffectsPanelPreferences;
}

/** Hardware monitoring policy for live input. */
export type InputMonitoringMode = "off" | "armed" | "always";

/** Which channels from the active hardware input should feed a track. */
export type TrackInputChannel = "mono" | "left" | "right" | "stereo" | "input1" | "input2" | "input3" | "input4" | "input5" | "input6" | "input7" | "input8";

/** Per-track input assignment, saved with the session like Audition track inputs. */
export interface TrackInputAssignment {
  deviceId?: string;
  label?: string;
  channel: TrackInputChannel;
  monitoring?: InputMonitoringMode;
}

/** Session hardware/recording preferences. Device ids are browser/native ids. */
export interface AudioHardwareSettings {
  inputDeviceId?: string;
  outputDeviceId?: string;
  hardwareSampleRate: number;
  inputChannels: number;
  inputMonitoring: InputMonitoringMode;
  latencyCompensationMs: number;
  preRollSeconds: Seconds;
  countInBars: number;
  punchIn: { start: Seconds; end: Seconds } | null;
  /** Display offset applied to meter dB readouts; sample clipping stays raw dBFS. */
  meterCalibrationDb: number;
  /** Software peak-hold duration for mixer/meter bridge displays. */
  meterPeakHoldMs: number;
}

/** Live input meter state while recording. Editor-only; never persisted. */
export interface RecordingInputLevel {
  peak: number;
  rms: number;
  peakDb: number;
  rmsDb: number;
  channels: number;
  clipped: boolean;
}

/** A referenced picture asset used for post-production alignment. */
export interface VideoAsset {
  id: string;
  name: string;
  sourceName?: string;
  sourcePath?: string;
  mimeType?: string;
  duration?: Seconds;
  width?: number;
  height?: number;
  frameRate?: number;
  hasAudio?: boolean;
  foreign?: ForeignPayload;
}

/** A positioned video region. Video media stays referenced, not rendered into PCM. */
export interface VideoClip extends TimelineClip {
  trackId: string;
  assetId: string;
  name: string;
  locked?: boolean;
  foreign?: ForeignPayload;
}

export type VideoTrackKind = "video";

/** A picture-reference lane for video/post workflows. */
export interface VideoTrack extends TimelineTrack<VideoClip> {
  id: string;
  name: string;
  kind: VideoTrackKind;
  color: string;
  clips: VideoClip[];
  height: number;
  locked?: boolean;
  visible?: boolean;
  foreign?: ForeignPayload;
}

/** A positioned region of audio on a track. It IS a @monet-ui/monet-timeline
 *  `TimelineClip` (id/start/duration/inPoint/speed/enabled — all in SECONDS for
 *  the time fields), so the shared editing ops + query engine operate on it.
 *  `inPoint` is the read offset into the source buffer (was Rythme's `offset`);
 *  `speed` is always 1 and `enabled` always true for audio. */
export interface Clip extends TimelineClip {
  trackId: string;
  name: string;
  /** Per-clip gain trim, in decibels. */
  gainDb: number;
  fadeIn: Seconds;
  fadeOut: Seconds;
  fadeInShape: FadeShape;
  fadeOutShape: FadeShape;
  /** Group id — clips sharing one move together on the timeline (undefined = ungrouped). */
  groupId?: string;
  /** Muted clips stay on the timeline but contribute silence to the mix (undefined = audible). */
  muted?: boolean;
  /** Locked-in-time clips can't be moved on the timeline (undefined = movable). */
  locked?: boolean;
  /** Looped clips repeat their source to fill a duration longer than the source
   *  (undefined = the region past the source renders as silence). */
  looped?: boolean;
  /** Nondestructive clip effects, rendered before clip gain/fades. */
  effectRack?: EffectRack;
  /** Clip-local automation lanes. */
  automation?: AutomationLane[];
  /** How this clip follows or captures automation; missing means "read". */
  automationMode?: AutomationMode;
  /** Source PCM. Shared structurally; ops shallow-clone (buffer shared). */
  buffer: AudioData;
  /** Another app's clip payload (incl. its `mediaId` when the PCM isn't ours). */
  foreign?: ForeignPayload;
}

export type TrackKind = "audio";

/** A horizontal lane holding clips, with a mixer channel. A
 *  `TimelineTrack<Clip>` (id + clips) plus Rythme's audio mixer fields. */
export interface Track extends TimelineTrack<Clip> {
  id: string;
  name: string;
  kind: TrackKind;
  /** CSS color string used for the lane + waveform accent. */
  color: string;
  clips: Clip[];
  /** Channel fader, in decibels (0 = unity). */
  gainDb: number;
  /** Stereo pan, -1 (hard left) … 0 (center) … +1 (hard right). */
  pan: number;
  /** Optional 5.1 object panner used when the project output has 6+ channels. */
  surroundPan?: SurroundPan;
  /** Essential Sound role for presets and role-aware ducking. */
  audioRole?: AudioRole;
  /** Hardware input assignment used when recording armed tracks. */
  input?: TrackInputAssignment;
  mute: boolean;
  solo: boolean;
  recordArm: boolean;
  /** Nondestructive track effects, rendered before the track fader. */
  effectRack?: EffectRack;
  /** Track automation lanes for fader, pan, and rack effect parameters. */
  automation?: AutomationLane[];
  /** How this mixer channel follows or captures automation; missing means "read". */
  automationMode?: AutomationMode;
  /** Sends to project buses. */
  sends?: Send[];
  /** Output route; undefined/"master" routes to the master bus. */
  outputId?: string;
  /** Lane height in px (UI hint; persisted with the doc). */
  height: number;
  foreign?: ForeignPayload;
}

/** A routable mix bus. Buses have no timeline clips; they receive track/bus
 *  outputs and sends, then render through their own rack/fader/pan. */
export interface Bus {
  id: string;
  name: string;
  color: string;
  gainDb: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  effectRack?: EffectRack;
  automation?: AutomationLane[];
  automationMode?: AutomationMode;
  sends?: Send[];
  outputId?: string;
}

export type MarkerKind = "cue" | "region";

/** A named point or region on the timeline. */
export interface Marker {
  id: string;
  time: Seconds;
  /** For region markers, the end time (> time); undefined for cue points. */
  end?: Seconds;
  name: string;
  color: string;
  kind: MarkerKind;
  foreign?: ForeignPayload;
}

export interface ProjectMeta {
  created: number;
  modified: number;
  author?: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  description?: string;
  comment?: string;
  copyright?: string;
  keywords?: string;
}

/** The whole document. */
export interface Project {
  id: string;
  name: string;
  /** Project sample rate; clips are resampled to this on import. */
  sampleRate: number;
  /** Master output channels (2 = stereo, 6 = 5.1 surround). */
  channelCount: number;
  /** Tempo in beats per minute (for the bars/beats ruler & grid). */
  tempo: number;
  /** Time signature [beatsPerBar, beatUnit], e.g. [4, 4]. */
  timeSignature: [number, number];
  /** Picture timeline frame rate for video reference clips and timecode. */
  videoFrameRate: number;
  /** Master bus gain, in decibels. */
  masterGainDb: number;
  masterEffectRack?: EffectRack;
  masterAutomation?: AutomationLane[];
  masterAutomationMode?: AutomationMode;
  /** Session-level audio hardware and recording preferences. */
  audioHardware?: AudioHardwareSettings;
  /** Session-level editor display and editing preferences. */
  editorPreferences?: EditorPreferences;
  /** Session-level advanced panel preferences. */
  panelPreferences?: PanelPreferences;
  /** Project-persisted Audio Plug-In Manager inventory and metadata. */
  nativePluginManager?: NativePluginManager;
  /** Referenced picture assets. Video bytes are not embedded in the project. */
  videoAssets?: VideoAsset[];
  /** Reference video tracks aligned to the audio timeline. */
  videoTracks?: VideoTrack[];
  tracks: Track[];
  buses?: Bus[];
  favoriteEffectChains?: FavoriteEffectChain[];
  markers: Marker[];
  meta: ProjectMeta;
  /** Opaque cargo from a cross-opened `.monet`: the document's unowned fields
   *  and foreign `data.<app>` bags, the media entries Rythme does not own, and
   *  the other sequences (Rythme edits exactly one). Re-emitted verbatim. */
  foreign?: ForeignPayload;
}

// ── Editor-only (non-persisted) state ───────────────────────────────────────

/** A time range on the timeline; null when nothing is range-selected. */
export interface TimeRange {
  start: Seconds;
  end: Seconds;
}

/** A vertical frequency band in Hz for spectral editing. */
export interface FrequencyRange {
  minHz: number;
  maxHz: number;
}

export type SpectralChannel = "all" | "left" | "right";

/** A rectangular time × frequency selection in the spectral display. */
export interface SpectralSelection {
  time: TimeRange;
  frequency: FrequencyRange;
  channel: SpectralChannel;
}

/** What the user currently has selected. */
export interface Selection {
  /** Selected clip ids. */
  clipIds: string[];
  /** Tracks participating in a range/clip selection. */
  trackIds: string[];
  /** Time-range selection (Audacity-style), or null. */
  range: TimeRange | null;
  /** Spectral Frequency Display rectangle, or null. */
  spectral: SpectralSelection | null;
}

export interface Transport {
  playing: boolean;
  recording: boolean;
  recordingInput: RecordingInputLevel | null;
  /** Current play position, in seconds. */
  playhead: Seconds;
  /** Loop region; loop disabled when null. */
  loop: TimeRange | null;
  loopEnabled: boolean;
  metronome: boolean;
}

export interface ViewState {
  /** Horizontal zoom: timeline pixels per second. */
  pxPerSecond: number;
  /** Horizontal scroll offset, in seconds. */
  scrollSec: Seconds;
  /** Vertical scroll offset, in px. */
  scrollY: number;
  /** Usable timeline width in px (excludes track headers); set by the view.
   *  Lets zoom-to-selection / zoom-out-full size the zoom to fit the window. */
  viewportPx: number;
  /** Snap clip drags to clip edges / markers / the playhead (Edit ▸ Snapping). */
  snap: boolean;
}

/** Clips captured by copy/cut, with start times relative to the range origin. */
export interface ClipboardTrack {
  sourceTrackId: string;
  clips: Clip[];
}

export interface Clipboard {
  duration: Seconds;
  tracks: ClipboardTrack[];
}

/** The full reactive editor state held by the store. */
export interface EditorState {
  project: Project;
  mode: EditorMode;
  selection: Selection;
  transport: Transport;
  view: ViewState;
  tool: ToolId;
  /** Active track for keyboard-driven ops. */
  activeTrackId: string | null;
  /** Copy/cut buffer; null when empty. Not part of undo history. */
  clipboard: Clipboard | null;
  dirty: boolean;
}
