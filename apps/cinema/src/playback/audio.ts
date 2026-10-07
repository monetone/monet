// ─────────────────────────────────────────────────────────────
// audio.ts — the Web Audio mix graph. `scheduleMix` schedules every audible
// audio clip from a start frame onward as a BufferSource → per-clip gain
// (clip gain + fades) → per-track gain (track level, mute/solo) → a destination
// node. Live playback runs it against the shared AudioContext's clock so
// picture and sound share a timebase; `renderMix` runs the *same* graph in an
// OfflineAudioContext so the baked MP4 export hears exactly what playback does.
// Reverse / shuttle (rate ≠ 1) skips audio. Re-scheduled on seek; torn down on
// stop.
// ─────────────────────────────────────────────────────────────

import { audioContext, getAudioBuffer, getBufferSync } from "../media/audio-buffers";
import { getHandle } from "../media/registry";
import { store } from "../state/app";
import { activeSequence, audioTracks, findMedia } from "../timeline/model/query";
import type { Sequence, Track } from "../timeline/model/types";

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Decode every buffer the sequence's audio clips reference (idempotent + cached). */
async function prefetchBuffers(tracks: Track[]): Promise<void> {
  await Promise.all(
    tracks.flatMap((t) =>
      t.clips.map((c) => {
        const url = getHandle(c.mediaId)?.objectUrl;
        return url ? getAudioBuffer(c.mediaId, url) : Promise.resolve(null);
      }),
    ),
  );
}

/**
 * Build the mix graph for `seq` into `dest`, playing from `fromFrame` and
 * treating context time `base` as that frame. Returns the started sources so
 * live playback can stop them. Shared by playback and offline export render.
 */
function scheduleMix(
  ctx: BaseAudioContext,
  dest: AudioNode,
  seq: Sequence,
  fromFrame: number,
  base: number,
): AudioBufferSourceNode[] {
  const started: AudioBufferSourceNode[] = [];
  const fps = seq.fps || 24;
  const playSec = fromFrame / fps;
  const tracks = audioTracks(seq);
  const soloed = tracks.some((t) => t.solo);
  // Timeline seconds → context seconds.
  const tAt = (sec: number) => Math.max(0, base + (sec - playSec));

  for (const track of tracks) {
    if (track.muted || (soloed && !track.solo)) continue;
    const trackGain = ctx.createGain();
    trackGain.gain.value = dbToGain(track.gain);
    trackGain.connect(dest);

    for (const clip of track.clips) {
      if (!clip.enabled) continue;
      const clipStartSec = clip.start / fps;
      const clipEndSec = (clip.start + clip.duration) / fps;
      if (clipEndSec <= playSec) continue;
      const buf = getBufferSync(clip.mediaId);
      if (!buf) continue;
      const media = findMedia(store.getProject(), clip.mediaId);
      const mediaFps = media?.fps || fps;
      const speed = Math.abs(clip.speed) || 1;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = speed;
      const g = ctx.createGain();
      const level = dbToGain(clip.audioGain);
      g.gain.value = level;
      src.connect(g);
      g.connect(trackGain);

      // Fades are timeline-length ramps (speed-independent), so they ride the
      // clip gain rather than the source. A clip we join mid-fade starts at the
      // partial value.
      const fadeInSec = clip.fadeInFrames / fps;
      const fadeOutSec = clip.fadeOutFrames / fps;
      if (fadeInSec > 0) {
        const from = Math.max(playSec, clipStartSec);
        const frac = Math.min(1, (from - clipStartSec) / fadeInSec);
        if (frac < 1) {
          g.gain.setValueAtTime(level * frac, tAt(from));
          g.gain.linearRampToValueAtTime(level, tAt(clipStartSec + fadeInSec));
        }
      }
      if (fadeOutSec > 0) {
        const from = Math.max(playSec, clipEndSec - fadeOutSec);
        const frac = Math.min(1, (clipEndSec - from) / fadeOutSec);
        g.gain.setValueAtTime(level * frac, tAt(from));
        g.gain.linearRampToValueAtTime(0, tAt(clipEndSec));
      }

      const sourceInSec = clip.inPoint / mediaFps;
      let when: number;
      let offset: number;
      let duration: number;
      if (clipStartSec >= playSec) {
        when = base + (clipStartSec - playSec);
        offset = sourceInSec;
        duration = clip.duration / fps;
      } else {
        when = base;
        const intoSec = playSec - clipStartSec;
        offset = sourceInSec + intoSec * speed;
        duration = clipEndSec - playSec;
      }
      try {
        src.start(when, Math.max(0, offset), Math.max(0.001, duration * speed));
        started.push(src);
      } catch {
        /* start() can throw if offset is past the buffer end */
      }
    }
  }
  return started;
}

/**
 * Render the sequence's audio mix offline to a single AudioBuffer, for baking
 * audio into an export. Returns null when nothing audible is scheduled.
 */
export async function renderMix(seq: Sequence, durationFrames: number): Promise<AudioBuffer | null> {
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Offline) return null;
  const fps = seq.fps || 24;
  const seconds = durationFrames / fps;
  if (!(seconds > 0)) return null;

  const tracks = audioTracks(seq);
  if (!tracks.some((t) => t.clips.length)) return null;
  await prefetchBuffers(tracks);

  // ponytail: fixed 48 kHz stereo render target — the source nodes resample any
  // buffer into it. Match the source rate here if bit-exact passthrough matters.
  const sampleRate = 48_000;
  const ctx = new Offline(2, Math.ceil(seconds * sampleRate), sampleRate);
  if (!scheduleMix(ctx, ctx.destination, seq, 0, 0).length) return null;
  return ctx.startRendering();
}

class AudioEngine {
  private sources: AudioBufferSourceNode[] = [];
  private master: GainNode | null = null;

  async start(playheadFrame: number): Promise<void> {
    this.stop();
    if ((store.state.rate || 1) !== 1) return; // only normal-speed playback gets audio
    const seq = activeSequence(store.getProject());
    if (!seq) return;
    const ctx = audioContext();
    try {
      await ctx.resume();
    } catch {
      /* resume may reject before a user gesture */
    }

    // Prefetch the buffers we may need this session.
    await prefetchBuffers(audioTracks(seq));

    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.master = master;
    this.sources = scheduleMix(ctx, master, seq, playheadFrame, ctx.currentTime + 0.06);
  }

  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    if (this.master) {
      this.master.disconnect();
      this.master = null;
    }
  }
}

export const audioEngine = new AudioEngine();
