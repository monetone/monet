import { describe, expect, it } from "vitest";
import { playsOnAwake, soundConfig } from "./audio";
import { createGameObject, createProject, createScene, defaultAudioSource } from "./factory";
import { projectFromJson, projectToJson } from "../io/jouer";
import { activeScene, findObject } from "./query";

// Unity-parity AudioSource (2D subset). soundConfig is the single source the
// exporter and the live player build their Phaser SoundConfig from.
describe("soundConfig", () => {
  it("is empty for a one-shot at full volume", () => {
    expect(soundConfig(defaultAudioSource())).toEqual({});
  });

  it("includes loop only when looping", () => {
    expect(soundConfig(defaultAudioSource({ loop: true }))).toEqual({ loop: true });
  });

  it("includes volume only when it differs from 1", () => {
    expect(soundConfig(defaultAudioSource({ volume: 0.5 }))).toEqual({ volume: 0.5 });
    expect(soundConfig(defaultAudioSource({ volume: 0 }))).toEqual({ volume: 0 });
  });

  it("combines loop + volume", () => {
    expect(soundConfig(defaultAudioSource({ loop: true, volume: 0.25 }))).toEqual({ loop: true, volume: 0.25 });
  });

  it("clamps volume to 0..1", () => {
    expect(soundConfig(defaultAudioSource({ volume: 1.5 }))).toEqual({ volume: 1 });
    expect(soundConfig(defaultAudioSource({ volume: -2 }))).toEqual({ volume: 0 });
  });

  it("ignores a non-finite volume (falls back to full)", () => {
    expect(soundConfig(defaultAudioSource({ volume: NaN }))).toEqual({});
    expect(soundConfig(defaultAudioSource({ loop: true, volume: Infinity }))).toEqual({ loop: true });
  });

  it("includes rate (Unity Pitch) only when pitch differs from 1", () => {
    expect(soundConfig(defaultAudioSource({ pitch: 1.5 }))).toEqual({ rate: 1.5 });
    expect(soundConfig(defaultAudioSource({ pitch: 1 }))).toEqual({});
    expect(soundConfig(defaultAudioSource({ pitch: NaN }))).toEqual({}); // non-finite → default
    expect(soundConfig(defaultAudioSource({ pitch: 0 }))).toEqual({ rate: 0.1 }); // floored, never silences
  });

  it("includes pan (Unity Stereo Pan) only when off-centre, clamped to -1..1", () => {
    expect(soundConfig(defaultAudioSource({ pan: -0.5 }))).toEqual({ pan: -0.5 });
    expect(soundConfig(defaultAudioSource({ pan: 0 }))).toEqual({});
    expect(soundConfig(defaultAudioSource({ pan: 5 }))).toEqual({ pan: 1 });
    expect(soundConfig(defaultAudioSource({ pan: -5 }))).toEqual({ pan: -1 });
  });

  it("combines pitch + pan with loop + volume", () => {
    expect(soundConfig(defaultAudioSource({ loop: true, volume: 0.25, pitch: 2, pan: 0.5 })))
      .toEqual({ loop: true, volume: 0.25, rate: 2, pan: 0.5 });
  });

  it("includes mute (Unity AudioSource Mute) only when muted", () => {
    expect(soundConfig(defaultAudioSource({ mute: true }))).toEqual({ mute: true });
    expect(soundConfig(defaultAudioSource({ mute: false }))).toEqual({});
    expect(soundConfig(defaultAudioSource({ loop: true, mute: true }))).toEqual({ loop: true, mute: true });
  });
});

describe("playsOnAwake", () => {
  it("is false for null/undefined", () => {
    expect(playsOnAwake(null)).toBe(false);
    expect(playsOnAwake(undefined)).toBe(false);
  });

  it("is false without a clip or with playOnAwake off", () => {
    expect(playsOnAwake(defaultAudioSource())).toBe(false); // no assetId
    expect(playsOnAwake(defaultAudioSource({ assetId: "a1", playOnAwake: false }))).toBe(false);
  });

  it("is true with a clip and playOnAwake on", () => {
    expect(playsOnAwake(defaultAudioSource({ assetId: "a1" }))).toBe(true);
  });
});

describe("defaultAudioSource", () => {
  it("defaults to a one-shot, no clip, full volume, play on awake", () => {
    expect(defaultAudioSource()).toEqual({ assetId: null, playOnAwake: true, loop: false, volume: 1, pitch: 1, pan: 0, mute: false });
  });
});

describe("audio .jouer round-trip", () => {
  it("preserves an audio source", () => {
    const o = createGameObject("rectangle", { id: "r1", audio: defaultAudioSource({ assetId: "clip1", loop: true, volume: 0.5, playOnAwake: false, pitch: 1.5, pan: -0.5, mute: true }) });
    const project = createProject("P", { scenes: [createScene("S", { objects: [o] })] });
    const back = projectFromJson(projectToJson(project));
    expect(findObject(activeScene(back), "r1")?.audio).toEqual({ assetId: "clip1", loop: true, volume: 0.5, playOnAwake: false, pitch: 1.5, pan: -0.5, mute: true });
  });

  it("leaves an object without audio audio-free", () => {
    const o = createGameObject("rectangle", { id: "r2" });
    const project = createProject("P", { scenes: [createScene("S", { objects: [o] })] });
    const back = projectFromJson(projectToJson(project));
    expect(findObject(activeScene(back), "r2")?.audio).toBeUndefined();
  });
});
