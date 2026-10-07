// ─────────────────────────────────────────────────────────────
// dsp/remix — duration-targeted music bed remix
// ─────────────────────────────────────────────────────────────
// A deterministic, offline Remix primitive: extend by looping with short
// crossfades; shorten by keeping the head and crossfading into the tail. It is
// intentionally conservative, but gives the editor a real duration-targeted
// operation instead of only speed/stretch tools.

import { cloneAudioData, createAudioData, sliceFrames } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";

export interface RemixToDurationOptions {
  crossfadeMs?: number;
}

export function remixToDuration(audio: AudioData, targetSeconds: number, opts: RemixToDurationOptions = {}): AudioData {
  const targetFrames = Math.max(0, Math.round((Number.isFinite(targetSeconds) ? targetSeconds : 0) * audio.sampleRate));
  const sourceFrames = frameCount(audio);
  if (targetFrames === sourceFrames) return cloneAudioData(audio);
  if (targetFrames === 0 || sourceFrames === 0) return createAudioData(Math.max(1, channelCount(audio)), targetFrames, audio.sampleRate);
  const fadeFrames = remixFadeFrames(audio, targetFrames, opts.crossfadeMs ?? 120);
  if (targetFrames < sourceFrames) return shortenWithTail(audio, targetFrames, fadeFrames);
  return extendWithLoops(audio, targetFrames, fadeFrames);
}

function shortenWithTail(audio: AudioData, targetFrames: number, fadeFrames: number): AudioData {
  if (fadeFrames <= 0 || targetFrames <= fadeFrames) return sliceFrames(audio, 0, targetFrames);
  const out = createAudioData(channelCount(audio), targetFrames, audio.sampleRate);
  const headFrames = targetFrames - fadeFrames;
  const tailStart = frameCount(audio) - fadeFrames;
  for (let c = 0; c < channelCount(audio); c++) {
    const src = audio.channels[c];
    const dst = out.channels[c];
    dst.set(src.subarray(0, headFrames));
    for (let i = 0; i < fadeFrames; i++) {
      const t = (i + 1) / (fadeFrames + 1);
      dst[headFrames + i] = src[headFrames + i] * (1 - t) + src[tailStart + i] * t;
    }
  }
  return out;
}

function extendWithLoops(audio: AudioData, targetFrames: number, fadeFrames: number): AudioData {
  const out = createAudioData(channelCount(audio), targetFrames, audio.sampleRate);
  const sourceFrames = frameCount(audio);
  let write = Math.min(sourceFrames, targetFrames);
  for (let c = 0; c < channelCount(audio); c++) out.channels[c].set(audio.channels[c].subarray(0, write));

  while (write < targetFrames) {
    const overlap = Math.min(fadeFrames, write, sourceFrames - 1);
    const start = write - overlap;
    const copyFrames = Math.min(sourceFrames, targetFrames - start);
    for (let c = 0; c < channelCount(audio); c++) {
      const src = audio.channels[c];
      const dst = out.channels[c];
      for (let i = 0; i < copyFrames; i++) {
        const j = start + i;
        if (i < overlap) {
          const t = (i + 1) / (overlap + 1);
          dst[j] = dst[j] * (1 - t) + src[i] * t;
        } else {
          dst[j] = src[i];
        }
      }
    }
    write = start + copyFrames;
  }
  return out;
}

function remixFadeFrames(audio: AudioData, targetFrames: number, crossfadeMs: number): number {
  const requested = Math.max(0, Math.round((Number.isFinite(crossfadeMs) ? crossfadeMs : 0) * audio.sampleRate / 1000));
  const limit = Math.max(0, Math.floor(Math.min(frameCount(audio), targetFrames) / 4));
  return Math.min(requested, limit);
}
