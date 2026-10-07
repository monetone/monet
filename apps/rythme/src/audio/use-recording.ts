// ─────────────────────────────────────────────────────────────
// audio/use-recording — bind microphone capture to the editor store
// ─────────────────────────────────────────────────────────────

import {
  createAudioData,
  defaultAudioHardwareSettings,
  durationSeconds,
  frameCount,
  insertClip,
  mixToMono,
  setPlayhead,
  setRecording,
  setRecordingInputLevel,
  setChannelCount,
  type AudioData,
  type AudioHardwareSettings,
  type EditorState,
  type RythmeStore,
  type Track,
  type TrackInputAssignment,
} from "../engine";
import { stop as stopPlayback } from "./use-playback";
import { InputRecorder, recordingSupported, type RecordingStartOptions } from "./recording";

interface StoreRecordingSession {
  recorder: InputRecorder;
  startAt: number;
  targets: RecordingTarget[];
  name: string;
}

interface RecordingTarget {
  trackId: string;
  input?: TrackInputAssignment;
}

const sessions = new WeakMap<RythmeStore, StoreRecordingSession>();

export { recordingSupported };

export function isRecording(store: RythmeStore): boolean {
  return sessions.has(store) || store.getState().transport.recording;
}

export async function startRecording(store: RythmeStore): Promise<void> {
  if (sessions.has(store)) return;
  const state = store.getState();
  const targets = recordingTargetTracks(state);
  if (targets.length === 0) throw new Error("Add or arm a track before recording");

  stopPlayback(store);
  const recorder = new InputRecorder();
  const startAt = recordingInsertStart(state);
  const name = recordingClipName();
  await recorder.start({
    ...recordingStartOptions(state, targets),
    onLevel: (level) => store.dispatch(setRecordingInputLevel(level), { history: false, dirty: false }),
  });
  sessions.set(store, { recorder, startAt, targets: targets.map((track) => ({ trackId: track.id, input: track.input })), name });
  store.dispatch(setRecording(true), { history: false, dirty: false });
}

export async function stopRecording(store: RythmeStore): Promise<{ trackIds: string[]; duration: number } | null> {
  const session = sessions.get(store);
  if (!session) {
    store.dispatch(setRecording(false), { history: false, dirty: false });
    return null;
  }
  sessions.delete(store);

  let audio;
  try {
    audio = await session.recorder.stop();
  } finally {
    store.dispatch(setRecording(false), { history: false, dirty: false });
  }

  const trackIds = session.targets.map((target) => target.trackId);
  if (frameCount(audio) === 0) return { trackIds, duration: 0 };
  const duration = durationSeconds(audio);
  store.dispatch((state) => {
    let next = state;
    for (const target of session.targets) {
      next = insertClip(target.trackId, mapRecordedAudioForTrack(audio, target.input), session.startAt, session.name)(next);
    }
    return next;
  }, { label: "Record" });
  store.dispatch(setPlayhead(session.startAt + duration), { history: false, dirty: false });
  return { trackIds, duration };
}

export async function toggleRecording(store: RythmeStore): Promise<void> {
  if (isRecording(store)) {
    await stopRecording(store);
  } else {
    await startRecording(store);
  }
}

export function recordingTargetTracks(state: EditorState): Track[] {
  const armed = state.project.tracks.filter((track) => track.recordArm);
  if (armed.length) return armed;
  const active = state.activeTrackId ? state.project.tracks.find((track) => track.id === state.activeTrackId) : undefined;
  return active ? [active] : state.project.tracks[0] ? [state.project.tracks[0]] : [];
}

export function recordingInsertStart(state: EditorState): number {
  const hardware = audioHardware(state);
  const base = hardware.punchIn?.start ?? state.transport.playhead;
  return Math.max(0, base - hardware.latencyCompensationMs / 1000);
}

export function recordingPreRollStart(state: EditorState): number {
  const hardware = audioHardware(state);
  const punchOrPlayhead = hardware.punchIn?.start ?? state.transport.playhead;
  const beatsPerBar = state.project.timeSignature[0] || 4;
  const beatSeconds = 60 / Math.max(1, state.project.tempo);
  return Math.max(0, punchOrPlayhead - hardware.preRollSeconds - hardware.countInBars * beatsPerBar * beatSeconds);
}

export function recordingStartOptions(state: EditorState, targets = recordingTargetTracks(state)): RecordingStartOptions {
  const hardware = audioHardware(state);
  const firstAssignedDevice = targets.find((track) => track.input?.deviceId)?.input?.deviceId;
  const channels = Math.max(1, Math.min(8, Math.max(hardware.inputChannels, ...targets.map((track) => requiredInputChannels(track.input?.channel)))));
  return {
    sampleRate: hardware.hardwareSampleRate || state.project.sampleRate,
    channels,
    deviceId: firstAssignedDevice ?? hardware.inputDeviceId,
    outputDeviceId: hardware.outputDeviceId,
    monitor: recordingShouldMonitor(hardware, targets),
  };
}

export function mapRecordedAudioForTrack(audio: AudioData, input?: TrackInputAssignment): AudioData {
  const channel = input?.channel ?? "stereo";
  if (channel === "stereo") return setChannelCount(audio, 2);
  if (channel === "mono") return mixToMono(audio);

  const index = channelInputIndex(channel);
  const source = audio.channels[Math.min(index, audio.channels.length - 1)] ?? audio.channels[0];
  const out = createAudioData(1, frameCount(audio), audio.sampleRate);
  if (source) out.channels[0].set(source);
  return out;
}

function audioHardware(state: EditorState): AudioHardwareSettings {
  return state.project.audioHardware ?? defaultAudioHardwareSettings(state.project.sampleRate);
}

function recordingShouldMonitor(hardware: AudioHardwareSettings, targets: Track[]): boolean {
  if (targets.some((track) => track.input?.monitoring === "always")) return true;
  if (targets.some((track) => track.input?.monitoring === "armed" && track.recordArm)) return true;
  if (hardware.inputMonitoring === "always") return true;
  return hardware.inputMonitoring === "armed" && targets.some((track) => track.recordArm);
}

function requiredInputChannels(channel: TrackInputAssignment["channel"] | undefined): number {
  if (channel === "mono") return 1;
  if (!channel || channel === "stereo") return 2;
  return channelInputIndex(channel ?? "stereo") + 1;
}

function channelInputIndex(channel: TrackInputAssignment["channel"]): number {
  if (channel === "right") return 1;
  if (channel.startsWith("input")) {
    const parsed = Number.parseInt(channel.slice("input".length), 10);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(7, parsed - 1));
  }
  return 0;
}

function recordingClipName(now = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `Recording ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}
