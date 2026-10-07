// ─────────────────────────────────────────────────────────────
// commands.ts — the high-level editor command layer.
//
// Every command is undo-wrapped via `store.mutate` (structural edits) or is a
// pure UI/transport state change on the store. The menu bar, keyboard
// shortcuts, tool handlers and panels all call into here; this is the single
// place editorial intent becomes a model change. Pure geometry/timeline logic
// lives in timeline/ops — commands only resolve selection/sequence and dispatch.
// ─────────────────────────────────────────────────────────────

import { store } from "./state/app";
import {
  createClip,
  createEffect,
  createMedia,
  createProject,
  createSequence,
  createTrack,
} from "./timeline/model/factory";
import {
  activeSequence,
  audioTracks,
  findClip,
  findMedia,
  findTrack,
  nextEdge,
  prevEdge,
  sequenceDuration,
  videoTracks,
} from "./timeline/model/query";
import type { Clip, Id, Sequence, TrackKind, TransitionKind } from "./timeline/model/types";
import {
  addTrack,
  addTransition,
  duplicateClip,
  liftClips,
  moveClip,
  overwriteClip,
  placeMedia,
  removeTrack,
  rippleDeleteClips,
  setClipSpeed,
  slipClip,
  splitAllTracksAt,
  splitTrackAt,
  trimClipEnd,
  trimClipStart,
} from "./timeline/ops/edits";

/** Resolve the active sequence within a draft project (after clone). */
function seqOf(p: { sequences: Sequence[]; activeSequenceId: Id | null }): Sequence | null {
  return activeSequence(p as never);
}

// ── project ───────────────────────────────────────────────────
export function newProject(): void {
  store.replaceProject(createProject());
}

export function newSequence(): void {
  store.mutate("New Sequence", (p) => {
    const seq = createSequence({ name: `Sequence 0${p.sequences.length + 1}`, fps: p.fps, width: p.width, height: p.height });
    p.sequences.push(seq);
    p.activeSequenceId = seq.id;
  });
}

export function setActiveSequence(id: Id): void {
  store.mutate("Switch Sequence", (p) => {
    if (p.sequences.some((s) => s.id === id)) p.activeSequenceId = id;
  });
}

// ── tracks ────────────────────────────────────────────────────
export function addVideoTrack(): void {
  store.mutate("Add Video Track", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    const n = videoTracks(seq).length + 1;
    // Insert above existing video tracks (before the first audio track).
    const firstAudio = seq.tracks.findIndex((t) => t.kind === "audio");
    addTrack(seq, createTrack("video", `V${n}`), firstAudio < 0 ? undefined : firstAudio);
  });
}

export function addAudioTrack(): void {
  store.mutate("Add Audio Track", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    const n = seq.tracks.filter((t) => t.kind === "audio").length + 1;
    addTrack(seq, createTrack("audio", `A${n}`));
  });
}

export function deleteTrack(trackId: Id): void {
  store.mutate("Delete Track", (p) => {
    const seq = seqOf(p);
    if (seq) removeTrack(seq, trackId);
  });
}

function toggleTrackFlag(trackId: Id, flag: "enabled" | "locked" | "muted" | "solo", label: string): void {
  store.mutate(label, (p) => {
    const seq = seqOf(p);
    const t = seq?.tracks.find((x) => x.id === trackId);
    if (t) t[flag] = !t[flag];
  });
}
export const toggleTrackEnabled = (id: Id) => toggleTrackFlag(id, "enabled", "Toggle Track Output");
export const toggleTrackLock = (id: Id) => toggleTrackFlag(id, "locked", "Toggle Track Lock");
export const toggleTrackMute = (id: Id) => toggleTrackFlag(id, "muted", "Toggle Mute");
export const toggleTrackSolo = (id: Id) => toggleTrackFlag(id, "solo", "Toggle Solo");

// ── razor / delete ────────────────────────────────────────────
export function razorAtPlayhead(allTracks = true): void {
  const frame = store.state.playhead;
  store.mutate("Razor", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    if (allTracks) {
      splitAllTracksAt(seq, frame);
    } else {
      const activeId = store.state.activeTrackId;
      const t = seq.tracks.find((x) => x.id === activeId);
      if (t) splitTrackAt(t, frame);
    }
  });
}

export function deleteSelected(): void {
  const ids = store.selection;
  if (ids.length === 0) return;
  store.mutate("Delete", (p) => {
    const seq = seqOf(p);
    if (seq) liftClips(seq, ids);
  });
  store.clearSelection();
}

export function rippleDeleteSelected(): void {
  const ids = store.selection;
  if (ids.length === 0) return;
  store.mutate("Ripple Delete", (p) => {
    const seq = seqOf(p);
    if (seq) rippleDeleteClips(seq, ids);
  });
  store.clearSelection();
}

export function duplicateSelected(): void {
  const ids = store.selection;
  if (ids.length === 0) return;
  const newIds: Id[] = [];
  store.mutate("Duplicate", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    for (const id of ids) {
      const hit = findClip(seq, id);
      if (!hit) continue;
      const dup = duplicateClip(hit.clip);
      dup.start = hit.clip.start + hit.clip.duration;
      hit.track.clips.push(dup);
      newIds.push(dup.id);
    }
  });
  if (newIds.length) store.select(newIds);
}

export function nudgeSelected(deltaFrames: number): void {
  const ids = store.selection;
  if (ids.length === 0) return;
  store.mutate(deltaFrames > 0 ? "Nudge Right" : "Nudge Left", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    for (const id of ids) {
      const c = findClip(seq, id)?.clip;
      if (c) c.start = Math.max(0, c.start + deltaFrames);
    }
  });
}

export function setSelectedSpeed(speed: number): void {
  const ids = store.selection;
  store.mutate("Clip Speed", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    for (const id of ids) {
      const hit = findClip(seq, id);
      if (hit) setClipSpeed(hit.track, id, speed);
    }
  });
}

export function slipSelected(delta: number): void {
  const ids = store.selection;
  store.mutate("Slip", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    for (const id of ids) {
      const hit = findClip(seq, id);
      if (hit) slipClip(hit.track, id, delta);
    }
  });
}

export function addTransitionToSelected(kind: TransitionKind, durationFrames = 24): void {
  const ids = store.selection;
  store.mutate("Apply Transition", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    for (const id of ids) {
      addTransition(seq, id, "in", kind, durationFrames);
      addTransition(seq, id, "out", kind, durationFrames);
    }
  });
}

// ── transport ─────────────────────────────────────────────────
export function togglePlay(): void {
  store.setPlaying(!store.state.playing);
}
export function stop(): void {
  store.setPlaying(false);
}
export function stepFrame(delta: number): void {
  store.setPlayhead(store.state.playhead + delta);
}
export function goToStart(): void {
  store.setPlayhead(0);
}
export function goToEnd(): void {
  const seq = activeSequence(store.getProject());
  store.setPlayhead(seq ? sequenceDuration(seq) : 0);
}
export function goNextEdge(): void {
  const seq = activeSequence(store.getProject());
  if (seq) store.setPlayhead(nextEdge(seq, store.state.playhead));
}
export function goPrevEdge(): void {
  const seq = activeSequence(store.getProject());
  if (seq) store.setPlayhead(prevEdge(seq, store.state.playhead));
}
export function markIn(): void {
  store.setInPoint(store.state.playhead);
}
export function markOut(): void {
  store.setOutPoint(store.state.playhead);
}

// ── edit ──────────────────────────────────────────────────────
export function undo(): void {
  store.undo();
}
export function redo(): void {
  store.redo();
}
export function selectAll(): void {
  const seq = activeSequence(store.getProject());
  if (!seq) return;
  store.select(seq.tracks.flatMap((t) => t.clips.map((c) => c.id)));
}

export function addTrackByKind(kind: TrackKind): void {
  kind === "video" ? addVideoTrack() : addAudioTrack();
}

// ── place media on the timeline ───────────────────────────────────
/** Insert a bin item at the playhead: video on V1 (+ linked audio on A1). */
export function addMediaToTimeline(mediaId: Id): void {
  const at = store.state.playhead;
  const newIds: Id[] = [];
  store.mutate("Insert Clip", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    const media = findMedia(p, mediaId);
    if (!media) return;
    const dur = media.durationFrames > 0 ? media.durationFrames : Math.round(seq.fps * 5);

    let videoClip = null;
    if (media.kind !== "audio") {
      const vt = videoTracks(seq)[0];
      if (vt) {
        videoClip = placeMedia(vt, {
          mediaId,
          name: media.name,
          kind: media.kind === "image" ? "image" : "video",
          inPoint: 0,
          duration: dur,
          frame: at,
        });
        newIds.push(videoClip.id);
      }
    }
    if (media.hasAudio || media.kind === "audio") {
      const aTrack = audioTracks(seq)[0];
      if (aTrack) {
        const audioClip = placeMedia(aTrack, { mediaId, name: media.name, kind: "audio", inPoint: 0, duration: dur, frame: at });
        if (videoClip) {
          videoClip.linkedId = audioClip.id;
          audioClip.linkedId = videoClip.id;
        }
        newIds.push(audioClip.id);
      }
    }
  });
  if (newIds.length) store.select(newIds);
}

/** Drop a bin item onto a specific track at a frame (drag-from-bin). */
export function addMediaAt(mediaId: Id, trackId: Id, frame: number, ripple = false): void {
  const newIds: Id[] = [];
  store.mutate("Insert Clip", (p) => {
    const seq = seqOf(p);
    const media = seq ? findMedia(p, mediaId) : null;
    const track = seq ? findTrack(seq, trackId) : null;
    if (!seq || !media || !track) return;
    const audioOnly = media.kind === "audio";
    if ((track.kind === "audio") !== audioOnly && !(media.hasAudio && track.kind === "audio")) {
      // video media → video track; audio media → audio track.
      if (track.kind === "audio" && media.kind !== "audio" && !media.hasAudio) return;
      if (track.kind === "video" && media.kind === "audio") return;
    }
    const dur = media.durationFrames > 0 ? media.durationFrames : Math.round(seq.fps * 5);
    const clip = placeMedia(track, {
      mediaId,
      name: media.name,
      kind: track.kind === "audio" ? "audio" : media.kind === "image" ? "image" : "video",
      inPoint: 0,
      duration: dur,
      frame: Math.max(0, frame),
      ripple,
    });
    newIds.push(clip.id);
  });
  if (newIds.length) store.select(newIds);
}

/** Move a clip to a track + start (drag-to-move on the timeline). A linked
 *  partner (A/V pair) shifts by the same delta on its own track so audio and
 *  video stay in sync. */
export function moveClipTo(clipId: Id, toTrackId: Id, toStart: number): void {
  store.mutate("Move Clip", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    const hit = findClip(seq, clipId);
    if (!hit) return;
    const delta = Math.max(0, toStart) - hit.clip.start;
    const linkedId = hit.clip.linkedId;
    moveClip(seq, clipId, toTrackId, toStart);
    if (linkedId && delta !== 0) {
      const linked = findClip(seq, linkedId);
      if (linked) moveClip(seq, linkedId, linked.track.id, Math.max(0, linked.clip.start + delta));
    }
  });
}

/** Trim a clip head/tail by a frame delta (drag a trim handle). */
export function trimClip(clipId: Id, side: "start" | "end", delta: number): void {
  if (delta === 0) return;
  store.mutate(side === "start" ? "Trim In" : "Trim Out", (p) => {
    const seq = seqOf(p);
    const hit = seq ? findClip(seq, clipId) : null;
    if (!hit) return;
    if (side === "start") trimClipStart(hit.track, clipId, delta);
    else trimClipEnd(hit.track, clipId, delta);
  });
}

// ── 3-point editing from the Source monitor ───────────────────────
function sourceSpan(): { mediaId: Id; inPoint: number; duration: number } | null {
  const s = store.state;
  if (!s.sourceMediaId) return null;
  const inPoint = s.sourceIn;
  const duration = Math.max(1, s.sourceOut - s.sourceIn + 1);
  return { mediaId: s.sourceMediaId, inPoint, duration };
}

function editFromSource(label: string, ripple: boolean): void {
  const span = sourceSpan();
  if (!span) return;
  const at = store.state.playhead;
  const newIds: Id[] = [];
  store.mutate(label, (p) => {
    const seq = seqOf(p);
    const media = seq ? findMedia(p, span.mediaId) : null;
    if (!seq || !media) return;
    if (media.kind !== "audio") {
      const vt = videoTracks(seq)[0];
      if (vt) {
        const c = placeMedia(vt, { mediaId: media.id, name: media.name, kind: media.kind === "image" ? "image" : "video", inPoint: span.inPoint, duration: span.duration, frame: at, ripple });
        newIds.push(c.id);
      }
    }
    if (media.hasAudio || media.kind === "audio") {
      const aTrack = audioTracks(seq)[0];
      if (aTrack) {
        const c = placeMedia(aTrack, { mediaId: media.id, name: media.name, kind: "audio", inPoint: span.inPoint, duration: span.duration, frame: at, ripple });
        newIds.push(c.id);
      }
    }
  });
  if (newIds.length) {
    store.select(newIds);
    store.setPlayhead(at + (sourceSpan()?.duration ?? 0));
  }
}

export function insertFromSource(): void {
  editFromSource("Insert", true);
}
export function overwriteFromSource(): void {
  editFromSource("Overwrite", false);
}

// ── synthetic sources (color matte / title) ──────────────────────
/** Create a color-matte source + place it on the top video track at playhead. */
export function addColorMatte(color = "#1f2430"): void {
  const at = store.state.playhead;
  const newIds: Id[] = [];
  store.mutate("Add Color Matte", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    const dur = Math.round(seq.fps * 5);
    const media = createMedia({ name: "Color Matte", kind: "color", color, durationFrames: dur, fps: seq.fps, width: seq.width, height: seq.height });
    p.media.push(media);
    const vt = videoTracks(seq)[0];
    if (!vt) return;
    const clip = createClip({ mediaId: media.id, name: "Color Matte", kind: "color", start: at, duration: dur });
    overwriteClip(vt, clip);
    newIds.push(clip.id);
  });
  if (newIds.length) store.select(newIds);
}

/** Create a title source (rendered as a label placeholder) on the top track. */
export function addTitle(text = "Title"): void {
  const at = store.state.playhead;
  store.mutate("Add Title", (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    const dur = Math.round(seq.fps * 4);
    const media = createMedia({ name: text, kind: "image", durationFrames: dur, fps: seq.fps, width: seq.width, height: seq.height });
    p.media.push(media);
    const vt = videoTracks(seq)[0];
    if (vt) overwriteClip(vt, createClip({ mediaId: media.id, name: text, kind: "title", start: at, duration: dur }));
  });
}

// ── inspector edits (Effect Controls / Lumetri / Audio Mixer) ─────
/** Mutate a single clip by id under an undo step. */
export function editClip(clipId: Id, label: string, fn: (clip: Clip) => void): void {
  store.mutate(label, (p) => {
    const seq = seqOf(p);
    const c = seq ? findClip(seq, clipId)?.clip : null;
    if (c) fn(c);
  });
}

/** Mutate every selected clip under one undo step. */
export function editSelectedClips(label: string, fn: (clip: Clip) => void): void {
  const ids = store.selection;
  if (ids.length === 0) return;
  store.mutate(label, (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    for (const id of ids) {
      const c = findClip(seq, id)?.clip;
      if (c) fn(c);
    }
  });
}

/** Add a named effect to every selected clip under one undo step. */
export function addEffectToSelected(type: string, name: string, params: Record<string, number> = {}): void {
  const ids = store.selection;
  if (ids.length === 0) return;
  store.mutate(`Add ${name}`, (p) => {
    const seq = seqOf(p);
    if (!seq) return;
    for (const id of ids) {
      const c = findClip(seq, id)?.clip;
      if (c) c.effects.push(createEffect(type, name, params));
    }
  });
}

/** Set an audio track's level (dB) under an undo step. */
export function setTrackGain(trackId: Id, gain: number): void {
  store.mutate("Track Level", (p) => {
    const t = seqOf(p)?.tracks.find((x) => x.id === trackId);
    if (t) t.gain = gain;
  });
}
