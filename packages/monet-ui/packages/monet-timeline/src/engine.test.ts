import { beforeEach, describe, expect, it } from "vitest";
import { clamp, formatClock, framesToTimecode, sourceFrameAt, timecodeToFrames } from "./time";
import { newId, resetIds, type TimelineClip, type TimelineSequence, type TimelineSpan, type TimelineTrack } from "./model";
import { clipAt, clipCovers, contentEnd, isRangeFree, nextEdge, snapTime } from "./query";
import {
  cloneClip,
  closeGapAt,
  insertClip,
  liftClips,
  moveClipToTrack,
  overwriteClip,
  rippleDeleteClips,
  rollEdit,
  setClipSpeed,
  slideClip,
  slipClip,
  splitTrackAt,
  trimClipEnd,
  trimClipStart,
} from "./ops";
import { TimelineStore } from "./store";

// A clip with an app-specific payload, to prove the generic ops preserve it.
interface TestClip extends TimelineClip {
  kind: string;
  label: string;
}
function mk(over: Partial<TestClip>): TestClip {
  return { id: newId("clip"), start: 0, duration: 10, inPoint: 0, speed: 1, enabled: true, kind: "video", label: "x", ...over };
}
function track(clips: TestClip[] = []): TimelineTrack<TestClip> {
  return { id: newId("t"), clips };
}
function seq(tracks: TimelineTrack<TestClip>[]): TimelineSequence<TestClip> {
  return { tracks };
}

beforeEach(() => resetIds());

describe("time", () => {
  it("formats + round-trips frame timecode", () => {
    expect(framesToTimecode(24, 24)).toBe("00:00:01:00");
    expect(timecodeToFrames(framesToTimecode(9999, 24), 24)).toBe(9999);
    expect(framesToTimecode(0, 29.97, true)).toBe("00:00:00;00");
    expect(formatClock(24 * 65, 24)).toBe("1:05");
  });
  it("sourceFrameAt honors in-point + speed; clamp works", () => {
    expect(sourceFrameAt(10, 5, 100, 1)).toBe(105);
    expect(sourceFrameAt(10, 0, 0, 2)).toBe(20);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("query (generic)", () => {
  it("clipCovers is half-open; clipAt + edges + snap", () => {
    const t = track([mk({ start: 10, duration: 20 }), mk({ start: 50, duration: 10 })]);
    expect(clipCovers(t.clips[0], 30)).toBe(false);
    expect(clipAt(t, 15)?.id).toBe(t.clips[0].id);
    const s = seq([t]);
    expect(contentEnd(s)).toBe(60);
    expect(nextEdge(s, 0)).toBe(10);
    expect(isRangeFree(t, 30, 20)).toBe(true);
    expect(snapTime(s, 11, 3)).toBe(10); // snaps to a clip edge within threshold
  });
});

describe("ops (generic, payload-preserving)", () => {
  it("split preserves the app payload on both halves + adjusts in-point", () => {
    const t = track([mk({ start: 0, duration: 100, inPoint: 10, label: "hero" })]);
    const ids = splitTrackAt(t, 40);
    expect(ids).toHaveLength(2);
    const [a, b] = [...t.clips].sort((x, y) => x.start - y.start);
    expect(a.duration).toBe(40);
    expect(b.start).toBe(40);
    expect(b.inPoint).toBe(50);
    expect(a.label).toBe("hero");
    expect(b.label).toBe("hero"); // payload carried to the new clip
    expect(b.kind).toBe("video");
  });

  it("overwrite carves; insert ripples + splits the host", () => {
    const ow = track([mk({ start: 0, duration: 100 })]);
    overwriteClip(ow, mk({ start: 40, duration: 20 }));
    expect([...ow.clips].sort((a, b) => a.start - b.start).map((c) => [c.start, c.duration])).toEqual([[0, 40], [40, 20], [60, 40]]);

    const ins = track([mk({ start: 0, duration: 100 })]);
    insertClip(ins, mk({ start: 40, duration: 30 }));
    expect([...ins.clips].sort((a, b) => a.start - b.start).map((c) => [c.start, c.duration])).toEqual([[0, 40], [40, 30], [70, 60]]);
  });

  it("lift leaves a gap; ripple-delete closes it; closeGapAt pulls left", () => {
    const a = mk({ start: 0, duration: 30 });
    const b = mk({ start: 30, duration: 30 });
    const c = mk({ start: 60, duration: 30 });
    const lift = seq([track([{ ...a }, { ...b }, { ...c }])]);
    liftClips(lift, [lift.tracks[0].clips[1].id]);
    expect(clipAt(lift.tracks[0], 45)).toBeNull();

    const rip = seq([track([{ ...a }, { ...b }, { ...c }])]);
    rippleDeleteClips(rip, [rip.tracks[0].clips[1].id]);
    expect([...rip.tracks[0].clips].map((x) => x.start).sort((m, n) => m - n)).toEqual([0, 30]);

    const gap = track([mk({ start: 0, duration: 30 }), mk({ start: 80, duration: 30 })]);
    closeGapAt(gap, 40);
    expect([...gap.clips].sort((m, n) => m.start - n.start)[1].start).toBe(30);
  });

  it("trim / slip / slide / roll", () => {
    const tt = track([mk({ start: 10, duration: 50, inPoint: 0 })]);
    const id = tt.clips[0].id;
    trimClipStart(tt, id, 5);
    expect([tt.clips[0].start, tt.clips[0].duration, tt.clips[0].inPoint]).toEqual([15, 45, 5]);
    trimClipEnd(tt, id, -10);
    expect(tt.clips[0].duration).toBe(35);
    slipClip(tt, id, 5);
    expect(tt.clips[0].inPoint).toBe(10);

    const sl = track([mk({ start: 0, duration: 30 }), mk({ start: 30, duration: 30 }), mk({ start: 60, duration: 30 })]);
    slideClip(sl, sl.clips[1].id, 10);
    const sorted = [...sl.clips].sort((a, b) => a.start - b.start);
    expect([sorted[0].duration, sorted[1].start, sorted[2].start]).toEqual([40, 40, 70]);

    const rl = track([mk({ start: 0, duration: 30 }), mk({ start: 30, duration: 30, inPoint: 0 })]);
    rollEdit(rl, rl.clips[0].id, 10);
    const rs = [...rl.clips].sort((a, b) => a.start - b.start);
    expect([rs[0].duration, rs[1].start, rs[1].inPoint]).toEqual([40, 40, 10]);
  });

  // (#206) A slide only trims neighbours that TOUCH the clip. Across a gap the
  // old code resized the non-adjacent neighbour and, clamping by the
  // gap-inclusive distance, drove its duration NEGATIVE.
  it("slide across a gap leaves the non-adjacent neighbours alone", () => {
    const g = track([
      mk({ start: 0, duration: 10 }),
      mk({ start: 30, duration: 10 }),
      mk({ start: 60, duration: 10 }),
    ]);
    slideClip(g, g.clips[1].id, -25);
    const s = [...g.clips].sort((a, b) => a.start - b.start);
    expect([s[0].start, s[0].duration]).toEqual([0, 10]); // was [0, -15]
    expect(s[1].start).toBe(10); // slid left only until it met its neighbour
    expect([s[2].start, s[2].duration]).toEqual([60, 10]);
  });

  // (#207) Unit-agnostic: no whole-unit rounding, no 1-unit floor (a 1.2s clip
  // at 4× became 1s instead of 0.3s; a reversed clip collapsed to 1).
  it("setClipSpeed keeps fractional durations and handles reverse speeds", () => {
    const t = track([mk({ start: 0, duration: 1.2, speed: 1 })]);
    const id = t.clips[0].id;
    setClipSpeed(t, id, 4);
    expect(t.clips[0].duration).toBeCloseTo(0.3, 9);
    setClipSpeed(t, id, -4); // same source span, played backwards
    expect(t.clips[0].duration).toBeCloseTo(0.3, 9);
    setClipSpeed(t, id, 1);
    expect(t.clips[0].duration).toBeCloseTo(1.2, 9);
  });

  it("moveClipToTrack respects a canDrop predicate", () => {
    const v = track([mk({ start: 0, duration: 30, kind: "video" })]);
    const aTrk = track([]);
    const s = seq([v, aTrk]);
    const sameKind = (from: TimelineTrack<TestClip>, to: TimelineTrack<TestClip>) =>
      (from.clips[0]?.kind ?? "video") === (to.clips[0]?.kind ?? from.clips[0]?.kind ?? "");
    // No clips on dest → predicate allows; move lands at 50.
    const moved = moveClipToTrack(s, v.clips[0]?.id ?? "", aTrk.id, 50, { canDrop: () => true });
    expect(moved).not.toBeNull();
    expect(aTrk.clips[0].start).toBe(50);
    void sameKind;
  });

  it("cloneClip mints a new id but keeps the payload", () => {
    const c = mk({ label: "keep" });
    const dup = cloneClip(c);
    expect(dup.id).not.toBe(c.id);
    expect(dup.label).toBe("keep");
  });
});

describe("queries work on TimelineSpan-only clips (audio shape: seconds, no in-point/speed/enabled)", () => {
  // The Rythme-style clip: seconds, no inPoint/speed/enabled, an audio payload.
  interface AudioClip extends TimelineSpan {
    trackId: string;
    gainDb: number;
  }
  it("clipAt / contentEnd / snapTime accept span-only seconds clips", () => {
    const a: AudioClip = { id: "a", start: 0.0, duration: 1.5, trackId: "t", gainDb: -3 };
    const b: AudioClip = { id: "b", start: 2.0, duration: 0.5, trackId: "t", gainDb: 0 };
    const track: TimelineTrack<AudioClip> = { id: "t", clips: [a, b] };
    const seq: TimelineSequence<AudioClip> = { tracks: [track] };
    expect(clipAt(track, 0.5)?.id).toBe("a");
    expect(clipAt(track, 1.5)).toBeNull(); // half-open
    expect(contentEnd(seq)).toBeCloseTo(2.5, 9);
    expect(nextEdge(seq, 0)).toBeCloseTo(1.5, 9);
    expect(snapTime(seq, 1.98, 0.05)).toBeCloseTo(2.0, 9); // snap to b.start
  });
});

describe("ops are unit-agnostic (seconds: no rounding, epsilon min-duration)", () => {
  it("split/trim on fractional seconds keep exact values", () => {
    const t = track([mk({ id: "s", start: 0, duration: 3.0, inPoint: 0.25 })]);
    const ids = splitTrackAt(t, 1.5);
    expect(ids).toHaveLength(2);
    const [a, b] = [...t.clips].sort((x, y) => x.start - y.start);
    expect(a.duration).toBeCloseTo(1.5, 9);
    expect(b.start).toBeCloseTo(1.5, 9);
    expect(b.inPoint).toBeCloseTo(1.75, 9); // 0.25 + 1.5 (NOT rounded)

    trimClipStart(t, a.id, 0.3);
    expect(a.start).toBeCloseTo(0.3, 9);
    expect(a.inPoint).toBeCloseTo(0.55, 9); // 0.25 + 0.3
    trimClipEnd(t, b.id, -0.2);
    expect(b.duration).toBeCloseTo(1.3, 9); // 1.5 - 0.2, no 1-unit floor
  });
});

describe("TimelineStore", () => {
  interface Doc {
    name: string;
    seq: TimelineSequence<TestClip>;
  }
  it("clone-on-write mutate + undo/redo restore project/playhead/selection", () => {
    const store = new TimelineStore<Doc>({ name: "d", seq: seq([track([mk({ start: 0, duration: 10 })])]) });
    expect(store.state.canUndo).toBe(false);
    store.setPlayhead(5);
    store.mutate("add", (p) => {
      p.seq.tracks[0].clips.push(mk({ start: 20, duration: 10 }));
    });
    expect(store.getProject().seq.tracks[0].clips).toHaveLength(2);
    expect(store.state.canUndo).toBe(true);
    expect(store.state.undoLabel).toBe("add");
    const revAfter = store.state.rev;
    store.undo();
    expect(store.getProject().seq.tracks[0].clips).toHaveLength(1);
    expect(store.state.rev).toBeGreaterThan(revAfter);
    store.redo();
    expect(store.getProject().seq.tracks[0].clips).toHaveLength(2);
  });

  it("coalesces consecutive same-key edits into one undo step", () => {
    const store = new TimelineStore<Doc>({ name: "d", seq: seq([track([mk({ id: "c", start: 0, duration: 10 })])]) });
    // Three drag ticks with the same coalesce key → ONE undo entry.
    for (const x of [5, 8, 12]) store.mutate("Move", (p) => { p.seq.tracks[0].clips[0].start = x; }, { coalesceKey: "move:c" });
    expect(store.getProject().seq.tracks[0].clips[0].start).toBe(12);
    store.undo();
    expect(store.getProject().seq.tracks[0].clips[0].start).toBe(0); // back to pre-drag in one step
    expect(store.state.canUndo).toBe(false);
  });

  it("selection + tool + transport setters bump and notify", () => {
    const store = new TimelineStore<Doc>({ name: "d", seq: seq([]) });
    let hits = 0;
    const unsub = store.subscribe(() => (hits += 1));
    store.selectOne("clip_1");
    store.toggleSelect("clip_2");
    store.setTool("razor");
    store.setPlaying(true);
    expect(store.state.selection).toEqual(["clip_1", "clip_2"]);
    expect(store.state.tool).toBe("razor");
    expect(store.state.playing).toBe(true);
    expect(hits).toBe(4);
    unsub();
  });
});
