// ─────────────────────────────────────────────────────────────
// ui/studio-reverb-presets.test — the shipped Studio Reverb presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual STUDIO_REVERB_PRESETS objects through the engine so each
// named preset provably adds a reverb tail, and a bigger room (Hall) rings
// longer/louder than a tight one (Room).

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { STUDIO_REVERB_PRESETS } from "./commands";

const SR = 44100;

/** A stereo unit impulse, `n` frames. */
function impulse(n = 4096) {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  l[0] = 1;
  r[0] = 1;
  return { sampleRate: SR, channels: [l, r] };
}

function energy(ch: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < Math.min(to, ch.length); i++) s += ch[i] * ch[i];
  return s;
}

const presetOpts = (id: string) => STUDIO_REVERB_PRESETS.find((p) => p.id === id)!.opts;

describe("STUDIO_REVERB_PRESETS", () => {
  it("exposes the four named presets", () => {
    expect(STUDIO_REVERB_PRESETS.map((p) => p.label)).toEqual(["Room", "Studio", "Hall", "Plate"]);
  });

  for (const p of STUDIO_REVERB_PRESETS) {
    it(`${p.label} adds a reverb tail past the dry impulse`, () => {
      const n = 4096;
      const out = E.DSP.studioReverb(impulse(n), p.opts);
      expect(energy(out.channels[0], n + 1000, n + SR / 4)).toBeGreaterThan(0);
    });
  }

  it("Hall rings louder than Room in a shared late window", () => {
    const n = 4096;
    const room = E.DSP.studioReverb(impulse(n), presetOpts("srvRoom"));
    const hall = E.DSP.studioReverb(impulse(n), presetOpts("srvHall"));
    // A window well inside both tails (Room's tail is 0.8 s, so ~0.5 s is shared).
    const win = (d: { channels: Float32Array[] }) => energy(d.channels[0], n + Math.round(0.4 * SR), n + Math.round(0.6 * SR));
    expect(win(hall)).toBeGreaterThan(win(room));
  });
});
