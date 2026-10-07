import { beforeEach, describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { channelCount, durationSeconds, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { generateSilence } from "../generate/silence";
import { peakAmplitude, rmsAmplitude } from "../dsp/normalize";
import { applyGainDb } from "../dsp/gain";
import { emptyProject, newAutomationLane, newBus, newClip, newEffectRack, newEffectSlot, newSend, newTrack } from "../model/factory";
import { resetIds } from "../model/ids";
import { clipById, clipEnd, projectDuration } from "../model/query";
import type { Project } from "../model/types";
import { addClip, duplicateClip, groupClips, moveClip, setClipLocked, setClipLoop, setClipMuted, splitAt, splitTrackAt, trimClipEdges } from "./clip";
import { deleteRange, insertSilence, silenceRange, trimToRange } from "./range";
import { copyRange, cutRange, pasteAt } from "./clipboard";
import { applyEffectToClip, applyEffectToRange } from "./effect";
import { mixdown, renderClip, renderProject, renderTrack } from "./render";

const SR = 48000;

/** A project with one track holding one 2-second clip starting at t=0. */
function oneClipProject(): { project: Project; trackId: string; clipId: string } {
  resetIds();
  let project = emptyProject("Test", 0, SR);
  const track = newTrack(0, { name: "T1" });
  project = { ...project, tracks: [track] };
  const clip = newClip(sine(440, 2, { sampleRate: SR, amplitude: 0.8, channels: 2 }), {
    trackId: track.id,
    name: "tone",
    start: 0,
  });
  project = addClip(project, track.id, clip);
  return { project, trackId: track.id, clipId: clip.id };
}

function segmentRms(audio: AudioData, startSec: number, endSec: number, channel = 0): number {
  return rmsAmplitude({
    sampleRate: audio.sampleRate,
    channels: [audio.channels[channel].slice(Math.round(startSec * audio.sampleRate), Math.round(endSec * audio.sampleRate))],
  });
}

describe("clip splitting", () => {
  it("splits a clip into two contiguous halves", () => {
    const { project, trackId } = oneClipProject();
    const out = splitAt(project, 1.0, [trackId]);
    const clips = out.tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0].start).toBe(0);
    expect(clips[0].duration).toBeCloseTo(1.0);
    expect(clips[1].start).toBeCloseTo(1.0);
    expect(clips[1].inPoint).toBeCloseTo(1.0);
    expect(clipEnd(clips[1])).toBeCloseTo(2.0);
  });

  it("does not split when the time is outside the clip", () => {
    const { project } = oneClipProject();
    expect(splitTrackAt(project.tracks[0], 5).clips).toHaveLength(1);
  });

  it("split halves render to the same total content as the original", () => {
    const { project, trackId, clipId } = oneClipProject();
    const original = renderClip(clipById(project, clipId)!.clip);
    const out = splitAt(project, 1.0, [trackId]);
    const a = renderClip(out.tracks[0].clips[0]);
    const b = renderClip(out.tracks[0].clips[1]);
    expect(frameCount(a) + frameCount(b)).toBe(frameCount(original));
  });
});

describe("clip moves & edits", () => {
  it("moveClip repositions within a track", () => {
    const { project, clipId } = oneClipProject();
    const out = moveClip(project, clipId, 3.5);
    expect(clipById(out, clipId)!.clip.start).toBe(3.5);
  });

  it("moveClip relocates to another track", () => {
    const { project, clipId, trackId } = oneClipProject();
    let p = { ...project, tracks: [...project.tracks, newTrack(1, { id: "track-x", name: "T2" })] };
    p = moveClip(p, clipId, 1, "track-x");
    expect(p.tracks.find((t) => t.id === trackId)!.clips).toHaveLength(0);
    expect(p.tracks.find((t) => t.id === "track-x")!.clips).toHaveLength(1);
  });

  it("duplicateClip places a copy after the original by default", () => {
    const { project, clipId } = oneClipProject();
    const out = duplicateClip(project, clipId);
    expect(out.tracks[0].clips).toHaveLength(2);
    expect(out.tracks[0].clips[1].start).toBeCloseTo(2.0);
  });

  it("a duplicated clip inherits the original's mute (mute is an intrinsic clip property, unlike groupId)", () => {
    const { project, clipId } = oneClipProject();
    const out = duplicateClip(setClipMuted(project, clipId, true), clipId);
    expect(out.tracks[0].clips[1].muted).toBe(true); // the copy stays muted (no group-style reset)
  });

  it("trimClipEdges moves the left edge into the source", () => {
    const { project, clipId } = oneClipProject();
    const out = trimClipEdges(project, clipId, 0.5, 0);
    const c = clipById(out, clipId)!.clip;
    expect(c.start).toBeCloseTo(0.5);
    expect(c.inPoint).toBeCloseTo(0.5);
    expect(c.duration).toBeCloseTo(1.5);
  });

  it("a clip locked in time can't be moved; unlocking restores movability", () => {
    const { project, clipId } = oneClipProject();
    const locked = setClipLocked(project, clipId, true);
    expect(clipById(locked, clipId)!.clip.locked).toBe(true);
    expect(moveClip(locked, clipId, 3.5)).toBe(locked); // locked → no-op (same project ref)

    const unlocked = setClipLocked(locked, clipId, false);
    expect(clipById(moveClip(unlocked, clipId, 3.5), clipId)!.clip.start).toBe(3.5); // movable again
  });

  it("a group can't move while any member is locked in time", () => {
    const { project, trackId, clipId } = oneClipProject();
    const c2 = newClip(sine(330, 1, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId, name: "b", start: 4 });
    let p = addClip(project, trackId, c2);
    p = groupClips(p, [clipId, c2.id]);
    p = setClipLocked(p, clipId, true); // lock one member of the group
    expect(moveClip(p, c2.id, 9)).toBe(p); // dragging the unlocked sibling can't move the locked group
  });

  it("a duplicated clip is movable even when the source is locked", () => {
    const { project, clipId } = oneClipProject();
    const out = duplicateClip(setClipLocked(project, clipId, true), clipId);
    expect(out.tracks[0].clips[1].locked).toBeUndefined(); // the copy is unlocked (it was just placed)
  });

  it("a duplicated clip inherits the original's loop (loop is an intrinsic playback property, like mute)", () => {
    const { project, clipId } = oneClipProject();
    const out = duplicateClip(setClipLoop(project, clipId, 2), clipId);
    expect(out.tracks[0].clips[1].looped).toBe(true); // the copy stays looped (no group-style reset)
  });
});

describe("clip loop", () => {
  it("setClipLoop ×N sets the duration to N copies of the source and marks it looped; ×1 turns it off", () => {
    const { project, clipId } = oneClipProject(); // 2 s source, inPoint 0
    const base = durationSeconds(clipById(project, clipId)!.clip.buffer);
    const out = setClipLoop(project, clipId, 3);
    expect(clipById(out, clipId)!.clip.looped).toBe(true);
    expect(clipById(out, clipId)!.clip.duration).toBeCloseTo(3 * base, 6);

    const off = setClipLoop(out, clipId, 1);
    expect(off.tracks[0].clips[0].looped).toBe(false);
    expect(off.tracks[0].clips[0].duration).toBeCloseTo(base, 6);
  });

  it("renderClip tiles a looped clip's source to fill the duration (vs silence when not looped)", () => {
    const src = sine(440, 0.5, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const clip = newClip(src, { trackId: "t1", start: 0, name: "loop" });
    const base = durationSeconds(src);
    const srcFrames = frameCount(src);

    const looped = renderClip({ ...clip, looped: true, duration: 2 * base });
    expect(frameCount(looped)).toBe(2 * srcFrames);
    expect(looped.channels[0][srcFrames + 10]).toBeCloseTo(looped.channels[0][10], 6); // 2nd copy == 1st (tiled)
    expect(peakAmplitude({ sampleRate: SR, channels: [looped.channels[0].slice(srcFrames)] })).toBeGreaterThan(0.4); // not silent

    const padded = renderClip({ ...clip, looped: false, duration: 2 * base });
    expect(peakAmplitude({ sampleRate: SR, channels: [padded.channels[0].slice(srcFrames)] })).toBeLessThan(1e-6); // silence past the source
  });
});

describe("range edits", () => {
  it("ripple-delete removes a span and shifts later audio left", () => {
    const { project, trackId } = oneClipProject();
    const out = deleteRange(project, 0.5, 1.0, [trackId], true);
    // total duration shrinks by 0.5s
    expect(projectDuration(out)).toBeCloseTo(1.5, 2);
  });

  it("silence (non-ripple) leaves a gap, preserving total length", () => {
    const { project, trackId } = oneClipProject();
    const out = silenceRange(project, 0.5, 1.0, [trackId]);
    expect(projectDuration(out)).toBeCloseTo(2.0, 2);
    // the gap region renders as silence
    const rendered = renderTrack(out.tracks[0], SR, 2);
    const gapStart = Math.round(0.6 * SR);
    expect(Math.abs(rendered.channels[0][gapStart])).toBeLessThan(1e-6);
  });

  it("insertSilence pushes later audio right", () => {
    const { project, trackId } = oneClipProject();
    const out = insertSilence(project, 1.0, 0.5, [trackId]);
    expect(projectDuration(out)).toBeCloseTo(2.5, 2);
  });

  it("trimToRange keeps only the selected span at t=0", () => {
    const { project, trackId } = oneClipProject();
    const out = trimToRange(project, 0.5, 1.5, [trackId]);
    expect(projectDuration(out)).toBeCloseTo(1.0, 2);
    expect(out.tracks[0].clips[0].start).toBeCloseTo(0);
  });
});

describe("clipboard", () => {
  it("copy then paste duplicates the range elsewhere", () => {
    const { project, trackId } = oneClipProject();
    const clip = copyRange(project, 0, 1, [trackId]);
    expect(clip.duration).toBe(1);
    expect(clip.tracks[0].clips).toHaveLength(1);
    const out = pasteAt(project, 1.0, clip);
    expect(out.tracks[0].clips.length).toBeGreaterThan(1);
  });

  it("cut removes the range and returns it on the clipboard", () => {
    const { project, trackId } = oneClipProject();
    const { project: after, clipboard } = cutRange(project, 0, 1, [trackId]);
    expect(projectDuration(after)).toBeCloseTo(1.0, 2);
    expect(clipboard.tracks[0].clips[0].duration).toBeCloseTo(1.0);
  });

  it("ripple paste shifts existing audio to make room", () => {
    const { project, trackId } = oneClipProject();
    const clip = copyRange(project, 0, 1, [trackId]);
    const out = pasteAt(project, 0, clip, { ripple: true });
    expect(projectDuration(out)).toBeCloseTo(3.0, 1);
  });
});

describe("effects baking", () => {
  it("applyEffectToClip bakes gain and resets the clip's trims", () => {
    const { project, clipId } = oneClipProject();
    const before = peakAmplitude(renderClip(clipById(project, clipId)!.clip));
    const out = applyEffectToClip(project, clipId, (d) => applyGainDb(d, -6));
    const c = clipById(out, clipId)!.clip;
    expect(c.gainDb).toBe(0);
    expect(c.inPoint).toBe(0);
    expect(peakAmplitude(c.buffer)).toBeCloseTo(before * 0.501, 1);
  });

  it("applyEffectToRange affects only clips inside the range", () => {
    const { project, trackId } = oneClipProject();
    const out = applyEffectToRange(project, 0.5, 1.0, [trackId], (d) => applyGainDb(d, -200));
    // the middle clip becomes (near) silent; flanks keep energy
    const clips = out.tracks[0].clips.sort((a, b) => a.start - b.start);
    expect(clips.length).toBeGreaterThanOrEqual(3);
    const mid = clips.find((c) => Math.abs(c.start - 0.5) < 1e-6)!;
    expect(peakAmplitude(renderClip(mid))).toBeLessThan(1e-3);
  });
});

describe("rendering & mixdown", () => {
  beforeEach(() => resetIds());

  it("renderClip applies the clip's fades", () => {
    const clip = newClip(sine(440, 1, { sampleRate: SR, amplitude: 1 }), {
      trackId: "t",
      fadeIn: 0.1,
      fadeOut: 0.1,
    });
    const r = renderClip(clip);
    expect(Math.abs(r.channels[0][0])).toBeLessThan(1e-6);
  });

  it("renderTrack places a clip at its start offset", () => {
    const track = newTrack(0);
    const clip = newClip(sine(440, 0.5, { sampleRate: SR, amplitude: 0.8 }), { trackId: track.id, start: 1.0 });
    const t2 = { ...track, clips: [clip] };
    const r = renderTrack(t2, SR, 2);
    expect(durationSeconds(r)).toBeCloseTo(1.5, 1);
    // silence before the clip starts
    expect(Math.abs(r.channels[0][Math.round(0.5 * SR)])).toBeLessThan(1e-6);
    // signal within the clip
    expect(rmsAmplitude({ sampleRate: SR, channels: [r.channels[0].slice(Math.round(1.1 * SR), Math.round(1.4 * SR))] })).toBeGreaterThan(0.1);
  });

  it("mixdown sums two tracks (mute respected)", () => {
    let project = emptyProject("Mix", 0, SR);
    const t1 = newTrack(0);
    const t2 = newTrack(1);
    project = { ...project, tracks: [t1, t2] };
    project = addClip(project, t1.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.5 }), { trackId: t1.id }));
    project = addClip(project, t2.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.5 }), { trackId: t2.id }));
    const both = peakAmplitude(renderProject(project));
    // muting one track lowers the peak
    const muted = { ...project, tracks: [project.tracks[0], { ...project.tracks[1], mute: true }] };
    expect(peakAmplitude(mixdown(muted))).toBeLessThan(both);
  });

  it("renderProject honors solo", () => {
    let project = emptyProject("Mix", 0, SR);
    const t1 = newTrack(0);
    const t2 = newTrack(1);
    project = { ...project, tracks: [t1, t2] };
    project = addClip(project, t1.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.5 }), { trackId: t1.id }));
    project = addClip(project, t2.id, newClip(generateSilence(1, 2, SR), { trackId: t2.id }));
    project = { ...project, tracks: [{ ...project.tracks[0], solo: false }, { ...project.tracks[1], solo: true }] };
    // only the (silent) soloed track is audible → near silence
    expect(peakAmplitude(renderProject(project))).toBeLessThan(1e-6);
  });

  it("a muted clip renders silent but keeps its place on the timeline", () => {
    let project = emptyProject("Mute", 0, SR);
    const t = newTrack(0);
    project = { ...project, tracks: [t] };
    const clip = newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.5 }), { trackId: t.id, start: 1 });
    project = addClip(project, t.id, clip);
    const audiblePeak = peakAmplitude(renderProject(project));
    const audibleDur = projectDuration(project);
    expect(audiblePeak).toBeGreaterThan(0.4);

    const muted = setClipMuted(project, clip.id, true);
    expect(clipById(muted, clip.id)!.clip.muted).toBe(true);
    expect(peakAmplitude(renderProject(muted))).toBeLessThan(1e-6); // contributes silence to the mix
    expect(projectDuration(muted)).toBe(audibleDur); // still occupies the timeline (no length change)

    const unmuted = setClipMuted(muted, clip.id, false);
    expect(clipById(unmuted, clip.id)!.clip.muted).toBe(false);
    expect(peakAmplitude(renderProject(unmuted))).toBeCloseTo(audiblePeak, 6); // unmute restores the audio
  });

  it("renderProject applies persistent track effect racks without baking clip buffers", () => {
    let project = emptyProject("Rack", 0, SR);
    const track = newTrack(0, {
      effectRack: newEffectRack({ slots: [newEffectSlot("gain", { params: { gainDb: -6 } })] }),
    });
    project = { ...project, tracks: [track] };
    const source = sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 });
    project = addClip(project, track.id, newClip(source, { trackId: track.id }));

    const rendered = peakAmplitude(renderProject(project));
    expect(rendered).toBeLessThan(0.5);
    expect(peakAmplitude(source)).toBeGreaterThan(0.7); // source data stays unbaked
  });

  it("renderClip applies persistent clip effect racks without baking clip buffers", () => {
    const source = sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 });
    const clip = newClip(source, {
      trackId: "track-a",
      effectRack: newEffectRack({ slots: [newEffectSlot("gain", { params: { gainDb: -12 } })] }),
    });

    expect(peakAmplitude(renderClip(clip))).toBeLessThan(0.25);
    expect(peakAmplitude(source)).toBeGreaterThan(0.7);
  });

  it("renderProject applies persistent compressor slots without baking clip buffers", () => {
    let project = emptyProject("Compressor rack", 0, SR);
    const track = newTrack(0, {
      effectRack: newEffectRack({
        slots: [
          newEffectSlot("compressor", {
            params: { thresholdDb: -30, ratio: 20, attackMs: 0.1, releaseMs: 30, kneeDb: 0, makeupDb: 0 },
          }),
        ],
      }),
    });
    project = { ...project, tracks: [track] };
    const source = sine(440, 2, { sampleRate: SR, amplitude: 0.9, channels: 2 });
    project = addClip(project, track.id, newClip(source, { trackId: track.id }));

    const rendered = renderProject(project);
    const dryTail = rmsAmplitude({ sampleRate: SR, channels: source.channels.map((ch) => ch.slice(SR)) });
    const compressedTail = rmsAmplitude({ sampleRate: SR, channels: rendered.channels.map((ch) => ch.slice(SR)) });
    expect(compressedTail).toBeLessThan(dryTail * 0.4);
    expect(peakAmplitude(source)).toBeGreaterThan(0.8); // source data stays unbaked
  });

  it("renderProject applies persistent master limiter slots", () => {
    const limiter = newEffectSlot("limiter", {
      params: { ceilingDb: -6, inputBoostDb: 0, lookAheadMs: 5, releaseMs: 50 },
    });
    let project: Project = { ...emptyProject("Limiter rack", 0, SR), masterEffectRack: newEffectRack({ slots: [limiter] }) };
    const track = newTrack(0);
    project = { ...project, tracks: [track] };
    const source = sine(440, 1, { sampleRate: SR, amplitude: 1.4, channels: 2 });
    project = addClip(project, track.id, newClip(source, { trackId: track.id }));

    expect(peakAmplitude(renderProject(project))).toBeLessThanOrEqual(0.502);
    expect(peakAmplitude(source)).toBeGreaterThan(1.3); // source data stays unbaked
  });

  it("renderProject preserves a 5.1 multichannel bed for surround export", () => {
    const source = createAudioData(6, SR, SR);
    source.channels[4].set(sine(440, 1, { sampleRate: SR, amplitude: 0.6, channels: 1 }).channels[0]);
    const track = newTrack(0);
    let project = { ...emptyProject("Surround", 0, SR, 6), tracks: [track] };
    project = addClip(project, track.id, newClip(source, { trackId: track.id }));

    const rendered = renderProject(project);
    expect(channelCount(rendered)).toBe(6);
    expect(peakAmplitude({ sampleRate: SR, channels: [rendered.channels[4]] })).toBeGreaterThan(0.5);
    expect(peakAmplitude({ sampleRate: SR, channels: [rendered.channels[0]] })).toBeLessThan(1e-6);
  });

  it("maps stereo clips to the front pair in a 5.1 session by default", () => {
    const source = sine(440, 1, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const track = newTrack(0);
    let project = { ...emptyProject("Front", 0, SR, 6), tracks: [track] };
    project = addClip(project, track.id, newClip(source, { trackId: track.id }));

    const rendered = renderProject(project);
    expect(channelCount(rendered)).toBe(6);
    expect(peakAmplitude({ sampleRate: SR, channels: [rendered.channels[0]] })).toBeGreaterThan(0.5);
    expect(peakAmplitude({ sampleRate: SR, channels: [rendered.channels[1]] })).toBeGreaterThan(0.5);
    for (const ch of [2, 3, 4, 5]) {
      expect(peakAmplitude({ sampleRate: SR, channels: [rendered.channels[ch]] })).toBeLessThan(1e-6);
    }
  });

  it("uses a track surround panner for mono/stereo objects in 5.1", () => {
    const source = sine(440, 1, { sampleRate: SR, amplitude: 0.6, channels: 1 });
    const track = newTrack(0, { surroundPan: { x: 1, y: -1, center: 0, lfe: 0, divergence: 1 } });
    let project = { ...emptyProject("Rear", 0, SR, 6), tracks: [track] };
    project = addClip(project, track.id, newClip(source, { trackId: track.id }));

    const rendered = renderProject(project);
    expect(peakAmplitude({ sampleRate: SR, channels: [rendered.channels[5]] })).toBeGreaterThan(0.5); // Rs
    for (const ch of [0, 1, 2, 3, 4]) {
      expect(peakAmplitude({ sampleRate: SR, channels: [rendered.channels[ch]] })).toBeLessThan(1e-6);
    }
  });

  it("routes a track output through a bus before the master", () => {
    const bus = newBus(0, { id: "bus-music", gainDb: -12 });
    const track = newTrack(0, { outputId: bus.id });
    let project: Project = { ...emptyProject("Bus", 0, SR), tracks: [track], buses: [bus] };
    project = addClip(project, track.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: track.id }));

    const routedPeak = peakAmplitude(renderProject(project));
    const directPeak = peakAmplitude(renderProject({ ...project, buses: [], tracks: [{ ...project.tracks[0], outputId: "master" }] }));
    expect(routedPeak).toBeLessThan(directPeak * 0.4);
  });

  it("mixes post-fader sends into buses alongside the dry master route", () => {
    const bus = newBus(0, { id: "bus-parallel" });
    const track = newTrack(0, { sends: [newSend(bus.id)] });
    let project: Project = { ...emptyProject("Send", 0, SR), tracks: [track], buses: [bus] };
    project = addClip(project, track.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.2, channels: 2 }), { trackId: track.id }));

    const withSend = peakAmplitude(renderProject(project));
    const dry = peakAmplitude(renderProject({ ...project, tracks: [{ ...project.tracks[0], sends: [] }] }));
    expect(withSend).toBeGreaterThan(dry * 1.8);
  });

  it("renders track send gain automation at the send tap", () => {
    const mutedDryBus = newBus(0, { id: "bus-muted", mute: true });
    const sendBus = newBus(1, { id: "bus-send" });
    const send = newSend(sendBus.id, { id: "send-auto", gainDb: 0 });
    const track = newTrack(0, {
      outputId: mutedDryBus.id,
      sends: [send],
      automation: [
        newAutomationLane({
          target: { kind: "sendGainDb", sendId: send.id },
          points: [
            { time: 0, value: -48 },
            { time: 1, value: 0 },
          ],
        }),
      ],
    });
    let project: Project = { ...emptyProject("Send automation", 0, SR), tracks: [track], buses: [mutedDryBus, sendBus] };
    project = addClip(project, track.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: track.id }));

    const rendered = renderProject(project);
    const early = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[0].slice(0, Math.round(0.2 * SR))] });
    const late = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[0].slice(Math.round(0.8 * SR), SR)] });
    expect(late).toBeGreaterThan(early * 20);
  });

  it("renders track send pan automation at the send tap", () => {
    const mutedDryBus = newBus(0, { id: "bus-muted", mute: true });
    const sendBus = newBus(1, { id: "bus-send" });
    const send = newSend(sendBus.id, { id: "send-pan-auto", pan: 0 });
    const track = newTrack(0, {
      outputId: mutedDryBus.id,
      sends: [send],
      automation: [
        newAutomationLane({
          target: { kind: "sendPan", sendId: send.id },
          interpolation: "hold",
          points: [
            { time: 0, value: -1 },
            { time: 0.5, value: 1 },
          ],
        }),
      ],
    });
    let project: Project = { ...emptyProject("Send pan automation", 0, SR), tracks: [track], buses: [mutedDryBus, sendBus] };
    project = addClip(project, track.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: track.id }));

    const rendered = renderProject(project);
    const earlyL = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[0].slice(Math.round(0.1 * SR), Math.round(0.3 * SR))] });
    const earlyR = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[1].slice(Math.round(0.1 * SR), Math.round(0.3 * SR))] });
    const lateL = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[0].slice(Math.round(0.7 * SR), Math.round(0.9 * SR))] });
    const lateR = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[1].slice(Math.round(0.7 * SR), Math.round(0.9 * SR))] });
    expect(earlyL).toBeGreaterThan(0.4);
    expect(earlyR).toBeLessThan(1e-6);
    expect(lateR).toBeGreaterThan(0.4);
    expect(lateL).toBeLessThan(1e-6);
  });

  it("renders track gain automation as a persistent envelope", () => {
    const track = newTrack(0, {
      automation: [
        newAutomationLane({
          target: { kind: "gainDb" },
          points: [
            { time: 0, value: -48 },
            { time: 1, value: 0 },
          ],
        }),
      ],
    });
    let project = { ...emptyProject("Automation", 0, SR), tracks: [track] };
    project = addClip(project, track.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: track.id }));

    const rendered = renderProject(project);
    const early = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[0].slice(0, Math.round(0.2 * SR))] });
    const late = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[0].slice(Math.round(0.8 * SR), SR)] });
    expect(late).toBeGreaterThan(early * 20);
  });

  it("bypasses clip, track, bus, and master automation when their mode is off", () => {
    const gainLane = () =>
      newAutomationLane({
        target: { kind: "gainDb" },
        points: [
          { time: 0, value: -48 },
          { time: 1, value: 0 },
        ],
      });
    const clip = newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: "track", automation: [gainLane()] });
    const clipRead = renderClip(clip);
    expect(segmentRms(clipRead, 0, 0.2)).toBeLessThan(segmentRms(clipRead, 0.8, 1) / 20);
    const clipOff = renderClip({ ...clip, automationMode: "off" });
    expect(segmentRms(clipOff, 0.1, 0.3)).toBeCloseTo(segmentRms(clipOff, 0.7, 0.9), 2);

    const track = newTrack(0, { automation: [gainLane()] });
    const trackProject = addClip({ ...emptyProject("Track automation off", 0, SR), tracks: [track] }, track.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: track.id }));
    const trackRead = renderProject(trackProject);
    expect(segmentRms(trackRead, 0, 0.2)).toBeLessThan(segmentRms(trackRead, 0.8, 1) / 20);
    const trackOff = renderProject({ ...trackProject, tracks: [{ ...trackProject.tracks[0], automationMode: "off" }] });
    expect(segmentRms(trackOff, 0.1, 0.3)).toBeCloseTo(segmentRms(trackOff, 0.7, 0.9), 2);

    const bus = newBus(0, { id: "bus-auto", automation: [gainLane()] });
    const busTrack = newTrack(0, { outputId: bus.id });
    const busProject = addClip({ ...emptyProject("Bus automation off", 0, SR), tracks: [busTrack], buses: [bus] }, busTrack.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: busTrack.id }));
    const busRead = renderProject(busProject);
    expect(segmentRms(busRead, 0, 0.2)).toBeLessThan(segmentRms(busRead, 0.8, 1) / 20);
    const busOff = renderProject({ ...busProject, buses: [{ ...busProject.buses![0], automationMode: "off" }] });
    expect(segmentRms(busOff, 0.1, 0.3)).toBeCloseTo(segmentRms(busOff, 0.7, 0.9), 2);

    const masterTrack = newTrack(0);
    const masterProject = addClip({ ...emptyProject("Master automation off", 0, SR), tracks: [masterTrack], masterAutomation: [gainLane()] }, masterTrack.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: masterTrack.id }));
    const masterRead = renderProject(masterProject);
    expect(segmentRms(masterRead, 0, 0.2)).toBeLessThan(segmentRms(masterRead, 0.8, 1) / 20);
    const masterOff = renderProject({ ...masterProject, masterAutomationMode: "off" });
    expect(segmentRms(masterOff, 0.1, 0.3)).toBeCloseTo(segmentRms(masterOff, 0.7, 0.9), 2);
  });

  it("renders track rack gain parameter automation", () => {
    const slot = newEffectSlot("gain", { id: "fx-gain", params: { gainDb: 0 } });
    const track = newTrack(0, {
      effectRack: newEffectRack({ slots: [slot] }),
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "gainDb" },
          points: [
            { time: 0, value: -48 },
            { time: 1, value: 0 },
          ],
        }),
      ],
    });
    let project = { ...emptyProject("Rack automation", 0, SR), tracks: [track] };
    project = addClip(project, track.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: track.id }));

    const rendered = renderProject(project);
    const early = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[0].slice(0, Math.round(0.2 * SR))] });
    const late = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[0].slice(Math.round(0.8 * SR), SR)] });
    expect(late).toBeGreaterThan(early * 20);
  });

  it("renders track rack pan parameter automation", () => {
    const slot = newEffectSlot("pan", { id: "fx-pan", params: { pan: 0 } });
    const track = newTrack(0, {
      effectRack: newEffectRack({ slots: [slot] }),
      automation: [
        newAutomationLane({
          target: { kind: "effectParam", effectSlotId: slot.id, param: "pan" },
          interpolation: "hold",
          points: [
            { time: 0, value: -1 },
            { time: 0.5, value: 1 },
          ],
        }),
      ],
    });
    let project = { ...emptyProject("Rack pan automation", 0, SR), tracks: [track] };
    project = addClip(project, track.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: track.id }));

    const rendered = renderProject(project);
    const earlyL = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[0].slice(Math.round(0.1 * SR), Math.round(0.3 * SR))] });
    const earlyR = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[1].slice(Math.round(0.1 * SR), Math.round(0.3 * SR))] });
    const lateL = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[0].slice(Math.round(0.7 * SR), Math.round(0.9 * SR))] });
    const lateR = rmsAmplitude({ sampleRate: SR, channels: [rendered.channels[1].slice(Math.round(0.7 * SR), Math.round(0.9 * SR))] });
    expect(earlyL).toBeGreaterThan(0.4);
    expect(earlyR).toBeLessThan(1e-6);
    expect(lateR).toBeGreaterThan(0.4);
    expect(lateL).toBeLessThan(1e-6);
  });
});
