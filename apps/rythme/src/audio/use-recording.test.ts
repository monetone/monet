import { describe, expect, it } from "vitest";
import { createAudioData, emptyProject, initialState } from "../engine";
import {
  mapRecordedAudioForTrack,
  recordingInsertStart,
  recordingPreRollStart,
  recordingStartOptions,
  recordingTargetTracks,
} from "./use-recording";

describe("recording preferences", () => {
  it("maps captured stereo channels according to a track input assignment", () => {
    const input = createAudioData(2, 3, 48000);
    input.channels[0].set(Float32Array.from([1, 2, 3]));
    input.channels[1].set(Float32Array.from([-1, -2, -3]));

    expect(Array.from(mapRecordedAudioForTrack(input, { channel: "left" }).channels[0])).toEqual([1, 2, 3]);
    expect(Array.from(mapRecordedAudioForTrack(input, { channel: "right" }).channels[0])).toEqual([-1, -2, -3]);
    expect(Array.from(mapRecordedAudioForTrack(input, { channel: "mono" }).channels[0])).toEqual([0, 0, 0]);
    expect(mapRecordedAudioForTrack(input, { channel: "stereo" }).channels).toHaveLength(2);
  });

  it("maps explicit multichannel hardware inputs into mono track takes", () => {
    const input = createAudioData(4, 3, 48000);
    input.channels[0].set(Float32Array.from([1, 1, 1]));
    input.channels[1].set(Float32Array.from([2, 2, 2]));
    input.channels[2].set(Float32Array.from([3, 3, 3]));
    input.channels[3].set(Float32Array.from([4, 4, 4]));

    expect(Array.from(mapRecordedAudioForTrack(input, { channel: "input4" }).channels[0])).toEqual([4, 4, 4]);
    expect(Array.from(mapRecordedAudioForTrack(input, { channel: "input8" }).channels[0])).toEqual([4, 4, 4]);
  });

  it("requests enough capture channels for explicit multichannel input assignments", () => {
    const project = emptyProject("Record", 1, 48000);
    project.audioHardware = {
      inputDeviceId: "session-mic",
      outputDeviceId: undefined,
      hardwareSampleRate: 48000,
      inputChannels: 4,
      inputMonitoring: "off",
      latencyCompensationMs: 0,
      preRollSeconds: 0,
      countInBars: 0,
      punchIn: null,
      meterCalibrationDb: 0,
      meterPeakHoldMs: 1200,
    };
    project.tracks[0] = {
      ...project.tracks[0],
      input: { channel: "input6" },
    };
    const state = initialState(project);

    expect(recordingStartOptions(state, [project.tracks[0]])).toMatchObject({ channels: 6 });
  });

  it("derives target tracks, stream constraints, punch start, and pre-roll from session settings", () => {
    const project = emptyProject("Record", 2, 48000);
    project.audioHardware = {
      inputDeviceId: "session-mic",
      outputDeviceId: "session-out",
      hardwareSampleRate: 96000,
      inputChannels: 1,
      inputMonitoring: "off",
      latencyCompensationMs: 24,
      preRollSeconds: 2,
      countInBars: 1,
      punchIn: { start: 10, end: 14 },
      meterCalibrationDb: 0,
      meterPeakHoldMs: 1200,
    };
    project.tracks[1] = {
      ...project.tracks[1],
      recordArm: true,
      input: { channel: "right", deviceId: "track-mic", monitoring: "armed" },
    };
    const state = { ...initialState(project), transport: { ...initialState(project).transport, playhead: 12 } };
    const targets = recordingTargetTracks(state);

    expect(targets.map((track) => track.id)).toEqual([project.tracks[1].id]);
    expect(recordingStartOptions(state, targets)).toMatchObject({
      sampleRate: 96000,
      channels: 2,
      deviceId: "track-mic",
      outputDeviceId: "session-out",
      monitor: true,
    });
    expect(recordingInsertStart(state)).toBeCloseTo(9.976, 6);
    expect(recordingPreRollStart(state)).toBeCloseTo(6, 6);
  });
});
