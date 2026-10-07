// COURIER (FMT-03): Rythme owns `data.rythme` and must hand every other app's
// namespace — plus the fields it has no model for — back unharmed. These tests
// drive a Cinema-authored `.monet` through fromMonet → toMonet and assert the
// foreign payload comes out the other side intact.

import { describe, expect, it } from "vitest";
import type { MonetFile } from "@monet-ui/monet-format";
import { sine } from "../generate/tone";
import { emptyProject, newClip, newTrack } from "../model/factory";
import { fromContainer, fromMonet, toContainer, toMonet } from "./monet-adapter";

const clipCinema = {
  kind: "video",
  transform: { x: 120, y: 0, scale: 100, scaleX: 100, scaleY: 100, rotation: 12, anchorX: 0.5, anchorY: 0.5, opacity: 80, blendMode: "screen", cropL: 0, cropT: 0, cropR: 0, cropB: 0 },
  color: { enabled: true, exposure: 0.4, contrast: 0.1, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, hue: 0, gamma: 1, lift: 0, gain: 1 },
  effects: [{ id: "fx1", type: "gaussian-blur", name: "Gaussian Blur", enabled: true, params: { radius: 8 } }],
  audioGain: 0,
  fadeInFrames: 6,
  fadeOutFrames: 0,
  transitionIn: { kind: "cross-dissolve", durationFrames: 12 },
  label: "mango",
};
const trackCinema = { muted: false, solo: true, height: 56, gain: -3 };
const audioClipCinema = { kind: "audio", audioGain: -6, fadeInFrames: 12, fadeOutFrames: 0 };

/** A Cinema-authored `.monet`: two sequences, referenced (not embedded) media,
 *  a video + an audio lane, and an unknown forward-compat key on a clip. */
const cinemaFile = (): MonetFile =>
  ({
    format: "monet",
    schemaVersion: 1,
    app: { name: "monet-cinema", version: "0.1.0" },
    document: {
      id: "proj_film",
      name: "FilmCut",
      defaults: { fps: 24, width: 1920, height: 1080 },
      media: [
        { id: "m-video", name: "plate.mov", kind: "video", source: { path: "/plates/plate.mov" }, duration: { frames: 240, fps: 24 }, width: 1920, height: 1080, hasAudio: true },
        { id: "m-dlg", name: "dlg.wav", kind: "audio", source: { path: "/audio/dlg.wav" }, duration: { frames: 240, fps: 24 }, hasAudio: true, data: { cinema: { color: "#f80" } } },
      ],
      sequences: [
        {
          id: "s1",
          name: "Reel 1",
          timeBase: { kind: "frames", fps: 24 },
          settings: { width: 1920, height: 1080, background: "#101014", duration: 2400 },
          tracks: [
            {
              id: "V1",
              kind: "video",
              name: "V1",
              clips: [{ id: "vc1", mediaId: "m-video", name: "plate", start: 48, duration: 72, inPoint: 24, speed: 1, enabled: true, futureKnob: 7, data: { cinema: clipCinema } }],
              data: { cinema: trackCinema },
            },
            {
              id: "A1",
              kind: "audio",
              name: "A1",
              clips: [{ id: "ac1", mediaId: "m-dlg", name: "dlg", start: 48, duration: 24, inPoint: 0, speed: 1, enabled: true, data: { cinema: audioClipCinema } }],
              data: { cinema: { muted: false, solo: false, height: 44, gain: 0 } },
            },
          ],
          markers: [{ time: 24, name: "Slate", color: "#0ff", data: { cinema: { note: "sync point" } } }],
        },
        {
          id: "s2",
          name: "Reel 2",
          timeBase: { kind: "frames", fps: 24 },
          settings: { width: 1920, height: 1080 },
          tracks: [{ id: "V1b", kind: "video", clips: [], data: { cinema: { muted: false, solo: false, height: 56, gain: 0 } } }],
        },
      ],
      activeSequenceId: "s1",
    },
  }) as unknown as MonetFile;

describe("monet adapter — Rythme as a courier for foreign data", () => {
  it("re-emits every foreign data.<app> namespace byte-faithfully", () => {
    const out = toMonet(fromMonet(cinemaFile())).document;
    const seq = out.sequences[0];
    const video = seq.tracks.find((t) => t.id === "V1")!;
    const audio = seq.tracks.find((t) => t.id === "A1")!;

    expect(video.data?.cinema).toEqual(trackCinema);
    // Frame-based values inside a foreign bag are cargo: never unit-converted.
    expect(video.clips[0].data?.cinema).toEqual(clipCinema);
    expect(audio.clips[0].data?.cinema).toEqual(audioClipCinema);
    expect(seq.markers?.[0].data?.cinema).toEqual({ note: "sync point" });
    expect(out.media.find((m) => m.id === "m-dlg")?.data?.cinema).toEqual({ color: "#f80" });
    // …and Rythme still writes its own namespace alongside.
    expect((audio.data?.rythme as { gainDb: number }).gainDb).toBe(0);
  });

  it("re-emits unowned fields: the other sequence, referenced media, clip links and unknown keys", () => {
    const out = toMonet(fromMonet(cinemaFile())).document;

    expect(out.sequences.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(out.sequences.find((s) => s.id === "s2")?.tracks[0].data?.cinema).toBeDefined();
    // A referenced (not embedded) audio asset has no Rythme model — carried whole.
    expect(out.media.find((m) => m.id === "m-dlg")?.source).toEqual({ path: "/audio/dlg.wav" });
    // No PCM of ours, so the clip keeps its original media link instead of
    // getting a freshly minted, empty `rmedia_N` embed.
    const audio = out.sequences[0].tracks.find((t) => t.id === "A1")!;
    expect(audio.clips[0].mediaId).toBe("m-dlg");
    expect(out.media.some((m) => m.id.startsWith("rmedia_"))).toBe(false);
    expect(out.sequences[0].settings?.background).toBe("#101014");
    const video = out.sequences[0].tracks.find((t) => t.id === "V1")!;
    expect((video.clips[0] as unknown as { futureKnob: number }).futureKnob).toBe(7);
  });

  it("keeps the edited sequence in Rythme's own units and id", () => {
    const out = toMonet(fromMonet(cinemaFile())).document;
    const seq = out.sequences[0];
    expect(seq.id).toBe("s1"); // not clobbered with "seq_main"
    expect(out.activeSequenceId).toBe("s1");
    expect(seq.timeBase).toEqual({ kind: "seconds" });
    expect(seq.tracks.find((t) => t.id === "A1")!.clips[0].start).toBe(2); // 48f @ 24fps
  });

  it("keeps a Rythme-authored document free of empty cargo", () => {
    const p = emptyProject("Mix", 0, 48000);
    const t = newTrack(0, { id: "T1" });
    t.clips.push(newClip(sine(440, 0.05, { sampleRate: 48000 }), { trackId: "T1", name: "take-1" }));
    p.tracks.push(t);

    // Through the container, so the clip's PCM comes back with it — a lost
    // buffer would show up as `mediaId` cargo on the clip.
    const back = fromContainer(toContainer(p)).project;
    expect(back.foreign).toBeUndefined();
    expect(back.tracks.every((t) => t.foreign === undefined)).toBe(true);
    expect(back.tracks.flatMap((t) => t.clips).every((c) => c.foreign === undefined)).toBe(true);
    expect(toMonet(back).document.sequences).toHaveLength(1);
    expect(toMonet(back).document.sequences[0].id).toBe("seq_main");
  });
});
