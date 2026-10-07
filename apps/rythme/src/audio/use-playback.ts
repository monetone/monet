// ─────────────────────────────────────────────────────────────
// audio/use-playback — transport control bound to the store
// ─────────────────────────────────────────────────────────────
// One PlaybackEngine per store (reused across components). Play/stop/toggle
// keep the store's transport state and playhead in sync.

import { setPlayhead, setPlaying, type RythmeStore } from "../engine";
import { PlaybackEngine } from "./playback";

const engines = new WeakMap<RythmeStore, PlaybackEngine>();

export function getPlayback(store: RythmeStore): PlaybackEngine {
  let e = engines.get(store);
  if (!e) {
    e = new PlaybackEngine(() => store.getState().project);
    engines.set(store, e);
  }
  return e;
}

export function play(store: RythmeStore): void {
  const e = getPlayback(store);
  const s = store.getState();
  store.dispatch(setPlaying(true), { history: false });
  e.play(s.transport.playhead, {
    loop: s.transport.loopEnabled ? s.transport.loop : null,
    onTick: (t) => store.dispatch(setPlayhead(t), { history: false }),
    onEnd: () => store.dispatch(setPlaying(false), { history: false }),
  });
}

export function stop(store: RythmeStore): void {
  getPlayback(store).stop();
  store.dispatch(setPlaying(false), { history: false });
}

export function togglePlay(store: RythmeStore): void {
  if (getPlayback(store).playing) stop(store);
  else play(store);
}

/** Stop and return the playhead to the start (or selection start). */
export function returnToZero(store: RythmeStore): void {
  stop(store);
  const s = store.getState();
  store.dispatch(setPlayhead(s.selection.range ? s.selection.range.start : 0), { history: false });
}
