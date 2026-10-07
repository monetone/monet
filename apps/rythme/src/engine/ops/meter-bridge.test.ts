import { describe, expect, it } from "vitest";
import { sine } from "../generate/tone";
import { emptyProject, newAutomationLane, newBus, newClip, newSend, newTrack } from "../model/factory";
import { addClip } from "./clip";
import { applyMeterBridgePeakHold, measureMeterBridge, meterTapId } from "./meter-bridge";

const SR = 48000;

describe("measureMeterBridge", () => {
  it("reports post-fader track and master levels around the playhead", () => {
    const track = newTrack(0, { id: "track-a", gainDb: -6 });
    const project = addClip(
      { ...emptyProject("Meter", 0, SR), tracks: [track] },
      track.id,
      newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: track.id }),
    );

    const meter = measureMeterBridge(project, { atSec: 0.25, windowSec: 0.1 });

    expect(meter.tracks).toHaveLength(1);
    expect(meter.tracks[0].id).toBe("track-a");
    expect(meter.tracks[0].peak).toBeGreaterThan(0.23);
    expect(meter.tracks[0].peak).toBeLessThan(0.27);
    expect(meter.tracks[0].rms).toBeGreaterThan(0.16);
    expect(meter.master.peak).toBeCloseTo(meter.tracks[0].peak, 3);
  });

  it("applies persisted meter calibration to dB readouts without changing raw peaks", () => {
    const track = newTrack(0, { id: "track-a" });
    const project = addClip(
      {
        ...emptyProject("Calibrated Meter", 0, SR),
        audioHardware: {
          hardwareSampleRate: SR,
          inputChannels: 2,
          inputMonitoring: "off",
          latencyCompensationMs: 0,
          preRollSeconds: 0,
          countInBars: 0,
          punchIn: null,
          meterCalibrationDb: 6,
          meterPeakHoldMs: 1200,
        },
        tracks: [track],
      },
      track.id,
      newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: track.id }),
    );
    const raw = measureMeterBridge({ ...project, audioHardware: { ...project.audioHardware!, meterCalibrationDb: 0 } }, { atSec: 0.25, windowSec: 0.1 });
    const calibrated = measureMeterBridge(project, { atSec: 0.25, windowSec: 0.1 });

    expect(calibrated.tracks[0].peak).toBeCloseTo(raw.tracks[0].peak, 6);
    expect(calibrated.tracks[0].peakDb).toBeCloseTo(raw.tracks[0].peakDb + 6, 6);
    expect(calibrated.tracks[0].channels[0].peakDb).toBeCloseTo(raw.tracks[0].channels[0].peakDb + 6, 6);
  });

  it("holds previous peak markers until the configured hold window expires", () => {
    const loud = measureMeterBridge(
      { ...emptyProject("Hold", 0, SR), tracks: [newTrack(0, { id: "track-a" })] },
      { atSec: 0, windowSec: 0.1, meterPeakHoldMs: 500 },
    );
    loud.tracks[0] = { ...loud.tracks[0], peak: 0.9, peakDb: -0.9, peakHold: { peak: 0.9, peakDb: -0.9, remainingMs: 0 } };
    const heldLoud = applyMeterBridgePeakHold(loud, null, { nowMs: 1000, holdMs: 500 });
    const quiet = {
      ...loud,
      tracks: [{ ...loud.tracks[0], peak: 0.1, peakDb: -20, peakHold: { peak: 0.1, peakDb: -20, remainingMs: 0 } }],
    };

    const stillHeld = applyMeterBridgePeakHold(quiet, heldLoud, { nowMs: 1250, holdMs: 500 });
    const released = applyMeterBridgePeakHold(quiet, heldLoud, { nowMs: 1600, holdMs: 500 });

    expect(stillHeld.tracks[0].peakHold.peak).toBe(0.9);
    expect(stillHeld.tracks[0].peakHold.remainingMs).toBe(250);
    expect(released.tracks[0].peakHold.peak).toBe(0.1);
  });

  it("meters routed buses and the resulting master output", () => {
    const bus = newBus(0, { id: "bus-a", gainDb: -6 });
    const track = newTrack(0, { id: "track-a", outputId: bus.id });
    const project = addClip(
      { ...emptyProject("Bus Meter", 0, SR), tracks: [track], buses: [bus] },
      track.id,
      newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: track.id }),
    );

    const meter = measureMeterBridge(project, { atSec: 0.25, windowSec: 0.1 });

    expect(meter.tracks[0].peak).toBeGreaterThan(0.75);
    expect(meter.buses[0].peak).toBeGreaterThan(0.37);
    expect(meter.buses[0].peak).toBeLessThan(0.43);
    expect(meter.master.peak).toBeCloseTo(meter.buses[0].peak, 3);
  });

  it("reports software insert and send tap meters", () => {
    const bus = newBus(0, { id: "bus-a" });
    const track = newTrack(0, {
      id: "track-a",
      sends: [newSend(bus.id, { id: "send-a", gainDb: -6, preFader: false })],
    });
    const project = addClip(
      { ...emptyProject("Tap Meter", 0, SR), tracks: [track], buses: [bus] },
      track.id,
      newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: track.id }),
    );

    const meter = measureMeterBridge(project, { atSec: 0.25, windowSec: 0.1 });
    const trackInput = meter.taps.find((tap) => tap.id === meterTapId("track", track.id, "input"));
    const trackPostRack = meter.taps.find((tap) => tap.id === meterTapId("track", track.id, "postRack"));
    const sendTap = meter.taps.find((tap) => tap.id === meterTapId("track", track.id, "send", "send-a"));
    const busInput = meter.taps.find((tap) => tap.id === meterTapId("bus", bus.id, "input"));
    const masterPostRack = meter.taps.find((tap) => tap.id === meterTapId("master", "master", "postRack"));

    expect(trackInput?.peak).toBeGreaterThan(0.75);
    expect(trackPostRack?.peak).toBeCloseTo(trackInput!.peak, 3);
    expect(sendTap).toMatchObject({ ownerKind: "track", ownerId: track.id, tapKind: "send", sendId: "send-a", targetBusId: bus.id, preFader: false });
    expect(sendTap!.peak).toBeGreaterThan(0.37);
    expect(sendTap!.peak).toBeLessThan(0.43);
    expect(busInput!.peak).toBeCloseTo(sendTap!.peak, 3);
    expect(masterPostRack).toBeDefined();
  });

  it("returns silent meters for inaudible tracks and honors automation off mode", () => {
    const mutedTrack = newTrack(0, { id: "muted", mute: true });
    const automatedTrack = newTrack(1, {
      id: "automated",
      automationMode: "off",
      automation: [
        newAutomationLane({
          target: { kind: "gainDb" },
          points: [
            { time: 0, value: -48 },
            { time: 1, value: -48 },
          ],
        }),
      ],
    });
    let project = { ...emptyProject("Silent Meter", 0, SR), tracks: [mutedTrack, automatedTrack] };
    project = addClip(project, mutedTrack.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: mutedTrack.id }));
    project = addClip(project, automatedTrack.id, newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.8, channels: 2 }), { trackId: automatedTrack.id }));

    const meter = measureMeterBridge(project, { atSec: 0.25, windowSec: 0.1 });

    expect(meter.tracks.find((entry) => entry.id === "muted")?.audible).toBe(false);
    expect(meter.tracks.find((entry) => entry.id === "muted")?.peak).toBe(0);
    expect(meter.tracks.find((entry) => entry.id === "automated")?.peak).toBeGreaterThan(0.75);
  });
});
