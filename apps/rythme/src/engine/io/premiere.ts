// ─────────────────────────────────────────────────────────────
// engine/io/premiere — Premiere-friendly timeline interchange
// ─────────────────────────────────────────────────────────────
// Adobe Premiere imports CMX-style EDLs and Final Cut Pro 7 XML. These exports
// carry Rythme's multitrack clip timing, names, track grouping, sample-rate /
// channel settings, and markers. Audio media itself is not embedded here; use
// this alongside WAV/AIFF stem export when handing a session to an NLE.

import { durationSeconds } from "../audio/types";
import { clipEnd, projectDuration } from "../model/query";
import type { Clip, Marker, Project, Track } from "../model/types";

export interface PremiereInterchangeOptions {
  /** Non-drop-frame timebase for the interchange file. Defaults to 30 fps. */
  frameRate?: number;
  /** Include muted/disabled tracks and clips in the timeline text. Default false. */
  includeMuted?: boolean;
}

interface ClipEvent {
  clip: Clip;
  track: Track;
  trackIndex: number;
}

export function exportPremiereEdl(project: Project, opts: PremiereInterchangeOptions = {}): string {
  const fps = normalizedFrameRate(opts.frameRate);
  const events = timelineClipEvents(project, opts);
  const lines: string[] = [
    `TITLE: ${edlText(project.name)}`,
    "FCM: NON-DROP FRAME",
    `* SAMPLE RATE: ${project.sampleRate}`,
    `* CHANNELS: ${project.channelCount}`,
  ];

  for (const marker of sortedMarkers(project.markers)) {
    const end = marker.end != null && marker.end > marker.time ? ` - ${secondsToTimecode(marker.end, fps)}` : "";
    lines.push(`* MARKER: ${secondsToTimecode(marker.time, fps)}${end} ${edlText(marker.name)}`);
  }
  if (project.markers.length) lines.push("");

  events.forEach((event, i) => {
    const reel = reelName(event.clip, event.trackIndex);
    const srcIn = secondsToTimecode(event.clip.inPoint, fps);
    const srcOut = secondsToTimecode(event.clip.inPoint + event.clip.duration, fps);
    const recIn = secondsToTimecode(event.clip.start, fps);
    const recOut = secondsToTimecode(clipEnd(event.clip), fps);
    lines.push(`${String(i + 1).padStart(3, "0")}  ${reel.padEnd(8, " ")} A     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    lines.push(`* FROM CLIP NAME: ${edlText(event.clip.name)}`);
    lines.push(`* TRACK: ${edlText(event.track.name)}`);
  });

  return `${lines.join("\n")}\n`;
}

export function exportPremiereXml(project: Project, opts: PremiereInterchangeOptions = {}): string {
  const fps = normalizedFrameRate(opts.frameRate);
  const duration = secondsToFrames(projectDuration(project), fps);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE xmeml>",
    '<xmeml version="5">',
    '  <sequence id="sequence-1">',
    `    <name>${xmlText(project.name)}</name>`,
    rateXml(fps, 2),
    `    <duration>${duration}</duration>`,
    "    <timecode>",
    rateXml(fps, 3),
    "      <string>00:00:00:00</string>",
    "      <frame>0</frame>",
    "      <displayformat>NDF</displayformat>",
    "    </timecode>",
    "    <media>",
    "      <audio>",
    `        <numOutputChannels>${project.channelCount}</numOutputChannels>`,
    "        <format>",
    "          <samplecharacteristics>",
    "            <depth>32</depth>",
    `            <samplerate>${project.sampleRate}</samplerate>`,
    "          </samplecharacteristics>",
    "        </format>",
  ];

  project.tracks.forEach((track, trackIndex) => {
    if (!opts.includeMuted && track.mute) return;
    const clips = track.clips.filter((clip) => opts.includeMuted || (!clip.muted && clip.enabled));
    if (!clips.length) return;
    lines.push(`        <track id="${xmlAttr(xmlId(track.id, `track-${trackIndex + 1}`))}">`);
    lines.push(`          <name>${xmlText(track.name)}</name>`);
    for (const clip of clips) lines.push(clipXml(clip, track, trackIndex, fps, project.sampleRate));
    lines.push("        </track>");
  });

  lines.push("      </audio>");
  lines.push("    </media>");

  for (const marker of sortedMarkers(project.markers)) lines.push(markerXml(marker, fps));

  lines.push("  </sequence>");
  lines.push("</xmeml>");
  return `${lines.join("\n")}\n`;
}

export function secondsToFrames(seconds: number, frameRate = 30): number {
  return Math.max(0, Math.round(Math.max(0, finiteOr(seconds, 0)) * normalizedFrameRate(frameRate)));
}

export function secondsToTimecode(seconds: number, frameRate = 30): string {
  return framesToTimecode(secondsToFrames(seconds, frameRate), frameRate);
}

export function framesToTimecode(frames: number, frameRate = 30): string {
  const fps = normalizedFrameRate(frameRate);
  let rest = Math.max(0, Math.round(frames));
  const ff = rest % fps;
  rest = Math.floor(rest / fps);
  const ss = rest % 60;
  rest = Math.floor(rest / 60);
  const mm = rest % 60;
  const hh = Math.floor(rest / 60);
  return [hh, mm, ss, ff].map((n) => String(n).padStart(2, "0")).join(":");
}

function timelineClipEvents(project: Project, opts: PremiereInterchangeOptions): ClipEvent[] {
  const events: ClipEvent[] = [];
  project.tracks.forEach((track, trackIndex) => {
    if (!opts.includeMuted && track.mute) return;
    for (const clip of track.clips) {
      if (!opts.includeMuted && (clip.muted || !clip.enabled)) continue;
      events.push({ clip, track, trackIndex });
    }
  });
  return events.sort((a, b) => a.clip.start - b.clip.start || a.trackIndex - b.trackIndex || a.clip.name.localeCompare(b.clip.name));
}

function clipXml(clip: Clip, track: Track, trackIndex: number, fps: number, sampleRate: number): string {
  const start = secondsToFrames(clip.start, fps);
  const end = secondsToFrames(clipEnd(clip), fps);
  const srcIn = secondsToFrames(clip.inPoint, fps);
  const srcOut = secondsToFrames(clip.inPoint + clip.duration, fps);
  const sourceDuration = secondsToFrames(durationSeconds(clip.buffer), fps);
  const clipId = xmlId(clip.id, `clip-${trackIndex + 1}-${start}`);
  const fileId = xmlId(`file-${clip.id}`, `file-${trackIndex + 1}-${start}`);
  return [
    `          <clipitem id="${xmlAttr(clipId)}">`,
    `            <name>${xmlText(clip.name)}</name>`,
    "            <enabled>TRUE</enabled>",
    `            <start>${start}</start>`,
    `            <end>${end}</end>`,
    `            <in>${srcIn}</in>`,
    `            <out>${srcOut}</out>`,
    `            <file id="${xmlAttr(fileId)}">`,
    `              <name>${xmlText(clip.name)}</name>`,
    rateXml(fps, 7),
    `              <duration>${sourceDuration}</duration>`,
    "              <media>",
    "                <audio>",
    "                  <samplecharacteristics>",
    "                    <depth>32</depth>",
    `                    <samplerate>${sampleRate}</samplerate>`,
    "                  </samplecharacteristics>",
    `                  <channelcount>${clip.buffer.channels.length}</channelcount>`,
    "                </audio>",
    "              </media>",
    "            </file>",
    `            <comments>Rythme track: ${xmlText(track.name)}</comments>`,
    "          </clipitem>",
  ].join("\n");
}

function markerXml(marker: Marker, fps: number): string {
  const at = secondsToFrames(marker.time, fps);
  const out = marker.end != null && marker.end > marker.time ? secondsToFrames(marker.end, fps) : -1;
  return [
    "    <marker>",
    `      <name>${xmlText(marker.name)}</name>`,
    `      <in>${at}</in>`,
    `      <out>${out}</out>`,
    "    </marker>",
  ].join("\n");
}

function sortedMarkers(markers: Marker[]): Marker[] {
  return [...markers].sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
}

function rateXml(fps: number, indent: number): string {
  const sp = " ".repeat(indent * 2);
  return [`${sp}<rate>`, `${sp}  <timebase>${fps}</timebase>`, `${sp}  <ntsc>FALSE</ntsc>`, `${sp}</rate>`].join("\n");
}

function normalizedFrameRate(frameRate = 30): number {
  return Math.max(1, Math.round(finiteOr(frameRate, 30)));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function reelName(clip: Clip, trackIndex: number): string {
  const raw = (clip.name || clip.id || `T${trackIndex + 1}`).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (raw || `T${trackIndex + 1}`).slice(0, 8);
}

function edlText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function xmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlAttr(value: string): string {
  return xmlText(value).replace(/"/g, "&quot;");
}

function xmlId(value: string, fallback: string): string {
  const clean = value.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(clean) ? clean : fallback;
}
