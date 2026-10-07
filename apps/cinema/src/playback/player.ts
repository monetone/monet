// ─────────────────────────────────────────────────────────────
// player.ts — the transport runtime. A wall-clock RAF loop advances the
// playhead at sequence fps × rate, schedules video decodes ahead of the
// playhead, and stops/loops at the sequence end. The ProgramMonitor renders
// each playhead change from cached frames; smoothness is bounded by the
// seek-decoder (WebCodecs is the realtime upgrade — see AGENTS.md).
//
// NOTE: synced audio playback is a follow-up; this drives the picture.
// ─────────────────────────────────────────────────────────────

import { store } from "../state/app";
import { activeSequence, sequenceDuration } from "../timeline/model/query";
import { livePlaybackTick, pausePlaybackElements } from "../media/decoder";
import { audioEngine } from "./audio";

class Player {
  private raf = 0;
  private startWall = 0;
  private startFrame = 0;

  get running(): boolean {
    return this.raf !== 0;
  }

  start(): void {
    if (this.raf) return;
    const seq = activeSequence(store.getProject());
    if (!seq) return;
    const fps = seq.fps || 24;
    this.startFrame = store.state.playhead;
    this.startWall = performance.now();
    void audioEngine.start(this.startFrame);

    const loop = () => {
      const seqNow = activeSequence(store.getProject());
      if (!seqNow) {
        this.stop();
        return;
      }
      const rate = store.state.rate || 1;
      const elapsed = (performance.now() - this.startWall) / 1000;
      let frame = this.startFrame + elapsed * fps * rate;
      const end = sequenceDuration(seqNow);

      if (frame >= end) {
        if (store.state.loop) {
          this.startFrame = store.state.inPoint ?? 0;
          this.startWall = performance.now();
          frame = this.startFrame;
        } else {
          store.setPlayhead(end);
          store.setPlaying(false);
          this.stop();
          return;
        }
      } else if (frame < 0) {
        frame = 0;
        this.startFrame = 0;
        this.startWall = performance.now();
      }

      store.setPlayhead(frame);
      livePlaybackTick(seqNow, Math.round(frame));
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    audioEngine.stop();
    pausePlaybackElements();
  }

  /** Re-sync the wall-clock anchor + reschedule audio (after a seek mid-play). */
  resync(): void {
    if (this.raf) {
      this.startFrame = store.state.playhead;
      this.startWall = performance.now();
      void audioEngine.start(this.startFrame);
    }
  }
}

export const player = new Player();
