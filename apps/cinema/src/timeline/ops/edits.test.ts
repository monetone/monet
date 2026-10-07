import { beforeEach, describe, expect, it } from "vitest";
import { createClip, createSequence, resetIds } from "../model/factory";
import { clipAt, clipsByStart } from "../model/query";
import type { Sequence, Track } from "../model/types";
import {
  closeGapAt,
  insertClip,
  liftClips,
  moveClip,
  overwriteClip,
  rippleDeleteClips,
  rollEdit,
  slideClip,
  slipClip,
  splitTrackAt,
  trimClipEnd,
  trimClipStart,
} from "./edits";

let seq: Sequence;
let v1: Track;

beforeEach(() => {
  resetIds();
  seq = createSequence({ videoTracks: 2, audioTracks: 1 });
  v1 = seq.tracks[0];
});

describe("razor / split", () => {
  it("splits a clip into two halves with adjusted in-point", () => {
    v1.clips.push(createClip({ name: "a", kind: "video", start: 0, duration: 100, inPoint: 10 }));
    const ids = splitTrackAt(v1, 40);
    expect(ids.length).toBe(2);
    const sorted = clipsByStart(v1);
    expect(sorted[0].duration).toBe(40);
    expect(sorted[1].start).toBe(40);
    expect(sorted[1].duration).toBe(60);
    expect(sorted[1].inPoint).toBe(50); // 10 + 40
  });

  it("no-ops on a frame outside any clip / on an edge", () => {
    v1.clips.push(createClip({ name: "a", kind: "video", start: 0, duration: 50 }));
    expect(splitTrackAt(v1, 0)).toEqual([]);
    expect(splitTrackAt(v1, 50)).toEqual([]);
    expect(splitTrackAt(v1, 999)).toEqual([]);
  });
});

describe("overwrite / insert", () => {
  it("overwrite carves out the covered range", () => {
    v1.clips.push(createClip({ name: "bed", kind: "video", start: 0, duration: 100 }));
    overwriteClip(v1, createClip({ name: "over", kind: "video", start: 40, duration: 20 }));
    const sorted = clipsByStart(v1);
    // bed-head [0,40), over [40,60), bed-tail [60,100)
    expect(sorted.map((c) => [c.start, c.duration])).toEqual([
      [0, 40],
      [40, 20],
      [60, 40],
    ]);
  });

  it("insert ripples later clips and splits the host clip", () => {
    v1.clips.push(createClip({ name: "bed", kind: "video", start: 0, duration: 100 }));
    insertClip(v1, createClip({ name: "ins", kind: "video", start: 40, duration: 30 }));
    const sorted = clipsByStart(v1);
    expect(sorted.map((c) => [c.start, c.duration])).toEqual([
      [0, 40],
      [40, 30],
      [70, 60],
    ]);
  });
});

describe("delete", () => {
  it("lift leaves a gap; ripple-delete closes it", () => {
    const a = createClip({ name: "a", kind: "video", start: 0, duration: 30 });
    const b = createClip({ name: "b", kind: "video", start: 30, duration: 30 });
    const c = createClip({ name: "c", kind: "video", start: 60, duration: 30 });
    v1.clips.push(a, b, c);

    const seq2 = createSequence({ videoTracks: 1, audioTracks: 0 });
    seq2.tracks[0].clips.push(structuredClone(a), structuredClone(b), structuredClone(c));

    liftClips(seq, [b.id]);
    expect(clipAt(v1, 45)).toBeNull(); // gap

    rippleDeleteClips(seq2, [seq2.tracks[0].clips[1].id]);
    const sorted = clipsByStart(seq2.tracks[0]);
    expect(sorted.map((x) => x.start)).toEqual([0, 30]); // c pulled left
  });
});

describe("trim / slip / slide / roll", () => {
  it("trims head + tail", () => {
    const a = createClip({ name: "a", kind: "video", start: 10, duration: 50, inPoint: 0 });
    v1.clips.push(a);
    trimClipStart(v1, a.id, 5);
    expect(a.start).toBe(15);
    expect(a.duration).toBe(45);
    expect(a.inPoint).toBe(5);
    trimClipEnd(v1, a.id, -10);
    expect(a.duration).toBe(35);
  });

  it("slip shifts in-point only", () => {
    const a = createClip({ name: "a", kind: "video", start: 0, duration: 50, inPoint: 20 });
    v1.clips.push(a);
    slipClip(v1, a.id, 5);
    expect(a.start).toBe(0);
    expect(a.inPoint).toBe(25);
  });

  it("slide moves a clip and adjusts neighbors", () => {
    const a = createClip({ name: "a", kind: "video", start: 0, duration: 30 });
    const b = createClip({ name: "b", kind: "video", start: 30, duration: 30 });
    const c = createClip({ name: "c", kind: "video", start: 60, duration: 30 });
    v1.clips.push(a, b, c);
    slideClip(v1, b.id, 10);
    expect(b.start).toBe(40);
    expect(a.duration).toBe(40); // grew
    expect(c.start).toBe(70); // pushed
    expect(c.duration).toBe(20); // shrank
  });

  it("roll moves the cut between two clips", () => {
    const a = createClip({ name: "a", kind: "video", start: 0, duration: 30 });
    const b = createClip({ name: "b", kind: "video", start: 30, duration: 30, inPoint: 0 });
    v1.clips.push(a, b);
    rollEdit(v1, a.id, 10);
    expect(a.duration).toBe(40);
    expect(b.start).toBe(40);
    expect(b.duration).toBe(20);
    expect(b.inPoint).toBe(10);
  });
});

describe("move + gaps", () => {
  it("moves a clip to another track", () => {
    const a = createClip({ name: "a", kind: "video", start: 0, duration: 30 });
    v1.clips.push(a);
    const v2 = seq.tracks[1];
    moveClip(seq, a.id, v2.id, 50);
    expect(v1.clips.length).toBe(0);
    expect(v2.clips[0].start).toBe(50);
  });

  it("refuses to move across track kinds", () => {
    const a = createClip({ name: "a", kind: "video", start: 0, duration: 30 });
    v1.clips.push(a);
    const audio = seq.tracks[2];
    expect(moveClip(seq, a.id, audio.id, 0)).toBeNull();
    expect(v1.clips.length).toBe(1);
  });

  it("closeGapAt pulls the next clip left", () => {
    v1.clips.push(createClip({ name: "a", kind: "video", start: 0, duration: 30 }));
    v1.clips.push(createClip({ name: "b", kind: "video", start: 80, duration: 30 }));
    closeGapAt(v1, 40);
    expect(clipsByStart(v1)[1].start).toBe(30);
  });
});
