import { describe, expect, it } from "vitest";
import { autoKeyTracks, transformTrackProps } from "./autokey";
import { createGameObject, createTimeline } from "../model/factory";

// Unity-parity Animation "Record" auto-key: the pure op upserts keyframes for the
// changed transform properties at a given time, creating tracks as needed.

describe("transformTrackProps", () => {
  it("keeps only keyable transform props, in stable order", () => {
    expect(transformTrackProps({ x: 1, angle: 90 })).toEqual(["x", "angle"]);
    expect(transformTrackProps({ scaleY: 2, scaleX: 2, y: 0, x: 0 })).toEqual(["x", "y", "scaleX", "scaleY"]);
    // non-track keys are ignored
    expect(transformTrackProps({ x: 1, name: "n", width: 5 } as object)).toEqual(["x"]);
    expect(transformTrackProps({})).toEqual([]);
  });
});

describe("autoKeyTracks", () => {
  it("creates a track + keyframe at the given time, reading the object's value", () => {
    const obj = createGameObject("rectangle", { id: "r", transform: { x: 42, y: 0, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 } });
    const tl = createTimeline("M");
    autoKeyTracks(tl, obj, ["x"], 1.5);
    expect(tl.tracks).toHaveLength(1);
    expect(tl.tracks[0]).toMatchObject({ targetId: "r", property: "x" });
    expect(tl.tracks[0].keyframes).toHaveLength(1);
    expect(tl.tracks[0].keyframes[0]).toMatchObject({ time: 1.5, value: 42 });
  });

  it("keys only the requested properties", () => {
    const obj = createGameObject("rectangle", { id: "r", transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, angle: 45, originX: 0.5, originY: 0.5, alpha: 1 } });
    const tl = createTimeline("M");
    autoKeyTracks(tl, obj, ["x", "angle"], 0);
    expect(tl.tracks.map((t) => t.property).sort()).toEqual(["angle", "x"]);
    expect(tl.tracks.find((t) => t.property === "y")).toBeUndefined();
  });

  it("reuses an existing track and overwrites the keyframe at the same time (upsert)", () => {
    const obj = createGameObject("rectangle", { id: "r" });
    const tl = createTimeline("M");
    autoKeyTracks(tl, obj, ["x"], 1);
    obj.transform.x = 99;
    autoKeyTracks(tl, obj, ["x"], 1); // same time → overwrite, not duplicate
    expect(tl.tracks).toHaveLength(1);
    expect(tl.tracks[0].keyframes).toHaveLength(1);
    expect(tl.tracks[0].keyframes[0].value).toBe(99);
  });

  it("adds a second keyframe at a different time on the same track", () => {
    const obj = createGameObject("rectangle", { id: "r", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 } });
    const tl = createTimeline("M");
    autoKeyTracks(tl, obj, ["x"], 0);
    obj.transform.x = 100;
    autoKeyTracks(tl, obj, ["x"], 2);
    expect(tl.tracks).toHaveLength(1);
    expect(tl.tracks[0].keyframes.map((k) => [k.time, k.value])).toEqual([[0, 0], [2, 100]]);
  });

  it("skips a locked existing track but still keys the unlocked ones (Unity Timeline lock)", () => {
    const obj = createGameObject("rectangle", { id: "r", transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 } });
    const tl = createTimeline("M");
    autoKeyTracks(tl, obj, ["x", "y"], 0); // create both tracks
    const xTrack = tl.tracks.find((t) => t.property === "x")!;
    xTrack.locked = true;
    obj.transform.x = 999;
    obj.transform.y = 50;
    autoKeyTracks(tl, obj, ["x", "y"], 1); // record again at t=1
    // the locked x track is untouched (still just its t=0 key); the unlocked y track gets the new key
    expect(xTrack.keyframes.map((k) => [k.time, k.value])).toEqual([[0, 10]]);
    expect(tl.tracks.find((t) => t.property === "y")!.keyframes.map((k) => [k.time, k.value])).toEqual([[0, 20], [1, 50]]);
  });
});
