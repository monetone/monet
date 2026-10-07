import { describe, expect, it } from "vitest";
import { createClip, createProject, createSequence, resetIds } from "./factory";
import {
  activeSequence,
  audioClipsAt,
  clipAt,
  clipCovers,
  contentEnd,
  findClip,
  isRangeFree,
  nextEdge,
  overlapping,
  videoClipsAt,
  videoTracks,
} from "./query";

describe("model queries", () => {
  it("creates a default project with an active sequence", () => {
    resetIds();
    const p = createProject("Demo");
    const seq = activeSequence(p)!;
    expect(seq).toBeTruthy();
    expect(videoTracks(seq).length).toBe(3);
    expect(seq.tracks.filter((t) => t.kind === "audio").length).toBe(3);
  });

  it("clipCovers / clipAt span semantics are half-open", () => {
    const c = createClip({ name: "a", kind: "video", start: 10, duration: 20 });
    expect(clipCovers(c, 9)).toBe(false);
    expect(clipCovers(c, 10)).toBe(true);
    expect(clipCovers(c, 29)).toBe(true);
    expect(clipCovers(c, 30)).toBe(false);
    const seq = createSequence();
    seq.tracks[0].clips.push(c);
    expect(clipAt(seq.tracks[0], 15)?.id).toBe(c.id);
    expect(clipAt(seq.tracks[0], 30)).toBeNull();
  });

  it("videoClipsAt respects enabled + solo", () => {
    const seq = createSequence({ videoTracks: 2, audioTracks: 0 });
    const [v1, v2] = videoTracks(seq);
    v1.clips.push(createClip({ name: "v1", kind: "video", start: 0, duration: 50 }));
    v2.clips.push(createClip({ name: "v2", kind: "video", start: 0, duration: 50 }));
    expect(videoClipsAt(seq, 10).length).toBe(2);
    v1.enabled = false;
    expect(videoClipsAt(seq, 10).length).toBe(1);
    v1.enabled = true;
    v2.solo = true;
    expect(videoClipsAt(seq, 10).map((h) => h.track.id)).toEqual([v2.id]);
  });

  it("audioClipsAt respects mute", () => {
    const seq = createSequence({ videoTracks: 0, audioTracks: 1 });
    const a1 = seq.tracks[0];
    a1.clips.push(createClip({ name: "a", kind: "audio", start: 0, duration: 30 }));
    expect(audioClipsAt(seq, 5).length).toBe(1);
    a1.muted = true;
    expect(audioClipsAt(seq, 5).length).toBe(0);
  });

  it("overlapping / isRangeFree", () => {
    const seq = createSequence();
    const t = seq.tracks[0];
    t.clips.push(createClip({ name: "a", kind: "video", start: 0, duration: 20 }));
    expect(isRangeFree(t, 20, 10)).toBe(true);
    expect(isRangeFree(t, 10, 10)).toBe(false);
    expect(overlapping(t, 5, 5).length).toBe(1);
  });

  it("findClip locates across tracks", () => {
    const seq = createSequence();
    const c = createClip({ name: "x", kind: "audio", start: 0, duration: 10 });
    seq.tracks[3].clips.push(c);
    expect(findClip(seq, c.id)?.track.id).toBe(seq.tracks[3].id);
  });

  it("contentEnd + nextEdge", () => {
    const seq = createSequence();
    seq.tracks[0].clips.push(createClip({ name: "a", kind: "video", start: 0, duration: 30 }));
    seq.tracks[1].clips.push(createClip({ name: "b", kind: "video", start: 50, duration: 40 }));
    expect(contentEnd(seq)).toBe(90);
    expect(nextEdge(seq, 0)).toBe(30);
    expect(nextEdge(seq, 30)).toBe(50);
    expect(nextEdge(seq, 50)).toBe(90);
  });
});
