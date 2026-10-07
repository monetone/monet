import { beforeEach, describe, expect, it } from "vitest";
import {
  addBus,
  addTrackSend,
  emptyProject,
  resetIds,
  RythmeStore,
  setBusAutomationMode,
  setMasterAutomationMode,
  setPlayhead,
  setTrackAutomationMode,
} from "../engine";
import {
  setBusPanFromMixer,
  setMasterGainFromMixer,
  setTrackGainFromMixer,
  setTrackPanFromMixer,
  setTrackSendGainFromMixer,
} from "./commands";

const SR = 48000;

let store: RythmeStore;

beforeEach(() => {
  resetIds();
  store = new RythmeStore(emptyProject("Automation Capture", 1, SR));
});

describe("mixer automation capture helpers", () => {
  it("updates static track controls without creating lanes in read mode", () => {
    const trackId = store.getState().project.tracks[0].id;

    setTrackGainFromMixer(store, trackId, -6);

    const track = store.getState().project.tracks[0];
    expect(track.gainDb).toBe(-6);
    expect(track.automation).toEqual([]);
  });

  it("captures track fader and pan moves when the track is in a capture mode", () => {
    const trackId = store.getState().project.tracks[0].id;
    store.dispatch(setPlayhead(1.25), { history: false });
    store.dispatch(setTrackAutomationMode(trackId, "write"), { history: false });

    setTrackGainFromMixer(store, trackId, -9);
    setTrackPanFromMixer(store, trackId, 0.5);

    const automation = store.getState().project.tracks[0].automation ?? [];
    expect(automation.find((lane) => lane.target.kind === "gainDb")?.points).toEqual([{ time: 1.25, value: -9 }]);
    expect(automation.find((lane) => lane.target.kind === "pan")?.points).toEqual([{ time: 1.25, value: 0.5 }]);
  });

  it("captures send, bus, and master mixer moves in touch/latch/write modes", () => {
    const trackId = store.getState().project.tracks[0].id;
    store.dispatch(addBus({ id: "bus-a" }), { history: false });
    store.dispatch(addTrackSend(trackId, "bus-a", { id: "send-a" }), { history: false });
    store.dispatch(setPlayhead(2), { history: false });
    store.dispatch(setTrackAutomationMode(trackId, "latch"), { history: false });
    store.dispatch(setBusAutomationMode("bus-a", "touch"), { history: false });
    store.dispatch(setMasterAutomationMode("write"), { history: false });

    setTrackSendGainFromMixer(store, trackId, "send-a", -12);
    setBusPanFromMixer(store, "bus-a", -0.25);
    setMasterGainFromMixer(store, -3);

    const trackAutomation = store.getState().project.tracks[0].automation ?? [];
    const busAutomation = store.getState().project.buses?.[0].automation ?? [];
    const masterAutomation = store.getState().project.masterAutomation ?? [];
    expect(trackAutomation.find((lane) => lane.target.kind === "sendGainDb" && lane.target.sendId === "send-a")?.points).toEqual([{ time: 2, value: -12 }]);
    expect(busAutomation.find((lane) => lane.target.kind === "pan")?.points).toEqual([{ time: 2, value: -0.25 }]);
    expect(masterAutomation.find((lane) => lane.target.kind === "gainDb")?.points).toEqual([{ time: 2, value: -3 }]);
  });
});
