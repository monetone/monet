// ─────────────────────────────────────────────────────────────
// ui/clip-commands.test — Clip ▸ Duplicate (Adobe Audition parity)
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { emptyProject, Generate, newClip, newMarker, Ops, RythmeStore, selectClips, selectRange, setPlayhead } from "../engine";
import { applyClipFade, duplicateSelectedClips, goToNextMarker, goToPrevMarker, groupSelectedClips, loopSelectedClips, loopSelection, mergeMarkersInSelection, nudgeClipGain, nudgeSelectedClips, resetClipGain, toggleClipLock, toggleClipMute, toggleLoop, ungroupSelectedClips } from "./commands";

const SR = 48000;

/** A store whose single track holds two clips; returns the store + clip ids. */
function storeWithClips() {
  const base = emptyProject("T", 1, SR);
  const tid = base.tracks[0].id;
  const a = newClip(Generate.sine(440, 1, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: tid, start: 1, name: "A" });
  const b = newClip(Generate.sine(330, 1, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: tid, start: 4, name: "B" });
  const project = Ops.addClip(Ops.addClip(base, tid, a), tid, b);
  return { store: new RythmeStore(project), tid, a, b };
}

describe("duplicateSelectedClips", () => {
  it("duplicates one selected clip, placing the copy right after it (shared buffer), and selects the copy", () => {
    const { store, tid, a } = storeWithClips();
    store.dispatch(selectClips([a.id]), { history: false });
    expect(duplicateSelectedClips(store)).toBe(true);

    const clips = store.getState().project.tracks.find((t) => t.id === tid)!.clips;
    expect(clips).toHaveLength(3);
    const copy = clips.find((c) => c.id !== a.id && c.name.includes("A"))!;
    expect(copy.start).toBeCloseTo(a.start + a.duration, 6); // end-to-end after the original
    expect(copy.buffer).toBe(a.buffer); // the copy shares the source PCM
    expect(store.getState().selection.clipIds).toEqual([copy.id]); // Audition selects the duplicate
  });

  it("duplicates every selected clip in a single undo step, with fresh distinct ids", () => {
    const { store, tid, a, b } = storeWithClips();
    store.dispatch(selectClips([a.id, b.id]), { history: false });
    const undoBefore = store.undoLabels().length;
    expect(duplicateSelectedClips(store)).toBe(true);

    const clips = store.getState().project.tracks.find((t) => t.id === tid)!.clips;
    expect(clips).toHaveLength(4);
    expect(new Set(clips.map((c) => c.id)).size).toBe(4); // every clip (incl. copies) has a distinct id
    expect(clips.some((c) => c.id === a.id) && clips.some((c) => c.id === b.id)).toBe(true); // both originals survive
    expect(store.getState().selection.clipIds).toHaveLength(2); // the two new copies are selected
    expect(store.getState().selection.clipIds.every((id) => id !== a.id && id !== b.id)).toBe(true);

    expect(store.undoLabels().length).toBe(undoBefore + 1); // one history entry for the whole batch (selection is history:false)
    expect(store.undoLabels().at(-1)).toBe("Duplicate Clips");

    store.undo();
    expect(store.getState().project.tracks.find((t) => t.id === tid)!.clips).toHaveLength(2);
  });

  it("is a no-op (returns false) with no clip selection", () => {
    const { store } = storeWithClips();
    expect(duplicateSelectedClips(store)).toBe(false);
    expect(store.getState().project.tracks[0].clips).toHaveLength(2);
  });
});

describe("nudgeClipGain / resetClipGain", () => {
  const gainOf = (store: RythmeStore, id: string) => store.getState().project.tracks[0].clips.find((c) => c.id === id)!.gainDb;

  it("nudges each selected clip's gain by the delta in one undo step", () => {
    const { store, a, b } = storeWithClips();
    store.dispatch(selectClips([a.id, b.id]), { history: false });
    const undoBefore = store.undoLabels().length;
    expect(nudgeClipGain(store, 3)).toBe(true);
    expect(gainOf(store, a.id)).toBeCloseTo(3, 6);
    expect(gainOf(store, b.id)).toBeCloseTo(3, 6);
    expect(store.undoLabels().length).toBe(undoBefore + 1);
    expect(store.undoLabels().at(-1)).toBe("Clip Gain +3 dB");

    expect(nudgeClipGain(store, -1)).toBe(true); // relative to the now-3 dB gain
    expect(gainOf(store, a.id)).toBeCloseTo(2, 6);

    store.undo();
    expect(gainOf(store, a.id)).toBeCloseTo(3, 6); // undo the −1 step
  });

  it("clamps the gain to [−60, +24] dB", () => {
    const { store, a } = storeWithClips();
    store.dispatch(selectClips([a.id]), { history: false });
    nudgeClipGain(store, 100);
    expect(gainOf(store, a.id)).toBe(24);
    nudgeClipGain(store, -1000);
    expect(gainOf(store, a.id)).toBe(-60);
  });

  it("resetClipGain returns the selected clips to 0 dB", () => {
    const { store, a } = storeWithClips();
    store.dispatch(selectClips([a.id]), { history: false });
    nudgeClipGain(store, 6);
    expect(gainOf(store, a.id)).toBeCloseTo(6, 6);
    expect(resetClipGain(store)).toBe(true);
    expect(gainOf(store, a.id)).toBe(0);
  });

  it("both are no-ops (return false) with no clip selection", () => {
    const { store } = storeWithClips();
    expect(nudgeClipGain(store, 3)).toBe(false);
    expect(resetClipGain(store)).toBe(false);
  });
});

describe("applyClipFade", () => {
  const clipOf = (store: RythmeStore, id: string) => store.getState().project.tracks[0].clips.find((c) => c.id === id)!;
  const rms = (ch: Float32Array, from: number, to: number) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += ch[i] * ch[i];
    return Math.sqrt(sum / (to - from));
  };

  it("sets the fade lengths + shape on each selected clip in one undo step", () => {
    const { store, a, b } = storeWithClips();
    store.dispatch(selectClips([a.id, b.id]), { history: false });
    const undoBefore = store.undoLabels().length;
    expect(applyClipFade(store, { fadeIn: 0.5, fadeInShape: "equalPower" }, "Clip Fade In")).toBe(true);

    expect(clipOf(store, a.id).fadeIn).toBeCloseTo(0.5, 6);
    expect(clipOf(store, a.id).fadeInShape).toBe("equalPower");
    expect(clipOf(store, b.id).fadeIn).toBeCloseTo(0.5, 6);
    expect(store.undoLabels().length).toBe(undoBefore + 1);

    store.undo();
    expect(clipOf(store, a.id).fadeIn).toBe(0);
  });

  it("clamps a fade longer than the clip to the clip duration", () => {
    const { store, a } = storeWithClips(); // clips are 1 s
    store.dispatch(selectClips([a.id]), { history: false });
    applyClipFade(store, { fadeIn: 5 }, "Clip Fade In");
    expect(clipOf(store, a.id).fadeIn).toBeCloseTo(1, 6);
  });

  it("Clear Fades zeroes both fades", () => {
    const { store, a } = storeWithClips();
    store.dispatch(selectClips([a.id]), { history: false });
    applyClipFade(store, { fadeIn: 0.5, fadeOut: 0.5 }, "Clip Fades");
    applyClipFade(store, { fadeIn: 0, fadeOut: 0 }, "Clear Clip Fades");
    expect(clipOf(store, a.id).fadeIn).toBe(0);
    expect(clipOf(store, a.id).fadeOut).toBe(0);
  });

  it("the fade attenuates the rendered clip's start (renderClip applies it)", () => {
    const { store, a } = storeWithClips(); // 1 s tone at full amplitude
    store.dispatch(selectClips([a.id]), { history: false });
    applyClipFade(store, { fadeIn: 0.5 }, "Clip Fade In");
    const rendered = Ops.renderClip(clipOf(store, a.id)).channels[0];
    const q = Math.floor(rendered.length / 4);
    expect(rms(rendered, 0, q)).toBeLessThan(rms(rendered, 3 * q, 4 * q)); // faded head quieter than the tail
  });

  it("is a no-op (returns false) with no clip selection", () => {
    const { store } = storeWithClips();
    expect(applyClipFade(store, { fadeIn: 0.5 }, "Clip Fade In")).toBe(false);
  });
});

describe("groupSelectedClips / ungroupSelectedClips", () => {
  const groupOf = (store: RythmeStore, id: string) => store.getState().project.tracks[0].clips.find((c) => c.id === id)!.groupId;

  it("groups the selected clips under one id, and ungroup clears it (one undo step each)", () => {
    const { store, a, b } = storeWithClips();
    store.dispatch(selectClips([a.id, b.id]), { history: false });
    expect(groupSelectedClips(store)).toBe(true);
    const g = groupOf(store, a.id);
    expect(g).toBeDefined();
    expect(groupOf(store, b.id)).toBe(g);
    expect(store.undoLabels().at(-1)).toBe("Group Clips");

    expect(ungroupSelectedClips(store)).toBe(true);
    expect(groupOf(store, a.id)).toBeUndefined();
    expect(store.undoLabels().at(-1)).toBe("Ungroup Clips");
  });

  it("group needs ≥ 2 clips; both are no-ops on an empty selection", () => {
    const { store, a } = storeWithClips();
    store.dispatch(selectClips([a.id]), { history: false });
    expect(groupSelectedClips(store)).toBe(false); // only one selected
    store.dispatch(selectClips([]), { history: false });
    expect(groupSelectedClips(store)).toBe(false);
    expect(ungroupSelectedClips(store)).toBe(false);
  });
});

describe("toggleClipMute", () => {
  const mutedOf = (store: RythmeStore, id: string) => store.getState().project.tracks[0].clips.find((c) => c.id === id)!.muted;

  it("mutes the selected clips in one undo step, then toggles them back to audible", () => {
    const { store, a, b } = storeWithClips();
    store.dispatch(selectClips([a.id, b.id]), { history: false });
    const undoBefore = store.undoLabels().length;
    expect(toggleClipMute(store)).toBe(true);
    expect(mutedOf(store, a.id)).toBe(true);
    expect(mutedOf(store, b.id)).toBe(true);
    expect(store.undoLabels().length).toBe(undoBefore + 1);
    expect(store.undoLabels().at(-1)).toBe("Mute Clips");

    expect(toggleClipMute(store)).toBe(true); // all muted → un-mute all
    expect(mutedOf(store, a.id)).toBe(false);
    expect(store.undoLabels().at(-1)).toBe("Unmute Clips");

    store.undo();
    expect(mutedOf(store, a.id)).toBe(true); // undo the un-mute
  });

  it("mutes every selected clip on a mixed selection (any audible → mute all, not per-clip toggle)", () => {
    const { store, a, b } = storeWithClips();
    store.dispatch(selectClips([a.id]), { history: false });
    toggleClipMute(store); // a muted, b audible
    store.dispatch(selectClips([a.id, b.id]), { history: false });
    expect(toggleClipMute(store)).toBe(true);
    expect(mutedOf(store, a.id)).toBe(true);
    expect(mutedOf(store, b.id)).toBe(true); // the audible one became muted
  });

  it("is a no-op (returns false) with no clip selection", () => {
    const { store } = storeWithClips();
    expect(toggleClipMute(store)).toBe(false);
  });
});

describe("toggleClipLock", () => {
  const lockedOf = (store: RythmeStore, id: string) => store.getState().project.tracks[0].clips.find((c) => c.id === id)!.locked;

  it("locks the selected clips in one undo step, then toggles them back to movable", () => {
    const { store, a, b } = storeWithClips();
    store.dispatch(selectClips([a.id, b.id]), { history: false });
    const undoBefore = store.undoLabels().length;
    expect(toggleClipLock(store)).toBe(true);
    expect(lockedOf(store, a.id)).toBe(true);
    expect(lockedOf(store, b.id)).toBe(true);
    expect(store.undoLabels().length).toBe(undoBefore + 1);
    expect(store.undoLabels().at(-1)).toBe("Lock Clips");

    expect(toggleClipLock(store)).toBe(true); // all locked → unlock all
    expect(lockedOf(store, a.id)).toBe(false);
    expect(store.undoLabels().at(-1)).toBe("Unlock Clips");

    store.undo();
    expect(lockedOf(store, a.id)).toBe(true); // undo the unlock
  });

  it("a locked clip can't be moved via the move command path", () => {
    const { store, a } = storeWithClips();
    store.dispatch(selectClips([a.id]), { history: false });
    toggleClipLock(store);
    const before = store.getState().project.tracks[0].clips.find((c) => c.id === a.id)!.start;
    store.dispatch((s) => ({ ...s, project: Ops.moveClip(s.project, a.id, before + 5) }), { label: "Move" });
    expect(store.getState().project.tracks[0].clips.find((c) => c.id === a.id)!.start).toBe(before); // unchanged
  });

  it("is a no-op (returns false) with no clip selection", () => {
    const { store } = storeWithClips();
    expect(toggleClipLock(store)).toBe(false);
  });
});

describe("nudgeSelectedClips", () => {
  const startOf = (store: RythmeStore, id: string) => store.getState().project.tracks[0].clips.find((c) => c.id === id)!.start;

  it("nudges the selected clips along the timeline in one undo step", () => {
    const { store, a, b } = storeWithClips(); // a@1, b@4
    store.dispatch(selectClips([a.id, b.id]), { history: false });
    const undoBefore = store.undoLabels().length;
    expect(nudgeSelectedClips(store, 0.5)).toBe(true);
    expect(startOf(store, a.id)).toBeCloseTo(1.5, 6);
    expect(startOf(store, b.id)).toBeCloseTo(4.5, 6);
    expect(store.undoLabels().length).toBe(undoBefore + 1);
    expect(store.undoLabels().at(-1)).toBe("Nudge Clips Right");

    store.undo();
    expect(startOf(store, a.id)).toBeCloseTo(1.0, 6);
  });

  it("clamps a leftward nudge so a clip can't cross t=0", () => {
    const { store, a } = storeWithClips();
    store.dispatch(selectClips([a.id]), { history: false });
    expect(nudgeSelectedClips(store, -5)).toBe(true); // a is at 1
    expect(startOf(store, a.id)).toBe(0);
  });

  it("moves a group once as a unit (not once per selected member)", () => {
    const { store, a, b } = storeWithClips();
    store.dispatch(selectClips([a.id, b.id]), { history: false });
    groupSelectedClips(store);
    store.dispatch(selectClips([a.id, b.id]), { history: false });
    nudgeSelectedClips(store, 0.5);
    expect(startOf(store, a.id)).toBeCloseTo(1.5, 6); // +0.5 once, not +1.0
    expect(startOf(store, b.id)).toBeCloseTo(4.5, 6);
  });

  it("doesn't move a locked clip and adds no undo step when nothing moves", () => {
    const { store, a } = storeWithClips();
    store.dispatch(selectClips([a.id]), { history: false });
    toggleClipLock(store); // lock a
    const undoBefore = store.undoLabels().length;
    expect(nudgeSelectedClips(store, 0.5)).toBe(true);
    expect(startOf(store, a.id)).toBe(1); // unchanged
    expect(store.undoLabels().length).toBe(undoBefore); // no clip moved → no undo step
  });

  it("adds no undo step when a clip already at t=0 is nudged further left (clamped no-op move)", () => {
    const base = emptyProject("T", 1, SR);
    const tid = base.tracks[0].id;
    const c = newClip(Generate.sine(440, 1, { sampleRate: SR, channels: 2 }), { trackId: tid, start: 0, name: "z" });
    const store = new RythmeStore(Ops.addClip(base, tid, c));
    store.dispatch(selectClips([c.id]), { history: false });
    const undoBefore = store.undoLabels().length;
    expect(nudgeSelectedClips(store, -0.1)).toBe(true);
    expect(store.getState().project.tracks[0].clips[0].start).toBe(0); // stays at the floor
    expect(store.undoLabels().length).toBe(undoBefore); // clamped no-op → no undo step
  });

  it("is a no-op (returns false) with no clip selection", () => {
    const { store } = storeWithClips();
    expect(nudgeSelectedClips(store, 0.5)).toBe(false);
  });
});

describe("loopSelectedClips", () => {
  const clipOf = (store: RythmeStore, id: string) => store.getState().project.tracks[0].clips.find((c) => c.id === id)!;

  it("loops the selected clips ×N (duration = N× source) in one undo step; No Loop resets", () => {
    const { store, a } = storeWithClips(); // a's source is 1 s
    store.dispatch(selectClips([a.id]), { history: false });
    const undoBefore = store.undoLabels().length;
    expect(loopSelectedClips(store, 3)).toBe(true);
    expect(clipOf(store, a.id).looped).toBe(true);
    expect(clipOf(store, a.id).duration).toBeCloseTo(3, 6);
    expect(store.undoLabels().length).toBe(undoBefore + 1);
    expect(store.undoLabels().at(-1)).toBe("Loop Clip ×3");

    expect(loopSelectedClips(store, 1)).toBe(true); // No Loop
    expect(clipOf(store, a.id).looped).toBe(false);
    expect(clipOf(store, a.id).duration).toBeCloseTo(1, 6);
    expect(store.undoLabels().at(-1)).toBe("Clip Loop Off");
  });

  it("is a no-op (returns false) with no clip selection", () => {
    const { store } = storeWithClips();
    expect(loopSelectedClips(store, 2)).toBe(false);
  });
});

describe("loopSelection / toggleLoop", () => {
  it("loopSelection sets the transport loop region to the selection and enables looping", () => {
    const store = new RythmeStore(emptyProject("T", 1, SR));
    expect(loopSelection(store)).toBe(false); // no time selection → no-op
    store.dispatch(selectRange({ start: 2, end: 5 }, []), { history: false });
    const undoBefore = store.undoLabels().length;
    expect(loopSelection(store)).toBe(true);
    const t = store.getState().transport;
    expect(t.loop).toEqual({ start: 2, end: 5 });
    expect(t.loopEnabled).toBe(true);
    expect(store.undoLabels().length).toBe(undoBefore); // transport state — no undo step
  });

  it("toggleLoop loops the selection when enabling and clears the flag when disabling", () => {
    const store = new RythmeStore(emptyProject("T", 1, SR));
    store.dispatch(selectRange({ start: 1, end: 4 }, []), { history: false });
    toggleLoop(store); // off → on with a selection
    expect(store.getState().transport.loopEnabled).toBe(true);
    expect(store.getState().transport.loop).toEqual({ start: 1, end: 4 });
    toggleLoop(store); // on → off
    expect(store.getState().transport.loopEnabled).toBe(false);
  });

  it("toggleLoop enables the flag with no region when there is no selection", () => {
    const store = new RythmeStore(emptyProject("T", 1, SR));
    toggleLoop(store);
    expect(store.getState().transport.loopEnabled).toBe(true);
    expect(store.getState().transport.loop).toBeNull();
  });
});

describe("mergeMarkersInSelection", () => {
  it("merges markers in the time selection in one undo step; no-ops otherwise", () => {
    const base = emptyProject("T", 1, SR);
    const store = new RythmeStore({ ...base, markers: [newMarker({ time: 1, name: "a" }), newMarker({ time: 2, name: "b" }), newMarker({ time: 9, name: "c" })] });
    expect(mergeMarkersInSelection(store)).toBe(false); // no time selection

    store.dispatch(selectRange({ start: 0, end: 3 }, []), { history: false });
    const undoBefore = store.undoLabels().length;
    expect(mergeMarkersInSelection(store)).toBe(true);
    expect(store.getState().project.markers).toHaveLength(2); // {region 1..2} + {9}
    expect(store.getState().project.markers.find((m) => m.kind === "region")).toBeDefined();
    expect(store.undoLabels().length).toBe(undoBefore + 1);
    expect(store.undoLabels().at(-1)).toBe("Merge Markers");

    store.undo();
    expect(store.getState().project.markers).toHaveLength(3);

    store.dispatch(selectRange({ start: 8, end: 10 }, []), { history: false });
    expect(mergeMarkersInSelection(store)).toBe(false); // only one marker (9) in range
  });
});

describe("goToNextMarker / goToPrevMarker", () => {
  const playhead = (store: RythmeStore) => store.getState().transport.playhead;

  it("moves the playhead to the next / previous marker, no-op past the ends", () => {
    const base = emptyProject("T", 1, SR);
    const store = new RythmeStore({ ...base, markers: [newMarker({ time: 2 }), newMarker({ time: 5 })] });
    store.dispatch(setPlayhead(0), { history: false });

    expect(goToNextMarker(store)).toBe(true);
    expect(playhead(store)).toBe(2);
    expect(goToNextMarker(store)).toBe(true);
    expect(playhead(store)).toBe(5);
    expect(goToNextMarker(store)).toBe(false); // no marker after the last one
    expect(playhead(store)).toBe(5);

    expect(goToPrevMarker(store)).toBe(true);
    expect(playhead(store)).toBe(2);
    expect(goToPrevMarker(store)).toBe(false); // no marker before the first one
    expect(playhead(store)).toBe(2);
  });

  it("seeking does not add an undo step, and both no-op without markers", () => {
    const store = new RythmeStore(emptyProject("T", 1, SR));
    const undoBefore = store.undoLabels().length;
    expect(goToNextMarker(store)).toBe(false);
    expect(goToPrevMarker(store)).toBe(false);

    const withMarker = new RythmeStore({ ...emptyProject("T", 1, SR), markers: [newMarker({ time: 3 })] });
    withMarker.dispatch(setPlayhead(0), { history: false });
    expect(goToNextMarker(withMarker)).toBe(true);
    expect(withMarker.undoLabels().length).toBe(undoBefore); // playhead seek is history:false
  });
});
