// ─────────────────────────────────────────────────────────────
// ui/mark-audio-presets.test — the shipped Mark Audio presets
// ─────────────────────────────────────────────────────────────
// Drives each MARK_AUDIO_PRESETS option set through the region finder on a
// two-phrase clip with a 0.5 s gap: the phrase/non-silent presets split it into
// two, while "Mark Takes" (which needs an 0.8 s gap) keeps it as one take.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { MARK_AUDIO_PRESETS } from "./commands";

const SR = 44100;
const tone = (sec: number) => E.Generate.sine(440, sec, { sampleRate: SR, amplitude: 0.6 });
const sil = (sec: number) => ({ sampleRate: SR, channels: [new Float32Array(Math.round(sec * SR))] }) as E.AudioData;
const clip = () => E.concat(tone(0.2), sil(0.5), tone(0.2));

const opts = (id: string) => MARK_AUDIO_PRESETS.find((p) => p.id === id)!.opts;

describe("MARK_AUDIO_PRESETS", () => {
  it("exposes the three named presets", () => {
    expect(MARK_AUDIO_PRESETS.map((p) => p.label)).toEqual(["Mark Phrases", "Mark Takes", "Mark Non-Silent"]);
  });

  it("Mark Phrases / Mark Non-Silent split the 0.5 s gap into two regions", () => {
    expect(E.Analysis.detectAudioRegions(clip(), opts("markPhrases"))).toHaveLength(2);
    expect(E.Analysis.detectAudioRegions(clip(), opts("markAll"))).toHaveLength(2);
  });

  it("Mark Takes keeps it as one take (needs a longer gap)", () => {
    expect(E.Analysis.detectAudioRegions(clip(), opts("markTakes"))).toHaveLength(1);
  });
});
