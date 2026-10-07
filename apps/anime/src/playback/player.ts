// playback/player — wall-clock rAF transport. Advances the (seconds) playhead
// from real elapsed time so it stays accurate under frame drops; loops or stops
// at the composition extent. The viewport samples the playhead each frame.

import { activeComp } from "../model/query";
import { compExtent } from "../model/sample";
import { store } from "../state/store";

class Player {
  private raf = 0;
  private startWall = 0;
  private startTime = 0;

  start(): void {
    this.resync();
    const tick = () => {
      const s = store.getState();
      const comp = activeComp(s.project);
      const extent = Math.max(0.001, compExtent(comp));
      let t = this.startTime + (performance.now() - this.startWall) / 1000;
      if (t >= extent) {
        if (s.loop) {
          t = t % extent;
          this.startWall = performance.now();
          this.startTime = t;
        } else {
          store.setPlayhead(extent);
          store.setPlaying(false);
          return;
        }
      }
      store.setPlayhead(t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Re-anchor to the current playhead (after a scrub while playing). */
  resync(): void {
    this.startWall = performance.now();
    this.startTime = store.getState().playhead;
  }
}

export const player = new Player();
