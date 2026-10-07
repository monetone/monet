// ─────────────────────────────────────────────────────────────
// engine/ops/render — bake clips / tracks / project to samples
// ─────────────────────────────────────────────────────────────
// Turns the structural model into actual PCM: a clip's audible region with its
// gain & fades applied; a track with its clips mixed at their timeline
// positions; and the whole project mixed down through track gain/pan/mute/solo
// and the master fader. This is the offline render used for export, mixdown,
// and the headless playback fallback.

import {
  createAudioData,
  mixToMono,
  mixInto,
  resampleLinear,
  setChannelCount,
  sliceFrames,
} from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { fadeIn, fadeOut } from "../dsp/fade";
import { applyGainDb } from "../dsp/gain";
import { busAudible, clipEnd, projectDuration, trackAudible } from "../model/query";
import { MASTER_BUS_ID, type AutomationLane, type AutomationMode, type Bus, type Clip, type Project, type Send, type Track } from "../model/types";
import { applyChannelControls, applyEffectRack, applyGainAutomation, applyPanAutomation } from "./rack";

/** The audible PCM of a clip: its visible region with gain & fades applied. */
export function renderClip(clip: Clip): AudioData {
  const sr = clip.buffer.sampleRate;
  const offsetFrames = Math.round(clip.inPoint * sr);
  const durFrames = Math.round(clip.duration * sr);
  let audio = sliceFrames(clip.buffer, offsetFrames, offsetFrames + durFrames);
  // when the visible region runs past the source, either loop the source to fill it
  // (Audition's looped clip) or pad with silence
  const srcLen = frameCount(audio);
  if (srcLen < durFrames) {
    const filled = createAudioData(audio.channels.length, durFrames, sr);
    if (clip.looped && srcLen > 0) {
      for (let c = 0; c < audio.channels.length; c++) {
        const inp = audio.channels[c];
        const out = filled.channels[c];
        for (let i = 0; i < durFrames; i++) out[i] = inp[i % srcLen];
      }
    } else {
      for (let c = 0; c < audio.channels.length; c++) filled.channels[c].set(audio.channels[c]);
    }
    audio = filled;
  }
  const automation = readableAutomation(clip.automationMode, clip.automation);
  audio = applyEffectRack(audio, clip.effectRack, { automation });
  if (clip.gainDb !== 0) audio = applyGainDb(audio, clip.gainDb);
  if (clip.fadeIn > 0) audio = fadeIn(audio, clip.fadeIn, clip.fadeInShape);
  if (clip.fadeOut > 0) audio = fadeOut(audio, clip.fadeOut, clip.fadeOutShape);
  audio = applyChannelControls(audio, { gainDb: 0, pan: 0, automation });
  return audio;
}

/** Mix one track's clips onto a contiguous buffer at the project's rate. */
export function renderTrack(track: Track, sampleRate: number, channels = 2): AudioData {
  let endFrames = 0;
  for (const c of track.clips) endFrames = Math.max(endFrames, Math.round(clipEnd(c) * sampleRate));
  const out = createAudioData(channels, endFrames, sampleRate);
  for (const clip of track.clips) {
    if (clip.muted) continue; // muted clips occupy the timeline but contribute silence to the mix
    let a = renderClip(clip);
    if (a.sampleRate !== sampleRate) a = resampleLinear(a, sampleRate);
    a = routeClipToTrackChannels(a, track, channels);
    mixInto(out, a, Math.round(clip.start * sampleRate));
  }
  return out;
}

function routeClipToTrackChannels(audio: AudioData, track: Track, channels: number): AudioData {
  if (channels < 6) return setChannelCount(audio, channels);
  if (channelCount(audio) >= 3) return setChannelCount(audio, channels);
  if (track.surroundPan) return applySurroundPan(audio, channels, track.surroundPan);
  return mapFrontChannels(audio, channels);
}

function mapFrontChannels(audio: AudioData, channels: number): AudioData {
  const out = createAudioData(channels, frameCount(audio), audio.sampleRate);
  if (channelCount(audio) === 1) {
    const src = audio.channels[0];
    for (let i = 0; i < src.length; i++) {
      const v = src[i] * Math.SQRT1_2;
      out.channels[0][i] = v;
      out.channels[1][i] = v;
    }
    return out;
  }
  out.channels[0].set(audio.channels[0]);
  out.channels[1].set(audio.channels[1]);
  return out;
}

function applySurroundPan(audio: AudioData, channels: number, pan: NonNullable<Track["surroundPan"]>): AudioData {
  const mono = mixToMono(audio);
  const out = createAudioData(channels, frameCount(mono), mono.sampleRate);
  const x = clampUnit(pan.x);
  const y = clampUnit(pan.y);
  const front = (y + 1) / 2;
  const rear = 1 - front;
  const left = (1 - x) / 2;
  const right = 1 - left;
  const spread = clamp01(pan.divergence);
  const weights = [
    Math.sqrt(front * left) * spread, // L
    Math.sqrt(front * right) * spread, // R
    Math.sqrt(front) * clamp01(pan.center), // C
    clamp01(pan.lfe), // LFE
    Math.sqrt(rear * left) * spread, // Ls
    Math.sqrt(rear * right) * spread, // Rs
  ];
  const power = Math.sqrt(weights.reduce((sum, w) => sum + w * w, 0));
  const norm = power > 1 ? 1 / power : 1;
  const src = mono.channels[0];
  for (let c = 0; c < Math.min(6, channels); c++) {
    const dst = out.channels[c];
    const gain = weights[c] * norm;
    for (let i = 0; i < src.length; i++) dst[i] = src[i] * gain;
  }
  return out;
}

export interface RenderProjectOptions {
  /** Apply the master fader (default true). */
  applyMaster?: boolean;
  /** Force a specific length in seconds (default: project duration). */
  durationSeconds?: number;
  /** Override the project output channel count. */
  channelCount?: number;
}

/** Mix the whole project through the full signal path. */
export function renderProject(project: Project, opts: RenderProjectOptions = {}): AudioData {
  const sr = project.sampleRate;
  const dur = opts.durationSeconds ?? projectDuration(project);
  const frames = Math.round(dur * sr);
  const channels = outputChannelCount(project, opts.channelCount);
  const out = createAudioData(channels, frames, sr);
  const buses = project.buses ?? [];
  const busBuffers = new Map<string, AudioData>();
  for (const bus of buses) busBuffers.set(bus.id, createAudioData(channels, frames, sr));

  for (const track of project.tracks) {
    if (!trackAudible(project, track)) continue;
    const raw = renderTrack(track, sr, channels);
    const automation = readableAutomation(track.automationMode, track.automation);
    const preFader = applyEffectRack(raw, track.effectRack, { automation });
    const postFader = applyChannelControls(preFader, { gainDb: track.gainDb, pan: track.pan, automation });
    mixSends(preFader, postFader, track.sends, busBuffers, channels, automation);
    mixToRoute(out, busBuffers, track.outputId, postFader, channels);
  }

  for (const bus of buses) {
    if (!busAudible(project, bus)) continue;
    const raw = busBuffers.get(bus.id);
    if (!raw) continue;
    const automation = readableAutomation(bus.automationMode, bus.automation);
    const preFader = applyEffectRack(raw, bus.effectRack, { automation });
    const postFader = applyChannelControls(preFader, { gainDb: bus.gainDb, pan: bus.pan, automation });
    mixSends(preFader, postFader, bus.sends, busBuffers, channels, automation);
    mixToRoute(out, busBuffers, bus.outputId, postFader, channels, bus.id);
  }
  const masterAutomation = readableAutomation(project.masterAutomationMode, project.masterAutomation);
  let mastered = applyEffectRack(out, project.masterEffectRack, { automation: masterAutomation });
  mastered = applyChannelControls(mastered, { gainDb: opts.applyMaster === false ? 0 : project.masterGainDb, pan: 0, automation: masterAutomation });
  return mastered;
}

/**
 * Render only the window [start, end) of the project — the audio you'd export
 * for a selected range. Clamped to a valid, non-negative span; an empty span
 * yields a zero-length buffer.
 */
export function renderProjectRange(project: Project, start: number, end: number, opts: RenderProjectOptions = {}): AudioData {
  const sr = project.sampleRate;
  const s = Math.max(0, start);
  const e = Math.max(s, end);
  const full = renderProject(project, { ...opts, durationSeconds: e });
  return sliceFrames(full, Math.round(s * sr), Math.round(e * sr));
}

/** Convenience alias: render the project as a single bounce. */
export const mixdown = renderProject;

function outputChannelCount(project: Project, override: number | undefined): number {
  const value = override ?? project.channelCount ?? 2;
  return Math.max(1, Math.min(8, Math.round(Number.isFinite(value) ? value : 2)));
}

function readableAutomation(mode: AutomationMode | undefined, lanes: AutomationLane[] | undefined): AutomationLane[] | undefined {
  return mode === "off" ? undefined : lanes;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function mixSends(
  preFader: AudioData,
  postFader: AudioData,
  sends: Send[] | undefined,
  busBuffers: Map<string, AudioData>,
  channels: number,
  automation?: AutomationLane[],
): void {
  for (const send of sends ?? []) {
    if (!send.enabled) continue;
    const target = busBuffers.get(send.targetBusId);
    if (!target) continue;
    let sent = setChannelCount(send.preFader ? preFader : postFader, channels);
    sent = applyPanAutomation(sent, activeSendAutomationLane(automation, send.id, "sendPan"), 0, send.pan);
    sent = applyGainAutomation(sent, activeSendAutomationLane(automation, send.id, "sendGainDb"), 0, send.gainDb);
    mixInto(target, sent, 0);
  }
}

function activeSendAutomationLane(lanes: AutomationLane[] | undefined, sendId: string, kind: "sendGainDb" | "sendPan"): AutomationLane | undefined {
  return lanes?.find((lane) => lane.enabled && lane.points.length > 0 && lane.target.kind === kind && lane.target.sendId === sendId);
}

function mixToRoute(
  master: AudioData,
  busBuffers: Map<string, AudioData>,
  outputId: string | undefined,
  audio: AudioData,
  channels: number,
  sourceBusId?: Bus["id"],
): void {
  const route = outputId ?? MASTER_BUS_ID;
  if (route !== MASTER_BUS_ID && route !== sourceBusId) {
    const target = busBuffers.get(route);
    if (target) {
      mixInto(target, setChannelCount(audio, channels), 0);
      return;
    }
  }
  mixInto(master, setChannelCount(audio, channels), 0);
}
