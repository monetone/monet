import { describe, expect, it } from "vitest";
import { bindControlSurfaceInput, bindControlSurfaceOutput, captureControlSurfaceTrigger, controlSurfaceFeedbackMessages, decodeControlSurfaceMessage, discoverControlSurfaces, normalizeControlSurfaceMappings, normalizeMidiPorts, type ControlSurfaceFeedbackSnapshot, type MidiAccessLike, type NavigatorMidiLike } from "./control-surfaces";

describe("control surface discovery", () => {
  it("normalizes MIDI inputs and outputs", () => {
    expect(normalizeMidiPorts(new Map([
      ["in-2", { id: "in-2", type: "input", name: "  FaderPort  ", manufacturer: "PreSonus", state: "connected", connection: "open" }],
      ["ignored", { id: "out-1", type: "output", name: "Output" }],
      ["bad", { id: "", type: "input", name: "Hidden" }],
    ]).values(), "input")).toEqual([
      { id: "in-2", name: "FaderPort", kind: "input", manufacturer: "PreSonus", state: "connected", connection: "open" },
    ]);

    expect(normalizeMidiPorts(new Map([
      ["out-1", { id: "out-1", type: "output", name: "" }],
    ]).values(), "output")).toEqual([
      { id: "out-1", name: "Output 1", kind: "output", manufacturer: undefined, state: undefined, connection: undefined },
    ]);
  });

  it("requests Web MIDI access and returns input/output ports", async () => {
    const access: MidiAccessLike = {
      inputs: new Map([["in-1", { id: "in-1", type: "input", name: "X-Touch" }]]).values(),
      outputs: new Map([["out-1", { id: "out-1", type: "output", name: "X-Touch Out" }]]).values(),
    };
    let requested: { sysex?: boolean } | undefined;
    const navigatorLike: NavigatorMidiLike = {
      requestMIDIAccess: async (options) => {
        requested = options;
        return access;
      },
    };

    const inventory = await discoverControlSurfaces({ requestPermission: true, navigator: navigatorLike });

    expect(requested).toEqual({ sysex: false });
    expect(inventory).toMatchObject({
      supported: true,
      permissionRequested: true,
      inputs: [{ id: "in-1", name: "X-Touch", kind: "input" }],
      outputs: [{ id: "out-1", name: "X-Touch Out", kind: "output" }],
    });
  });

  it("reports unsupported or blocked Web MIDI without throwing", async () => {
    await expect(discoverControlSurfaces({ navigator: {} })).resolves.toMatchObject({ supported: false });
    await expect(discoverControlSurfaces({
      requestPermission: true,
      navigator: { requestMIDIAccess: async () => { throw new Error("midi denied"); } },
    })).resolves.toMatchObject({
      supported: true,
      permissionRequested: true,
      inputs: [],
      outputs: [],
      error: "midi denied",
    });
  });

  it("decodes common transport, fader, and pan MIDI messages", () => {
    expect(decodeControlSurfaceMessage([0x90, 94, 127], "mackieControl")).toEqual({ type: "play" });
    expect(decodeControlSurfaceMessage([0x90, 93, 127], "hui")).toEqual({ type: "stop" });
    expect(decodeControlSurfaceMessage([0x90, 60, 127], "genericMidi")).toEqual({ type: "togglePlay" });
    expect(decodeControlSurfaceMessage([0xe0, 0, 0x7f], "mackieControl")).toMatchObject({ type: "trackGain", trackIndex: 0 });
    expect(decodeControlSurfaceMessage([0xb0, 24, 127], "genericMidi")).toEqual({ type: "trackPan", trackIndex: 0, pan: 1 });
    expect(decodeControlSurfaceMessage([0xb0, 32, 127], "genericMidi")).toEqual({ type: "masterGain", gainDb: 12 });
  });

  it("decodes common channel mute, solo, and record-arm buttons", () => {
    expect(decodeControlSurfaceMessage([0x90, 2, 127], "mackieControl")).toEqual({ type: "trackArm", trackIndex: 2 });
    expect(decodeControlSurfaceMessage([0x90, 11, 127], "mackieControl")).toEqual({ type: "trackSolo", trackIndex: 3 });
    expect(decodeControlSurfaceMessage([0x90, 21, 127], "hui")).toEqual({ type: "trackMute", trackIndex: 5 });
    expect(decodeControlSurfaceMessage([0x90, 66, 127], "genericMidi")).toEqual({ type: "trackArm", trackIndex: 2 });
    expect(decodeControlSurfaceMessage([0x90, 75, 127], "genericMidi")).toEqual({ type: "trackSolo", trackIndex: 3 });
    expect(decodeControlSurfaceMessage([0x90, 85, 127], "genericMidi")).toEqual({ type: "trackMute", trackIndex: 5 });
  });

  it("decodes relative jog wheels for playhead scrubbing", () => {
    expect(decodeControlSurfaceMessage([0xb0, 60, 1], "mackieControl")).toEqual({ type: "jog", deltaSeconds: 0.05 });
    expect(decodeControlSurfaceMessage([0xb0, 60, 65], "hui")).toEqual({ type: "jog", deltaSeconds: -3.15 });
    expect(decodeControlSurfaceMessage([0xb0, 44, 2], "genericMidi")).toEqual({ type: "jog", deltaSeconds: 0.1 });
    expect(decodeControlSurfaceMessage([0xb0, 44, 64], "genericMidi")).toBeNull();
  });

  it("decodes custom mapped MIDI controls before protocol defaults", () => {
    const mappings = normalizeControlSurfaceMappings([
      { label: "Alt stop", trigger: { status: 0x90, data1: 60 }, action: { type: "stop" } },
      { trigger: { status: 0xb0, data1: 2 }, action: { type: "trackGain", trackIndex: 3 } },
      { trigger: { status: 0xb0, data1: 3 }, action: { type: "jog", sensitivitySeconds: 0.1 } },
      { trigger: { status: 0x90, data1: 99 }, action: { type: "trackMute", trackIndex: 2 } },
    ]);

    expect(decodeControlSurfaceMessage([0x90, 60, 127], "genericMidi", mappings)).toEqual({ type: "stop" });
    expect(decodeControlSurfaceMessage([0xb0, 2, 127], "genericMidi", mappings)).toEqual({ type: "trackGain", trackIndex: 3, gainDb: 12 });
    expect(decodeControlSurfaceMessage([0xb0, 3, 65], "genericMidi", mappings)).toEqual({ type: "jog", deltaSeconds: -6.3 });
    expect(decodeControlSurfaceMessage([0x90, 99, 0], "genericMidi", mappings)).toBeNull();
    expect(decodeControlSurfaceMessage([0x90, 99, 127], "genericMidi", mappings)).toEqual({ type: "trackMute", trackIndex: 2 });
  });

  it("binds a configured MIDI input and cleans up the message listener", async () => {
    const input = { id: "surface-in", type: "input", name: "Surface", onmidimessage: null as ((event: { data: ArrayLike<number> }) => void) | null };
    const actions: unknown[] = [];
    const release = await bindControlSurfaceInput({
      enabled: true,
      protocol: "genericMidi",
      inputId: "surface-in",
      navigator: {
        requestMIDIAccess: async () => ({ inputs: new Map([["surface-in", input]]).values() }),
      },
      onAction: (action) => actions.push(action),
    });

    input.onmidimessage?.({ data: [0x90, 60, 127] });
    expect(actions).toEqual([{ type: "togglePlay" }]);
    release();
    expect(input.onmidimessage).toBeNull();
  });

  it("encodes transport, fader, pan, and channel state feedback", () => {
    const snapshot: ControlSurfaceFeedbackSnapshot = {
      playing: true,
      masterGainDb: -60,
      tracks: [{ gainDb: 12, pan: -1, mute: true, solo: false, arm: true }],
    };

    expect(controlSurfaceFeedbackMessages(snapshot, "mackieControl")).toEqual([
      [0x90, 94, 127],
      [0x90, 93, 0],
      [0xe8, 0, 0],
      [0xe0, 127, 127],
      [0xb0, 16, 0],
      [0x90, 0, 127],
      [0x90, 8, 0],
      [0x90, 16, 127],
    ]);
    expect(controlSurfaceFeedbackMessages(snapshot, "genericMidi")).toContainEqual([0xb0, 32, 0]);
    expect(controlSurfaceFeedbackMessages(snapshot, "genericMidi")).toContainEqual([0x90, 80, 127]);
  });

  it("binds a configured MIDI output and sends feedback only when state changes", async () => {
    const sent: number[][] = [];
    const output = { id: "surface-out", type: "output", name: "Surface", send: (data: number[]) => sent.push(data) };
    let snapshot: ControlSurfaceFeedbackSnapshot = {
      playing: false,
      masterGainDb: 0,
      tracks: [{ gainDb: 0, pan: 0, mute: false, solo: false, arm: false }],
    };
    let notify = () => undefined as void;
    let unsubscribed = false;
    const release = await bindControlSurfaceOutput({
      enabled: true,
      protocol: "genericMidi",
      outputId: "surface-out",
      navigator: {
        requestMIDIAccess: async () => ({ outputs: new Map([["surface-out", output]]).values() }),
      },
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        notify = listener;
        return () => { unsubscribed = true; };
      },
    });

    expect(sent).toHaveLength(8);
    notify();
    expect(sent).toHaveLength(8);
    snapshot = { ...snapshot, playing: true };
    notify();
    expect(sent).toHaveLength(16);
    expect(sent).toContainEqual([0x90, 60, 127]);
    release();
    expect(unsubscribed).toBe(true);
  });

  it("captures a learn trigger from the configured MIDI input", async () => {
    const input = { id: "surface-in", type: "input", name: "Surface", onmidimessage: null as ((event: { data: ArrayLike<number> }) => void) | null };
    const learned = captureControlSurfaceTrigger({
      inputId: "surface-in",
      timeoutMs: 1000,
      navigator: {
        requestMIDIAccess: async () => ({ inputs: new Map([["surface-in", input]]).values() }),
      },
    });

    await Promise.resolve();
    input.onmidimessage?.({ data: [0xb0, 44, 1] });
    await expect(learned).resolves.toEqual({ status: 0xb0, data1: 44 });
    expect(input.onmidimessage).toBeNull();
  });
});
