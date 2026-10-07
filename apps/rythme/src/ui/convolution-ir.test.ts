import { describe, expect, it } from "vitest";
import { emptyProject, fromChannels, Generate, newClip, Ops, RythmeStore } from "../engine";
import { applyConvolutionReverbImpulse } from "./commands";

const SR = 48000;

describe("Convolution Reverb imported IR command", () => {
  it("applies a decoded impulse response over the active track", () => {
    let project = emptyProject("IR", 1, SR);
    const trackId = project.tracks[0].id;
    const clip = newClip(Generate.sine(440, 0.05, { sampleRate: SR, channels: 1, amplitude: 0.4 }), { trackId });
    project = Ops.addClip(project, trackId, clip);
    const store = new RythmeStore(project);

    const ok = applyConvolutionReverbImpulse(
      store,
      fromChannels([[1, 0.5, 0.25]], SR),
      { mix: 1, normalize: "none" },
      "Convolution Reverb - test-ir.wav",
    );

    expect(ok).toBe(true);
    const out = store.getState().project.tracks[0].clips[0].buffer;
    expect(out.channels[0].length).toBe(clip.buffer.channels[0].length + 2);
    expect(store.undoLabels().at(-1)).toBe("Convolution Reverb - test-ir.wav");
  });

  it("rejects empty impulse responses without pushing history", () => {
    const store = new RythmeStore(emptyProject("Empty IR", 1, SR));
    expect(applyConvolutionReverbImpulse(store, fromChannels([[]], SR))).toBe(false);
    expect(store.undoLabels()).toEqual([]);
  });
});
