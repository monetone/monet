import { describe, expect, it } from "vitest";
import type { MonetFile } from "@monet-ui/monet-format";
import { createClip, createProject, resetIds } from "../model/factory";
import { activeSequence, findClip } from "../model/query";
import { fromMonet, toMonet } from "./monet-adapter";

describe("monet adapter — Cinema ⇄ .monet", () => {
  it("round-trips the Cinema domain payload (transform/color/effects/blend)", () => {
    resetIds();
    const p = createProject("Doc");
    const seq = activeSequence(p)!;
    const clip = createClip({ name: "hero", kind: "video", start: 12, duration: 48, inPoint: 6 });
    clip.transform.x = 120;
    clip.transform.blendMode = "screen";
    clip.color.enabled = true;
    clip.color.exposure = 0.4;
    clip.effects.push({ id: "fx1", type: "gaussian-blur", name: "Gaussian Blur", enabled: true, params: { radius: 8 } });
    clip.transitionIn = { kind: "cross-dissolve", durationFrames: 12 };
    seq.tracks[0].clips.push(clip);

    const file = toMonet(p);
    expect(file.format).toBe("monet");
    expect(file.document.sequences[0].timeBase).toEqual({ kind: "frames", fps: 24 });

    const back = findClip(activeSequence(fromMonet(file))!, clip.id)!.clip;
    expect([back.start, back.duration, back.inPoint]).toEqual([12, 48, 6]);
    expect(back.transform.x).toBe(120);
    expect(back.transform.blendMode).toBe("screen");
    expect(back.color.enabled).toBe(true);
    expect(back.color.exposure).toBeCloseTo(0.4, 6);
    expect(back.effects[0]?.params.radius).toBe(8);
    expect(back.transitionIn?.kind).toBe("cross-dissolve");
  });

  it("cross-opens a seconds-based (audio) .monet into frames", () => {
    const file: MonetFile = {
      format: "monet",
      schemaVersion: 1,
      app: { name: "monet-rythme", version: "0.1.0" },
      document: {
        name: "Song",
        defaults: { fps: 24, sampleRate: 48000 },
        media: [{ id: "m1", name: "vox.wav", kind: "audio", source: { path: "vox.wav" }, duration: { seconds: 10 }, hasAudio: true }],
        sequences: [
          {
            id: "s1",
            name: "Mix",
            timeBase: { kind: "seconds" },
            settings: { sampleRate: 48000 },
            tracks: [
              {
                id: "A1",
                kind: "audio",
                clips: [{ id: "c1", mediaId: "m1", name: "vox", start: 1.0, duration: 2.0, inPoint: 0.5, speed: 1, enabled: true, data: { rythme: { gainDb: -6, fadeIn: 0.5 } } }],
              },
            ],
          },
        ],
        activeSequenceId: "s1",
      },
    };

    const seq = activeSequence(fromMonet(file))!;
    expect(seq.fps).toBe(24);
    const c = seq.tracks[0].clips[0];
    expect(c.kind).toBe("audio");
    expect([c.start, c.duration, c.inPoint]).toEqual([24, 48, 12]); // seconds×24 fps
    expect(c.audioGain).toBe(-6); // mapped from data.rythme.gainDb
    expect(c.fadeInFrames).toBe(12); // 0.5s × 24
  });
});

// ── COURIER: Cinema must hand a foreign document back unharmed ──
describe("monet adapter — Cinema as a courier for foreign data", () => {
  const embed = { encoding: "f32-base64", sampleRate: 48000, channels: ["AAAAAA=="] };
  const trackRythme = {
    color: "#3af",
    gainDb: -2,
    pan: 0.25,
    surroundPan: { x: -0.5, y: 0.25, center: 0.4, lfe: 0.1, divergence: 0.75 },
    mute: false,
    solo: false,
    recordArm: false,
    height: 96,
    effectRack: { enabled: true, slots: [{ id: "s1", kind: "gain", enabled: true, params: { gainDb: 3 } }] },
    automation: [{ id: "a1", target: { kind: "gainDb" }, points: [{ time: 0.5, value: -6 }], interpolation: "linear" }],
    automationMode: "latch",
    sends: [{ id: "snd1", busId: "bus_verb", gainDb: -9, pan: 0, preFader: false, enabled: true }],
    outputId: "bus_verb",
  };
  const clipRythme = { gainDb: -3, fadeIn: 0.5, fadeOut: 0.25, fadeInShape: "equalPower", fadeOutShape: "linear" };
  const docRythme = { channelCount: 6, buses: [{ id: "bus_verb", name: "Reverb" }], masterGainDb: -1 };

  /** A Rythme-authored `.monet`, with an unknown forward-compat key on the clip. */
  const rythmeFile = (): MonetFile =>
    ({
      format: "monet",
      schemaVersion: 1,
      app: { name: "monet-rythme", version: "0.1.0" },
      document: {
        id: "proj_song",
        name: "Song",
        defaults: { sampleRate: 48000 },
        media: [{ id: "rmedia_1", name: "vox", kind: "audio", source: { embed }, duration: { seconds: 2 }, hasAudio: true }],
        sequences: [
          {
            id: "seq_main",
            name: "Song",
            timeBase: { kind: "seconds" },
            settings: { sampleRate: 48000, tempo: 96, timeSignature: [3, 4], masterGainDb: -1 },
            tracks: [
              {
                id: "A1",
                kind: "audio",
                name: "Vox",
                clips: [
                  {
                    id: "c1",
                    mediaId: "rmedia_1",
                    name: "take-1",
                    start: 1,
                    duration: 2,
                    inPoint: 0,
                    speed: 1,
                    enabled: true,
                    futureKnob: 7, // a key written by a newer Rythme
                    data: { rythme: clipRythme },
                  },
                ],
                data: { rythme: trackRythme },
              },
            ],
            markers: [{ time: 1, end: 3, name: "Chorus", color: "#f0f", data: { rythme: { id: "m1", kind: "region" } } }],
          },
        ],
        activeSequenceId: "seq_main",
        data: { rythme: docRythme },
      },
    }) as unknown as MonetFile;

  it("re-emits every foreign data.<app> namespace byte-faithfully", () => {
    const out = toMonet(fromMonet(rythmeFile())).document;
    const seq = out.sequences[0];
    const clip = seq.tracks[0].clips[0];

    expect(out.data?.rythme).toEqual(docRythme);
    expect(seq.tracks[0].data?.rythme).toEqual(trackRythme);
    // Seconds-based values inside a foreign bag are cargo: never unit-converted.
    expect(clip.data?.rythme).toEqual(clipRythme);
    expect(seq.markers?.[0].data?.rythme).toEqual({ id: "m1", kind: "region" });
    // …and Cinema still writes its own namespace alongside.
    expect((clip.data?.cinema as { audioGain: number }).audioGain).toBe(-3);
  });

  it("re-emits unowned fields: the document id, embedded PCM, region ends and unknown keys", () => {
    const out = toMonet(fromMonet(rythmeFile())).document;
    const seq = out.sequences[0];

    expect(out.id).toBe("proj_song");
    expect(out.defaults?.sampleRate).toBe(48000);
    // The PCM lives in `source.embed`; a `{ path: null }` here would delete it.
    expect(out.media[0].source).toEqual({ embed });
    expect(seq.settings?.tempo).toBe(96);
    expect(seq.settings?.timeSignature).toEqual([3, 4]);
    // Backbone times ARE converted with the sequence (1s/3s → 24f/72f at 24 fps).
    expect(seq.markers?.[0].end).toBe(72);
    expect((seq.tracks[0].clips[0] as unknown as { futureKnob: number }).futureKnob).toBe(7);
  });

  it("keeps a Cinema-authored document free of empty cargo", () => {
    resetIds();
    const p = createProject("Doc");
    activeSequence(p)!.tracks[0].clips.push(createClip({ name: "a", kind: "video", start: 0, duration: 10, inPoint: 0 }));
    const out = toMonet(fromMonet(toMonet(p))).document;
    expect(out.data).toBeUndefined();
    expect(out.sequences[0].tracks[0].clips[0].data).toEqual({ cinema: expect.any(Object) });
  });
});
