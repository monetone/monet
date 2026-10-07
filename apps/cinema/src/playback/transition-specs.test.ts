import { beforeEach, describe, expect, it } from "vitest";
import { createClip, createSequence, resetIds } from "../timeline/model/factory";
import type { Sequence } from "../timeline/model/types";
import { collectVideoSpecs, envelopeOpacity } from "./transition-specs";

let seq: Sequence;

beforeEach(() => {
  resetIds();
  seq = createSequence({ videoTracks: 2, audioTracks: 0, width: 1920, height: 1080 });
});

describe("collectVideoSpecs", () => {
  it("emits one spec per covering clip", () => {
    seq.tracks[0].clips.push(createClip({ name: "a", kind: "video", start: 0, duration: 100 }));
    const specs = collectVideoSpecs(seq, 50);
    expect(specs.length).toBe(1);
    expect(specs[0].opacityMul).toBe(1);
    expect(specs[0].wipeKind).toBe(0);
  });

  it("cross-dissolve head emits outgoing + ramped incoming", () => {
    const a = createClip({ name: "a", kind: "video", start: 0, duration: 50 });
    const b = createClip({ name: "b", kind: "video", start: 50, duration: 50 });
    b.transitionIn = { kind: "cross-dissolve", durationFrames: 20 };
    seq.tracks[0].clips.push(a, b);
    // 10 frames into the 20-frame dissolve (p = 0.5).
    const specs = collectVideoSpecs(seq, 60);
    expect(specs.length).toBe(2);
    expect(specs[0].clip.id).toBe(a.id); // outgoing beneath
    expect(specs[1].clip.id).toBe(b.id); // incoming on top
    expect(specs[1].opacityMul).toBeCloseTo(0.5, 5);
  });

  it("wipe sets engine wipe params; push sets an offset", () => {
    const a = createClip({ name: "a", kind: "video", start: 0, duration: 50 });
    const b = createClip({ name: "b", kind: "video", start: 50, duration: 50 });
    b.transitionIn = { kind: "wipe", durationFrames: 20, angle: 90 };
    seq.tracks[0].clips.push(a, b);
    const wipe = collectVideoSpecs(seq, 55)[1];
    expect(wipe.wipeKind).toBe(1);
    expect(wipe.wipeProgress).toBeCloseTo(0.25, 5);

    b.transitionIn = { kind: "push", durationFrames: 20 };
    const push = collectVideoSpecs(seq, 55)[1];
    expect(push.offsetX).toBeCloseTo(0.75 * 1920, 3); // (1-p) * width
  });

  it("transitionOut emits current clip + incoming next clip", () => {
    const a = createClip({ name: "a", kind: "video", start: 0, duration: 50 });
    const b = createClip({ name: "b", kind: "video", start: 50, duration: 50 });
    a.transitionOut = { kind: "cross-dissolve", durationFrames: 10 };
    seq.tracks[0].clips.push(a, b);
    // 5 frames before a's end → within the out window (p ≈ 0.5).
    const specs = collectVideoSpecs(seq, 45);
    expect(specs.length).toBe(2);
    expect(specs[0].clip.id).toBe(a.id);
    expect(specs[1].clip.id).toBe(b.id);
    expect(specs[1].opacityMul).toBeCloseTo(0.5, 5);
  });

  it("dip-to-black stays single-layer with a ramped envelope", () => {
    const b = createClip({ name: "b", kind: "video", start: 0, duration: 50 });
    b.transitionIn = { kind: "dip-to-black", durationFrames: 10 };
    seq.tracks[0].clips.push(b);
    const specs = collectVideoSpecs(seq, 5);
    expect(specs.length).toBe(1);
    expect(specs[0].opacityMul).toBeCloseTo(0.5, 5);
  });

  it("respects track enable + solo", () => {
    const [v1, v2] = [seq.tracks[0], seq.tracks[1]];
    v1.clips.push(createClip({ name: "v1", kind: "video", start: 0, duration: 50 }));
    v2.clips.push(createClip({ name: "v2", kind: "video", start: 0, duration: 50 }));
    expect(collectVideoSpecs(seq, 10).length).toBe(2);
    v2.solo = true;
    expect(collectVideoSpecs(seq, 10).length).toBe(1);
  });

  it("envelopeOpacity ramps fades", () => {
    const c = createClip({ name: "a", kind: "video", start: 0, duration: 100 });
    c.fadeInFrames = 10;
    expect(envelopeOpacity(c, 0)).toBe(0);
    expect(envelopeOpacity(c, 5)).toBeCloseTo(0.5, 5);
    expect(envelopeOpacity(c, 20)).toBe(1);
  });
});
