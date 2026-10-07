// ─────────────────────────────────────────────────────────────
// audio/playback — Web Audio realtime transport
// ─────────────────────────────────────────────────────────────
// Builds a live audio graph from the project (one gain+pan per track into a
// master gain) and schedules every audible clip with sample-accurate timing.
// This is the only part of the app that touches the Web Audio API; it degrades
// to a no-op when no AudioContext is available (SSR / headless tests).

import {
  dbToGain,
  frameCount,
  MASTER_BUS_ID,
  Ops,
  trackAudible,
  type AudioData,
  type Project,
  type TimeRange,
} from "../engine";
import { applyAudioContextSink } from "./sink";

export interface PlayOptions {
  loop?: TimeRange | null;
  onTick?: (seconds: number) => void;
  onEnd?: () => void;
}

function hasAudio(): boolean {
  return typeof window !== "undefined" && typeof (window.AudioContext ?? (window as any).webkitAudioContext) !== "undefined";
}

export class PlaybackEngine {
  private ctx: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private startCtxTime = 0;
  private startOffset = 0;
  private raf = 0;
  private endSeconds = 0;
  private opts: PlayOptions = {};
  playing = false;

  constructor(private getProject: () => Project) {}

  private ensureCtx(): AudioContext | null {
    if (!hasAudio()) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  private toBuffer(ctx: AudioContext, d: AudioData): AudioBuffer {
    const channels = Math.max(1, d.channels.length);
    const frames = Math.max(1, frameCount(d));
    const buf = ctx.createBuffer(channels, frames, d.sampleRate);
    for (let c = 0; c < channels; c++) buf.getChannelData(c).set(d.channels[c] ?? new Float32Array(frames));
    return buf;
  }

  /** Start playback from `fromSeconds`. */
  play(fromSeconds: number, opts: PlayOptions = {}): void {
    const ctx = this.ensureCtx();
    this.stop();
    this.opts = opts;
    if (!ctx) {
      // headless: still report a (frozen) playing state so the UI reflects intent
      this.playing = true;
      this.startOffset = fromSeconds;
      return;
    }
    if (ctx.state === "suspended") void ctx.resume();

    const project = this.getProject();
    void applyAudioContextSink(ctx, project.audioHardware?.outputDeviceId);
    if (hasAdvancedSignalPath(project)) {
      this.playRenderedMix(ctx, project, fromSeconds, opts);
      return;
    }

    const master = ctx.createGain();
    master.gain.value = dbToGain(project.masterGainDb);
    master.connect(ctx.destination);

    let end = 0;
    for (const track of project.tracks) {
      if (!trackAudible(project, track)) continue;
      const tg = ctx.createGain();
      tg.gain.value = dbToGain(track.gainDb);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) {
        pan.pan.value = track.pan;
        tg.connect(pan);
        pan.connect(master);
      } else {
        tg.connect(master);
      }
      for (const clip of track.clips) {
        if (clip.muted) continue; // muted clips render silent in playback, matching the offline mix
        const audio = Ops.renderClip(clip);
        const dur = frameCount(audio) / audio.sampleRate;
        const when = clip.start - fromSeconds;
        const src = ctx.createBufferSource();
        src.buffer = this.toBuffer(ctx, audio);
        src.connect(tg);
        if (when >= 0) {
          src.start(ctx.currentTime + when);
          end = Math.max(end, clip.start + dur);
        } else if (-when < dur) {
          src.start(ctx.currentTime, -when);
          end = Math.max(end, clip.start + dur);
        } else {
          continue; // clip already finished before the start point
        }
        this.sources.push(src);
      }
    }

    this.startCtxTime = ctx.currentTime;
    this.startOffset = fromSeconds;
    this.endSeconds = opts.loop ? opts.loop.end : end;
    this.playing = true;
    this.tick();
  }

  private playRenderedMix(ctx: AudioContext, project: Project, fromSeconds: number, opts: PlayOptions): void {
    const mix = Ops.renderProject(project);
    const dur = frameCount(mix) / mix.sampleRate;
    if (fromSeconds < dur) {
      const src = ctx.createBufferSource();
      src.buffer = this.toBuffer(ctx, mix);
      src.connect(ctx.destination);
      src.start(ctx.currentTime, Math.max(0, fromSeconds));
      this.sources.push(src);
    }
    this.startCtxTime = ctx.currentTime;
    this.startOffset = fromSeconds;
    this.endSeconds = opts.loop ? opts.loop.end : dur;
    this.playing = true;
    this.tick();
  }

  private tick = (): void => {
    if (!this.playing) return;
    const pos = this.position();
    this.opts.onTick?.(pos);
    const loop = this.opts.loop;
    if (loop && pos >= loop.end) {
      this.play(loop.start, this.opts);
      return;
    }
    if (!loop && this.endSeconds > 0 && pos >= this.endSeconds) {
      this.stop();
      this.opts.onEnd?.();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Current playhead position in seconds. */
  position(): number {
    if (!this.playing || !this.ctx) return this.startOffset;
    return this.startOffset + (this.ctx.currentTime - this.startCtxTime);
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
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.playing = false;
  }

  dispose(): void {
    this.stop();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}

function hasAdvancedSignalPath(project: Project): boolean {
  if ((project.buses?.length ?? 0) > 0) return true;
  if (hasRack(project.masterEffectRack) || hasAutomation(project.masterAutomation)) return true;
  return project.tracks.some(
    (track) =>
      hasRack(track.effectRack) ||
      hasAutomation(track.automation) ||
      (track.outputId != null && track.outputId !== MASTER_BUS_ID) ||
      (track.sends ?? []).some((send) => send.enabled) ||
      track.clips.some((clip) => hasRack(clip.effectRack) || hasAutomation(clip.automation)),
  );
}

function hasRack(rack: Project["masterEffectRack"]): boolean {
  return !!rack && !rack.bypassed && rack.slots.some((slot) => slot.enabled);
}

function hasAutomation(lanes: Project["masterAutomation"]): boolean {
  return !!lanes && lanes.some((lane) => lane.enabled && lane.points.length > 0);
}
