// ─────────────────────────────────────────────────────────────
// ui/analog-delay-presets.test — the shipped Analog Delay presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual ANALOG_DELAY_PRESETS objects through the engine so each
// named preset provably adds an audible echo at its delay time.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { ANALOG_DELAY_PRESETS } from "./commands";

const SR = 44100;

/** A mono unit impulse, 4096 frames. */
function impulse() {
  const c = new Float32Array(4096);
  c[0] = 1;
  return { sampleRate: SR, channels: [c] };
}

function energy(ch: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < Math.min(to, ch.length); i++) s += ch[i] * ch[i];
  return s;
}

describe("ANALOG_DELAY_PRESETS", () => {
  it("exposes the four named presets", () => {
    expect(ANALOG_DELAY_PRESETS.map((p) => p.label)).toEqual(["Tape Echo", "Tube Echo", "BBD", "Slapback"]);
  });

  for (const p of ANALOG_DELAY_PRESETS) {
    it(`${p.label} adds an echo at its delay time`, () => {
      const out = E.DSP.analogDelay(impulse(), p.opts);
      const ds = Math.round(((p.opts.delayMs ?? 300) / 1000) * SR);
      expect(energy(out.channels[0], ds - 200, ds + 600)).toBeGreaterThan(0);
    });
  }
});
