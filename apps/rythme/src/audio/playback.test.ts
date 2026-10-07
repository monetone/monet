// ─────────────────────────────────────────────────────────────
// audio/playback.test — realtime transport honors clip mute
// ─────────────────────────────────────────────────────────────
// The live Web Audio path is a hand-rolled loop separate from the offline
// renderer, so it gets its own guard: a muted clip must not be scheduled.
// A tiny fake AudioContext counts the buffer sources the engine creates.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyProject, Generate, newBus, newClip, Ops } from "../engine";
import { PlaybackEngine } from "./playback";

const SR = 48000;

let lastCtx: FakeCtx | null = null;
let rafCb: (() => void) | null = null;

class FakeCtx {
  currentTime = 0;
  state = "running";
  sinkId = "default";
  sinkCalls: string[] = [];
  destination = {};
  sourceCount = 0;
  constructor() {
    // The app constructs this via `new window.AudioContext()`, so registering the
    // instance here is the only hook the test has; it is not a `const self = this`.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastCtx = this;
  }
  async setSinkId(sinkId: string) {
    this.sinkCalls.push(sinkId);
    this.sinkId = sinkId;
  }
  createGain() {
    return { gain: { value: 0 }, connect() {} };
  }
  createStereoPanner() {
    return { pan: { value: 0 }, connect() {} };
  }
  createBufferSource() {
    this.sourceCount++;
    return { buffer: null as unknown, connect() {}, start() {}, stop() {} };
  }
  createBuffer(channels: number, frames: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return { getChannelData: (c: number) => data[c] };
  }
  resume() {}
  close() {}
}

describe("PlaybackEngine clip mute", () => {
  beforeEach(() => {
    lastCtx = null;
    rafCb = null;
    (globalThis as { window?: unknown }).window = { AudioContext: FakeCtx };
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: () => void) => {
      rafCb = cb; // capture the tick so a test can drive it deterministically
      return 1;
    };
    (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {};
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
  });

  it("does not schedule a muted clip for playback, and reschedules it once un-muted", () => {
    let p = emptyProject("P", 1, SR);
    const tid = p.tracks[0].id;
    p = Ops.addClip(p, tid, newClip(Generate.sine(440, 0.1, { sampleRate: SR, channels: 2 }), { trackId: tid, start: 0, name: "audible" }));
    p = Ops.addClip(p, tid, newClip(Generate.sine(440, 0.1, { sampleRate: SR, channels: 2 }), { trackId: tid, start: 0, name: "muted" }));
    const mutedId = p.tracks[0].clips[1].id;
    p = Ops.setClipMuted(p, mutedId, true);

    const engine = new PlaybackEngine(() => p);
    engine.play(0);
    expect(lastCtx).not.toBeNull();
    expect(lastCtx!.sourceCount).toBe(1); // only the audible clip is scheduled
    engine.stop();

    p = Ops.setClipMuted(p, mutedId, false); // un-mute
    lastCtx!.sourceCount = 0;
    engine.play(0);
    expect(lastCtx!.sourceCount).toBe(2); // both clips now scheduled
    engine.dispose();
  });

  it("loops the region: reaching loop.end reschedules playback from loop.start", () => {
    let p = emptyProject("P", 1, SR);
    const tid = p.tracks[0].id;
    p = Ops.addClip(p, tid, newClip(Generate.sine(440, 0.5, { sampleRate: SR, channels: 2 }), { trackId: tid, start: 0, name: "c" }));

    const engine = new PlaybackEngine(() => p);
    engine.play(0, { loop: { start: 0, end: 0.5 } });
    expect(lastCtx!.sourceCount).toBe(1); // first pass scheduled
    expect(rafCb).not.toBeNull();

    lastCtx!.currentTime = 0.6; // advance past loop.end
    rafCb!(); // the captured tick detects pos >= loop.end and restarts from loop.start
    expect(lastCtx!.sourceCount).toBe(2); // clip rescheduled — the region looped
    engine.dispose();
  });

  it("plays advanced bus/rack sessions as one rendered mix source", () => {
    let p = emptyProject("P", 1, SR);
    const bus = newBus(0, { id: "bus-preview" });
    const tid = p.tracks[0].id;
    p = { ...p, buses: [bus], tracks: [{ ...p.tracks[0], outputId: bus.id }] };
    p = Ops.addClip(p, tid, newClip(Generate.sine(440, 0.1, { sampleRate: SR, channels: 2 }), { trackId: tid, start: 0, name: "a" }));
    p = Ops.addClip(p, tid, newClip(Generate.sine(660, 0.1, { sampleRate: SR, channels: 2 }), { trackId: tid, start: 0, name: "b" }));

    const engine = new PlaybackEngine(() => p);
    engine.play(0);
    expect(lastCtx!.sourceCount).toBe(1); // rendered mix source, not per-clip scheduling
    engine.dispose();
  });

  it("applies the selected output device when the host supports AudioContext sinks", async () => {
    let p = emptyProject("P", 1, SR);
    p = { ...p, audioHardware: { ...p.audioHardware!, outputDeviceId: "out-1" } };
    const tid = p.tracks[0].id;
    p = Ops.addClip(p, tid, newClip(Generate.sine(440, 0.1, { sampleRate: SR, channels: 2 }), { trackId: tid, start: 0, name: "a" }));

    const engine = new PlaybackEngine(() => p);
    engine.play(0);
    await Promise.resolve();
    expect(lastCtx!.sinkCalls).toEqual(["out-1"]);
    expect(lastCtx!.sinkId).toBe("out-1");
    engine.dispose();
  });
});
