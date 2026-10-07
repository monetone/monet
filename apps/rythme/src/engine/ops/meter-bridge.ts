import { createAudioData, mixInto, setChannelCount, sliceFrames } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { analyzeLevels, channelStats, type LevelStats } from "../analysis/levels";
import { busAudible, projectDuration, trackAudible } from "../model/query";
import { MASTER_BUS_ID, type AutomationLane, type AutomationMode, type Bus, type Project, type Send } from "../model/types";
import { applyChannelControls, applyEffectRack, applyGainAutomation, applyPanAutomation } from "./rack";
import { renderTrack } from "./render";

export interface MeterBridgeEntry {
  kind: "track" | "bus" | "master" | "tap";
  id: string;
  name: string;
  color?: string;
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  clippedSamples: number;
  channels: LevelStats[];
  audible: boolean;
  peakHold: MeterBridgePeakHold;
}

export interface MeterBridgeTapEntry extends MeterBridgeEntry {
  kind: "tap";
  ownerKind: "track" | "bus" | "master";
  ownerId: string;
  tapKind: "input" | "postRack" | "send";
  sendId?: string;
  targetBusId?: string;
  preFader?: boolean;
}

export interface MeterBridgePeakHold {
  peak: number;
  peakDb: number;
  remainingMs: number;
  expiresAtMs?: number;
}

export interface MeterBridgeSnapshot {
  atSec: number;
  windowSec: number;
  sampleRate: number;
  channelCount: number;
  meterCalibrationDb: number;
  meterPeakHoldMs: number;
  tracks: MeterBridgeEntry[];
  buses: MeterBridgeEntry[];
  master: MeterBridgeEntry;
  taps: MeterBridgeTapEntry[];
}

export interface MeterBridgeOptions {
  atSec?: number;
  windowSec?: number;
  channelCount?: number;
  meterCalibrationDb?: number;
  meterPeakHoldMs?: number;
}

export interface MeterBridgePeakHoldOptions {
  nowMs?: number;
  holdMs?: number;
}

export function measureMeterBridge(project: Project, opts: MeterBridgeOptions = {}): MeterBridgeSnapshot {
  const sr = project.sampleRate;
  const atSec = Math.max(0, finiteOr(opts.atSec, 0));
  const windowSec = Math.max(0.01, Math.min(10, finiteOr(opts.windowSec, 0.25)));
  const frames = Math.max(1, Math.round(Math.max(projectDuration(project), atSec + windowSec) * sr));
  const channels = outputChannelCount(project, opts.channelCount);
  const meterCalibrationDb = Math.max(-60, Math.min(60, finiteOr(opts.meterCalibrationDb, project.audioHardware?.meterCalibrationDb ?? 0)));
  const meterPeakHoldMs = Math.round(Math.max(0, Math.min(10000, finiteOr(opts.meterPeakHoldMs, project.audioHardware?.meterPeakHoldMs ?? 1200))));
  const startFrame = Math.round(atSec * sr);
  const endFrame = Math.max(startFrame + 1, Math.round((atSec + windowSec) * sr));
  const masterPre = createAudioData(channels, frames, sr);
  const busBuffers = new Map<string, AudioData>();
  const taps: MeterBridgeTapEntry[] = [];
  const buses = project.buses ?? [];
  for (const bus of buses) busBuffers.set(bus.id, createAudioData(channels, frames, sr));

  const tracks: MeterBridgeEntry[] = project.tracks.map((track) => {
    const audible = trackAudible(project, track);
    const raw = audible ? renderTrack(track, sr, channels) : createAudioData(channels, frames, sr);
    const automation = readableAutomation(track.automationMode, track.automation);
    const preFader = applyEffectRack(raw, track.effectRack, { automation });
    taps.push(tapEntry("track", track.id, `${track.name} input`, "input", track.color, raw, startFrame, endFrame, audible, meterCalibrationDb));
    taps.push(tapEntry("track", track.id, `${track.name} post rack`, "postRack", track.color, preFader, startFrame, endFrame, audible, meterCalibrationDb));
    const postFader = audible
      ? applyChannelControls(preFader, { gainDb: track.gainDb, pan: track.pan, automation })
      : createAudioData(channels, frames, sr);
    if (audible) {
      mixSends(preFader, postFader, track.sends, busBuffers, channels, automation, {
        ownerKind: "track",
        ownerId: track.id,
        ownerName: track.name,
        color: track.color,
        startFrame,
        endFrame,
        meterCalibrationDb,
        taps,
      });
      mixToRoute(masterPre, busBuffers, track.outputId, postFader, channels);
    }
    return meterEntry("track", track.id, track.name, track.color, postFader, startFrame, endFrame, audible, meterCalibrationDb);
  });

  const busEntries: MeterBridgeEntry[] = buses.map((bus) => {
    const raw = busBuffers.get(bus.id) ?? createAudioData(channels, frames, sr);
    const audible = busAudible(project, bus);
    const automation = readableAutomation(bus.automationMode, bus.automation);
    const preFader = applyEffectRack(raw, bus.effectRack, { automation });
    taps.push(tapEntry("bus", bus.id, `${bus.name} input`, "input", bus.color, raw, startFrame, endFrame, audible, meterCalibrationDb));
    taps.push(tapEntry("bus", bus.id, `${bus.name} post rack`, "postRack", bus.color, preFader, startFrame, endFrame, audible, meterCalibrationDb));
    const postFader = audible
      ? applyChannelControls(preFader, { gainDb: bus.gainDb, pan: bus.pan, automation })
      : createAudioData(channels, frames, sr);
    if (audible) {
      mixSends(preFader, postFader, bus.sends, busBuffers, channels, automation, {
        ownerKind: "bus",
        ownerId: bus.id,
        ownerName: bus.name,
        color: bus.color,
        startFrame,
        endFrame,
        meterCalibrationDb,
        taps,
      });
      mixToRoute(masterPre, busBuffers, bus.outputId, postFader, channels, bus.id);
    }
    return meterEntry("bus", bus.id, bus.name, bus.color, postFader, startFrame, endFrame, audible, meterCalibrationDb);
  });

  const masterAutomation = readableAutomation(project.masterAutomationMode, project.masterAutomation);
  let mastered = applyEffectRack(masterPre, project.masterEffectRack, { automation: masterAutomation });
  taps.push(tapEntry("master", MASTER_BUS_ID, "Master input", "input", undefined, masterPre, startFrame, endFrame, true, meterCalibrationDb));
  taps.push(tapEntry("master", MASTER_BUS_ID, "Master post rack", "postRack", undefined, mastered, startFrame, endFrame, true, meterCalibrationDb));
  mastered = applyChannelControls(mastered, { gainDb: project.masterGainDb, pan: 0, automation: masterAutomation });
  const master = meterEntry("master", MASTER_BUS_ID, "Master", undefined, mastered, startFrame, endFrame, true, meterCalibrationDb);

  return { atSec, windowSec, sampleRate: sr, channelCount: channels, meterCalibrationDb, meterPeakHoldMs, tracks, buses: busEntries, master, taps };
}

export function applyMeterBridgePeakHold(
  snapshot: MeterBridgeSnapshot,
  previous: MeterBridgeSnapshot | null | undefined,
  opts: MeterBridgePeakHoldOptions = {},
): MeterBridgeSnapshot {
  const nowMs = Math.max(0, finiteOr(opts.nowMs, Date.now()));
  const holdMs = Math.round(Math.max(0, Math.min(10000, finiteOr(opts.holdMs, snapshot.meterPeakHoldMs))));
  const previousTracks = new Map((previous?.tracks ?? []).map((entry) => [entry.id, entry]));
  const previousBuses = new Map((previous?.buses ?? []).map((entry) => [entry.id, entry]));
  const previousTaps = new Map((previous?.taps ?? []).map((entry) => [entry.id, entry]));
  return {
    ...snapshot,
    meterPeakHoldMs: holdMs,
    tracks: snapshot.tracks.map((entry) => applyEntryPeakHold(entry, previousTracks.get(entry.id), nowMs, holdMs)),
    buses: snapshot.buses.map((entry) => applyEntryPeakHold(entry, previousBuses.get(entry.id), nowMs, holdMs)),
    master: applyEntryPeakHold(snapshot.master, previous?.master, nowMs, holdMs),
    taps: snapshot.taps.map((entry) => applyEntryPeakHold(entry, previousTaps.get(entry.id), nowMs, holdMs) as MeterBridgeTapEntry),
  };
}

function meterEntry(
  kind: MeterBridgeEntry["kind"],
  id: string,
  name: string,
  color: string | undefined,
  audio: AudioData,
  startFrame: number,
  endFrame: number,
  audible: boolean,
  meterCalibrationDb: number,
): MeterBridgeEntry {
  const window = windowOrSilence(audio, startFrame, endFrame);
  const levels = analyzeLevels(window);
  const stats = calibrateStats(levels, meterCalibrationDb);
  return {
    kind,
    id,
    name,
    color,
    peak: stats.peak,
    peakDb: stats.peakDb,
    rms: stats.rms,
    rmsDb: stats.rmsDb,
    clippedSamples: stats.clippedSamples,
    channels: window.channels.map((channel) => calibrateStats(channelStats(channel), meterCalibrationDb)),
    audible,
    peakHold: { peak: stats.peak, peakDb: stats.peakDb, remainingMs: 0 },
  };
}

function tapEntry(
  ownerKind: MeterBridgeTapEntry["ownerKind"],
  ownerId: string,
  name: string,
  tapKind: MeterBridgeTapEntry["tapKind"],
  color: string | undefined,
  audio: AudioData,
  startFrame: number,
  endFrame: number,
  audible: boolean,
  meterCalibrationDb: number,
  send?: Send,
): MeterBridgeTapEntry {
  const id = meterTapId(ownerKind, ownerId, tapKind, send?.id);
  return {
    ...meterEntry("tap", id, name, color, audio, startFrame, endFrame, audible, meterCalibrationDb),
    kind: "tap",
    ownerKind,
    ownerId,
    tapKind,
    ...(send ? { sendId: send.id, targetBusId: send.targetBusId, preFader: send.preFader } : {}),
  };
}

export function meterTapId(ownerKind: MeterBridgeTapEntry["ownerKind"], ownerId: string, tapKind: MeterBridgeTapEntry["tapKind"], sendId?: string): string {
  return `${ownerKind}:${ownerId}:${tapKind}${sendId ? `:${sendId}` : ""}`;
}

function applyEntryPeakHold(entry: MeterBridgeEntry, previous: MeterBridgeEntry | undefined, nowMs: number, holdMs: number): MeterBridgeEntry {
  if (holdMs <= 0) return { ...entry, peakHold: { peak: entry.peak, peakDb: entry.peakDb, remainingMs: 0 } };
  const previousHold = previous?.peakHold;
  const previousExpiresAtMs = previousHold?.expiresAtMs ?? 0;
  if (previousHold && previousHold.peak > entry.peak && previousExpiresAtMs > nowMs) {
    return {
      ...entry,
      peakHold: {
        peak: previousHold.peak,
        peakDb: previousHold.peakDb,
        remainingMs: Math.round(Math.max(0, previousExpiresAtMs - nowMs)),
        expiresAtMs: previousExpiresAtMs,
      },
    };
  }
  return {
    ...entry,
    peakHold: {
      peak: entry.peak,
      peakDb: entry.peakDb,
      remainingMs: holdMs,
      expiresAtMs: nowMs + holdMs,
    },
  };
}

function calibrateStats(stats: LevelStats, meterCalibrationDb: number): LevelStats {
  return {
    ...stats,
    peakDb: stats.peak > 0 ? stats.peakDb + meterCalibrationDb : stats.peakDb,
    rmsDb: stats.rms > 0 ? stats.rmsDb + meterCalibrationDb : stats.rmsDb,
  };
}

function windowOrSilence(audio: AudioData, startFrame: number, endFrame: number): AudioData {
  const channels = Math.max(1, audio.channels.length);
  const frames = Math.max(1, endFrame - startFrame);
  if (startFrame >= frameCount(audio)) return createAudioData(channels, frames, audio.sampleRate);
  const sliced = sliceFrames(audio, startFrame, endFrame);
  if (frameCount(sliced) === frames) return sliced;
  const padded = createAudioData(channels, frames, audio.sampleRate);
  for (let c = 0; c < Math.min(channels, sliced.channels.length); c++) padded.channels[c].set(sliced.channels[c]);
  return padded;
}

function mixSends(
  preFader: AudioData,
  postFader: AudioData,
  sends: Send[] | undefined,
  busBuffers: Map<string, AudioData>,
  channels: number,
  automation?: AutomationLane[],
  meter?: {
    ownerKind: MeterBridgeTapEntry["ownerKind"];
    ownerId: string;
    ownerName: string;
    color?: string;
    startFrame: number;
    endFrame: number;
    meterCalibrationDb: number;
    taps: MeterBridgeTapEntry[];
  },
): void {
  for (const send of sends ?? []) {
    if (!send.enabled) continue;
    const target = busBuffers.get(send.targetBusId);
    if (!target) continue;
    let sent = setChannelCount(send.preFader ? preFader : postFader, channels);
    sent = applyPanAutomation(sent, activeSendAutomationLane(automation, send.id, "sendPan"), 0, send.pan);
    sent = applyGainAutomation(sent, activeSendAutomationLane(automation, send.id, "sendGainDb"), 0, send.gainDb);
    meter?.taps.push(tapEntry(meter.ownerKind, meter.ownerId, `${meter.ownerName} send ${send.name}`, "send", meter.color, sent, meter.startFrame, meter.endFrame, true, meter.meterCalibrationDb, send));
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

function outputChannelCount(project: Project, override: number | undefined): number {
  const value = override ?? project.channelCount ?? 2;
  return Math.max(1, Math.min(8, Math.round(Number.isFinite(value) ? value : 2)));
}

function readableAutomation(mode: AutomationMode | undefined, lanes: AutomationLane[] | undefined): AutomationLane[] | undefined {
  return mode === "off" ? undefined : lanes;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
