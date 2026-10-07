import { describe, expect, it } from "vitest";
import { discoverAudioDevices, normalizeAudioDevices, probeAudioInputCapabilities, type MediaDevicesLike } from "./devices";

describe("audio device discovery", () => {
  it("normalizes inputs and outputs into selectable devices", () => {
    const normalized = normalizeAudioDevices([
      { kind: "videoinput", deviceId: "camera", label: "Camera" },
      { kind: "audiooutput", deviceId: "out-1", label: "  Monitors  ", groupId: "room" },
      { kind: "audioinput", deviceId: "mic-2", label: "" },
      { kind: "audioinput", deviceId: "default", label: "" },
      { kind: "audioinput", deviceId: "mic-2", label: "Duplicate" },
      { kind: "audioinput", deviceId: "", label: "Hidden" },
    ]);

    expect(normalized.inputs).toEqual([
      { id: "default", label: "System input", kind: "audioinput", groupId: undefined, isDefault: true },
      { id: "mic-2", label: "Input 1", kind: "audioinput", groupId: undefined, isDefault: false },
    ]);
    expect(normalized.outputs).toEqual([
      { id: "out-1", label: "Monitors", kind: "audiooutput", groupId: "room", isDefault: false },
    ]);
  });

  it("can request permission, stop the temporary stream, and enumerate devices", async () => {
    let stopped = false;
    const mediaDevices: MediaDevicesLike = {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped = true; } }] }),
      enumerateDevices: async () => [
        { kind: "audioinput", deviceId: "mic-1", label: "Studio Mic" },
        { kind: "audiooutput", deviceId: "default", label: "System Output" },
      ],
    };

    const inventory = await discoverAudioDevices({ requestPermission: true, mediaDevices });

    expect(stopped).toBe(true);
    expect(inventory.permissionRequested).toBe(true);
    expect(inventory.permissionGranted).toBe(true);
    expect(inventory.inputs.map((device) => device.label)).toEqual(["Studio Mic"]);
    expect(inventory.outputs.map((device) => device.id)).toEqual(["default"]);
  });

  it("reports unsupported or blocked discovery without throwing", async () => {
    await expect(discoverAudioDevices({ mediaDevices: {} })).resolves.toMatchObject({ supported: false });
    await expect(discoverAudioDevices({
      requestPermission: true,
      mediaDevices: {
        getUserMedia: async () => { throw new Error("denied"); },
        enumerateDevices: async () => [{ kind: "audioinput", deviceId: "default", label: "" }],
      },
    })).resolves.toMatchObject({
      supported: true,
      permissionRequested: true,
      permissionGranted: false,
      error: "denied",
    });
  });

  it("probes selected input capabilities and stops the temporary stream", async () => {
    let stopped = false;
    let requestedConstraints: MediaStreamConstraints | undefined;
    const mediaDevices: MediaDevicesLike = {
      getUserMedia: async (constraints) => {
        requestedConstraints = constraints;
        return {
          getTracks: () => [
            {
              label: "Interface Input 1-2",
              getCapabilities: () => ({
                sampleRate: { min: 44100, max: 96000 },
                channelCount: { min: 1, max: 2 },
                latency: { min: 0.002, max: 0.04 },
                echoCancellation: [false],
                noiseSuppression: [false],
                autoGainControl: [false],
              }),
              getSettings: () => ({ deviceId: "mic-1", sampleRate: 48000, channelCount: 2 }),
              stop: () => { stopped = true; },
            },
          ],
        };
      },
    };

    const capabilities = await probeAudioInputCapabilities("mic-1", mediaDevices);

    expect(requestedConstraints?.audio).toMatchObject({
      deviceId: { exact: "mic-1" },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(stopped).toBe(true);
    expect(capabilities).toMatchObject({
      supported: true,
      deviceId: "mic-1",
      label: "Interface Input 1-2",
      sampleRate: { min: 44100, max: 96000 },
      channelCount: { min: 1, max: 2 },
      latency: { min: 0.002, max: 0.04 },
      echoCancellation: [false],
      noiseSuppression: [false],
      autoGainControl: [false],
    });
  });

  it("falls back to settings when track capabilities are sparse", async () => {
    const mediaDevices: MediaDevicesLike = {
      getUserMedia: async () => ({
        getTracks: () => [
          {
            getSettings: () => ({ sampleRate: 48000, channelCount: 1, latency: 0.01 }),
            stop: () => undefined,
          },
        ],
      }),
    };

    await expect(probeAudioInputCapabilities(undefined, mediaDevices)).resolves.toMatchObject({
      supported: true,
      sampleRate: { min: 48000, max: 48000 },
      channelCount: { min: 1, max: 1 },
      latency: { min: 0.01, max: 0.01 },
    });
  });

  it("reports unsupported or denied input capability probing without throwing", async () => {
    await expect(probeAudioInputCapabilities("mic-1", {})).resolves.toMatchObject({
      supported: false,
      error: "Audio input capability probing is unavailable",
    });
    await expect(probeAudioInputCapabilities("mic-1", {
      getUserMedia: async () => { throw new Error("permission denied"); },
    })).resolves.toMatchObject({
      supported: true,
      deviceId: "mic-1",
      error: "permission denied",
    });
  });
});
