// Unit tests for the pure document model — factory constructors, the id counter
// and the read-only query selectors. These are the foundation every op, the
// store and the UI read through, yet had no direct coverage (ops.test.ts only
// exercises them incidentally). Time is in SECONDS throughout the model.

import { beforeEach, describe, expect, it } from "vitest";
import { durationSeconds, frameCount } from "../audio/types";
import {
  DEFAULT_SAMPLE_RATE,
  DEFAULT_VIDEO_FRAME_RATE,
  MARKER_COLORS,
  TRACK_COLORS,
  defaultAudioHardwareSettings,
  defaultEditorPreferences,
  defaultPanelPreferences,
  emptyProject,
  newAutomationLane,
  newBus,
  newClip,
  newEffectSlot,
  newMarker,
  newProject,
  newSend,
  newTrack,
  newVideoAsset,
  newVideoClip,
  newVideoTrack,
  silentBuffer,
} from "./factory";
import { nextId, resetIds } from "./ids";
import {
  anySolo,
  beatDuration,
  clipById,
  clipEnd,
  clipIntersectsRange,
  clipsInRange,
  projectDuration,
  secondsToBarsBeats,
  sortedMarkers,
  trackAudible,
  trackById,
  trackIndex,
  activeVideoClipAt,
  videoAssetById,
  videoClipById,
} from "./query";
import type { Clip, Project, Track, VideoTrack } from "./types";

const SR = 48000;

beforeEach(() => resetIds());

describe("ids", () => {
  it("emits monotonic, prefixed ids", () => {
    resetIds();
    expect(nextId("clip")).toBe("clip-1");
    expect(nextId("track")).toBe("track-2");
    expect(nextId("clip")).toBe("clip-3");
  });

  it("resetIds rewinds the counter, with an optional seed", () => {
    resetIds();
    nextId("x");
    resetIds();
    expect(nextId("x")).toBe("x-1");
    resetIds(10);
    expect(nextId("x")).toBe("x-11");
  });
});

describe("factory", () => {
  it("newProject fills musical + audio defaults", () => {
    const p = newProject();
    expect(p.sampleRate).toBe(DEFAULT_SAMPLE_RATE);
    expect(p.channelCount).toBe(2);
    expect(p.tempo).toBe(120);
    expect(p.timeSignature).toEqual([4, 4]);
    expect(p.videoFrameRate).toBe(DEFAULT_VIDEO_FRAME_RATE);
    expect(p.masterGainDb).toBe(0);
    expect(p.masterEffectRack).toEqual({ slots: [], bypassed: false });
    expect(p.masterAutomation).toEqual([]);
    expect(p.audioHardware).toEqual(defaultAudioHardwareSettings(DEFAULT_SAMPLE_RATE));
    expect(p.editorPreferences).toEqual(defaultEditorPreferences(DEFAULT_SAMPLE_RATE));
    expect(p.panelPreferences).toEqual(defaultPanelPreferences(DEFAULT_SAMPLE_RATE));
    expect(p.videoAssets).toEqual([]);
    expect(p.videoTracks).toEqual([]);
    expect(p.tracks).toEqual([]);
    expect(p.buses).toEqual([]);
    expect(p.markers).toEqual([]);
    expect(typeof p.meta.created).toBe("number");
    expect(p.meta.modified).toBe(p.meta.created);
  });

  it("newTrack defaults to an unmuted audio lane and cycles colors by index", () => {
    const t0 = newTrack(0);
    expect(t0.kind).toBe("audio");
    expect(t0.gainDb).toBe(0);
    expect(t0.mute).toBe(false);
    expect(t0.solo).toBe(false);
    expect(t0.clips).toEqual([]);
    expect(t0.effectRack).toEqual({ slots: [], bypassed: false });
    expect(t0.automation).toEqual([]);
    expect(t0.input).toBeUndefined();
    expect(t0.sends).toEqual([]);
    expect(t0.outputId).toBe("master");
    expect(t0.name).toBe("Track 1");
    expect(t0.color).toBe(TRACK_COLORS[0]);
    expect(newTrack(1).color).toBe(TRACK_COLORS[1]);
    // wraps modulo the palette length
    expect(newTrack(TRACK_COLORS.length).color).toBe(TRACK_COLORS[0]);
  });

  it("newClip derives duration from the buffer and applies clip defaults", () => {
    const buf = silentBuffer(2, 2, SR); // 2 s stereo
    const clip = newClip(buf, { trackId: "track-1" });
    expect(clip.duration).toBe(durationSeconds(buf));
    expect(clip.duration).toBe(2);
    expect(clip.start).toBe(0);
    expect(clip.inPoint).toBe(0);
    expect(clip.speed).toBe(1);
    expect(clip.enabled).toBe(true);
    expect(clip.gainDb).toBe(0);
    expect(clip.fadeInShape).toBe("equalPower");
    expect(clip.fadeOutShape).toBe("equalPower");
    expect(clip.effectRack).toEqual({ slots: [], bypassed: false });
    expect(clip.automation).toEqual([]);
    expect(clip.buffer).toBe(buf);
  });

  it("newBus / newSend / newEffectSlot / newAutomationLane create durable session graph defaults", () => {
    const bus = newBus(0, { id: "bus-reverb" });
    const send = newSend(bus.id, { gainDb: -12, preFader: true });
    const slot = newEffectSlot("gain", { params: { gainDb: -6 } });
    const lane = newAutomationLane({ target: { kind: "gainDb" }, points: [{ time: 0, value: 0 }] });

    expect(bus.name).toBe("Bus 1");
    expect(bus.outputId).toBe("master");
    expect(send.targetBusId).toBe("bus-reverb");
    expect(send.enabled).toBe(true);
    expect(slot.enabled).toBe(true);
    expect(lane.interpolation).toBe("linear");
  });

  it("newClip honours explicit overrides", () => {
    const clip = newClip(silentBuffer(5, 1, SR), { trackId: "track-9", start: 3, duration: 1.5, name: "vox" });
    expect(clip.trackId).toBe("track-9");
    expect(clip.start).toBe(3);
    expect(clip.duration).toBe(1.5);
    expect(clip.name).toBe("vox");
  });

  it("newVideoAsset / newVideoTrack / newVideoClip create reference picture defaults", () => {
    const asset = newVideoAsset({ name: "scene-01.mp4", duration: 12, width: 1920, height: 1080, mimeType: "video/mp4" });
    const track = newVideoTrack(0);
    const clip = newVideoClip(asset, { trackId: track.id, start: 2 });
    expect(asset.sourceName).toBe("scene-01.mp4");
    expect(track.kind).toBe("video");
    expect(track.name).toBe("Video 1");
    expect(track.visible).toBe(true);
    expect(clip.assetId).toBe(asset.id);
    expect(clip.start).toBe(2);
    expect(clip.duration).toBe(12);
    expect(clip.enabled).toBe(true);
  });

  it("newMarker infers cue vs region from the presence of an end", () => {
    expect(newMarker({ time: 1 }).kind).toBe("cue");
    const region = newMarker({ time: 1, end: 3 });
    expect(region.kind).toBe("region");
    expect(region.end).toBe(3);
    expect(newMarker({ time: 1 }).color).toBe(MARKER_COLORS[0]);
  });

  it("emptyProject builds the requested number of named tracks", () => {
    const p = emptyProject("Mix", 3, SR, 6);
    expect(p.name).toBe("Mix");
    expect(p.sampleRate).toBe(SR);
    expect(p.channelCount).toBe(6);
    expect(p.tracks.map((t) => t.name)).toEqual(["Track 1", "Track 2", "Track 3"]);
  });

  it("silentBuffer has the expected frame count and duration", () => {
    const buf = silentBuffer(1.5, 2, SR);
    expect(frameCount(buf)).toBe(Math.round(1.5 * SR));
    expect(durationSeconds(buf)).toBeCloseTo(1.5, 6);
    expect(buf.channels).toHaveLength(2);
  });
});

// ── query selectors ──────────────────────────────────────────
// Build projects directly through the factory so these tests exercise the model
// layer in isolation (no dependency on the ops/store editing layer).

function clipAt(trackId: string, start: number, duration: number, over: Partial<Clip> = {}): Clip {
  return newClip(silentBuffer(duration, 1, SR), { trackId, start, duration, ...over });
}

function project(tracks: Track[], markers: Project["markers"] = []): Project {
  return newProject({ tracks, markers, sampleRate: SR });
}

function videoProject(videoTracks: VideoTrack[]): Project {
  const asset = newVideoAsset({ id: "asset-video", name: "picture.mov", duration: 9 });
  return newProject({ tracks: [], videoAssets: [asset], videoTracks, sampleRate: SR });
}

describe("query: lookups", () => {
  it("trackById / trackIndex find by id and miss cleanly", () => {
    const a = newTrack(0, { id: "track-a" });
    const b = newTrack(1, { id: "track-b" });
    const p = project([a, b]);
    expect(trackById(p, "track-b")).toBe(b);
    expect(trackById(p, "nope")).toBeUndefined();
    expect(trackIndex(p, "track-b")).toBe(1);
    expect(trackIndex(p, "nope")).toBe(-1);
  });

  it("clipById returns the clip together with its owning track", () => {
    const c = clipAt("track-a", 0, 1, { id: "clip-x" });
    const a = newTrack(0, { id: "track-a", clips: [c] });
    const b = newTrack(1, { id: "track-b" });
    const p = project([a, b]);
    expect(clipById(p, "clip-x")).toEqual({ clip: c, track: a });
    expect(clipById(p, "missing")).toBeUndefined();
  });
});

describe("query: ranges", () => {
  it("clipEnd is start + duration", () => {
    expect(clipEnd(clipAt("t", 2, 3))).toBe(5);
  });

  it("clipIntersectsRange treats the range as half-open [start, end)", () => {
    const c = clipAt("t", 0, 2); // occupies [0, 2)
    expect(clipIntersectsRange(c, 1, 3)).toBe(true);
    expect(clipIntersectsRange(c, 2, 4)).toBe(false); // touches the trailing edge → no overlap
    expect(clipIntersectsRange(c, -1, 0)).toBe(false); // touches the leading edge → no overlap
    expect(clipIntersectsRange(c, 0.5, 1.5)).toBe(true); // fully inside
  });

  it("clipsInRange filters to overlap and returns them in timeline order", () => {
    const t = newTrack(0, {
      id: "t",
      clips: [clipAt("t", 5, 1, { id: "c5" }), clipAt("t", 1, 1, { id: "c1" }), clipAt("t", 3, 1, { id: "c3" })],
    });
    expect(clipsInRange(t, 0, 4).map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(clipsInRange(t, 0, 10).map((c) => c.id)).toEqual(["c1", "c3", "c5"]);
  });

  it("projectDuration is the furthest clip end across all tracks", () => {
    const a = newTrack(0, { id: "a", clips: [clipAt("a", 1, 2)] }); // ends at 3
    const b = newTrack(1, { id: "b", clips: [clipAt("b", 0, 5)] }); // ends at 5
    expect(projectDuration(project([a, b]))).toBe(5);
    expect(projectDuration(project([]))).toBe(0);
  });

  it("projectDuration and video lookup include reference video tracks", () => {
    const asset = newVideoAsset({ id: "asset-video", name: "picture.mov", duration: 9 });
    const v = newVideoTrack(0, {
      id: "video-1",
      clips: [newVideoClip(asset, { id: "vclip-1", trackId: "video-1", start: 4, duration: 9 })],
    });
    const p = videoProject([v]);
    expect(projectDuration(p)).toBe(13);
    expect(videoAssetById(p, "asset-video")?.name).toBe("picture.mov");
    expect(videoClipById(p, "vclip-1")?.track.id).toBe("video-1");
    expect(activeVideoClipAt(p, 5)?.clip.id).toBe("vclip-1");
    expect(activeVideoClipAt(p, 20)).toBeUndefined();
  });
});

describe("query: mute / solo audibility", () => {
  it("with no solo, every unmuted track is audible", () => {
    const a = newTrack(0, { id: "a" });
    const b = newTrack(1, { id: "b", mute: true });
    const p = project([a, b]);
    expect(anySolo(p)).toBe(false);
    expect(trackAudible(p, a)).toBe(true);
    expect(trackAudible(p, b)).toBe(false);
  });

  it("with a solo engaged, only soloed unmuted tracks are audible", () => {
    const soloed = newTrack(0, { id: "s", solo: true });
    const plain = newTrack(1, { id: "p" });
    const soloedMuted = newTrack(2, { id: "sm", solo: true, mute: true });
    const p = project([soloed, plain, soloedMuted]);
    expect(anySolo(p)).toBe(true);
    expect(trackAudible(p, soloed)).toBe(true);
    expect(trackAudible(p, plain)).toBe(false); // not soloed
    expect(trackAudible(p, soloedMuted)).toBe(false); // mute wins over solo
  });
});

describe("query: musical time", () => {
  it("beatDuration is 60 / tempo", () => {
    expect(beatDuration(project([]))).toBe(0.5); // 120 bpm
    expect(beatDuration(newProject({ tempo: 60 }))).toBe(1);
  });

  it("secondsToBarsBeats maps to 1-based bar.beat with 960-PPQ ticks (120 bpm, 4/4)", () => {
    const p = project([]); // 120 bpm → 2 beats/sec, 4 beats/bar
    expect(secondsToBarsBeats(p, 0)).toEqual({ bar: 1, beat: 1, ticks: 0 });
    expect(secondsToBarsBeats(p, 0.5)).toEqual({ bar: 1, beat: 2, ticks: 0 }); // one beat in
    expect(secondsToBarsBeats(p, 2)).toEqual({ bar: 2, beat: 1, ticks: 0 }); // four beats = one bar
    expect(secondsToBarsBeats(p, 0.625)).toEqual({ bar: 1, beat: 2, ticks: 240 }); // quarter of a beat
  });
});

describe("query: markers", () => {
  it("sortedMarkers orders by time without mutating the source array", () => {
    const markers = [newMarker({ time: 3, name: "c" }), newMarker({ time: 1, name: "a" }), newMarker({ time: 2, name: "b" })];
    const p = project([], markers);
    expect(sortedMarkers(p).map((m) => m.name)).toEqual(["a", "b", "c"]);
    expect(p.markers.map((m) => m.name)).toEqual(["c", "a", "b"]); // original untouched
  });
});
