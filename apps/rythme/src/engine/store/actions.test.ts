// Unit tests for the pure Command creators in store/actions. store.test.ts
// drives a handful through the RythmeStore; this file tests the rest directly
// as (state) => state functions — clamping ranges, selection set semantics,
// track/marker structural edits, and the no-op identity contract the store
// relies on to avoid pushing empty undo steps.

import { beforeEach, describe, expect, it } from "vitest";
import { emptyProject, newAutomationLane, newEffectSlot, newVideoAsset } from "../model/factory";
import { createAudioData } from "../audio/buffer";
import { resetIds } from "../model/ids";
import { insertClip } from "./edit";
import { initialState } from "./store";
import {
  addBus,
  addBusAutomationLane,
  addBusEffectSlot,
  addBusSend,
  addClipEffectSlot,
  addMarker,
  addMasterEffectSlot,
  addMasterAutomationLane,
  addTrackAutomationLane,
  addTrackEffectSlot,
  addTrackSend,
  addVideoReference,
  addVideoReferenceWithExtractedAudio,
  applyProjectKeyboardShortcutPreset,
  clearSelection,
  deleteProjectKeyboardShortcutPreset,
  moveMarker,
  moveTrack,
  removeBus,
  removeBusEffectSlot,
  removeBusSend,
  removeClipEffectSlot,
  removeFavoriteEffectChain,
  removeMarker,
  removeMasterEffectSlot,
  removeNativePlugin,
  removeProjectKeyboardShortcut,
  removeTrack,
  removeTrackEffectSlot,
  removeTrackSend,
  renameMarker,
  renameTrack,
  selectClips,
  selectRange,
  selectSpectralRange,
  setActiveTrack,
  setBusGain,
  setBusAutomationMode,
  setBusEffectParamAutomationPoint,
  setBusEffectSlotEnabled,
  setBusEffectSlotParam,
  setBusGainAutomationPoint,
  setBusOutput,
  setBusPan,
  setBusPanAutomationPoint,
  setBusSendEnabled,
  setBusSendGain,
  setBusSendGainAutomationPoint,
  setBusSendPan,
  setBusSendPanAutomationPoint,
  setBusSendPreFader,
  setClipEffectSlotEnabled,
  setClipAutomationMode,
  setClipEffectSlotParam,
  setClipEffectParamAutomationPoint,
  setClipGainAutomationPoint,
  setClipPanAutomationPoint,
  deleteProjectWorkspace,
  saveProjectWorkspace,
  saveProjectKeyboardShortcutPreset,
  setActiveWorkspace,
  setEditorMode,
  setMasterAutomationMode,
  setMasterEffectParamAutomationPoint,
  setMasterEffectSlotEnabled,
  setMasterEffectSlotParam,
  setMasterEffectRack,
  setMasterGainAutomationPoint,
  setLoop,
  setLoopEnabled,
  setMasterGain,
  setMasterPanAutomationPoint,
  setProjectAudioHardware,
  setProjectEditorPreferences,
  setProjectKeyboardShortcut,
  setProjectPanelPreferences,
  setFavoriteEffectChains,
  setNativePluginEnabled,
  setNativePluginManager,
  setNativePluginPresetState,
  setPlayhead,
  setPlaying,
  setProjectChannelCount,
  setRecording,
  setRecordingInputLevel,
  setScroll,
  setSnap,
  setTempo,
  setTrackEffectSlotEnabled,
  setTrackAutomationMode,
  setTrackEffectParamAutomationPoint,
  setTrackEffectSlotParam,
  setTool,
  setTrackGainAutomationPoint,
  setTrackSendEnabled,
  setTrackOutput,
  setTrackSendGain,
  setTrackSendGainAutomationPoint,
  setTrackSendPan,
  setTrackSendPanAutomationPoint,
  setTrackSendPreFader,
  setViewportWidth,
  setTrackGain,
  setTrackHeight,
  setTrackAudioRole,
  setTrackInput,
  setTrackPan,
  setTrackPanAutomationPoint,
  setVideoClipLocked,
  setTrackSurroundPan,
  setZoom,
  toggleArm,
  toggleBusMute,
  toggleBusSolo,
  toggleSolo,
  toggleMetronome,
  updateVideoAsset,
  updateProjectMeta,
  upsertFavoriteEffectChain,
  upsertNativePlugins,
  updateBus,
  updateClip,
  updateTrack,
  zoomBy,
  zoomToFit,
  zoomToSelection,
} from "./actions";
import type { EditorState } from "../model/types";

const SR = 48000;
let s: EditorState;
let t0: string, t1: string, t2: string;

beforeEach(() => {
  resetIds();
  const p = emptyProject("T", 3, SR);
  s = initialState(p);
  [t0, t1, t2] = p.tracks.map((t) => t.id);
});

describe("tool & view", () => {
  it("setEditorMode switches Waveform/Multitrack surfaces, but no-ops when unchanged", () => {
    expect(s.mode).toBe("multitrack");
    const waveform = setEditorMode("waveform")(s);
    expect(waveform.mode).toBe("waveform");
    expect(setEditorMode("waveform")(waveform)).toBe(waveform);
    expect(setEditorMode("multitrack")(waveform).mode).toBe("multitrack");
  });

  it("setTool switches tools, but is a no-op (same ref) when unchanged", () => {
    expect(setTool("razor")(s).tool).toBe("razor");
    expect(setTool("select")(s)).toBe(s); // initial tool is 'select'
  });

  it("setActiveTrack updates, and no-ops when already active", () => {
    expect(setActiveTrack(t1)(s).activeTrackId).toBe(t1);
    expect(setActiveTrack(t0)(s)).toBe(s); // t0 is the initial active track
  });

  it("setZoom / zoomBy clamp to [2, 8000] px/s", () => {
    expect(setZoom(1)(s).view.pxPerSecond).toBe(2);
    expect(setZoom(99999)(s).view.pxPerSecond).toBe(8000);
    expect(setZoom(300)(s).view.pxPerSecond).toBe(300);
    expect(zoomBy(2)(s).view.pxPerSecond).toBe(240); // default 120 × 2
    expect(zoomBy(0.0001)(s).view.pxPerSecond).toBe(2);
    expect(zoomBy(1000)(s).view.pxPerSecond).toBe(8000);
  });

  it("setScroll floors scrollSec at 0 and keeps scrollY unless given", () => {
    expect(setScroll(-5)(s).view.scrollSec).toBe(0);
    const a = setScroll(10)(s).view;
    expect(a.scrollSec).toBe(10);
    expect(a.scrollY).toBe(0); // unchanged
    expect(setScroll(10, 50)(s).view.scrollY).toBe(50);
  });

  it("setSnap toggles view.snap, and no-ops (same ref) when unchanged", () => {
    expect(s.view.snap).toBe(true); // snapping defaults on
    expect(setSnap(true)(s)).toBe(s); // already on → same ref
    const off = setSnap(false)(s);
    expect(off.view.snap).toBe(false);
    expect(off.project.editorPreferences?.snap).toBe(false);
    expect(setSnap(true)(off).view.snap).toBe(true);
  });

  it("setProjectEditorPreferences persists display/editing defaults and updates only requested current UI fields", () => {
    const tool = setTool("razor")(s);
    const display = setProjectEditorPreferences({
      displayTimeFormat: "samples",
      spectralMinHz: 120,
      spectralMaxHz: 12000,
    })(tool);
    expect(display.project.editorPreferences).toMatchObject({
      displayTimeFormat: "samples",
      spectralMinHz: 120,
      spectralMaxHz: 12000,
    });
    expect(display.tool).toBe("razor");
    expect(display.mode).toBe("multitrack");

    const defaults = setProjectEditorPreferences({ editorMode: "waveform", tool: "envelope", snap: false })(display);
    expect(defaults.mode).toBe("waveform");
    expect(defaults.tool).toBe("envelope");
    expect(defaults.view.snap).toBe(false);
    expect(defaults.project.editorPreferences).toMatchObject({ editorMode: "waveform", tool: "envelope", snap: false });
  });

  it("persists custom workspace presets and resets active workspace when deleted", () => {
    const layout = { left: { size: 280, stack: [{ tabs: ["files", "mixer"], active: "mixer", flex: 1 }] } };
    const saved = saveProjectWorkspace({ name: "Mix Review", layout })(s);
    expect(saved.project.editorPreferences?.activeWorkspaceId).toBe("mix-review");
    expect(saved.project.editorPreferences?.customWorkspaces).toEqual([{ id: "mix-review", name: "Mix Review", layout }]);

    const duplicate = saveProjectWorkspace({ name: "Mix Review", layout: { left: { size: 300, stack: [] } } })(saved);
    expect(duplicate.project.editorPreferences?.activeWorkspaceId).toBe("mix-review-2");
    expect(duplicate.project.editorPreferences?.customWorkspaces.map((workspace) => workspace.id)).toEqual(["mix-review", "mix-review-2"]);

    const selected = setActiveWorkspace("mix-review")(duplicate);
    expect(selected.project.editorPreferences?.activeWorkspaceId).toBe("mix-review");

    const deleted = deleteProjectWorkspace("mix-review")(selected);
    expect(deleted.project.editorPreferences?.activeWorkspaceId).toBe("default");
    expect(deleted.project.editorPreferences?.customWorkspaces.map((workspace) => workspace.id)).toEqual(["mix-review-2"]);
    expect(deleteProjectWorkspace("missing")(deleted)).toBe(deleted);
  });

  it("persists custom keyboard shortcut overrides and removes them by action", () => {
    const split = setProjectKeyboardShortcut({ action: "edit.split", key: "x", mod: true, shift: true })(s);
    expect(split.project.editorPreferences?.keyboardShortcuts).toEqual([
      { action: "edit.split", key: "x", mod: true, shift: true, alt: false },
    ]);

    const moved = setProjectKeyboardShortcut({ action: "edit.split", key: "b", alt: true })(split);
    expect(moved.project.editorPreferences?.keyboardShortcuts).toEqual([
      { action: "edit.split", key: "b", mod: false, shift: false, alt: true },
    ]);

    const removed = removeProjectKeyboardShortcut("edit.split")(moved);
    expect(removed.project.editorPreferences?.keyboardShortcuts).toEqual([]);
    expect(removeProjectKeyboardShortcut("edit.split")(removed)).toBe(removed);
  });

  it("saves, applies, and deletes project keyboard shortcut presets", () => {
    const customized = setProjectKeyboardShortcut({ action: "edit.split", key: "x", mod: true, shift: true })(s);
    const saved = saveProjectKeyboardShortcutPreset({ name: "Editing" })(customized);
    expect(saved.project.editorPreferences?.keyboardShortcutPresets).toEqual([{
      id: "editing",
      name: "Editing",
      shortcuts: [{ action: "edit.split", key: "x", mod: true, shift: true, alt: false }],
    }]);

    const reset = removeProjectKeyboardShortcut("edit.split")(saved);
    expect(reset.project.editorPreferences?.keyboardShortcuts).toEqual([]);

    const applied = applyProjectKeyboardShortcutPreset("editing")(reset);
    expect(applied.project.editorPreferences?.keyboardShortcuts).toEqual([
      { action: "edit.split", key: "x", mod: true, shift: true, alt: false },
    ]);

    const deleted = deleteProjectKeyboardShortcutPreset("editing")(applied);
    expect(deleted.project.editorPreferences?.keyboardShortcutPresets).toEqual([]);
    expect(deleteProjectKeyboardShortcutPreset("editing")(deleted)).toBe(deleted);
  });

  it("setProjectPanelPreferences persists Analyze panel spectral defaults", () => {
    const updated = setProjectPanelPreferences({ analyze: { spectralMinHz: 120, spectralMaxHz: 12000, spectralGainDb: -18 } })(s);
    expect(updated.project.panelPreferences?.analyze).toEqual({ spectralMinHz: 120, spectralMaxHz: 12000, spectralGainDb: -18 });
    expect(setProjectPanelPreferences({ analyze: { spectralGainDb: -18 } })(updated)).toBe(updated);
    const clamped = setProjectPanelPreferences({ analyze: { spectralMinHz: -1, spectralMaxHz: 999999, spectralGainDb: -999 } })(updated);
    expect(clamped.project.panelPreferences?.analyze).toEqual({ spectralMinHz: 0, spectralMaxHz: 24000, spectralGainDb: -60 });
  });

  it("setProjectPanelPreferences persists Effects panel numeric defaults", () => {
    const updated = setProjectPanelPreferences({ effects: { gainDb: 9, normalizeTargetDb: -1, dehummerHarmonics: 12 } })(s);
    expect(updated.project.panelPreferences?.effects).toMatchObject({ gainDb: 9, normalizeTargetDb: -1, dehummerHarmonics: 12 });
    expect(setProjectPanelPreferences({ effects: { gainDb: 9 } })(updated)).toBe(updated);
    const clamped = setProjectPanelPreferences({
      effects: { gainDb: 999, normalizeTargetDb: -999, dehummerHarmonics: 99, matchLoudnessTargetLufs: 0 },
    })(updated);
    expect(clamped.project.panelPreferences?.effects).toMatchObject({
      gainDb: 48,
      normalizeTargetDb: -24,
      dehummerHarmonics: 40,
      matchLoudnessTargetLufs: -6,
    });
  });

  it("setViewportWidth records the usable timeline width (rounded, ≥1) and no-ops when unchanged", () => {
    expect(setViewportWidth(630.4)(s).view.viewportPx).toBe(630);
    expect(setViewportWidth(0)(s).view.viewportPx).toBe(1);
    expect(setViewportWidth(800)(s)).toBe(s); // 800 is the default → same ref
  });

  it("zoomToSelection fills the viewport with the time selection (and no-ops without one)", () => {
    const sized = setViewportWidth(600)(s);
    const sel = selectRange({ start: 2, end: 5 }, [])(sized); // 3 s selection
    const z = zoomToSelection()(sel).view;
    expect(z.pxPerSecond).toBe(200); // 600 px / 3 s
    expect(z.scrollSec).toBe(2);
    expect(zoomToSelection()(sized)).toBe(sized); // no range → no-op
  });

  it("zoomToSelection clamps a very short selection to the max zoom", () => {
    const sized = setViewportWidth(600)(s);
    const sel = selectRange({ start: 0, end: 0.01 }, [])(sized); // 600/0.01 = 60000 → clamp 8000
    expect(zoomToSelection()(sel).view.pxPerSecond).toBe(8000);
  });

  it("zoomToFit fits the whole session (and no-ops on an empty project)", () => {
    expect(zoomToFit()(s)).toBe(s); // empty project → duration 0 → no-op
    const sized = setViewportWidth(600)(s);
    const withClip = insertClip(t0, createAudioData(2, SR * 2, SR), 1)(sized); // clip 1..3 → 3 s
    const z = zoomToFit()(withClip).view;
    expect(z.pxPerSecond).toBe(200); // 600 px / 3 s
    expect(z.scrollSec).toBe(0);
  });
});

describe("transport", () => {
  it("setPlayhead floors at 0", () => {
    expect(setPlayhead(-3)(s).transport.playhead).toBe(0);
    expect(setPlayhead(2.5)(s).transport.playhead).toBe(2.5);
  });

  it("setPlaying / setRecording / toggleMetronome", () => {
    expect(setPlaying(true)(s).transport.playing).toBe(true);
    expect(setRecording(true)(s).transport.recording).toBe(true);
    expect(toggleMetronome()(s).transport.metronome).toBe(true); // default false
  });

  it("setRecordingInputLevel normalizes live input meter state and clears on stop", () => {
    expect(s.transport.recordingInput).toBeNull();
    const leveled = setRecordingInputLevel({ peak: 2, rms: 0.5, peakDb: 999, rmsDb: 999, channels: 2, clipped: false })(s);
    expect(leveled.transport.recordingInput).toMatchObject({
      peak: 2,
      rms: 0.5,
      channels: 2,
      clipped: true,
    });
    expect(leveled.transport.recordingInput?.peakDb).toBeCloseTo(20 * Math.log10(2), 6);
    expect(leveled.transport.recordingInput?.rmsDb).toBeCloseTo(20 * Math.log10(0.5), 6);
    expect(setRecordingInputLevel(leveled.transport.recordingInput)(leveled)).toBe(leveled);
    expect(setRecording(false)(leveled).transport.recordingInput).toBeNull();
  });

  it("setLoop forces loopEnabled on when a region is set, and leaves it when cleared", () => {
    const looped = setLoop({ start: 0, end: 2 })(s).transport;
    expect(looped.loop).toEqual({ start: 0, end: 2 });
    expect(looped.loopEnabled).toBe(true);
    // clearing the region keeps whatever enabled state was there
    const cleared = setLoop(null)(setLoop({ start: 0, end: 2 })(s)).transport;
    expect(cleared.loop).toBeNull();
    expect(cleared.loopEnabled).toBe(true);
    expect(setLoopEnabled(false)(s).transport.loopEnabled).toBe(false);
  });
});

describe("selection", () => {
  it("clearSelection no-ops when already empty, clears when not", () => {
    expect(clearSelection()(s)).toBe(s);
    const sel = selectClips(["c1", "c2"])(s);
    const cleared = clearSelection()(sel);
    expect(cleared.selection).toEqual({ clipIds: [], trackIds: [], range: null, spectral: null });
  });

  it("selectClips replaces by default and unions when additive", () => {
    expect(selectClips(["c1", "c2"])(s).selection.clipIds).toEqual(["c1", "c2"]);
    const a = selectClips(["c1", "c2"])(s);
    expect(selectClips(["c3"])(a).selection.clipIds).toEqual(["c3"]); // replace
    expect(selectClips(["c2", "c3"], true)(a).selection.clipIds).toEqual(["c1", "c2", "c3"]); // union, deduped
  });

  it("selectRange sets the range and participating tracks", () => {
    const sel = selectRange({ start: 1, end: 4 }, [t0, t1])(s).selection;
    expect(sel.range).toEqual({ start: 1, end: 4 });
    expect(sel.trackIds).toEqual([t0, t1]);
  });

  it("selectSpectralRange normalizes a spectral rectangle and mirrors its time range", () => {
    const sel = selectSpectralRange({
      time: { start: 4, end: 1 },
      frequency: { minHz: 8000, maxHz: 200 },
      channel: "left",
    })(s).selection;
    expect(sel.range).toEqual({ start: 1, end: 4 });
    expect(sel.spectral).toEqual({
      time: { start: 1, end: 4 },
      frequency: { minHz: 200, maxHz: 8000 },
      channel: "left",
    });
  });

  it("selectSpectralRange clamps frequency bounds to Nyquist and clears on null", () => {
    const selected = selectSpectralRange({
      time: { start: -1, end: 2 },
      frequency: { minHz: -100, maxHz: 999999 },
      channel: "right",
    })(s);
    expect(selected.selection.spectral?.time).toEqual({ start: 0, end: 2 });
    expect(selected.selection.spectral?.frequency).toEqual({ minHz: 0, maxHz: SR / 2 });
    expect(selectSpectralRange(null)(selected).selection.spectral).toBeNull();
    expect(selectSpectralRange(null)(s)).toBe(s);
  });
});

describe("mixer & track params (clamped)", () => {
  it("setTrackGain clamps to [-60, 12] dB", () => {
    const gain = (db: number) => setTrackGain(t0, db)(s).project.tracks[0].gainDb;
    expect(gain(-100)).toBe(-60);
    expect(gain(99)).toBe(12);
    expect(gain(-6)).toBe(-6);
  });

  it("setTrackPan clamps to [-1, 1]", () => {
    const pan = (p: number) => setTrackPan(t0, p)(s).project.tracks[0].pan;
    expect(pan(-5)).toBe(-1);
    expect(pan(5)).toBe(1);
    expect(pan(0.3)).toBe(0.3);
  });

  it("sets clip, track, bus, and master automation modes", () => {
    const withClip = insertClip(t0, createAudioData(2, SR, SR), 0, "Dialog")(s);
    const clipId = withClip.project.tracks[0].clips[0].id;
    expect(setTrackAutomationMode(t0, "read")(withClip)).toBe(withClip);
    expect(setTrackAutomationMode(t0, "bad" as never)(withClip)).toBe(withClip);
    const trackOff = setTrackAutomationMode(t0, "off")(withClip);
    expect(trackOff.project.tracks[0].automationMode).toBe("off");
    expect(setClipAutomationMode(clipId, "touch")(trackOff).project.tracks[0].clips[0].automationMode).toBe("touch");

    const withBus = addBus({ id: "bus-a" })(trackOff);
    const busLatch = setBusAutomationMode("bus-a", "latch")(withBus);
    expect(busLatch.project.buses?.[0].automationMode).toBe("latch");
    expect(setBusAutomationMode("missing", "off")(busLatch)).toBe(busLatch);

    const masterWrite = setMasterAutomationMode("write")(busLatch);
    expect(masterWrite.project.masterAutomationMode).toBe("write");
    expect(setMasterAutomationMode("write")(masterWrite)).toBe(masterWrite);
  });

  it("setTrackSurroundPan clamps 5.1 panner coordinates", () => {
    const pan = setTrackSurroundPan(t0, { x: 2, y: -2, center: 3, lfe: -1, divergence: 0.25 })(s).project.tracks[0].surroundPan;
    expect(pan).toEqual({ x: 1, y: -1, center: 1, lfe: 0, divergence: 0.25 });
    const patched = setTrackSurroundPan(t0, { x: -0.5 })(setTrackSurroundPan(t0, { y: 0, center: 0.5 })(s)).project.tracks[0].surroundPan;
    expect(patched).toEqual({ x: -0.5, y: 0, center: 0.5, lfe: 0, divergence: 1 });
  });

  it("setTrackAudioRole assigns, clears, and ignores invalid roles", () => {
    const role = setTrackAudioRole(t0, "dialogue")(s);
    expect(role.project.tracks[0].audioRole).toBe("dialogue");
    expect(setTrackAudioRole(t0, "dialogue")(role)).toBe(role);
    expect(setTrackAudioRole(t0, "invalid" as never)(role)).toBe(role);
    expect(setTrackAudioRole("ghost", "music")(role)).toBe(role);
    const cleared = setTrackAudioRole(t0, null)(role);
    expect(cleared.project.tracks[0].audioRole).toBeUndefined();
    expect(setTrackAudioRole(t0, null)(cleared)).toBe(cleared);
  });

  it("setTrackInput assigns, normalizes, clears, and no-ops when unchanged", () => {
    const assigned = setTrackInput(t0, { channel: "right", deviceId: " mic-1 ", label: " Boom ", monitoring: "armed" })(s);
    expect(assigned.project.tracks[0].input).toEqual({ channel: "right", deviceId: "mic-1", label: "Boom", monitoring: "armed" });
    expect(setTrackInput(t0, { channel: "right", deviceId: "mic-1", label: "Boom", monitoring: "armed" })(assigned)).toBe(assigned);
    expect(setTrackInput(t0, { channel: "input7" })(assigned).project.tracks[0].input?.channel).toBe("input7");
    expect(setTrackInput(t0, { channel: "bad" as never })(assigned).project.tracks[0].input?.channel).toBe("stereo");
    expect(setTrackInput("ghost", { channel: "mono" })(assigned)).toBe(assigned);
    const cleared = setTrackInput(t0, null)(assigned);
    expect(cleared.project.tracks[0].input).toBeUndefined();
    expect(setTrackInput(t0, null)(cleared)).toBe(cleared);
  });

  it("setTrackHeight clamps to [40, 600] px", () => {
    const h = (px: number) => setTrackHeight(t0, px)(s).project.tracks[0].height;
    expect(h(10)).toBe(40);
    expect(h(9999)).toBe(600);
    expect(h(120)).toBe(120);
  });

  it("toggleSolo / toggleArm / renameTrack mutate the addressed track only", () => {
    expect(toggleSolo(t0)(s).project.tracks[0].solo).toBe(true);
    expect(toggleArm(t1)(s).project.tracks[1].recordArm).toBe(true);
    const renamed = renameTrack(t2, "Vocals")(s);
    expect(renamed.project.tracks[2].name).toBe("Vocals");
    expect(renamed.project.tracks[0]).toBe(s.project.tracks[0]); // others shared by reference
  });

  it("setMasterGain / setTempo clamp at the project level", () => {
    expect(setMasterGain(99)(s).project.masterGainDb).toBe(12);
    expect(setMasterGain(-100)(s).project.masterGainDb).toBe(-60);
    expect(setTempo(5)(s).project.tempo).toBe(20);
    expect(setTempo(9999)(s).project.tempo).toBe(400);
    expect(setTempo(140)(s).project.tempo).toBe(140);
    expect(setProjectChannelCount(6)(s).project.channelCount).toBe(6);
    expect(setProjectChannelCount(99)(s).project.channelCount).toBe(8);
    expect(setProjectChannelCount(0)(s).project.channelCount).toBe(1);
  });

  it("setProjectAudioHardware normalizes device, monitoring, punch, and timing preferences", () => {
    const hardware = setProjectAudioHardware({
      inputDeviceId: " mic-a ",
      outputDeviceId: " out-a ",
      hardwareSampleRate: 999999,
      inputChannels: 9,
      inputMonitoring: "always",
      latencyCompensationMs: -2000,
      preRollSeconds: 99,
      countInBars: 99,
      punchIn: { start: 5, end: 2 },
      meterCalibrationDb: 99,
      meterPeakHoldMs: 99999,
    })(s);
    expect(hardware.project.audioHardware).toMatchObject({
      inputDeviceId: "mic-a",
      outputDeviceId: "out-a",
      hardwareSampleRate: 192000,
      inputChannels: 8,
      inputMonitoring: "always",
      latencyCompensationMs: -1000,
      preRollSeconds: 30,
      countInBars: 8,
      punchIn: { start: 2, end: 5 },
      meterCalibrationDb: 60,
      meterPeakHoldMs: 10000,
    });
    expect(setProjectAudioHardware(hardware.project.audioHardware!)(hardware)).toBe(hardware);
    const cleared = setProjectAudioHardware({ inputDeviceId: "", outputDeviceId: "", punchIn: null })(hardware);
    expect(cleared.project.audioHardware?.inputDeviceId).toBeUndefined();
    expect(cleared.project.audioHardware?.outputDeviceId).toBeUndefined();
    expect(cleared.project.audioHardware?.punchIn).toBeNull();
  });

  it("updateProjectMeta merges editable metadata fields", () => {
    const next = updateProjectMeta({ title: "Scene Mix", artist: "Editor", keywords: "dialogue" })(s);
    expect(next.project.meta).toMatchObject({ title: "Scene Mix", artist: "Editor", keywords: "dialogue" });
    expect(next.project.meta.created).toBe(s.project.meta.created);
  });

  it("sets, upserts, and removes project favorite effect chains", () => {
    const set = setFavoriteEffectChains([
      { id: " clean ", name: " Dialogue Clean ", steps: [{ kind: " gain ", name: " Gain ", params: { gainDb: -3, bad: Number.NaN } }] },
      { id: "", name: "Invalid", steps: [{ kind: "gain" }] },
      { id: "empty", name: "Empty", steps: [] },
    ])(s);
    expect(set.project.favoriteEffectChains).toEqual([
      { id: "clean", name: "Dialogue Clean", steps: [{ kind: "gain", name: "Gain", enabled: true, params: { gainDb: -3 } }] },
    ]);

    const upserted = upsertFavoriteEffectChain({
      id: "clean",
      name: "Polarity Flip",
      steps: [{ kind: "invertPolarity", params: {} }],
    })(set);
    expect(upserted.project.favoriteEffectChains).toEqual([
      { id: "clean", name: "Polarity Flip", steps: [{ kind: "invertPolarity", name: "invertPolarity", enabled: true, params: {} }] },
    ]);

    expect(removeFavoriteEffectChain("missing")(upserted)).toBe(upserted);
    expect(removeFavoriteEffectChain("clean")(upserted).project.favoriteEffectChains).toEqual([]);
  });

  it("manages native plug-in inventory enablement and preset metadata", () => {
    const managed = setNativePluginManager({
      plugins: [
        {
          id: " proq ",
          kind: "vst3",
          name: " Pro-Q 3 ",
          vendor: " FabFilter ",
          version: " 3.2.1 ",
          bundleIdentifier: " com.fabfilter.Pro-Q.3 ",
          path: " /Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3 ",
          extension: ".VST3",
          canProcess: true as false,
          hostStatus: "inventoryOnly",
          enabled: true,
          validationIssues: ["", "Inventory only"],
          entryPointVerified: true,
          presetName: " Voice ",
          state: { mix: 1, bad: Number.NaN },
        },
      ],
      scanRoots: [" /Library/Audio/Plug-Ins/VST3 "],
      lastScanAt: 10,
    })(s);
    expect(managed.project.nativePluginManager?.plugins[0]).toMatchObject({
      id: "proq",
      kind: "vst3",
      name: "Pro-Q 3",
      vendor: "FabFilter",
      version: "3.2.1",
      bundleIdentifier: "com.fabfilter.Pro-Q.3",
      extension: ".vst3",
      canProcess: false,
      hostStatus: "inventoryOnly",
      enabled: true,
      validationStatus: "invalid",
      validationIssues: ["Inventory only"],
      entryPointVerified: true,
      presetName: "Voice",
      state: { mix: 1 },
    });

    const disabled = setNativePluginEnabled("proq", false)(managed);
    expect(disabled.project.nativePluginManager?.plugins[0].enabled).toBe(false);
    const preset = setNativePluginPresetState("proq", "Podcast", { thresholdDb: -18, mode: "dialogue" })(disabled);
    expect(preset.project.nativePluginManager?.plugins[0]).toMatchObject({ presetName: "Podcast", state: { thresholdDb: -18, mode: "dialogue" } });

    const rescanned = upsertNativePlugins([
      {
        id: "proq",
        kind: "vst3",
        name: "Pro-Q 3",
        version: "3.2.2",
        validationStatus: "metadataVerified",
        path: "/Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3",
        extension: ".vst3",
        canProcess: false,
        hostStatus: "inventoryOnly",
        enabled: true,
        entryPointVerified: true,
      },
    ])(preset);
    expect(rescanned.project.nativePluginManager?.plugins[0]).toMatchObject({
      enabled: false,
      presetName: "Podcast",
      state: { thresholdDb: -18, mode: "dialogue" },
      version: "3.2.2",
      validationStatus: "metadataVerified",
      entryPointVerified: true,
    });
    expect(removeNativePlugin("missing")(rescanned)).toBe(rescanned);
    expect(removeNativePlugin("proq")(rescanned).project.nativePluginManager?.plugins).toEqual([]);
  });
});

describe("track structure", () => {
  it("adds a reference video asset and clip on a video track", () => {
    const asset = newVideoAsset({ id: "asset-video", name: "scene.mov", duration: 7.25, width: 1280, height: 720 });
    const withVideo = addVideoReference(asset, { start: 12 })(s);
    expect(withVideo.project.videoAssets?.[0]).toMatchObject({ id: "asset-video", name: "scene.mov", duration: 7.25, width: 1280, height: 720 });
    expect(withVideo.project.videoTracks?.[0].kind).toBe("video");
    expect(withVideo.project.videoTracks?.[0].clips[0]).toMatchObject({ assetId: "asset-video", start: 12, duration: 7.25 });
    expect(withVideo.project.tracks).toHaveLength(s.project.tracks.length);
  });

  it("updates reference video asset metadata for media relinking", () => {
    const asset = newVideoAsset({ id: "asset-video", name: "Scene", sourceName: "old.mov", duration: 7.25, width: 1280, height: 720 });
    const withVideo = addVideoReference(asset, { start: 12 })(s);
    const relinked = updateVideoAsset("asset-video", {
      id: "ignored",
      sourceName: "new cut.mp4",
      sourcePath: " ",
      mimeType: "video/mp4",
      duration: 9.5,
      width: 1920.4,
      height: 1080.4,
      frameRate: 23.976,
      hasAudio: true,
    })(withVideo);

    expect(relinked.project.videoAssets?.[0]).toMatchObject({
      id: "asset-video",
      name: "Scene",
      sourceName: "new cut.mp4",
      sourcePath: undefined,
      mimeType: "video/mp4",
      duration: 9.5,
      width: 1920,
      height: 1080,
      frameRate: 23.976,
      hasAudio: true,
    });
    expect(relinked.project.videoTracks?.[0].clips[0]).toMatchObject({ assetId: "asset-video", start: 12, duration: 7.25 });
    expect(updateVideoAsset("missing", { sourceName: "ghost.mov" })(withVideo)).toBe(withVideo);
    expect(updateVideoAsset("asset-video", relinked.project.videoAssets![0])(relinked)).toBe(relinked);
  });

  it("adds extracted video audio as an aligned audio track in the same edit", () => {
    const asset = newVideoAsset({ id: "asset-video", name: "scene.mov", duration: 8, width: 1280, height: 720, hasAudio: true });
    const audio = createAudioData(2, SR * 3, SR);
    audio.channels[0][0] = 0.5;
    const next = addVideoReferenceWithExtractedAudio(asset, audio, { start: 4, duration: 8, audioTrackName: "Scene Production Audio" })(s);

    expect(next.project.videoAssets?.[0]).toMatchObject({ id: "asset-video", hasAudio: true });
    expect(next.project.videoTracks?.[0].clips[0]).toMatchObject({ assetId: "asset-video", start: 4, duration: 8 });
    expect(next.project.tracks).toHaveLength(s.project.tracks.length + 1);
    expect(next.project.tracks.at(-1)).toMatchObject({ name: "Scene Production Audio" });
    expect(next.project.tracks.at(-1)?.clips[0]).toMatchObject({ start: 4, duration: 3, name: "scene.mov audio" });
    expect(next.project.tracks.at(-1)?.clips[0].buffer).toBe(audio);
    expect(next.activeTrackId).toBe(next.project.tracks.at(-1)?.id);
  });

  it("locks and unlocks a reference video clip for picture-lock workflows", () => {
    const asset = newVideoAsset({ id: "asset-video", name: "scene.mov", duration: 8 });
    const withVideo = addVideoReference(asset, { start: 4 })(s);
    const clipId = withVideo.project.videoTracks![0].clips[0].id;

    const locked = setVideoClipLocked(clipId, true)(withVideo);
    expect(locked.project.videoTracks?.[0].clips[0].locked).toBe(true);
    expect(setVideoClipLocked(clipId, true)(locked)).toBe(locked);

    const unlocked = setVideoClipLocked(clipId, false)(locked);
    expect(unlocked.project.videoTracks?.[0].clips[0].locked).toBeUndefined();
    expect(setVideoClipLocked("missing", true)(withVideo)).toBe(withVideo);
  });

  it("removeTrack drops the track and is a no-op for unknown ids", () => {
    expect(removeTrack(t1)(s).project.tracks.map((t) => t.id)).toEqual([t0, t2]);
    expect(removeTrack("ghost")(s)).toBe(s);
  });

  it("removeTrack reassigns the active track when the active one is removed", () => {
    expect(s.activeTrackId).toBe(t0);
    expect(removeTrack(t0)(s).activeTrackId).toBe(t1); // falls to the new first track
  });

  it("moveTrack reorders with a clamped target index; no-op for unknown ids", () => {
    expect(moveTrack(t0, 2)(s).project.tracks.map((t) => t.id)).toEqual([t1, t2, t0]);
    expect(moveTrack(t2, 99)(s).project.tracks.map((t) => t.id)).toEqual([t0, t1, t2]); // clamped to the end
    expect(moveTrack("ghost", 0)(s)).toBe(s);
  });
});

describe("advanced session graph commands", () => {
  it("adds buses, routes tracks, adds sends, and cleans stale routes when a bus is removed", () => {
    const withBus = addBus({ id: "bus-1", name: "Reverb" })(s);
    expect(withBus.project.buses?.[0].name).toBe("Reverb");

    const routed = setTrackOutput(t0, "bus-1")(withBus);
    expect(routed.project.tracks[0].outputId).toBe("bus-1");
    expect(setTrackOutput(t0, "ghost")(withBus)).toBe(withBus);

    const sent = addTrackSend(t0, "bus-1", { id: "send-1", gainDb: -6 })(routed);
    expect(sent.project.tracks[0].sends?.[0].gainDb).toBe(-6);
    expect(setTrackSendGain(t0, "send-1", 99)(sent).project.tracks[0].sends?.[0].gainDb).toBe(12);
    expect(setTrackSendPan(t0, "send-1", -9)(sent).project.tracks[0].sends?.[0].pan).toBe(-1);
    const sendGainAuto = setTrackSendGainAutomationPoint(t0, "send-1", 0.5, 99)(sent);
    expect(sendGainAuto.project.tracks[0].automation?.[0].name).toBe("Send Send Gain");
    expect(sendGainAuto.project.tracks[0].automation?.[0].target).toEqual({ kind: "sendGainDb", sendId: "send-1" });
    expect(sendGainAuto.project.tracks[0].automation?.[0].points).toEqual([{ time: 0.5, value: 12 }]);
    const sendPanAuto = setTrackSendPanAutomationPoint(t0, "send-1", 0.75, -9)(sendGainAuto);
    expect(sendPanAuto.project.tracks[0].automation?.[1].target).toEqual({ kind: "sendPan", sendId: "send-1" });
    expect(sendPanAuto.project.tracks[0].automation?.[1].points).toEqual([{ time: 0.75, value: -1 }]);
    expect(setTrackSendGainAutomationPoint(t0, "missing", 0, -6)(sent)).toBe(sent);
    expect(setTrackSendPreFader(t0, "send-1", true)(sent).project.tracks[0].sends?.[0].preFader).toBe(true);
    expect(setTrackSendEnabled(t0, "send-1", false)(sent).project.tracks[0].sends?.[0].enabled).toBe(false);
    expect(setTrackSendEnabled(t0, "missing", false)(sent)).toBe(sent);
    expect(removeTrackSend(t0, "send-1")(sent).project.tracks[0].sends).toEqual([]);

    const cleaned = removeBus("bus-1")(sent);
    expect(cleaned.project.buses).toEqual([]);
    expect(cleaned.project.tracks[0].outputId).toBe("master");
    expect(cleaned.project.tracks[0].sends).toEqual([]);
  });

  it("edits bus mixer params, bus sends, bus racks, and bus automation", () => {
    const withBuses = addBus({ id: "bus-a" })(addBus({ id: "bus-b" })(s));
    expect(setBusGain("bus-a", -100)(withBuses).project.buses?.find((b) => b.id === "bus-a")?.gainDb).toBe(-60);
    expect(setBusPan("bus-a", 3)(withBuses).project.buses?.find((b) => b.id === "bus-a")?.pan).toBe(1);
    expect(toggleBusMute("bus-a")(withBuses).project.buses?.find((b) => b.id === "bus-a")?.mute).toBe(true);
    expect(toggleBusSolo("bus-a")(withBuses).project.buses?.find((b) => b.id === "bus-a")?.solo).toBe(true);
    expect(setBusOutput("bus-a", "bus-b")(withBuses).project.buses?.find((b) => b.id === "bus-a")?.outputId).toBe("bus-b");
    const busGainAuto = setBusGainAutomationPoint("bus-a", 0.5, 99)(withBuses);
    expect(busGainAuto.project.buses?.find((b) => b.id === "bus-a")?.automation?.[0].target).toEqual({ kind: "gainDb" });
    expect(busGainAuto.project.buses?.find((b) => b.id === "bus-a")?.automation?.[0].points).toEqual([{ time: 0.5, value: 12 }]);
    const busPanAuto = setBusPanAutomationPoint("bus-a", 0.75, -9)(busGainAuto);
    expect(busPanAuto.project.buses?.find((b) => b.id === "bus-a")?.automation?.[1].target).toEqual({ kind: "pan" });
    expect(busPanAuto.project.buses?.find((b) => b.id === "bus-a")?.automation?.[1].points).toEqual([{ time: 0.75, value: -1 }]);
    expect(setBusGainAutomationPoint("missing", 0, -6)(withBuses)).toBe(withBuses);

    const withSend = addBusSend("bus-a", "bus-b", { id: "send-bus" })(withBuses);
    expect(withSend.project.buses?.find((b) => b.id === "bus-a")?.sends?.[0].id).toBe("send-bus");
    expect(setBusSendGain("bus-a", "send-bus", 99)(withSend).project.buses?.find((b) => b.id === "bus-a")?.sends?.[0].gainDb).toBe(12);
    expect(setBusSendPan("bus-a", "send-bus", -9)(withSend).project.buses?.find((b) => b.id === "bus-a")?.sends?.[0].pan).toBe(-1);
    expect(setBusSendPreFader("bus-a", "send-bus", true)(withSend).project.buses?.find((b) => b.id === "bus-a")?.sends?.[0].preFader).toBe(true);
    expect(setBusSendEnabled("bus-a", "send-bus", false)(withSend).project.buses?.find((b) => b.id === "bus-a")?.sends?.[0].enabled).toBe(false);
    expect(setBusSendEnabled("bus-a", "missing", false)(withSend)).toBe(withSend);
    const busSendGainAuto = setBusSendGainAutomationPoint("bus-a", "send-bus", 0.25, -99)(withSend);
    expect(busSendGainAuto.project.buses?.find((b) => b.id === "bus-a")?.automation?.[0].target).toEqual({ kind: "sendGainDb", sendId: "send-bus" });
    expect(busSendGainAuto.project.buses?.find((b) => b.id === "bus-a")?.automation?.[0].points).toEqual([{ time: 0.25, value: -60 }]);
    const busSendPanAuto = setBusSendPanAutomationPoint("bus-a", "send-bus", 0.75, 9)(busSendGainAuto);
    expect(busSendPanAuto.project.buses?.find((b) => b.id === "bus-a")?.automation?.[1].target).toEqual({ kind: "sendPan", sendId: "send-bus" });
    expect(busSendPanAuto.project.buses?.find((b) => b.id === "bus-a")?.automation?.[1].points).toEqual([{ time: 0.75, value: 1 }]);
    expect(setBusSendPanAutomationPoint("bus-a", "missing", 0, 1)(withSend)).toBe(withSend);
    expect(removeBusSend("bus-a", "send-bus")(withSend).project.buses?.find((b) => b.id === "bus-a")?.sends).toEqual([]);

    const withSlot = addBusEffectSlot("bus-a", newEffectSlot("gain", { id: "fx-bus" }))(withBuses);
    expect(withSlot.project.buses?.find((b) => b.id === "bus-a")?.effectRack?.slots[0].id).toBe("fx-bus");
    expect(setBusEffectSlotParam("bus-a", "fx-bus", "gainDb", -99)(withSlot).project.buses?.find((b) => b.id === "bus-a")?.effectRack?.slots[0].params.gainDb).toBe(-60);
    const busAutomated = setBusEffectParamAutomationPoint("bus-a", "fx-bus", "gainDb", 1.25, 99)(withSlot);
    const busAutomation = busAutomated.project.buses?.find((b) => b.id === "bus-a")?.automation?.[0];
    expect(busAutomation?.target).toEqual({ kind: "effectParam", effectSlotId: "fx-bus", param: "gainDb" });
    expect(busAutomation?.points).toEqual([{ time: 1.25, value: 24 }]);
    expect(setBusEffectSlotEnabled("bus-a", "fx-bus", false)(withSlot).project.buses?.find((b) => b.id === "bus-a")?.effectRack?.slots[0].enabled).toBe(false);
    expect(removeBusEffectSlot("bus-a", "fx-bus")(withSlot).project.buses?.find((b) => b.id === "bus-a")?.effectRack?.slots).toEqual([]);
    const withLane = addBusAutomationLane("bus-a", newAutomationLane({ id: "auto-bus", target: { kind: "gainDb" } }))(withBuses);
    expect(withLane.project.buses?.find((b) => b.id === "bus-a")?.automation?.[0].id).toBe("auto-bus");
  });

  it("edits persistent clip racks", () => {
    const withClip = insertClip(t0, createAudioData(2, SR, SR), 0, "Dialog")(s);
    const clipId = withClip.project.tracks[0].clips[0].id;
    const slot = newEffectSlot("gain", { id: "fx-clip", params: { gainDb: 0 } });
    const withSlot = addClipEffectSlot(clipId, slot)(withClip);
    expect(withSlot.project.tracks[0].clips[0].effectRack?.slots[0].id).toBe("fx-clip");
    expect(setClipEffectSlotParam(clipId, "fx-clip", "gainDb", -99)(withSlot).project.tracks[0].clips[0].effectRack?.slots[0].params.gainDb).toBe(-60);
    const automated = setClipEffectParamAutomationPoint(clipId, "fx-clip", "gainDb", 0.75, 6)(withSlot);
    expect(automated.project.tracks[0].clips[0].automation?.[0].target).toEqual({ kind: "effectParam", effectSlotId: "fx-clip", param: "gainDb" });
    expect(automated.project.tracks[0].clips[0].automation?.[0].points).toEqual([{ time: 0.75, value: 6 }]);
    const clipGainAuto = setClipGainAutomationPoint(clipId, 0.25, 99)(withClip);
    expect(clipGainAuto.project.tracks[0].clips[0].automation?.[0].name).toBe("Clip Volume");
    expect(clipGainAuto.project.tracks[0].clips[0].automation?.[0].target).toEqual({ kind: "gainDb" });
    expect(clipGainAuto.project.tracks[0].clips[0].automation?.[0].points).toEqual([{ time: 0.25, value: 12 }]);
    const clipPanAuto = setClipPanAutomationPoint(clipId, 0.5, -9)(clipGainAuto);
    const clipPanLane = clipPanAuto.project.tracks[0].clips[0].automation?.find((automation) => automation.target.kind === "pan");
    expect(clipPanLane?.name).toBe("Clip Pan");
    expect(clipPanLane?.points).toEqual([{ time: 0.5, value: -1 }]);
    expect(setClipGainAutomationPoint("missing", 0, -6)(withClip)).toBe(withClip);
    expect(setClipEffectSlotEnabled(clipId, "fx-clip", false)(withSlot).project.tracks[0].clips[0].effectRack?.slots[0].enabled).toBe(false);
    expect(setClipEffectSlotEnabled(clipId, "fx-clip", true)(withSlot)).toBe(withSlot);
    expect(setClipEffectSlotParam(clipId, "missing", "gainDb", -6)(withSlot)).toBe(withSlot);
    expect(setClipEffectParamAutomationPoint(clipId, "fx-clip", "ratio", 0, 4)(withSlot)).toBe(withSlot);
    expect(removeClipEffectSlot(clipId, "missing")(withSlot)).toBe(withSlot);
    expect(removeClipEffectSlot(clipId, "fx-clip")(withSlot).project.tracks[0].clips[0].effectRack?.slots).toEqual([]);
    expect(updateClip(withClip.project, "missing", (clip) => ({ ...clip, name: "Nope" }))).toBe(withClip.project);
  });

  it("edits persistent track racks, track automation, and master rack automation", () => {
    const slot = newEffectSlot("gain", { id: "fx-track", params: { gainDb: -3 } });
    const withSlot = addTrackEffectSlot(t0, slot)(s);
    expect(withSlot.project.tracks[0].effectRack?.slots[0].id).toBe("fx-track");
    expect(setTrackEffectSlotEnabled(t0, "fx-track", false)(withSlot).project.tracks[0].effectRack?.slots[0].enabled).toBe(false);
    expect(setTrackEffectSlotParam(t0, "fx-track", "gainDb", 99)(withSlot).project.tracks[0].effectRack?.slots[0].params.gainDb).toBe(24);
    const rackAutomated = setTrackEffectParamAutomationPoint(t0, "fx-track", "gainDb", 1.25, -99)(setTrackEffectParamAutomationPoint(t0, "fx-track", "gainDb", 0.25, 99)(withSlot));
    expect(rackAutomated.project.tracks[0].automation?.[0].name).toBe("gain gainDb");
    expect(rackAutomated.project.tracks[0].automation?.[0].target).toEqual({ kind: "effectParam", effectSlotId: "fx-track", param: "gainDb" });
    expect(rackAutomated.project.tracks[0].automation?.[0].points).toEqual([
      { time: 0.25, value: 24 },
      { time: 1.25, value: -60 },
    ]);
    expect(setTrackEffectParamAutomationPoint(t0, "fx-track", "gainDb", 0.25, 6)(rackAutomated).project.tracks[0].automation?.[0].points[0]).toEqual({ time: 0.25, value: 6 });
    expect(setTrackEffectSlotParam(t0, "missing", "gainDb", -6)(withSlot)).toBe(withSlot);
    expect(removeTrackEffectSlot(t0, "fx-track")(withSlot).project.tracks[0].effectRack?.slots).toEqual([]);

    const panSlot = newEffectSlot("pan", { id: "fx-pan", params: { pan: 0 } });
    const withPan = addTrackEffectSlot(t0, panSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-pan", "pan", -9)(withPan).project.tracks[0].effectRack?.slots[0].params.pan).toBe(-1);
    expect(setTrackEffectParamAutomationPoint(t0, "fx-pan", "pan", 0.5, 9)(withPan).project.tracks[0].automation?.[0].points).toEqual([{ time: 0.5, value: 1 }]);

    const compressorSlot = newEffectSlot("compressor", {
      id: "fx-compressor",
      params: { thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 120, kneeDb: 6, makeupDb: 0 },
    });
    const withCompressor = addTrackEffectSlot(t0, compressorSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-compressor", "thresholdDb", -999)(withCompressor).project.tracks[0].effectRack?.slots[0].params.thresholdDb).toBe(-80);
    expect(setTrackEffectSlotParam(t0, "fx-compressor", "ratio", 99)(withCompressor).project.tracks[0].effectRack?.slots[0].params.ratio).toBe(20);
    expect(setTrackEffectSlotParam(t0, "fx-compressor", "makeupDb", -99)(withCompressor).project.tracks[0].effectRack?.slots[0].params.makeupDb).toBe(-24);
    const compressorAutomated = setTrackEffectParamAutomationPoint(t0, "fx-compressor", "thresholdDb", 0.5, -999)(withCompressor);
    expect(compressorAutomated.project.tracks[0].automation?.[0].target).toEqual({ kind: "effectParam", effectSlotId: "fx-compressor", param: "thresholdDb" });
    expect(compressorAutomated.project.tracks[0].automation?.[0].points).toEqual([{ time: 0.5, value: -80 }]);

    const limiterSlot = newEffectSlot("limiter", {
      id: "fx-limiter",
      params: { ceilingDb: -0.3, inputBoostDb: 0, lookAheadMs: 5, releaseMs: 100 },
    });
    const withLimiter = addTrackEffectSlot(t0, limiterSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-limiter", "ceilingDb", 99)(withLimiter).project.tracks[0].effectRack?.slots[0].params.ceilingDb).toBe(0);
    expect(setTrackEffectSlotParam(t0, "fx-limiter", "inputBoostDb", -99)(withLimiter).project.tracks[0].effectRack?.slots[0].params.inputBoostDb).toBe(0);
    expect(setTrackEffectSlotParam(t0, "fx-limiter", "lookAheadMs", 99)(withLimiter).project.tracks[0].effectRack?.slots[0].params.lookAheadMs).toBe(50);
    expect(setTrackEffectSlotParam(t0, "fx-limiter", "releaseMs", 1)(withLimiter).project.tracks[0].effectRack?.slots[0].params.releaseMs).toBe(5);

    const tubeSlot = newEffectSlot("tubeCompressor", { id: "fx-tube", params: { driveDb: 9, warmth: 0.4, ratio: 3 } });
    const withTube = addTrackEffectSlot(t0, tubeSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-tube", "driveDb", 99)(withTube).project.tracks[0].effectRack?.slots[0].params.driveDb).toBe(24);
    expect(setTrackEffectSlotParam(t0, "fx-tube", "warmth", -1)(withTube).project.tracks[0].effectRack?.slots[0].params.warmth).toBe(0);
    expect(setTrackEffectSlotParam(t0, "fx-tube", "ratio", 99)(withTube).project.tracks[0].effectRack?.slots[0].params.ratio).toBe(20);

    const speechSlot = newEffectSlot("speechLeveler", { id: "fx-speech", params: { amount: 0.7, targetDb: -18 } });
    const withSpeech = addTrackEffectSlot(t0, speechSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-speech", "amount", 9)(withSpeech).project.tracks[0].effectRack?.slots[0].params.amount).toBe(1);
    expect(setTrackEffectSlotParam(t0, "fx-speech", "targetDb", -999)(withSpeech).project.tracks[0].effectRack?.slots[0].params.targetDb).toBe(-60);

    const centerSlot = newEffectSlot("centerChannel", { id: "fx-center", params: { centerLevelDb: -80, highFreq: 10000 } });
    const withCenter = addTrackEffectSlot(t0, centerSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-center", "centerLevelDb", 99)(withCenter).project.tracks[0].effectRack?.slots[0].params.centerLevelDb).toBe(24);
    expect(setTrackEffectSlotParam(t0, "fx-center", "highFreq", 99999)(withCenter).project.tracks[0].effectRack?.slots[0].params.highFreq).toBe(20000);

    const stereoToolsSlot = newEffectSlot("channelMixer", { id: "fx-channel-mixer", params: { leftToLeft: 100 } });
    const withStereoTools = addTrackEffectSlot(t0, stereoToolsSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-channel-mixer", "leftToLeft", 999)(withStereoTools).project.tracks[0].effectRack?.slots[0].params.leftToLeft).toBe(200);

    const phaseSlot = newEffectSlot("graphicPhaseShifter", { id: "fx-phase", params: { lowPhaseDeg: 0 } });
    const withPhase = addTrackEffectSlot(t0, phaseSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-phase", "highPhaseDeg", 999)(withPhase).project.tracks[0].effectRack?.slots[0].params.highPhaseDeg).toBe(180);

    const autoPhaseSlot = newEffectSlot("autoPhaseCorrect", { id: "fx-auto-phase", params: { maxShiftMs: 5 } });
    const withAutoPhase = addTrackEffectSlot(t0, autoPhaseSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-auto-phase", "maxShiftMs", 999)(withAutoPhase).project.tracks[0].effectRack?.slots[0].params.maxShiftMs).toBe(100);
    expect(setTrackEffectSlotParam(t0, "fx-auto-phase", "rightShiftMs", -999)(withAutoPhase).project.tracks[0].effectRack?.slots[0].params.rightShiftMs).toBe(-100);

    const phaserSlot = newEffectSlot("phaser", { id: "fx-phaser", params: { rateHz: 0.5, stages: 4, feedback: 0.3 } });
    const withPhaser = addTrackEffectSlot(t0, phaserSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-phaser", "rateHz", 99)(withPhaser).project.tracks[0].effectRack?.slots[0].params.rateHz).toBe(20);
    expect(setTrackEffectSlotParam(t0, "fx-phaser", "stages", 99)(withPhaser).project.tracks[0].effectRack?.slots[0].params.stages).toBe(24);
    expect(setTrackEffectSlotParam(t0, "fx-phaser", "feedback", -99)(withPhaser).project.tracks[0].effectRack?.slots[0].params.feedback).toBe(-0.95);

    const fullReverbSlot = newEffectSlot("fullReverb", { id: "fx-full-reverb", params: { decayMs: 1500, absorption: 0.35, seed: 1 } });
    const withFullReverb = addTrackEffectSlot(t0, fullReverbSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-full-reverb", "decayMs", 99999)(withFullReverb).project.tracks[0].effectRack?.slots[0].params.decayMs).toBe(6000);
    expect(setTrackEffectSlotParam(t0, "fx-full-reverb", "absorption", 2)(withFullReverb).project.tracks[0].effectRack?.slots[0].params.absorption).toBe(0.999);
    expect(setTrackEffectSlotParam(t0, "fx-full-reverb", "lowDb", -99)(withFullReverb).project.tracks[0].effectRack?.slots[0].params.lowDb).toBe(-36);
    expect(setTrackEffectSlotParam(t0, "fx-full-reverb", "midQ", 99)(withFullReverb).project.tracks[0].effectRack?.slots[0].params.midQ).toBe(50);
    expect(setTrackEffectSlotParam(t0, "fx-full-reverb", "highFreq", 100)(withFullReverb).project.tracks[0].effectRack?.slots[0].params.highFreq).toBe(500);
    expect(setTrackEffectSlotParam(t0, "fx-full-reverb", "seed", 1.4)(withFullReverb).project.tracks[0].effectRack?.slots[0].params.seed).toBe(1);

    const masteringSlot = newEffectSlot("mastering", { id: "fx-mastering", params: { width: 1.3, driveDb: 3 } });
    const withMastering = addTrackEffectSlot(t0, masteringSlot)(s);
    expect(setTrackEffectSlotParam(t0, "fx-mastering", "width", 9)(withMastering).project.tracks[0].effectRack?.slots[0].params.width).toBe(3);
    expect(setTrackEffectSlotParam(t0, "fx-mastering", "ceilingDb", 99)(withMastering).project.tracks[0].effectRack?.slots[0].params.ceilingDb).toBe(0);

    const lane = newAutomationLane({ id: "auto-track", target: { kind: "gainDb" } });
    expect(addTrackAutomationLane(t0, lane)(s).project.tracks[0].automation?.[0].id).toBe("auto-track");
    const drawn = setTrackGainAutomationPoint(t0, 1.5, -100)(setTrackGainAutomationPoint(t0, 0.5, 99)(s));
    expect(drawn.project.tracks[0].automation?.[0].points).toEqual([
      { time: 0.5, value: 12 },
      { time: 1.5, value: -60 },
    ]);
    const replaced = setTrackGainAutomationPoint(t0, 0.5, -6)(drawn);
    expect(replaced.project.tracks[0].automation?.[0].points[0]).toEqual({ time: 0.5, value: -6 });
    expect(setTrackGainAutomationPoint("missing", 0, -3)(drawn)).toBe(drawn);
    const withPanAutomation = setTrackPanAutomationPoint(t0, 1.5, -5)(setTrackPanAutomationPoint(t0, 0.25, 5)(drawn));
    const panLane = withPanAutomation.project.tracks[0].automation?.find((automation) => automation.target.kind === "pan");
    expect(panLane?.name).toBe("Pan");
    expect(panLane?.points).toEqual([
      { time: 0.25, value: 1 },
      { time: 1.5, value: -1 },
    ]);
    expect(withPanAutomation.project.tracks[0].automation?.find((automation) => automation.target.kind === "gainDb")?.points).toHaveLength(2);
    expect(setTrackPanAutomationPoint(t0, 0.25, 0.5)(withPanAutomation).project.tracks[0].automation?.find((automation) => automation.target.kind === "pan")?.points[0]).toEqual({ time: 0.25, value: 0.5 });

    const masterSlot = newEffectSlot("gain", { id: "fx-master" });
    expect(setMasterEffectRack({ slots: [masterSlot] })(s).project.masterEffectRack?.slots[0].id).toBe("fx-master");
    expect(addMasterEffectSlot(newEffectSlot("pan", { id: "fx-master-pan", params: { pan: 0 } }))(s).project.masterEffectRack?.slots[0].id).toBe("fx-master-pan");
    expect(setMasterEffectSlotParam("fx-master", "gainDb", 99)(setMasterEffectRack({ slots: [masterSlot] })(s)).project.masterEffectRack?.slots[0].params.gainDb).toBe(24);
    const masterAutomated = setMasterEffectParamAutomationPoint("fx-master", "gainDb", 2.5, -99)(setMasterEffectRack({ slots: [masterSlot] })(s));
    expect(masterAutomated.project.masterAutomation?.[0].target).toEqual({ kind: "effectParam", effectSlotId: "fx-master", param: "gainDb" });
    expect(masterAutomated.project.masterAutomation?.[0].points).toEqual([{ time: 2.5, value: -60 }]);
    expect(setMasterEffectSlotEnabled("fx-master", false)(setMasterEffectRack({ slots: [masterSlot] })(s)).project.masterEffectRack?.slots[0].enabled).toBe(false);
    expect(removeMasterEffectSlot("fx-master")(setMasterEffectRack({ slots: [masterSlot] })(s)).project.masterEffectRack?.slots).toEqual([]);
    expect(addMasterAutomationLane(newAutomationLane({ id: "auto-master", target: { kind: "gainDb" } }))(s).project.masterAutomation?.[0].id).toBe("auto-master");
    const masterGainAuto = setMasterGainAutomationPoint(0.5, 99)(s);
    expect(masterGainAuto.project.masterAutomation?.[0].name).toBe("Master Volume");
    expect(masterGainAuto.project.masterAutomation?.[0].target).toEqual({ kind: "gainDb" });
    expect(masterGainAuto.project.masterAutomation?.[0].points).toEqual([{ time: 0.5, value: 12 }]);
    const masterPanAuto = setMasterPanAutomationPoint(0.75, -9)(masterGainAuto);
    const masterPanLane = masterPanAuto.project.masterAutomation?.find((automation) => automation.target.kind === "pan");
    expect(masterPanLane?.name).toBe("Master Pan");
    expect(masterPanLane?.points).toEqual([{ time: 0.75, value: -1 }]);
    expect(masterPanAuto.project.masterAutomation?.find((automation) => automation.target.kind === "gainDb")?.points).toEqual([{ time: 0.5, value: 12 }]);
  });
});

describe("markers", () => {
  it("remove / rename / move address a marker by id", () => {
    const withM = addMarker({ time: 2, name: "M" })(s);
    const id = withM.project.markers[0].id;
    expect(removeMarker(id)(withM).project.markers).toHaveLength(0);
    expect(removeMarker("ghost")(withM)).toBe(withM); // no-op identity
    expect(renameMarker(id, "Chorus")(withM).project.markers[0].name).toBe("Chorus");
    expect(moveMarker(id, -5)(withM).project.markers[0].time).toBe(0); // floored at 0
    expect(moveMarker(id, 3)(withM).project.markers[0].time).toBe(3);
  });
});

describe("updateTrack helper (structural sharing)", () => {
  it("returns the same project when the id is unknown", () => {
    expect(updateTrack(s.project, "ghost", (t) => ({ ...t, gainDb: 5 }))).toBe(s.project);
  });

  it("replaces only the addressed track, sharing the rest by reference", () => {
    const next = updateTrack(s.project, t1, (t) => ({ ...t, gainDb: 5 }));
    expect(next).not.toBe(s.project);
    expect(next.tracks[1].gainDb).toBe(5);
    expect(next.tracks[0]).toBe(s.project.tracks[0]);
    expect(next.tracks[2]).toBe(s.project.tracks[2]);
  });
});

describe("updateBus helper (structural sharing)", () => {
  it("returns the same project when the id is unknown", () => {
    expect(updateBus(s.project, "ghost", (b) => ({ ...b, gainDb: 5 }))).toBe(s.project);
  });
});
