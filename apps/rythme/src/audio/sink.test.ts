import { describe, expect, it } from "vitest";
import { applyAudioContextSink, audioContextSinkSupported, type AudioContextSinkLike } from "./sink";

describe("audio output sink routing", () => {
  it("detects host AudioContext sink support", () => {
    expect(audioContextSinkSupported({ setSinkId: async () => {} })).toBe(true);
    expect(audioContextSinkSupported({})).toBe(false);
  });

  it("applies a requested output sink and reports unsupported contexts", async () => {
    let applied = "";
    const ctx: AudioContextSinkLike = {
      sinkId: "default",
      setSinkId: async (sinkId) => { applied = sinkId; ctx.sinkId = sinkId; },
    };

    await expect(applyAudioContextSink(ctx, " out-1 ")).resolves.toEqual({
      requested: true,
      supported: true,
      applied: true,
      sinkId: "out-1",
    });
    expect(applied).toBe("out-1");
    await expect(applyAudioContextSink({}, "out-1")).resolves.toEqual({
      requested: true,
      supported: false,
      applied: false,
      sinkId: "out-1",
    });
  });

  it("does not throw when sink switching fails or no output is selected", async () => {
    await expect(applyAudioContextSink({ setSinkId: async () => { throw new Error("denied"); } }, "out-1")).resolves.toMatchObject({
      requested: true,
      supported: true,
      applied: false,
      sinkId: "out-1",
      error: "denied",
    });
    await expect(applyAudioContextSink({ setSinkId: async () => {} }, "")).resolves.toEqual({
      requested: false,
      supported: true,
      applied: false,
    });
  });
});
