// ─────────────────────────────────────────────────────────────
// mcp/commands.test — thin MCP wrappers over live Rythme state
// ─────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addBus, addTrackSend, createAudioData, emptyProject, insertClip, resetIds, RythmeStore } from "../engine";
import { setMcpStore } from "./store-handle";
import { appApplyKeyboardShortcutPreset, appDeleteKeyboardShortcutPreset, appDiscoverControlSurfaces, appExportKeyboardShortcutPreset, appGetAudioHardwarePreferences, appGetControlSurfacePreferences, appGetFilePreferences, appGetPanelPreferences, appGetWorkspacePreferences, appImportKeyboardShortcutPreset, appListKeyboardShortcutPresets, appSaveKeyboardShortcutPreset, appSetAudioHardwarePreferences, appSetControlSurfaceMappings, appSetControlSurfacePreferences, appSetFilePreferences, appSetPanelPreferences, appSetWorkspacePreferences, busSetAutomationMode, clipSetAutomationMode, effectApplyFavorite, effectSaveFavoriteRack, mixerMeterBridge, pluginAddToTrackRack, pluginImportCandidateMetadata, pluginImportCandidates, pluginImportRoots, pluginListManaged, pluginScanRoots, pluginSetEnabled, pluginSetPreset, projectApplyKeyboardShortcutPreset, projectDeleteCustomWorkspace, projectDeleteKeyboardShortcutPreset, projectExportKeyboardShortcutPreset, projectImportKeyboardShortcutPreset, projectRemoveKeyboardShortcut, projectSaveCustomWorkspace, projectSaveKeyboardShortcutPreset, projectSetAnalyzePanelPreferences, projectSetAudioHardware, projectSetEditorPreferences, projectSetEffectsPanelPreferences, projectSetKeyboardShortcut, projectSetMasterAutomationMode, projectSetPunchRange, sessionNew, trackAddRackSlot, trackAutomateRackParam, trackSetAutomationMode, trackSetInput, viewSetEditorMode, viewSetWorkspace } from "./commands";

let store: RythmeStore;
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

beforeEach(() => {
  resetIds();
  store = new RythmeStore(emptyProject("MCP", 1, 48000));
  setMcpStore(store);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: fakeStorage() });
});

afterEach(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

function fakeStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const data: Record<string, string> = {};
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}

describe("MCP rack automation commands", () => {
  it("switches the editor mode through the MCP view surface", () => {
    expect(store.getState().mode).toBe("multitrack");
    expect(viewSetEditorMode("waveform")).toContain("waveform");
    expect(store.getState().mode).toBe("waveform");
    expect(viewSetEditorMode("multitrack")).toContain("multitrack");
    expect(store.getState().mode).toBe("multitrack");
  });

  it("sets project editor preferences through the MCP project surface", () => {
    expect(projectSetEditorPreferences("waveform", "envelope", 0, "samples", 100, 12000)).toContain("waveform");
    const state = store.getState();
    expect(state.mode).toBe("waveform");
    expect(state.tool).toBe("envelope");
    expect(state.view.snap).toBe(false);
    expect(state.project.editorPreferences).toMatchObject({
      editorMode: "waveform",
      tool: "envelope",
      snap: false,
      displayTimeFormat: "samples",
      spectralMinHz: 100,
      spectralMaxHz: 12000,
    });
  });

  it("saves, selects, and deletes custom workspaces through the MCP surface", () => {
    const layout = JSON.stringify({ left: { size: 300, stack: [{ tabs: ["mixer"], active: "mixer", flex: 1 }] } });
    expect(projectSaveCustomWorkspace("Mix Review", layout)).toContain("mix-review");
    expect(store.getState().project.editorPreferences?.customWorkspaces[0]).toMatchObject({ id: "mix-review", name: "Mix Review" });
    expect(viewSetWorkspace("mix-review")).toContain("mix-review");
    expect(store.getState().project.editorPreferences?.activeWorkspaceId).toBe("mix-review");
    expect(projectDeleteCustomWorkspace("mix-review")).toContain("mix-review");
    expect(store.getState().project.editorPreferences?.activeWorkspaceId).toBe("default");
    expect(viewSetWorkspace("mix-review")).toContain("not found");
  });

  it("sets and removes project keyboard shortcut overrides through the MCP surface", () => {
    expect(projectSetKeyboardShortcut("edit.split", "x", 1, 1, 0)).toContain("Cmd/Ctrl+Shift+X");
    expect(store.getState().project.editorPreferences?.keyboardShortcuts).toEqual([
      { action: "edit.split", key: "x", mod: true, shift: true, alt: false },
    ]);
    expect(projectSetKeyboardShortcut("nope", "x")).toContain("not supported");
    expect(projectRemoveKeyboardShortcut("edit.split")).toContain("built-in default");
    expect(store.getState().project.editorPreferences?.keyboardShortcuts).toEqual([]);
  });

  it("saves, applies, imports, exports, and deletes keyboard shortcut presets over MCP", () => {
    expect(projectSaveKeyboardShortcutPreset("Empty")).toContain("No custom");
    projectSetKeyboardShortcut("edit.split", "x", 1, 1, 0);
    expect(projectSaveKeyboardShortcutPreset("Editing")).toContain("Editing");
    const preset = store.getState().project.editorPreferences?.keyboardShortcutPresets[0];
    expect(preset).toMatchObject({ id: "editing", name: "Editing" });

    projectRemoveKeyboardShortcut("edit.split");
    expect(projectApplyKeyboardShortcutPreset("editing")).toContain("Editing");
    expect(store.getState().project.editorPreferences?.keyboardShortcuts[0]).toMatchObject({ action: "edit.split", key: "x" });

    const exported = projectExportKeyboardShortcutPreset("editing");
    expect(JSON.parse(exported)).toMatchObject({ id: "editing", name: "Editing" });
    expect(projectImportKeyboardShortcutPreset(exported.replace("\"editing\"", "\"editing-copy\""))).toContain("Editing");
    expect(store.getState().project.editorPreferences?.keyboardShortcutPresets.map((entry) => entry.id)).toEqual(["editing", "editing-copy"]);

    expect(projectDeleteKeyboardShortcutPreset("editing")).toContain("Editing");
    expect(projectDeleteKeyboardShortcutPreset("missing")).toContain("not found");
  });

  it("manages app-global keyboard shortcut presets over MCP", async () => {
    await expect(appListKeyboardShortcutPresets()).resolves.toContain("No app-global");
    await expect(appSaveKeyboardShortcutPreset("Empty")).resolves.toContain("No custom");

    projectSetKeyboardShortcut("edit.split", "x", 1, 1, 0);
    await expect(appSaveKeyboardShortcutPreset("Global Editing")).resolves.toContain("global-editing");
    await expect(appListKeyboardShortcutPresets()).resolves.toContain("global-editing: Global Editing (1 shortcuts)");

    projectRemoveKeyboardShortcut("edit.split");
    await expect(appApplyKeyboardShortcutPreset("global-editing")).resolves.toContain("Global Editing");
    expect(store.getState().project.editorPreferences?.keyboardShortcuts[0]).toMatchObject({ action: "edit.split", key: "x" });

    const exported = await appExportKeyboardShortcutPreset("global-editing");
    expect(JSON.parse(exported)).toMatchObject({ id: "global-editing", name: "Global Editing" });
    await expect(appImportKeyboardShortcutPreset(exported.replace("\"global-editing\"", "\"global-editing-copy\""))).resolves.toContain("Global Editing");
    await expect(appListKeyboardShortcutPresets()).resolves.toContain("global-editing-copy: Global Editing");

    await expect(appDeleteKeyboardShortcutPreset("global-editing")).resolves.toContain("Global Editing");
    await expect(appApplyKeyboardShortcutPreset("missing")).resolves.toContain("not found");
  });

  it("sets app-global file behavior preferences over MCP", async () => {
    await expect(appSetFilePreferences("wav", 32, 1)).resolves.toContain("WAV 32-bit float");
    await expect(appGetFilePreferences()).resolves.toBe(JSON.stringify({
      exportFormat: "wav",
      exportBitDepth: 32,
      exportFloat: true,
    }));

    await expect(appSetFilePreferences("aiff", 32, 1)).resolves.toContain("AIFF 32-bit");
    await expect(appGetFilePreferences()).resolves.toBe(JSON.stringify({
      exportFormat: "aiff",
      exportBitDepth: 32,
      exportFloat: false,
    }));
  });

  it("sets app-global workspace defaults over MCP and applies them to new sessions", async () => {
    await expect(appSetWorkspacePreferences("mixing", "waveform", "envelope", 0, "samples")).resolves.toContain("mixing, waveform, envelope, snap off, samples");
    await expect(appSetAudioHardwarePreferences("mic-default", "out-default", 96000, 4, "armed", 11, 2, 1, -4, 3000)).resolves.toContain("96000 Hz");
    await expect(appSetPanelPreferences(JSON.stringify({
      analyze: { spectralMinHz: 80, spectralMaxHz: 9000, spectralGainDb: -18 },
      effects: { gainDb: 7, normalizeTargetDb: -2 },
    }))).resolves.toContain("analyze 80-9000 Hz");
    await expect(appGetWorkspacePreferences()).resolves.toBe(JSON.stringify({
      defaultWorkspaceId: "mixing",
      defaultEditorMode: "waveform",
      defaultTool: "envelope",
      defaultSnap: false,
      defaultDisplayTimeFormat: "samples",
    }));
    await expect(appGetPanelPreferences()).resolves.toContain("\"spectralMinHz\":80");

    await expect(sessionNew()).resolves.toContain("Started");
    const state = store.getState();
    expect(state.mode).toBe("waveform");
    expect(state.tool).toBe("envelope");
    expect(state.view.snap).toBe(false);
    expect(state.project.editorPreferences).toMatchObject({
      activeWorkspaceId: "mixing",
      editorMode: "waveform",
      tool: "envelope",
      snap: false,
      displayTimeFormat: "samples",
    });
    expect(state.project.audioHardware).toMatchObject({
      inputDeviceId: "mic-default",
      outputDeviceId: "out-default",
      hardwareSampleRate: 96000,
      inputChannels: 4,
      inputMonitoring: "armed",
      latencyCompensationMs: 11,
      preRollSeconds: 2,
      countInBars: 1,
      punchIn: null,
      meterCalibrationDb: -4,
      meterPeakHoldMs: 3000,
    });
    expect(state.project.panelPreferences).toMatchObject({
      analyze: { spectralMinHz: 80, spectralMaxHz: 9000, spectralGainDb: -18 },
      effects: { gainDb: 7, normalizeTargetDb: -2 },
    });
  });

  it("sets app-global audio hardware defaults over MCP", async () => {
    await expect(appSetAudioHardwarePreferences("mic-a", "out-a", 44100, 1, "always", -12, 3, 2, 2.5, 1800)).resolves.toContain("44100 Hz");
    await expect(appGetAudioHardwarePreferences()).resolves.toBe(JSON.stringify({
      inputDeviceId: "mic-a",
      outputDeviceId: "out-a",
      hardwareSampleRate: 44100,
      inputChannels: 1,
      inputMonitoring: "always",
      latencyCompensationMs: -12,
      preRollSeconds: 3,
      countInBars: 2,
      meterCalibrationDb: 2.5,
      meterPeakHoldMs: 1800,
    }));
  });

  it("sets app-global control surface defaults over MCP", async () => {
    await expect(appSetControlSurfacePreferences(1, "mackieControl", "midi-in", "midi-out")).resolves.toContain("mackieControl");
    await expect(appGetControlSurfacePreferences()).resolves.toBe(JSON.stringify({
      enabled: true,
      protocol: "mackieControl",
      inputId: "midi-in",
      outputId: "midi-out",
      mappings: [],
    }));
    await expect(appSetControlSurfaceMappings(JSON.stringify([
      { trigger: { status: 0x90, data1: 60 }, action: { type: "togglePlay" } },
      { trigger: { status: 0xb0, data1: 16 }, action: { type: "trackGain", trackIndex: 0 } },
    ]))).resolves.toContain("2 app-global");
    await expect(appGetControlSurfacePreferences()).resolves.toContain("\"mappings\":[{\"trigger\":{\"status\":144,\"data1\":60},\"action\":{\"type\":\"togglePlay\"}}");
    await expect(appSetControlSurfaceMappings("{bad")).resolves.toContain("could not be parsed");
    await expect(appSetControlSurfacePreferences(1, "eucon", "", "")).resolves.toContain("genericMidi");
    await expect(appDiscoverControlSurfaces()).resolves.toContain("\"supported\":false");
  });

  it("validates app-global panel defaults over MCP", async () => {
    await expect(appSetPanelPreferences("{bad")).resolves.toContain("could not be parsed");
    await expect(appSetPanelPreferences(JSON.stringify({ effects: { gainDb: "loud" } }))).resolves.toContain("finite number");
    await expect(appSetPanelPreferences(JSON.stringify({ analyze: { spectralLowHz: 100 } }))).resolves.toContain("not supported");
  });

  it("sets Analyze panel preferences through the MCP project surface", () => {
    expect(projectSetAnalyzePanelPreferences(120, 12000, -18)).toContain("120-12000 Hz");
    expect(store.getState().project.panelPreferences?.analyze).toEqual({
      spectralMinHz: 120,
      spectralMaxHz: 12000,
      spectralGainDb: -18,
    });
  });

  it("sets Effects panel preferences through the MCP project surface", () => {
    const prefs = { gainDb: 9, normalizeTargetDb: -1, dehummerHarmonics: 12 };
    expect(projectSetEffectsPanelPreferences(JSON.stringify(prefs))).toContain("gain 9.0 dB");
    expect(store.getState().project.panelPreferences?.effects).toMatchObject(prefs);
    expect(projectSetEffectsPanelPreferences("{bad")).toContain("could not be parsed");
    expect(projectSetEffectsPanelPreferences(JSON.stringify({ gainDb: "loud" }))).toContain("finite number");
  });

  it("adds a persistent built-in track rack slot and returns its id", () => {
    const msg = trackAddRackSlot(0, "gain", -12);
    const slot = store.getState().project.tracks[0].effectRack?.slots[0];
    expect(slot?.kind).toBe("gain");
    expect(slot?.params.gainDb).toBe(-12);
    expect(msg).toContain(slot!.id);
  });

  it("saves and applies favorite rack chains through the MCP effect surface", () => {
    const audio = createAudioData(1, 2, 48000);
    audio.channels[0][0] = 0.25;
    audio.channels[0][1] = -0.5;
    store.dispatch(insertClip(store.getState().project.tracks[0].id, audio, 0, "Test"), { history: false });
    trackAddRackSlot(0, "invertPolarity");

    expect(effectSaveFavoriteRack("Flip Polarity")).toContain("fav-");
    const chain = store.getState().project.favoriteEffectChains?.[0];
    expect(chain).toMatchObject({ name: "Flip Polarity", steps: [{ kind: "invertPolarity" }] });
    expect(effectApplyFavorite("Flip Polarity")).toContain("Applied favorite effect chain Flip Polarity");
    const out = store.getState().project.tracks[0].clips[0].buffer.channels[0];
    expect(out[0]).toBeCloseTo(-0.25, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
  });

  it("sets audio hardware preferences, punch range, and track input assignment", () => {
    expect(projectSetAudioHardware("mic-a", "out-a", 96000, 6, "armed", 12, 1.5, 2, -3, 2400)).toContain("96000 Hz");
    expect(projectSetPunchRange(3, 7)).toContain("3s..7s");
    expect(trackSetInput(0, "input6", "mic-b", "always")).toContain("input6");
    const state = store.getState();
    expect(state.project.audioHardware).toMatchObject({
      inputDeviceId: "mic-a",
      outputDeviceId: "out-a",
      hardwareSampleRate: 96000,
      inputChannels: 6,
      inputMonitoring: "armed",
      latencyCompensationMs: 12,
      preRollSeconds: 1.5,
      countInBars: 2,
      meterCalibrationDb: -3,
      meterPeakHoldMs: 2400,
      punchIn: { start: 3, end: 7 },
    });
    expect(state.project.tracks[0].input).toEqual({ channel: "input6", deviceId: "mic-b", monitoring: "always" });
    expect(trackSetInput(0, "clear")).toContain("Cleared");
    expect(store.getState().project.tracks[0].input).toBeUndefined();
  });

  it("sets automation modes through the MCP surface", () => {
    const audio = createAudioData(1, 2, 48000);
    store.dispatch(insertClip(store.getState().project.tracks[0].id, audio, 0, "Auto"), { history: false });
    const clipId = store.getState().project.tracks[0].clips[0].id;
    store.dispatch(addBus({ id: "bus-mcp" }), { history: false });

    expect(trackSetAutomationMode(0, "off")).toContain("off");
    expect(busSetAutomationMode(0, "latch")).toContain("latch");
    expect(clipSetAutomationMode(clipId, "touch")).toContain("touch");
    expect(projectSetMasterAutomationMode("write")).toContain("write");

    const project = store.getState().project;
    expect(project.tracks[0].automationMode).toBe("off");
    expect(project.buses?.[0].automationMode).toBe("latch");
    expect(project.tracks[0].clips[0].automationMode).toBe("touch");
    expect(project.masterAutomationMode).toBe("write");
  });

  it("reports the mixer meter bridge over MCP", () => {
    const audio = createAudioData(2, 48000, 48000);
    audio.channels[0].fill(0.5);
    audio.channels[1].fill(0.25);
    store.dispatch(insertClip(store.getState().project.tracks[0].id, audio, 0, "Tone"), { history: false });
    store.dispatch(addBus({ id: "bus-meter", name: "Meter Bus" }), { history: false });
    store.dispatch(addTrackSend(store.getState().project.tracks[0].id, "bus-meter", { id: "send-meter", name: "Meter Send" }), { history: false });

    const report = mixerMeterBridge(0, 100);

    expect(report).toContain("Meter bridge @ 0.000s / 100ms");
    expect(report).toContain("cal +0.0 dB");
    expect(report).toContain("hold 1200 ms");
    expect(report).toContain("Master peak");
    expect(report).toContain("hold");
    expect(report).toContain("Track Track 1 peak");
    expect(report).toContain("Tap Track Track 1 input");
    expect(report).toContain("Tap Track Track 1 send Meter Send send post -> bus-meter");
    expect(report).toContain("Tap Bus Meter Bus input");
  });

  it("manages project-persisted native plug-in inventory over MCP", () => {
    expect(pluginImportCandidates("/Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3")).toContain("Imported 1");
    const plugin = store.getState().project.nativePluginManager!.plugins[0];
    expect(pluginListManaged()).toContain(`${plugin.id}: Pro-Q 3`);
    expect(pluginAddToTrackRack(0, plugin.id)).toContain("inventory only");
    expect(store.getState().project.tracks[0].effectRack?.slots[0]).toMatchObject({
      kind: "nativePlugin",
      params: { pluginId: plugin.id, hostStatus: "inventoryOnly", canProcess: false },
    });
    expect(pluginSetEnabled(plugin.id, 0)).toContain("Disabled");
    expect(pluginSetPreset(plugin.id, "Dialogue", "{\"thresholdDb\":-18,\"mode\":\"speech\"}")).toContain("Stored preset Dialogue");
    expect(store.getState().project.nativePluginManager!.plugins[0]).toMatchObject({
      enabled: false,
      presetName: "Dialogue",
      state: { thresholdDb: -18, mode: "speech" },
    });
    expect(pluginSetPreset(plugin.id, "Bad", "{\"nested\":{}}")).toContain("State JSON must be an object");
  });

  it("imports scanner-validated native plug-in metadata through MCP", () => {
    const msg = pluginImportCandidateMetadata(JSON.stringify([{
      path: "/Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3",
      vendor: "FabFilter",
      version: "3.2.1",
      bundleIdentifier: "com.fabfilter.Pro-Q.3",
      validationStatus: "metadataVerified",
      entryPointVerified: true,
    }]));
    expect(msg).toContain("1 metadata verified");
    expect(store.getState().project.nativePluginManager!.plugins[0]).toMatchObject({
      vendor: "FabFilter",
      version: "3.2.1",
      bundleIdentifier: "com.fabfilter.Pro-Q.3",
      validationStatus: "metadataVerified",
      entryPointVerified: true,
    });
    expect(pluginListManaged()).toContain("metadata verified");
    expect(pluginImportCandidateMetadata("{bad")).toContain("could not be parsed");
    expect(pluginImportCandidateMetadata(JSON.stringify([{ path: 3 }]))).toContain("include a path");
    expect(pluginImportCandidateMetadata(JSON.stringify([{ path: "/x.vst3", entryPointVerified: "yes" }]))).toContain("entryPointVerified must be a boolean");
  });

  it("scans and imports native plug-in roots through MCP", async () => {
    await expect(pluginScanRoots("/Plug-Ins/Foo.vst3", 0)).resolves.toContain("Foo");
    await expect(pluginImportRoots("/Plug-Ins/Foo.vst3", 0)).resolves.toContain("Imported 1");
    expect(store.getState().project.nativePluginManager).toMatchObject({
      scanRoots: ["/Plug-Ins/Foo.vst3"],
      plugins: [{ name: "Foo", hostStatus: "inventoryOnly" }],
    });
    await expect(pluginImportRoots("", 0)).resolves.toContain("No search roots supplied");
  });

  it("adds persistent compressor and limiter rack slots with clamped primary params", () => {
    trackAddRackSlot(0, "compressor", -999);
    trackAddRackSlot(0, "limiter", 99);
    const slots = store.getState().project.tracks[0].effectRack!.slots;
    expect(slots[0].kind).toBe("compressor");
    expect(slots[0].params).toMatchObject({ thresholdDb: -80, ratio: 4, attackMs: 10, releaseMs: 120, kneeDb: 6, makeupDb: 0 });
    expect(slots[1].kind).toBe("limiter");
    expect(slots[1].params).toMatchObject({ ceilingDb: 0, inputBoostDb: 0, lookAheadMs: 5, releaseMs: 100 });
  });

  it("adds persistent EQ, restoration, stereo, delay, and reverb rack slots", () => {
    trackAddRackSlot(0, "parametricEQ", 12);
    trackAddRackSlot(0, "dehummer", 50);
    trackAddRackSlot(0, "stereoExpander", 180);
    trackAddRackSlot(0, "delay", 125);
    trackAddRackSlot(0, "studioReverb", 0.4);
    const slots = store.getState().project.tracks[0].effectRack!.slots;
    expect(slots.map((slot) => slot.kind)).toEqual(["parametricEQ", "dehummer", "stereoExpander", "delay", "studioReverb"]);
    expect(slots[0].params).toMatchObject({ freq: 1000, q: 1, gainDb: 12 });
    expect(slots[1].params).toMatchObject({ frequency: 50, q: 20, reductionDb: -24, harmonics: 10 });
    expect(slots[2].params).toMatchObject({ expand: 180, centerPan: 0 });
    expect(slots[3].params).toMatchObject({ delayMs: 125, feedback: 0.35, mix: 0.35, tailSeconds: 1.5 });
    expect(slots[4].params).toMatchObject({ decay: 0.5, damping: 0.4, mix: 0.4, tailSeconds: 1.5 });
  });

  it("adds persistent modulation, distortion, vocal, and full reverb rack slots", () => {
    trackAddRackSlot(0, "phaser", 2);
    trackAddRackSlot(0, "waveshaper", 18);
    trackAddRackSlot(0, "guitarSuite", 24);
    trackAddRackSlot(0, "exciter", 18);
    trackAddRackSlot(0, "vocalEnhancer");
    trackAddRackSlot(0, "fullReverb", 750);
    const slots = store.getState().project.tracks[0].effectRack!.slots;
    expect(slots.map((slot) => slot.kind)).toEqual(["phaser", "waveshaper", "guitarSuite", "exciter", "vocalEnhancer", "fullReverb"]);
    expect(slots[0].params).toMatchObject({ rateHz: 2, stages: 4, depth: 1, feedback: 0.3, mix: 0.5, baseFreqHz: 300, rangeOctaves: 4 });
    expect(slots[1].params).toMatchObject({ driveDb: 18, amount: 0.7, mix: 1 });
    expect(slots[2].params).toMatchObject({ driveDb: 24, bodyHz: 90, toneHz: 5000, presenceDb: 3, mix: 1, outputDb: 0 });
    expect(slots[3].params).toMatchObject({ frequency: 3000, driveDb: 18, mix: 0.3 });
    expect(slots[4].params).toEqual({});
    expect(slots[5].params).toMatchObject({ decayMs: 750, perception: 40, preDelayMs: 0, absorption: 0.35, lowDb: 0, lowFreq: 200, midDb: 0, midFreq: 1000, midQ: 1, highDb: -6, highFreq: 6000, mix: 0.3, seed: 1 });
  });

  it("adds persistent stereo utility, phase, leveler, and mastering rack slots", () => {
    trackAddRackSlot(0, "tubeCompressor", 12);
    trackAddRackSlot(0, "speechLeveler", 0.8);
    trackAddRackSlot(0, "centerChannel");
    trackAddRackSlot(0, "channelMixer");
    trackAddRackSlot(0, "graphicPhaseShifter", 90);
    trackAddRackSlot(0, "autoPhaseCorrect", 12);
    trackAddRackSlot(0, "mastering", 6);
    const slots = store.getState().project.tracks[0].effectRack!.slots;
    expect(slots.map((slot) => slot.kind)).toEqual(["tubeCompressor", "speechLeveler", "centerChannel", "channelMixer", "graphicPhaseShifter", "autoPhaseCorrect", "mastering"]);
    expect(slots[0].params).toMatchObject({ driveDb: 12, warmth: 0.4, thresholdDb: -18, ratio: 3, makeupDb: 3 });
    expect(slots[1].params).toMatchObject({ targetDb: -18, amount: 0.8, maxGainDb: 24, gateDb: -50, windowMs: 300 });
    expect(slots[2].params).toMatchObject({ mode: "remove", centerLevelDb: -80, sideLevelDb: 0, lowFreq: 120, highFreq: 10000 });
    expect(slots[3].params).toMatchObject({ leftToLeft: 100, rightToLeft: 0, leftToRight: 0, rightToRight: 100 });
    expect(slots[4].params).toMatchObject({ channel: "left", lowPhaseDeg: 0, highPhaseDeg: 90 });
    expect(slots[5].params).toMatchObject({ mode: "auto", maxShiftMs: 12, leftShiftMs: 0, rightShiftMs: 0 });
    expect(slots[6].params).toMatchObject({ lowShelfDb: 1, highShelfDb: 2, exciteAmount: 0.2, width: 1.3, driveDb: 6, ceilingDb: -1, amount: 1 });
  });

  it("clamps slot params and adds an effect-parameter automation lane", () => {
    trackAddRackSlot(0, "pan", 9);
    const slot = store.getState().project.tracks[0].effectRack!.slots[0];
    expect(slot.params.pan).toBe(1);

    const msg = trackAutomateRackParam(0, slot.id, "pan", 0, -2, 2, 2, "hold");
    const lane = store.getState().project.tracks[0].automation?.[0];
    expect(lane?.target).toEqual({ kind: "effectParam", effectSlotId: slot.id, param: "pan" });
    expect(lane?.interpolation).toBe("hold");
    expect(lane?.points).toEqual([
      { time: 0, value: -1 },
      { time: 2, value: 1 },
    ]);
    expect(msg).toContain(`${slot.id}.pan`);
  });

  it("rejects unsupported slot/parameter pairs without mutating automation", () => {
    trackAddRackSlot(0, "silence", 0);
    const slot = store.getState().project.tracks[0].effectRack!.slots[0];
    const msg = trackAutomateRackParam(0, slot.id, "gainDb", 0, -12, 1, 0);
    expect(msg).toContain("does not support");
    expect(store.getState().project.tracks[0].automation).toEqual([]);
  });
});
