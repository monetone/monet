// Monet Rythme — MCP command surface.
//
// Every exported `@mcp` function here becomes an MCP tool automatically: the
// codegen (`pnpm mcp:codegen`) reads the JSDoc + parameter types and writes
// mcp.manifest.json + mcp.generated.ts, and `pnpm mcp:check` fails CI if a new
// command is added without regenerating. To add a feature to the MCP surface,
// add a typed, `@mcp`-tagged exported function here that calls into the app's
// existing command layer (ui/commands + engine store actions).
//
// Keep these thin: they delegate to the same high-level UI commands and store
// actions the UI uses, so MCP automation and the UI stay in lockstep. Rythme's
// commands take the live `RythmeStore`; we fetch it from the MCP store handle
// (registered by EditorProvider) rather than a `window` global.

import {
  applySpectralSelectionGain,
  selectSpectralRange,
  setTempo,
  setMasterGain,
  setMasterAutomationMode,
  applyProjectKeyboardShortcutPreset,
  deleteProjectKeyboardShortcutPreset,
  deleteProjectWorkspace,
  saveProjectWorkspace,
  saveProjectKeyboardShortcutPreset,
  setActiveWorkspace,
  setProjectAudioHardware,
  setProjectEditorPreferences,
  setProjectKeyboardShortcut,
  setProjectPanelPreferences,
  removeProjectKeyboardShortcut,
  defaultPanelPreferences,
  KEYBOARD_SHORTCUT_ACTIONS,
  normalizeShortcutKey,
  setProjectChannelCount,
  setTrackAudioRole,
  setBusAutomationMode,
  setClipAutomationMode,
  setTrackAutomationMode,
  setTrackInput,
  setTrackSurroundPan,
  addTrackAutomationLane,
  addTrackEffectSlot,
  newAutomationLane,
  newEffectSlot,
  setZoom,
  zoomBy,
  setEditorMode,
  setTool,
  toggleMetronome,
  setPlayhead,
  IO,
  Ops,
  type AnalyzePanelPreferences,
  type EffectParamValue,
  type EffectsPanelPreferences,
  type KeyboardShortcut,
  type WorkspaceLayoutData,
} from "../engine";
import {
  newSession,
  insertGenerated,
  insertTones,
  insertDtmfSequence,
  applyPitchShift,
  applyRemixToDuration,
  applyTimeStretch,
  applyScientificFilter,
  applyGraphicEq,
  GRAPHIC_EQ_PRESETS,
  applyParametricEq,
  PARAMETRIC_EQ_PRESETS,
  bounceTrackToNewTrack,
  bounceProjectToNewTrack,
  applyStereoExpander,
  applySwapChannels,
  applyMastering,
  MASTERING_PRESETS,
  applyFullReverb,
  applyConvolutionReverbImpulse,
  applyAutoPhaseCorrect,
  applyGraphicPhaseShifter,
  applyGainEnvelope,
  splitIntoBands,
  applyFavoriteEffectChain,
  saveActiveRackAsFavorite,
  analyzeAmplitude,
  analyzePhase,
  applyDeleteSilence,
  analyzeSpectrogram,
  applyConvertSampleType,
  markAudioRegions,
  markBeats,
  markersCsv,
  importMarkersCsv,
  analyzeTempo,
  analyzePitch,
  analyzeHistogram,
  analyzeLoudnessSeries,
  analyzeVectorscope,
  analyzeLoudness,
  applyTruePeakLimiter,
  applySidechainDuck,
  applySidechainCompress,
  applySidechainGate,
  applyEssentialSoundAutoDuck,
  applyEssentialSoundPreset,
  applyAutoCrossfade,
  applyMatchClipVolume,
  applySplitAtMarkers,
  applyMergeClips,
  addNativePluginSlotToRack,
  addNativePluginsToProject,
  formatManagedNativePluginInventory,
  convertProjectSampleRate,
  exportBatch,
  formatNativePluginInventory,
  nativePluginSearchRoots,
  premiereEdl,
  premiereXml,
  scanNativePluginPathsIntoProject,
  scanNativePluginPaths,
  scanNativePluginRootsIntoProject,
  scanNativePluginRootsWithNativeMetadata,
  setManagedNativePluginEnabled,
  setManagedNativePluginPresetState,
} from "../ui/commands";
import { WORKSPACE_LAYOUT, WORKSPACES } from "../ui/workspace-layout";
import { deleteGlobalKeyboardShortcutPresetAsync, loadGlobalKeyboardShortcutPresetsAsync, parseKeyboardShortcutPresetJson, upsertGlobalKeyboardShortcutPresetAsync } from "../ui/keyboard-shortcuts";
import { loadAudioHardwarePreferencesAsync, loadControlSurfacePreferencesAsync, loadFileBehaviorPreferencesAsync, loadPanelDefaultPreferencesAsync, loadWorkspaceBehaviorPreferencesAsync, saveAudioHardwarePreferencesAsync, saveControlSurfacePreferencesAsync, saveFileBehaviorPreferencesAsync, savePanelDefaultPreferencesAsync, saveWorkspaceBehaviorPreferencesAsync, type ControlSurfacePreferences, type FileExportFormat, type PanelDefaultPreferencesPatch, type WorkspaceBehaviorPreferences } from "../ui/app-preferences";
import { discoverControlSurfaces, normalizeControlSurfaceMappings, type ControlSurfaceMapping } from "../audio/control-surfaces";
import { play, stop, togglePlay, returnToZero } from "../audio/use-playback";
import { getMcpStore } from "./store-handle";

let lastMcpMeterBridge: Ops.MeterBridgeSnapshot | null = null;
let lastMcpMeterBridgeProject: object | null = null;

// ── Session ───────────────────────────────────────────────────────────────────

/**
 * Start a new, empty session (4 tracks), replacing the current project.
 * @mcp session.new
 */
export async function sessionNew(): Promise<string> {
  await newSession(getMcpStore());
  return "Started a new session";
}

// ── Transport ─────────────────────────────────────────────────────────────────

/**
 * Start playback from the current playhead.
 * @mcp transport.play
 */
export function transportPlay(): string {
  play(getMcpStore());
  return "Playing";
}

/**
 * Stop playback.
 * @mcp transport.stop
 */
export function transportStop(): string {
  stop(getMcpStore());
  return "Stopped";
}

/**
 * Toggle playback (play if stopped, stop if playing).
 * @mcp transport.toggle
 */
export function transportToggle(): string {
  togglePlay(getMcpStore());
  return "Toggled playback";
}

/**
 * Stop and return the playhead to the start (or the selection start).
 * @mcp transport.returnToZero
 */
export function transportReturnToZero(): string {
  returnToZero(getMcpStore());
  return "Returned to start";
}

/**
 * Move the playhead to a position in seconds.
 * @mcp transport.seek
 * @param seconds Playhead position in seconds (0..86400).
 */
export function transportSeek(seconds: number): string {
  getMcpStore().dispatch(setPlayhead(seconds), { history: false });
  return `Playhead at ${seconds}s`;
}

/**
 * Toggle the metronome on or off.
 * @mcp transport.toggleMetronome
 */
export function transportToggleMetronome(): string {
  getMcpStore().dispatch(toggleMetronome(), { history: false });
  return "Toggled metronome";
}

// ── Tool / view ────────────────────────────────────────────────────────────────

/**
 * Select the active timeline tool.
 * @mcp tool.set
 * @param tool Tool to activate.
 */
export function toolSet(
  tool: "select" | "razor" | "marquee" | "envelope" | "fade" | "marker" | "hand" | "zoom",
): string {
  getMcpStore().dispatch(setTool(tool));
  return `Tool set to ${tool}`;
}

/**
 * Set the timeline zoom in pixels per second.
 * @mcp view.zoom
 * @param pxPerSecond Horizontal zoom in pixels per second (2..8000).
 */
export function viewZoom(pxPerSecond: number): string {
  getMcpStore().dispatch(setZoom(pxPerSecond), { history: false });
  return `Zoom set to ${pxPerSecond} px/s`;
}

/**
 * Zoom the timeline in or out by a multiplicative factor.
 * @mcp view.zoomBy
 * @param factor Zoom factor (>1 zooms in, <1 zooms out) (0.05..20).
 */
export function viewZoomBy(factor: number): string {
  getMcpStore().dispatch(zoomBy(factor), { history: false });
  return `Zoomed by ${factor}×`;
}

/**
 * Switch between Rythme's Audition-style editor surfaces.
 * @mcp view.setEditorMode
 * @param mode Editor mode: "multitrack" or "waveform".
 */
export function viewSetEditorMode(mode: "multitrack" | "waveform" = "multitrack"): string {
  getMcpStore().dispatch(setEditorMode(mode), { history: false, dirty: true, label: "Editor mode preference" });
  return `Editor mode set to ${mode}`;
}

/**
 * Configure session editor display/editing preferences that persist with the
 * Rythme project.
 * @mcp project.setEditorPreferences
 * @param editorMode Default editor mode: "multitrack" or "waveform".
 * @param tool Default tool: select, razor, marquee, envelope, fade, marker, hand, or zoom.
 * @param snap Whether snapping is enabled by default (0/1).
 * @param displayTimeFormat Display time format: decimal, smpte30, samples, or barsBeats.
 * @param spectralMinHz Spectral display lower bound in Hz.
 * @param spectralMaxHz Spectral display upper bound in Hz.
 */
export function projectSetEditorPreferences(
  editorMode: "multitrack" | "waveform" = "multitrack",
  tool: "select" | "razor" | "marquee" | "envelope" | "fade" | "marker" | "hand" | "zoom" = "select",
  snap = 1,
  displayTimeFormat: "decimal" | "smpte30" | "samples" | "barsBeats" = "decimal",
  spectralMinHz = 0,
  spectralMaxHz = 24000,
): string {
  getMcpStore().dispatch(
    setProjectEditorPreferences({
      editorMode,
      tool,
      snap: snap !== 0,
      displayTimeFormat,
      spectralMinHz,
      spectralMaxHz,
    }),
    { history: false, dirty: true, label: "Editor preferences" },
  );
  const prefs = getMcpStore().getState().project.editorPreferences!;
  return `Editor preferences set: ${prefs.editorMode}, ${prefs.tool}, ${prefs.snap ? "snap on" : "snap off"}, ${prefs.displayTimeFormat}, ${Math.round(prefs.spectralMinHz)}-${Math.round(prefs.spectralMaxHz)} Hz`;
}

/**
 * Customize a project-persisted keyboard shortcut for an existing keyboard
 * action. The override replaces the built-in shortcut for that action.
 * @mcp project.setKeyboardShortcut
 * @param action Shortcut action id, such as edit.split, project.save, or tool.razor.
 * @param key Key name, such as k, space, home, arrowleft, or backspace.
 * @param mod Whether Cmd/Ctrl is held (0/1).
 * @param shift Whether Shift is held (0/1).
 * @param alt Whether Alt/Option is held (0/1).
 */
export function projectSetKeyboardShortcut(action = "edit.split", key = "k", mod = 1, shift = 0, alt = 0): string {
  if (!KEYBOARD_SHORTCUT_ACTIONS.includes(action as (typeof KEYBOARD_SHORTCUT_ACTIONS)[number])) return `Shortcut action ${action || "(empty)"} is not supported`;
  const normalizedKey = normalizeShortcutKey(key);
  if (!normalizedKey) return "Shortcut key is required";
  const shortcut: KeyboardShortcut = {
    action: action as (typeof KEYBOARD_SHORTCUT_ACTIONS)[number],
    key: normalizedKey,
    mod: mod !== 0,
    shift: shift !== 0,
    alt: alt !== 0,
  };
  getMcpStore().dispatch(setProjectKeyboardShortcut(shortcut), { history: false, dirty: true, label: "Keyboard shortcut" });
  return `Shortcut ${shortcut.action} set to ${formatShortcut(shortcut)}`;
}

/**
 * Remove a project-persisted keyboard shortcut override, restoring the built-in
 * default for that action.
 * @mcp project.removeKeyboardShortcut
 * @param action Shortcut action id to restore.
 */
export function projectRemoveKeyboardShortcut(action = "edit.split"): string {
  if (!KEYBOARD_SHORTCUT_ACTIONS.includes(action as (typeof KEYBOARD_SHORTCUT_ACTIONS)[number])) return `Shortcut action ${action || "(empty)"} is not supported`;
  getMcpStore().dispatch(removeProjectKeyboardShortcut(action as (typeof KEYBOARD_SHORTCUT_ACTIONS)[number]), { history: false, dirty: true, label: "Keyboard shortcut" });
  return `Shortcut ${action} restored to built-in default`;
}

/**
 * Save the current project keyboard shortcut overrides as a named preset.
 * @mcp project.saveKeyboardShortcutPreset
 * @param name Preset name.
 */
export function projectSaveKeyboardShortcutPreset(name = "Custom Shortcuts"): string {
  const shortcuts = getMcpStore().getState().project.editorPreferences?.keyboardShortcuts ?? [];
  if (shortcuts.length === 0) return "No custom keyboard shortcuts to save";
  getMcpStore().dispatch(saveProjectKeyboardShortcutPreset({ name }), { history: false, dirty: true, label: "Keyboard shortcut preset" });
  return `Saved keyboard shortcut preset ${name || "Custom Shortcuts"}`;
}

/**
 * Apply a project keyboard shortcut preset to the active shortcut overrides.
 * @mcp project.applyKeyboardShortcutPreset
 * @param id Preset id.
 */
export function projectApplyKeyboardShortcutPreset(id = ""): string {
  const preset = getMcpStore().getState().project.editorPreferences?.keyboardShortcutPresets.find((entry) => entry.id === id);
  if (!preset) return `Keyboard shortcut preset ${id || "(empty)"} not found`;
  getMcpStore().dispatch(applyProjectKeyboardShortcutPreset(id), { history: false, dirty: true, label: "Keyboard shortcut preset" });
  return `Applied keyboard shortcut preset ${preset.name}`;
}

/**
 * Delete a project keyboard shortcut preset.
 * @mcp project.deleteKeyboardShortcutPreset
 * @param id Preset id.
 */
export function projectDeleteKeyboardShortcutPreset(id = ""): string {
  const preset = getMcpStore().getState().project.editorPreferences?.keyboardShortcutPresets.find((entry) => entry.id === id);
  if (!preset) return `Keyboard shortcut preset ${id || "(empty)"} not found`;
  getMcpStore().dispatch(deleteProjectKeyboardShortcutPreset(id), { history: false, dirty: true, label: "Keyboard shortcut preset" });
  return `Deleted keyboard shortcut preset ${preset.name}`;
}

/**
 * Export a project keyboard shortcut preset as JSON.
 * @mcp project.exportKeyboardShortcutPreset
 * @param id Preset id.
 */
export function projectExportKeyboardShortcutPreset(id = ""): string {
  const preset = getMcpStore().getState().project.editorPreferences?.keyboardShortcutPresets.find((entry) => entry.id === id);
  if (!preset) return `Keyboard shortcut preset ${id || "(empty)"} not found`;
  return JSON.stringify(preset);
}

/**
 * Import a keyboard shortcut preset from JSON.
 * @mcp project.importKeyboardShortcutPreset
 * @param presetJson JSON object with id, name, and shortcuts.
 */
export function projectImportKeyboardShortcutPreset(presetJson = "{}"): string {
  const preset = parseKeyboardShortcutPresetJson(presetJson);
  if (typeof preset === "string") return preset;
  getMcpStore().dispatch(saveProjectKeyboardShortcutPreset(preset), { history: false, dirty: true, label: "Keyboard shortcut preset" });
  return `Imported keyboard shortcut preset ${preset.name}`;
}

/**
 * List app-global keyboard shortcut presets stored for this Rythme installation.
 * @mcp app.listKeyboardShortcutPresets
 */
export async function appListKeyboardShortcutPresets(): Promise<string> {
  const presets = await loadGlobalKeyboardShortcutPresetsAsync();
  if (presets.length === 0) return "No app-global keyboard shortcut presets";
  return presets.map((preset) => `${preset.id}: ${preset.name} (${preset.shortcuts.length} shortcuts)`).join("\n");
}

/**
 * Save the current project keyboard shortcut overrides as an app-global preset.
 * @mcp app.saveKeyboardShortcutPreset
 * @param name Preset name.
 */
export async function appSaveKeyboardShortcutPreset(name = "Custom Shortcuts"): Promise<string> {
  const shortcuts = getMcpStore().getState().project.editorPreferences?.keyboardShortcuts ?? [];
  if (shortcuts.length === 0) return "No custom keyboard shortcuts to save";
  const saved = await upsertGlobalKeyboardShortcutPresetAsync({ name, shortcuts });
  if (!saved) return "App-global keyboard shortcut presets are unavailable";
  return `Saved app-global keyboard shortcut preset ${saved.name} (${saved.id})`;
}

/**
 * Apply an app-global keyboard shortcut preset to the current project.
 * @mcp app.applyKeyboardShortcutPreset
 * @param id Preset id.
 */
export async function appApplyKeyboardShortcutPreset(id = ""): Promise<string> {
  const preset = (await loadGlobalKeyboardShortcutPresetsAsync()).find((entry) => entry.id === id);
  if (!preset) return `App-global keyboard shortcut preset ${id || "(empty)"} not found`;
  getMcpStore().dispatch(setProjectEditorPreferences({ keyboardShortcuts: preset.shortcuts }), { history: false, dirty: true, label: "App-global keyboard shortcut preset" });
  return `Applied app-global keyboard shortcut preset ${preset.name}`;
}

/**
 * Delete an app-global keyboard shortcut preset.
 * @mcp app.deleteKeyboardShortcutPreset
 * @param id Preset id.
 */
export async function appDeleteKeyboardShortcutPreset(id = ""): Promise<string> {
  const preset = (await loadGlobalKeyboardShortcutPresetsAsync()).find((entry) => entry.id === id);
  if (!preset) return `App-global keyboard shortcut preset ${id || "(empty)"} not found`;
  await deleteGlobalKeyboardShortcutPresetAsync(id);
  return `Deleted app-global keyboard shortcut preset ${preset.name}`;
}

/**
 * Export an app-global keyboard shortcut preset as JSON.
 * @mcp app.exportKeyboardShortcutPreset
 * @param id Preset id.
 */
export async function appExportKeyboardShortcutPreset(id = ""): Promise<string> {
  const preset = (await loadGlobalKeyboardShortcutPresetsAsync()).find((entry) => entry.id === id);
  if (!preset) return `App-global keyboard shortcut preset ${id || "(empty)"} not found`;
  return JSON.stringify(preset);
}

/**
 * Import an app-global keyboard shortcut preset from JSON.
 * @mcp app.importKeyboardShortcutPreset
 * @param presetJson JSON object with id, name, and shortcuts.
 */
export async function appImportKeyboardShortcutPreset(presetJson = "{}"): Promise<string> {
  const preset = parseKeyboardShortcutPresetJson(presetJson);
  if (typeof preset === "string") return preset;
  const saved = await upsertGlobalKeyboardShortcutPresetAsync(preset);
  if (!saved) return "App-global keyboard shortcut presets are unavailable";
  return `Imported app-global keyboard shortcut preset ${saved.name}`;
}

/**
 * Get app-global file behavior preferences for default mixdown and batch export.
 * @mcp app.getFilePreferences
 */
export async function appGetFilePreferences(): Promise<string> {
  return JSON.stringify(await loadFileBehaviorPreferencesAsync());
}

/**
 * Set app-global file behavior preferences for default mixdown and batch export.
 * @mcp app.setFilePreferences
 * @param exportFormat Default audio format: "wav" or "aiff".
 * @param bitDepth Default audio bit depth: 16, 24, or 32.
 * @param exportFloat Use 32-bit float WAV when exportFormat is "wav" and bitDepth is 32. (0 or 1)
 */
export async function appSetFilePreferences(exportFormat = "wav", bitDepth = 24, exportFloat = 0): Promise<string> {
  const saved = await saveFileBehaviorPreferencesAsync({
    exportFormat: exportFormat === "aiff" ? "aiff" : "wav",
    exportBitDepth: bitDepth === 16 || bitDepth === 32 ? bitDepth : 24,
    exportFloat: exportFloat !== 0,
  });
  if (!saved) return "App-global file behavior preferences are unavailable";
  const format = saved.exportFormat.toUpperCase();
  const floatLabel = saved.exportFloat ? " float" : "";
  return `Set app-global file preferences to ${format} ${saved.exportBitDepth}-bit${floatLabel}`;
}

/**
 * Get app-global workspace/editor defaults used by New Session.
 * @mcp app.getWorkspacePreferences
 */
export async function appGetWorkspacePreferences(): Promise<string> {
  return JSON.stringify(await loadWorkspaceBehaviorPreferencesAsync());
}

/**
 * Set app-global workspace/editor defaults used by New Session.
 * @mcp app.setWorkspacePreferences
 * @param defaultWorkspaceId Built-in workspace id: default, maxWaveform, maxSpectral, mixing, or radio.
 * @param editorMode Default editor mode: multitrack or waveform.
 * @param tool Default tool: select, razor, marquee, envelope, fade, marker, hand, or zoom.
 * @param snap Whether snapping is enabled by default (0/1).
 * @param displayTimeFormat Display time format: decimal, smpte30, samples, or barsBeats.
 */
export async function appSetWorkspacePreferences(defaultWorkspaceId = "default", editorMode = "multitrack", tool = "select", snap = 1, displayTimeFormat = "decimal"): Promise<string> {
  const knownWorkspace = WORKSPACES.some((workspace) => workspace.id === defaultWorkspaceId);
  const saved = await saveWorkspaceBehaviorPreferencesAsync({
    defaultWorkspaceId: knownWorkspace ? defaultWorkspaceId as WorkspaceBehaviorPreferences["defaultWorkspaceId"] : "default",
    defaultEditorMode: editorMode === "waveform" ? "waveform" : "multitrack",
    defaultTool: ["select", "razor", "marquee", "envelope", "fade", "marker", "hand", "zoom"].includes(tool) ? tool as WorkspaceBehaviorPreferences["defaultTool"] : "select",
    defaultSnap: snap !== 0,
    defaultDisplayTimeFormat: ["decimal", "smpte30", "samples", "barsBeats"].includes(displayTimeFormat) ? displayTimeFormat as WorkspaceBehaviorPreferences["defaultDisplayTimeFormat"] : "decimal",
  });
  if (!saved) return "App-global workspace preferences are unavailable";
  return `Set app-global workspace defaults to ${saved.defaultWorkspaceId}, ${saved.defaultEditorMode}, ${saved.defaultTool}, ${saved.defaultSnap ? "snap on" : "snap off"}, ${saved.defaultDisplayTimeFormat}`;
}

/**
 * Get app-global audio hardware defaults used by New Session.
 * @mcp app.getAudioHardwarePreferences
 */
export async function appGetAudioHardwarePreferences(): Promise<string> {
  return JSON.stringify(await loadAudioHardwarePreferencesAsync());
}

/**
 * Set app-global audio hardware defaults used by New Session.
 * @mcp app.setAudioHardwarePreferences
 * @param inputDeviceId Browser/native input device id, or empty for system default.
 * @param outputDeviceId Browser/native output device id, or empty for system default.
 * @param hardwareSampleRate Requested hardware sample rate in Hz (8000..192000).
 * @param inputChannels Requested hardware input channels (1..8).
 * @param inputMonitoring Input monitoring mode: "off", "armed", or "always".
 * @param latencyCompensationMs Timeline placement compensation in milliseconds (-1000..1000).
 * @param preRollSeconds Pre-roll before punch/playhead in seconds (0..30).
 * @param countInBars Count-in length in bars before recording (0..8).
 * @param meterCalibrationDb Display offset applied to meter dB readouts (-60..60).
 * @param meterPeakHoldMs Software mixer meter peak-hold duration in milliseconds (0..10000).
 */
export async function appSetAudioHardwarePreferences(
  inputDeviceId = "",
  outputDeviceId = "",
  hardwareSampleRate = 48000,
  inputChannels = 2,
  inputMonitoring: "off" | "armed" | "always" = "off",
  latencyCompensationMs = 0,
  preRollSeconds = 0,
  countInBars = 0,
  meterCalibrationDb = 0,
  meterPeakHoldMs = 1200,
): Promise<string> {
  const saved = await saveAudioHardwarePreferencesAsync({
    inputDeviceId: inputDeviceId || undefined,
    outputDeviceId: outputDeviceId || undefined,
    hardwareSampleRate,
    inputChannels,
    inputMonitoring,
    latencyCompensationMs,
    preRollSeconds,
    countInBars,
    meterCalibrationDb,
    meterPeakHoldMs,
  });
  if (!saved) return "App-global audio hardware preferences are unavailable";
  return `Set app-global audio hardware defaults to ${Math.round(saved.hardwareSampleRate)} Hz, ${Math.round(saved.inputChannels)} input channel(s), monitoring ${saved.inputMonitoring}, meter cal ${meterOffsetDb(saved.meterCalibrationDb)}, peak hold ${Math.round(saved.meterPeakHoldMs)} ms`;
}

/**
 * Discover browser/WebView-visible MIDI control surface ports.
 * @mcp app.discoverControlSurfaces
 * @param requestPermission Request Web MIDI permission before listing ports. (0 or 1)
 */
export async function appDiscoverControlSurfaces(requestPermission = 0): Promise<string> {
  return JSON.stringify(await discoverControlSurfaces({ requestPermission: requestPermission !== 0 }));
}

/**
 * Get app-global MIDI/control-surface preferences.
 * @mcp app.getControlSurfacePreferences
 */
export async function appGetControlSurfacePreferences(): Promise<string> {
  return JSON.stringify(await loadControlSurfacePreferencesAsync());
}

/**
 * Set app-global MIDI/control-surface preferences.
 * @mcp app.setControlSurfacePreferences
 * @param enabled Whether the configured surface is enabled. (0 or 1)
 * @param protocol Surface protocol: genericMidi, mackieControl, or hui.
 * @param inputId MIDI input id, or empty for none.
 * @param outputId MIDI output id, or empty for none.
 */
export async function appSetControlSurfacePreferences(
  enabled = 0,
  protocol = "genericMidi",
  inputId = "",
  outputId = "",
): Promise<string> {
  const saved = await saveControlSurfacePreferencesAsync({
    enabled: enabled !== 0,
    protocol: controlSurfaceProtocol(protocol),
    inputId: inputId || undefined,
    outputId: outputId || undefined,
  });
  if (!saved) return "App-global control surface preferences are unavailable";
  return `Set app-global control surface to ${saved.enabled ? "on" : "off"}, ${saved.protocol}, input ${saved.inputId ?? "none"}, output ${saved.outputId ?? "none"}`;
}

/**
 * Set app-global custom MIDI control mappings from JSON.
 * @mcp app.setControlSurfaceMappings
 * @param mappingsJson JSON array of mapping objects with trigger/status/data1 and action/type fields.
 */
export async function appSetControlSurfaceMappings(mappingsJson = "[]"): Promise<string> {
  const parsed = parseControlSurfaceMappings(mappingsJson);
  if (typeof parsed === "string") return parsed;
  const saved = await saveControlSurfacePreferencesAsync({ mappings: parsed });
  if (!saved) return "App-global control surface preferences are unavailable";
  return `Set ${saved.mappings.length} app-global control surface mapping(s)`;
}

/**
 * Get app-global Analyze and Effects panel defaults used by New Session.
 * @mcp app.getPanelPreferences
 */
export async function appGetPanelPreferences(): Promise<string> {
  return JSON.stringify(await loadPanelDefaultPreferencesAsync());
}

/**
 * Set app-global Analyze and Effects panel defaults used by New Session.
 * @mcp app.setPanelPreferences
 * @param defaultsJson JSON object with optional analyze and effects preference sections.
 */
export async function appSetPanelPreferences(defaultsJson = "{}"): Promise<string> {
  const parsed = parsePanelDefaultPreferences(defaultsJson);
  if (typeof parsed === "string") return parsed;
  const saved = await savePanelDefaultPreferencesAsync(parsed);
  if (!saved) return "App-global panel preferences are unavailable";
  return `Set app-global panel defaults: analyze ${Math.round(saved.analyze.spectralMinHz)}-${Math.round(saved.analyze.spectralMaxHz)} Hz, gain ${saved.effects.gainDb.toFixed(1)} dB, normalize ${saved.effects.normalizeTargetDb.toFixed(1)} dB`;
}

/**
 * Configure project-persisted Analyze panel spectral edit defaults.
 * @mcp project.setAnalyzePanelPreferences
 * @param spectralMinHz Spectral selection lower bound in Hz.
 * @param spectralMaxHz Spectral selection upper bound in Hz.
 * @param spectralGainDb Spectral gain amount in dB.
 */
export function projectSetAnalyzePanelPreferences(spectralMinHz = 1000, spectralMaxHz = 8000, spectralGainDb = -24): string {
  getMcpStore().dispatch(
    setProjectPanelPreferences({ analyze: { spectralMinHz, spectralMaxHz, spectralGainDb } }),
    { history: false, dirty: true, label: "Analyze panel preferences" },
  );
  const prefs = getMcpStore().getState().project.panelPreferences!.analyze;
  return `Analyze panel preferences set: ${Math.round(prefs.spectralMinHz)}-${Math.round(prefs.spectralMaxHz)} Hz, ${prefs.spectralGainDb.toFixed(1)} dB`;
}

/**
 * Configure project-persisted Effects panel default parameters from JSON.
 * @mcp project.setEffectsPanelPreferences
 * @param defaultsJson JSON object with EffectsPanelPreferences numeric fields.
 */
export function projectSetEffectsPanelPreferences(defaultsJson = "{}"): string {
  const parsed = parseEffectsPanelPreferences(defaultsJson);
  if (typeof parsed === "string") return parsed;
  getMcpStore().dispatch(
    setProjectPanelPreferences({ effects: parsed }),
    { history: false, dirty: true, label: "Effects panel preferences" },
  );
  const prefs = getMcpStore().getState().project.panelPreferences!.effects;
  return `Effects panel preferences set: gain ${prefs.gainDb.toFixed(1)} dB, normalize ${prefs.normalizeTargetDb.toFixed(1)} dB`;
}

/**
 * Save a project-persisted custom workspace layout. If layoutJson is empty,
 * Rythme saves the default dock layout as the custom workspace seed.
 * @mcp project.saveCustomWorkspace
 * @param name Workspace name.
 * @param layoutJson Serialized DockLayout JSON, or empty to use the default layout.
 */
export function projectSaveCustomWorkspace(name = "Custom Workspace", layoutJson = ""): string {
  const parsed = parseWorkspaceLayout(layoutJson);
  if (typeof parsed === "string") return parsed;
  getMcpStore().dispatch(saveProjectWorkspace({ name, layout: parsed }), { history: false, dirty: true, label: "Save workspace" });
  const prefs = getMcpStore().getState().project.editorPreferences!;
  return `Saved custom workspace ${prefs.activeWorkspaceId}`;
}

/**
 * Delete a project-persisted custom workspace layout.
 * @mcp project.deleteCustomWorkspace
 * @param id Custom workspace id to delete.
 */
export function projectDeleteCustomWorkspace(id = ""): string {
  const prefs = getMcpStore().getState().project.editorPreferences;
  if (!prefs?.customWorkspaces.some((workspace) => workspace.id === id)) return `Custom workspace ${id || "(empty)"} not found`;
  getMcpStore().dispatch(deleteProjectWorkspace(id), { history: false, dirty: true, label: "Delete workspace" });
  return `Deleted custom workspace ${id}`;
}

/**
 * Select the active project workspace by built-in or custom workspace id.
 * @mcp view.setWorkspace
 * @param id Built-in or custom workspace id.
 */
export function viewSetWorkspace(id = "default"): string {
  const prefs = getMcpStore().getState().project.editorPreferences;
  const known = WORKSPACES.some((workspace) => workspace.id === id) || !!prefs?.customWorkspaces.some((workspace) => workspace.id === id);
  if (!known) return `Workspace ${id || "(empty)"} not found`;
  getMcpStore().dispatch(setActiveWorkspace(id), { history: false, dirty: true, label: "Workspace" });
  return `Workspace set to ${id}`;
}

function parseWorkspaceLayout(layoutJson: string): WorkspaceLayoutData | string {
  if (!layoutJson.trim()) return WORKSPACE_LAYOUT as WorkspaceLayoutData;
  try {
    const parsed = JSON.parse(layoutJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Workspace layout JSON must be an object";
    return parsed as WorkspaceLayoutData;
  } catch {
    return "Workspace layout JSON could not be parsed";
  }
}

function controlSurfaceProtocol(protocol: string): ControlSurfacePreferences["protocol"] {
  return protocol === "mackieControl" || protocol === "hui" ? protocol : "genericMidi";
}

function parseControlSurfaceMappings(mappingsJson: string): ControlSurfaceMapping[] | string {
  try {
    const parsed = JSON.parse(mappingsJson) as unknown;
    if (!Array.isArray(parsed)) return "Control surface mappings JSON must be an array";
    return normalizeControlSurfaceMappings(parsed);
  } catch {
    return "Control surface mappings JSON could not be parsed";
  }
}

function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts = [
    shortcut.mod ? "Cmd/Ctrl" : "",
    shortcut.alt ? "Alt" : "",
    shortcut.shift ? "Shift" : "",
    shortcut.key === "space" ? "Space" : shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
  ].filter(Boolean);
  return parts.join("+");
}

function parseEffectsPanelPreferences(defaultsJson: string): Partial<EffectsPanelPreferences> | string {
  try {
    const parsed = JSON.parse(defaultsJson) as unknown;
    return parseEffectsPanelPreferencesObject(parsed);
  } catch {
    return "Effects panel preferences JSON could not be parsed";
  }
}

function parsePanelDefaultPreferences(defaultsJson: string): PanelDefaultPreferencesPatch | string {
  try {
    const parsed = JSON.parse(defaultsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Panel preferences JSON must be an object";
    const out: PanelDefaultPreferencesPatch = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key === "analyze") {
        const analyze = parseAnalyzePanelPreferencesObject(value);
        if (typeof analyze === "string") return analyze;
        out.analyze = analyze;
      } else if (key === "effects") {
        const effects = parseEffectsPanelPreferencesObject(value);
        if (typeof effects === "string") return effects;
        out.effects = effects;
      } else {
        return `Panel preference section ${key} is not supported`;
      }
    }
    return out;
  } catch {
    return "Panel preferences JSON could not be parsed";
  }
}

function parseAnalyzePanelPreferencesObject(parsed: unknown): Partial<AnalyzePanelPreferences> | string {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Analyze panel preferences JSON must be an object";
  const defaults = defaultPanelPreferences().analyze;
  const out: Partial<AnalyzePanelPreferences> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(key in defaults)) return `Analyze panel preference ${key} is not supported`;
    if (typeof value !== "number" || !Number.isFinite(value)) return `Analyze panel preference ${key} must be a finite number`;
    (out as Record<string, number>)[key] = value;
  }
  return out;
}

function parseEffectsPanelPreferencesObject(parsed: unknown): Partial<EffectsPanelPreferences> | string {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Effects panel preferences JSON must be an object";
  const defaults = defaultPanelPreferences().effects;
  const out: Partial<EffectsPanelPreferences> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(key in defaults)) return `Effects panel preference ${key} is not supported`;
    if (typeof value !== "number" || !Number.isFinite(value)) return `Effects panel preference ${key} must be a finite number`;
    (out as Record<string, number>)[key] = value;
  }
  return out;
}

// ── Project ─────────────────────────────────────────────────────────────────────

/**
 * Set the project tempo in beats per minute.
 * @mcp project.setTempo
 * @param tempo Tempo in BPM (20..400).
 */
export function projectSetTempo(tempo: number): string {
  getMcpStore().dispatch(setTempo(tempo), { label: "Set tempo" });
  return `Tempo set to ${tempo} BPM`;
}

/**
 * Set the master output gain in decibels.
 * @mcp project.setMasterGain
 * @param gainDb Master gain in dB (-60..12).
 */
export function projectSetMasterGain(gainDb: number): string {
  getMcpStore().dispatch(setMasterGain(gainDb), { label: "Master gain" });
  return `Master gain set to ${gainDb} dB`;
}

/**
 * Set the master automation mode. "off" bypasses master automation during render;
 * write/touch/latch persist the session mode for automation workflows.
 * @mcp project.setMasterAutomationMode
 * @param mode Automation mode: "read", "off", "write", "touch", or "latch".
 */
export function projectSetMasterAutomationMode(
  mode: "read" | "off" | "write" | "touch" | "latch" = "read",
): string {
  getMcpStore().dispatch(setMasterAutomationMode(mode), { label: "Master automation mode" });
  return `Master automation mode set to ${mode}`;
}

/**
 * Set the project output channel count for mono, stereo, or surround sessions.
 * @mcp project.setChannelCount
 * @param channels Output channels: 1 mono, 2 stereo, 6 for 5.1 (1..8).
 */
export function projectSetChannelCount(channels = 2): string {
  getMcpStore().dispatch(setProjectChannelCount(channels), { label: "Channels" });
  return `Project output set to ${Math.round(channels)} channel(s)`;
}

/**
 * Configure session audio hardware and recording preferences.
 * @mcp project.setAudioHardware
 * @param inputDeviceId Browser/native input device id, or empty for system default.
 * @param outputDeviceId Browser/native output device id, or empty for system default.
 * @param hardwareSampleRate Requested hardware sample rate in Hz (8000..192000).
 * @param inputChannels Requested hardware input channels (1..8).
 * @param inputMonitoring Input monitoring mode: "off", "armed", or "always".
 * @param latencyCompensationMs Timeline placement compensation in milliseconds (-1000..1000).
 * @param preRollSeconds Pre-roll before punch/playhead in seconds (0..30).
 * @param countInBars Count-in length in bars before recording (0..8).
 * @param meterCalibrationDb Display offset applied to meter dB readouts (-60..60).
 * @param meterPeakHoldMs Software mixer meter peak-hold duration in milliseconds (0..10000).
 */
export function projectSetAudioHardware(
  inputDeviceId = "",
  outputDeviceId = "",
  hardwareSampleRate = 48000,
  inputChannels = 2,
  inputMonitoring: "off" | "armed" | "always" = "off",
  latencyCompensationMs = 0,
  preRollSeconds = 0,
  countInBars = 0,
  meterCalibrationDb = 0,
  meterPeakHoldMs = 1200,
): string {
  getMcpStore().dispatch(
    setProjectAudioHardware({
      inputDeviceId: inputDeviceId || undefined,
      outputDeviceId: outputDeviceId || undefined,
      hardwareSampleRate,
      inputChannels,
      inputMonitoring,
      latencyCompensationMs,
      preRollSeconds,
      countInBars,
      meterCalibrationDb,
      meterPeakHoldMs,
    }),
    { label: "Audio hardware" },
  );
  return `Audio hardware set to ${Math.round(hardwareSampleRate)} Hz, ${Math.round(inputChannels)} input channel(s), monitoring ${inputMonitoring}, meter cal ${meterOffsetDb(meterCalibrationDb)}, peak hold ${Math.round(meterPeakHoldMs)} ms`;
}

/**
 * Set or clear the punch-in recording range.
 * @mcp project.setPunchRange
 * @param startSec Punch-in start in seconds. Use a negative value to clear.
 * @param endSec Punch-out end in seconds.
 */
export function projectSetPunchRange(startSec = -1, endSec = -1): string {
  const punchIn = startSec >= 0 && endSec > startSec ? { start: startSec, end: endSec } : null;
  getMcpStore().dispatch(setProjectAudioHardware({ punchIn }), { label: "Punch range" });
  return punchIn ? `Punch range set to ${punchIn.start}s..${punchIn.end}s` : "Punch range cleared";
}

/**
 * Set the 5.1 surround panner for a track. The project should have 6+ output
 * channels for this to affect rendering.
 * @mcp track.setSurroundPan
 * @param track Track index, 0-based.
 * @param x Left/right position: -1 left, 0 center, 1 right.
 * @param y Front/rear position: -1 rear, 0 middle, 1 front.
 * @param center Amount sent to the center speaker (0..1).
 * @param lfe Amount sent to LFE (0..1).
 * @param divergence Amount spread across corner speakers (0..1).
 */
export function trackSetSurroundPan(track = 0, x = 0, y = 1, center = 0, lfe = 0, divergence = 1): string {
  const store = getMcpStore();
  const trackId = store.getState().project.tracks[track]?.id;
  if (!trackId) return `Track ${track} not found`;
  store.dispatch(setTrackSurroundPan(trackId, { x, y, center, lfe, divergence }), { label: "Surround pan" });
  return `Track ${track} surround pan x=${x}, y=${y}, center=${center}, lfe=${lfe}, spread=${divergence}`;
}

/**
 * Assign an Essential Sound role to a track for role presets and automatic
 * music-under-dialogue ducking.
 * @mcp track.setAudioRole
 * @param track Track index, 0-based.
 * @param role Essential Sound role, or "none" to clear it.
 */
export function trackSetAudioRole(track = 0, role: "dialogue" | "music" | "sfx" | "ambience" | "none" = "dialogue"): string {
  const store = getMcpStore();
  const trackId = store.getState().project.tracks[track]?.id;
  if (!trackId) return `Track ${track} not found`;
  store.dispatch(setTrackAudioRole(trackId, role === "none" ? null : role), { label: "Audio role" });
  return role === "none" ? `Cleared audio role on track ${track}` : `Track ${track} role set to ${role}`;
}

/**
 * Assign a hardware input channel/device to a track for recording.
 * @mcp track.setInput
 * @param track Track index, 0-based.
 * @param channel Input channel mapping: "stereo", "mono", "left", "right", "input1".."input8", or "clear".
 * @param deviceId Optional device id overriding the session input device.
 * @param monitoring Track monitoring override: "session", "off", "armed", or "always".
 */
export function trackSetInput(
  track = 0,
  channel: "stereo" | "mono" | "left" | "right" | "input1" | "input2" | "input3" | "input4" | "input5" | "input6" | "input7" | "input8" | "clear" = "stereo",
  deviceId = "",
  monitoring: "session" | "off" | "armed" | "always" = "session",
): string {
  const store = getMcpStore();
  const trackObj = store.getState().project.tracks[track];
  if (!trackObj) return `Track ${track} not found`;
  if (channel === "clear") {
    store.dispatch(setTrackInput(trackObj.id, null), { label: "Track input" });
    return `Cleared input on track ${track}`;
  }
  store.dispatch(
    setTrackInput(trackObj.id, {
      channel,
      deviceId: deviceId || undefined,
      monitoring: monitoring === "session" ? undefined : monitoring,
    }),
    { label: "Track input" },
  );
  return `Track ${track} input set to ${channel}${deviceId ? ` on ${deviceId}` : ""}`;
}

/**
 * Set a track automation mode. "off" bypasses track automation during render;
 * write/touch/latch persist the session mode for automation workflows.
 * @mcp track.setAutomationMode
 * @param track Track index, 0-based.
 * @param mode Automation mode: "read", "off", "write", "touch", or "latch".
 */
export function trackSetAutomationMode(
  track = 0,
  mode: "read" | "off" | "write" | "touch" | "latch" = "read",
): string {
  const store = getMcpStore();
  const trackObj = store.getState().project.tracks[track];
  if (!trackObj) return `Track ${track} not found`;
  store.dispatch(setTrackAutomationMode(trackObj.id, mode), { label: "Track automation mode" });
  return `Track ${track} automation mode set to ${mode}`;
}

/**
 * Set a bus automation mode. "off" bypasses bus automation during render;
 * write/touch/latch persist the session mode for automation workflows.
 * @mcp bus.setAutomationMode
 * @param bus Bus index, 0-based.
 * @param mode Automation mode: "read", "off", "write", "touch", or "latch".
 */
export function busSetAutomationMode(
  bus = 0,
  mode: "read" | "off" | "write" | "touch" | "latch" = "read",
): string {
  const store = getMcpStore();
  const busObj = store.getState().project.buses?.[bus];
  if (!busObj) return `Bus ${bus} not found`;
  store.dispatch(setBusAutomationMode(busObj.id, mode), { label: "Bus automation mode" });
  return `Bus ${bus} automation mode set to ${mode}`;
}

/**
 * Set a clip automation mode by clip id. "off" bypasses clip automation during render;
 * write/touch/latch persist the session mode for automation workflows.
 * @mcp clip.setAutomationMode
 * @param clipId Clip id.
 * @param mode Automation mode: "read", "off", "write", "touch", or "latch".
 */
export function clipSetAutomationMode(
  clipId = "",
  mode: "read" | "off" | "write" | "touch" | "latch" = "read",
): string {
  const store = getMcpStore();
  const clip = store.getState().project.tracks.flatMap((trackObj) => trackObj.clips).find((candidate) => candidate.id === clipId);
  if (!clip) return `Clip ${clipId} not found`;
  store.dispatch(setClipAutomationMode(clip.id, mode), { label: "Clip automation mode" });
  return `Clip ${clip.id} automation mode set to ${mode}`;
}

/**
 * Read the Mixer meter bridge at the playhead or an explicit timeline position,
 * reporting post-fader track, bus, master, insert-tap, and send-tap peak/RMS levels.
 * @mcp mixer.meterBridge
 * @param atSec Timeline position in seconds. Negative values use the current playhead.
 * @param windowMs Meter integration window in milliseconds (10..10000).
 */
export function mixerMeterBridge(atSec = -1, windowMs = 250): string {
  const store = getMcpStore();
  const state = store.getState();
  const at = atSec >= 0 ? atSec : state.transport.playhead;
  const snapshot = Ops.measureMeterBridge(state.project, { atSec: at, windowSec: Math.max(10, Math.min(10000, windowMs)) / 1000 });
  if (lastMcpMeterBridgeProject !== state.project) lastMcpMeterBridge = null;
  const held = Ops.applyMeterBridgePeakHold(snapshot, lastMcpMeterBridge, { holdMs: snapshot.meterPeakHoldMs });
  lastMcpMeterBridge = held;
  lastMcpMeterBridgeProject = state.project;
  const lines = [
    `Meter bridge @ ${held.atSec.toFixed(3)}s / ${Math.round(held.windowSec * 1000)}ms · cal ${meterOffsetDb(held.meterCalibrationDb)} · hold ${held.meterPeakHoldMs} ms`,
  ];
  lines.push(`Master ${formatMeterEntry(held.master)}`);
  for (const track of held.tracks) lines.push(`Track ${track.name} ${formatMeterEntry(track)}`);
  for (const bus of held.buses) lines.push(`Bus ${bus.name} ${formatMeterEntry(bus)}`);
  for (const tap of held.taps) lines.push(`Tap ${formatTapName(tap)} ${formatMeterEntry(tap)}`);
  return lines.join("\n");
}

function formatTapName(entry: Ops.MeterBridgeTapEntry): string {
  const kind = entry.ownerKind === "master" ? "Master" : entry.ownerKind === "track" ? "Track" : "Bus";
  const tap = entry.tapKind === "postRack" ? "post-rack" : entry.tapKind;
  const target = entry.tapKind === "send" ? ` ${entry.preFader ? "pre" : "post"} -> ${entry.targetBusId ?? "unknown"}` : "";
  return `${kind} ${entry.name} ${tap}${target}`;
}

function formatMeterEntry(entry: Ops.MeterBridgeEntry): string {
  const clip = entry.clippedSamples > 0 || entry.peak >= 1 ? " CLIP" : "";
  const muted = entry.audible ? "" : " muted";
  return `peak ${meterDb(entry.peakDb)} hold ${meterDb(entry.peakHold.peakDb)} RMS ${meterDb(entry.rmsDb)}${clip}${muted}`;
}

function meterDb(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} dB` : "-∞ dB";
}

function meterOffsetDb(value: number): string {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(1)} dB` : "-∞ dB";
}

type TrackRackSlotKind =
  | "gain"
  | "pan"
  | "compressor"
  | "limiter"
  | "tubeCompressor"
  | "speechLeveler"
  | "parametricEQ"
  | "graphicEQ"
  | "notchFilter"
  | "dehummer"
  | "declicker"
  | "deesser"
  | "centerChannel"
  | "channelMixer"
  | "graphicPhaseShifter"
  | "autoPhaseCorrect"
  | "phaser"
  | "stereoExpander"
  | "waveshaper"
  | "guitarSuite"
  | "exciter"
  | "vocalEnhancer"
  | "mastering"
  | "delay"
  | "analogDelay"
  | "echo"
  | "studioReverb"
  | "fullReverb"
  | "invertPolarity"
  | "silence";
type TrackRackParam = "gainDb" | "pan";

/**
 * Add a persistent built-in effect slot to a track's nondestructive rack.
 * Gain and pan slot ids can be passed to track.automateRackParam.
 * @mcp track.addRackSlot
 * @param track Track index, 0-based.
 * @param kind Built-in slot kind: gain/pan/dynamics/EQ/restoration/stereo/modulation/special/delay/reverb rack processor.
 * @param value Primary initial value: gain dB, pan, threshold/ceiling dB, EQ gain/frequency, width, or delay time.
 */
export function trackAddRackSlot(
  track = 0,
  kind:
    | "gain"
    | "pan"
    | "compressor"
    | "limiter"
    | "tubeCompressor"
    | "speechLeveler"
    | "parametricEQ"
    | "graphicEQ"
    | "notchFilter"
    | "dehummer"
    | "declicker"
    | "deesser"
    | "centerChannel"
    | "channelMixer"
    | "graphicPhaseShifter"
    | "autoPhaseCorrect"
    | "phaser"
    | "stereoExpander"
    | "waveshaper"
    | "guitarSuite"
    | "exciter"
    | "vocalEnhancer"
    | "mastering"
    | "delay"
    | "analogDelay"
    | "echo"
    | "studioReverb"
    | "fullReverb"
    | "invertPolarity"
    | "silence" = "gain",
  value = 0,
): string {
  const store = getMcpStore();
  const trackId = store.getState().project.tracks[track]?.id;
  if (!trackId) return `Track ${track} not found`;
  const slotKind = normalizeRackSlotKind(kind);
  const slot = newEffectSlot(slotKind, {
    name: rackSlotLabel(slotKind),
    params: initialRackSlotParams(slotKind, value),
  });
  store.dispatch(addTrackEffectSlot(trackId, slot), { label: `Add ${slot.name} rack slot` });
  return `Track ${track} rack slot ${slot.id} (${slot.name})`;
}

/**
 * Save the selected clip rack, active track rack, or master rack as a project Favorite.
 * @mcp effect.saveFavoriteRack
 * @param name Optional favorite name. Defaults to the active rack name.
 */
export function effectSaveFavoriteRack(name = ""): string {
  const id = saveActiveRackAsFavorite(getMcpStore(), name);
  return id ? `Saved favorite effect chain ${id}` : "No active rack with effect slots";
}

/**
 * Apply a saved Favorite effect chain by id or exact name to the current edit scope.
 * @mcp effect.applyFavorite
 * @param idOrName Favorite chain id or exact favorite name.
 */
export function effectApplyFavorite(idOrName = ""): string {
  const store = getMcpStore();
  const needle = idOrName.trim();
  const chain = (store.getState().project.favoriteEffectChains ?? []).find((candidate) => candidate.id === needle || candidate.name === needle);
  if (!chain) return `Favorite effect chain not found: ${idOrName}`;
  return applyFavoriteEffectChain(store, chain.id) ? `Applied favorite effect chain ${chain.name}` : `Could not apply favorite effect chain ${chain.name}`;
}

/**
 * Add a persistent automation lane for a built-in track rack slot parameter.
 * Supports gain.gainDb and pan.pan; values are rendered as parameter offsets.
 * @mcp track.automateRackParam
 * @param track Track index, 0-based.
 * @param slotId Effect slot id returned by track.addRackSlot.
 * @param param Parameter to automate: "gainDb" for gain slots or "pan" for pan slots.
 * @param startSec First point time in seconds.
 * @param startValue First point value in dB or pan units.
 * @param endSec Second point time in seconds.
 * @param endValue Second point value in dB or pan units.
 * @param interpolation Interpolation mode: "linear" or "hold".
 */
export function trackAutomateRackParam(
  track = 0,
  slotId = "",
  param: "gainDb" | "pan" = "gainDb",
  startSec = 0,
  startValue = 0,
  endSec = 1,
  endValue = 0,
  interpolation: "linear" | "hold" = "linear",
): string {
  const store = getMcpStore();
  const trackObj = store.getState().project.tracks[track];
  if (!trackObj) return `Track ${track} not found`;
  const slot = trackObj.effectRack?.slots.find((x) => x.id === slotId);
  if (!slot) return `Rack slot ${slotId} not found on track ${track}`;
  if (!rackSlotSupportsParam(slot.kind, param)) return `${slot.kind} slot ${slot.id} does not support ${param} automation`;

  const a = Math.max(0, finiteNumber(startSec, 0));
  const b = Math.max(a, finiteNumber(endSec, a));
  const lane = newAutomationLane({
    name: `${slot.name} ${param}`,
    target: { kind: "effectParam", effectSlotId: slot.id, param },
    interpolation,
    points:
      b === a
        ? [{ time: a, value: rackParamValue(param, startValue) }]
        : [
            { time: a, value: rackParamValue(param, startValue) },
            { time: b, value: rackParamValue(param, endValue) },
          ],
  });
  store.dispatch(addTrackAutomationLane(trackObj.id, lane), { label: "Rack automation" });
  return `Track ${track} automated ${slot.id}.${param} with lane ${lane.id}`;
}

function normalizeRackSlotKind(kind: TrackRackSlotKind): TrackRackSlotKind {
  switch (kind) {
    case "gain":
    case "pan":
    case "compressor":
    case "limiter":
    case "tubeCompressor":
    case "speechLeveler":
    case "parametricEQ":
    case "graphicEQ":
    case "notchFilter":
    case "dehummer":
    case "declicker":
    case "deesser":
    case "centerChannel":
    case "channelMixer":
    case "graphicPhaseShifter":
    case "autoPhaseCorrect":
    case "phaser":
    case "stereoExpander":
    case "waveshaper":
    case "guitarSuite":
    case "exciter":
    case "vocalEnhancer":
    case "mastering":
    case "delay":
    case "analogDelay":
    case "echo":
    case "studioReverb":
    case "fullReverb":
    case "invertPolarity":
    case "silence":
      return kind;
  }
  return "gain";
}

function rackSlotLabel(kind: TrackRackSlotKind): string {
  switch (kind) {
    case "gain":
      return "Gain";
    case "pan":
      return "Pan";
    case "compressor":
      return "Compressor";
    case "limiter":
      return "Limiter";
    case "tubeCompressor":
      return "Tube Compressor";
    case "speechLeveler":
      return "Speech Volume Leveler";
    case "parametricEQ":
      return "Parametric EQ";
    case "graphicEQ":
      return "Graphic EQ";
    case "notchFilter":
      return "Notch Filter";
    case "dehummer":
      return "DeHummer";
    case "declicker":
      return "DeClicker";
    case "deesser":
      return "DeEsser";
    case "centerChannel":
      return "Center Channel Extractor";
    case "channelMixer":
      return "Channel Mixer";
    case "graphicPhaseShifter":
      return "Graphic Phase Shifter";
    case "autoPhaseCorrect":
      return "Auto Phase Correction";
    case "phaser":
      return "Phaser";
    case "stereoExpander":
      return "Stereo Expander";
    case "waveshaper":
      return "Waveshaper";
    case "guitarSuite":
      return "Guitar Suite";
    case "exciter":
      return "Exciter";
    case "vocalEnhancer":
      return "Vocal Enhancer";
    case "mastering":
      return "Mastering";
    case "delay":
      return "Delay";
    case "analogDelay":
      return "Analog Delay";
    case "echo":
      return "Echo";
    case "studioReverb":
      return "Studio Reverb";
    case "fullReverb":
      return "Full Reverb";
    case "invertPolarity":
      return "Invert Polarity";
    case "silence":
      return "Silence";
  }
}

function initialRackSlotParams(kind: TrackRackSlotKind, value: number): Record<string, EffectParamValue> {
  if (kind === "gain") return { gainDb: rackParamValue("gainDb", value) };
  if (kind === "pan") return { pan: rackParamValue("pan", value) };
  if (kind === "compressor") return { thresholdDb: clampFinite(value, -80, 0, -18), ratio: 4, attackMs: 10, releaseMs: 120, kneeDb: 6, makeupDb: 0 };
  if (kind === "limiter") return { ceilingDb: clampFinite(value, -24, 0, -0.3), inputBoostDb: 0, lookAheadMs: 5, releaseMs: 100 };
  if (kind === "tubeCompressor") return { driveDb: clampFinite(value, 0, 24, 9), warmth: 0.4, thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 150, makeupDb: 3 };
  if (kind === "speechLeveler") return { targetDb: -18, amount: clampFinite(value, 0, 1, 0.7), maxGainDb: 24, gateDb: -50, windowMs: 300 };
  if (kind === "parametricEQ") return { freq: 1000, q: 1, gainDb: clampFinite(value, -24, 24, 0) };
  if (kind === "graphicEQ") return { g31: 0, g62: 0, g125: 0, g250: 0, g500: 0, g1000: clampFinite(value, -24, 24, 0), g2000: 0, g4000: 0, g8000: 0, g16000: 0 };
  if (kind === "notchFilter") return { frequency: clampFinite(value, 20, 20000, 1000), gainDb: -40, q: 30 };
  if (kind === "dehummer") return { frequency: clampFinite(value, 40, 400, 60), q: 20, reductionDb: -24, harmonics: 10, harmonicFalloff: 1 };
  if (kind === "declicker") return { sensitivity: clampFinite(value, 0, 50, 5), threshold: 0.02, maxRunLength: 16 };
  if (kind === "deesser") return { centerFreq: clampFinite(value, 1000, 16000, 7000), q: 2.5, thresholdDb: -30, ratio: 4, attackMs: 1, releaseMs: 60, rangeDb: 12 };
  if (kind === "centerChannel") return { mode: "remove", centerLevelDb: -80, sideLevelDb: 0, lowFreq: 120, highFreq: 10000 };
  if (kind === "channelMixer") return { leftToLeft: 100, rightToLeft: 0, leftToRight: 0, rightToRight: 100 };
  if (kind === "graphicPhaseShifter") return { channel: "left", lowPhaseDeg: 0, highPhaseDeg: clampFinite(value, -180, 180, 180) };
  if (kind === "autoPhaseCorrect") return { mode: "auto", maxShiftMs: clampFinite(value, 0, 100, 5), leftShiftMs: 0, rightShiftMs: 0 };
  if (kind === "phaser") return { rateHz: clampFinite(value, 0, 20, 0.5), stages: 4, depth: 1, feedback: 0.3, mix: 0.5, baseFreqHz: 300, rangeOctaves: 4 };
  if (kind === "stereoExpander") return { expand: clampFinite(value, 0, 300, 125), centerPan: 0 };
  if (kind === "waveshaper") return { driveDb: clampFinite(value, -24, 48, 12), amount: 0.7, mix: 1 };
  if (kind === "guitarSuite") return { driveDb: clampFinite(value, 0, 48, 12), bodyHz: 90, toneHz: 5000, presenceDb: 3, mix: 1, outputDb: 0 };
  if (kind === "exciter") return { frequency: 3000, driveDb: clampFinite(value, 0, 48, 12), mix: 0.3 };
  if (kind === "vocalEnhancer") return {};
  if (kind === "mastering") return { lowShelfDb: 1, highShelfDb: 2, exciteAmount: 0.2, width: 1.3, ambience: 0, ambienceDecayMs: 250, ambiencePreDelayMs: 8, driveDb: clampFinite(value, 0, 24, 3), ceilingDb: -1, amount: 1 };
  if (kind === "delay") return { delayMs: clampFinite(value, 1, 5000, 250), feedback: 0.35, mix: 0.35, tailSeconds: 1.5 };
  if (kind === "analogDelay") return { delayMs: clampFinite(value, 1, 5000, 300), feedback: 0.4, toneHz: 4000, driveDb: 6, mix: 0.4, tailSeconds: 1.5 };
  if (kind === "echo") return { delayMs: clampFinite(value, 1, 5000, 300), feedback: 0.5, mix: 0.5, g31: 0, g62: 0, g125: 0, g250: 0, g500: 0, g1000: -1, g2000: -3, g4000: -6, g8000: -9, g16000: -12, tailSeconds: 1.5 };
  if (kind === "studioReverb") return { decay: 0.5, damping: 0.4, earlyMs: 80, earlyLevel: 0.5, width: 0.7, mix: clampFinite(value, 0, 1, 0.3), tailSeconds: 1.5 };
  if (kind === "fullReverb") return { decayMs: clampFinite(value, 20, 6000, 1500), perception: 40, preDelayMs: 0, absorption: 0.35, lowDb: 0, lowFreq: 200, midDb: 0, midFreq: 1000, midQ: 1, highDb: -6, highFreq: 6000, mix: 0.3, seed: 1 };
  return {};
}

function rackSlotSupportsParam(kind: string, param: TrackRackParam): boolean {
  return (kind === "gain" && param === "gainDb") || (kind === "pan" && param === "pan");
}

function rackParamValue(param: TrackRackParam, value: number): number {
  return param === "gainDb" ? clampFinite(value, -60, 12, 0) : clampFinite(value, -1, 1, 0);
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  return Math.max(min, Math.min(max, finiteNumber(value, fallback)));
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Batch-export separate files from the current session: track stems, marker
 * regions, or selected clips. The files download through the same path as the
 * File menu's Batch Export commands.
 * @mcp file.batchExport
 * @param scope What to export: "tracks", "regions", or "clips".
 * @param format Audio file format: "default", "wav", or "aiff".
 * @param bitDepth PCM bit depth for the exported files; 0 uses app default.
 */
export async function fileBatchExport(scope: "tracks" | "regions" | "clips" = "tracks", format = "default", bitDepth = 0): Promise<string> {
  const preferences = await loadFileBehaviorPreferencesAsync();
  const resolvedFormat: FileExportFormat = format === "wav" || format === "aiff" ? format : preferences.exportFormat;
  const depth = bitDepth === 16 || bitDepth === 24 || bitDepth === 32 ? bitDepth : preferences.exportBitDepth;
  const float = resolvedFormat === "wav" && depth === 32 && preferences.exportFloat;
  const count = exportBatch(getMcpStore(), scope, { format: resolvedFormat, bitDepth: depth, float });
  const label = `${resolvedFormat.toUpperCase()} ${depth}-bit${float ? " float" : ""}`;
  return count > 0 ? `Batch exported ${count} ${scope} file(s) as ${label}` : `No ${scope} to batch export`;
}

/**
 * Export the session timeline as Final Cut Pro 7 XML text for Adobe Premiere
 * import. Use alongside WAV/AIFF stem export when the NLE needs media files.
 * @mcp file.premiereXml
 * @param frameRate Non-drop-frame timeline rate for the XML (1..120).
 * @param includeMuted Include muted/disabled clips and tracks (0 or 1).
 */
export function filePremiereXml(frameRate = 30, includeMuted = 0): string {
  return premiereXml(getMcpStore(), { frameRate, includeMuted: includeMuted === 1 });
}

/**
 * Export the session timeline as CMX-style EDL text for Adobe Premiere import.
 * Use alongside WAV/AIFF stem export when the NLE needs media files.
 * @mcp file.edl
 * @param frameRate Non-drop-frame timeline rate for the EDL (1..120).
 * @param includeMuted Include muted/disabled clips and tracks (0 or 1).
 */
export function fileEdl(frameRate = 30, includeMuted = 0): string {
  return premiereEdl(getMcpStore(), { frameRate, includeMuted: includeMuted === 1 });
}

// ── Native plug-ins ───────────────────────────────────────────────────────────

/**
 * List standard native audio plug-in search roots for VST3, VST2, and Audio
 * Units. This is inventory support only; Rythme does not host native plug-ins yet.
 * @mcp plugin.searchRoots
 * @param platform Target platform: "auto", "darwin", "win32", or "linux".
 * @param homeDir Optional user home directory for per-user plug-in roots.
 */
export function pluginSearchRoots(platform: "auto" | "darwin" | "win32" | "linux" = "auto", homeDir = ""): string {
  return nativePluginSearchRoots(platform, homeDir || undefined).join("\n");
}

/**
 * Inventory native audio plug-in candidate paths (.vst3, .vst, .component,
 * .dll, .so), returning format, name, status, and path. Candidate paths are
 * newline- or semicolon-separated. This does not host or process plug-ins.
 * @mcp plugin.scanCandidates
 * @param paths Newline- or semicolon-separated candidate plug-in paths.
 */
export function pluginScanCandidates(paths = ""): string {
  const plugins = scanNativePluginPaths(paths);
  return paths.trim() ? formatNativePluginInventory(plugins) : "No candidate paths supplied";
}

/**
 * Scan candidate native audio plug-in paths and store the discovered inventory in
 * this project Audio Plug-In Manager. This still does not host or process plug-ins.
 * @mcp plugin.importCandidates
 * @param paths Newline- or semicolon-separated candidate plug-in paths.
 */
export function pluginImportCandidates(paths = ""): string {
  if (!paths.trim()) return "No candidate paths supplied";
  const count = scanNativePluginPathsIntoProject(getMcpStore(), paths);
  return `Imported ${count} native audio plug-in candidate(s) into the project manager`;
}

/**
 * Recursively scan native audio plug-in search roots for .vst3, .vst,
 * .component, .dll, and .so candidates. This still does not host or process
 * plug-ins.
 * @mcp plugin.scanRoots
 * @param roots Newline- or semicolon-separated plug-in search root folders.
 * @param maxDepth Maximum nested folder depth below each root. (0..16)
 */
export async function pluginScanRoots(roots = "", maxDepth = 6): Promise<string> {
  if (!roots.trim()) return "No search roots supplied";
  return formatNativePluginInventory(await scanNativePluginRootsWithNativeMetadata(roots, maxDepth));
}

/**
 * Recursively scan native audio plug-in search roots and store the discovered
 * inventory in this project Audio Plug-In Manager. This still does not host or
 * process plug-ins.
 * @mcp plugin.importRoots
 * @param roots Newline- or semicolon-separated plug-in search root folders.
 * @param maxDepth Maximum nested folder depth below each root. (0..16)
 */
export async function pluginImportRoots(roots = "", maxDepth = 6): Promise<string> {
  if (!roots.trim()) return "No search roots supplied";
  const count = await scanNativePluginRootsIntoProject(getMcpStore(), roots, maxDepth);
  return `Imported ${count} native audio plug-in candidate(s) from search roots into the project manager`;
}

/**
 * Import native audio plug-in candidates that already include scanner metadata,
 * such as version, bundle identifier, validation status, and validation issues.
 * This still does not host or process plug-ins.
 * @mcp plugin.importCandidateMetadata
 * @param candidatesJson JSON array of candidate objects with at least a path.
 */
export function pluginImportCandidateMetadata(candidatesJson = "[]"): string {
  const candidates = parsePluginCandidateMetadataJson(candidatesJson);
  if (typeof candidates === "string") return candidates;
  const plugins = scanNativePluginPaths(candidates, { includeUnknown: true });
  const count = addNativePluginsToProject(getMcpStore(), plugins, candidates.map((candidate) => candidate.path));
  const verified = plugins.filter((plugin) => plugin.validationStatus === "metadataVerified").length;
  const invalid = plugins.filter((plugin) => plugin.validationStatus === "invalid").length;
  return `Imported ${count} native audio plug-in candidate(s) into the project manager (${verified} metadata verified, ${invalid} invalid)`;
}

/**
 * List the project-persisted Audio Plug-In Manager inventory, including
 * enablement, inventory-only host status, and stored preset metadata.
 * @mcp plugin.listManaged
 */
export function pluginListManaged(): string {
  return formatManagedNativePluginInventory(getMcpStore().getState().project.nativePluginManager?.plugins ?? []);
}

/**
 * Enable or disable a project-managed native plug-in entry.
 * @mcp plugin.setEnabled
 * @param pluginId Plug-in id returned by plugin.listManaged.
 * @param enabled 1 to enable, 0 to disable.
 */
export function pluginSetEnabled(pluginId = "", enabled = 1): string {
  return setManagedNativePluginEnabled(getMcpStore(), pluginId, enabled !== 0)
    ? `${enabled !== 0 ? "Enabled" : "Disabled"} native audio plug-in ${pluginId}`
    : `Native audio plug-in not found: ${pluginId}`;
}

/**
 * Store preset/state metadata for a project-managed native plug-in entry.
 * @mcp plugin.setPreset
 * @param pluginId Plug-in id returned by plugin.listManaged.
 * @param presetName Preset name to remember with the project.
 * @param stateJson Optional JSON object of primitive state values.
 */
export function pluginSetPreset(pluginId = "", presetName = "Default", stateJson = "{}"): string {
  const state = parsePluginStateJson(stateJson);
  if (!state) return "State JSON must be an object with string, number, boolean, or null values";
  return setManagedNativePluginPresetState(getMcpStore(), pluginId, presetName, state)
    ? `Stored preset ${presetName} for native audio plug-in ${pluginId}`
    : `Native audio plug-in not found: ${pluginId}`;
}

/**
 * Add a project-managed native audio plug-in to a track rack as an
 * inventory-only slot. This still does not host or process the plug-in.
 * @mcp plugin.addToTrackRack
 * @param track Track index, 0-based.
 * @param pluginId Plug-in id returned by plugin.listManaged.
 */
export function pluginAddToTrackRack(track = 0, pluginId = ""): string {
  const store = getMcpStore();
  const trackObj = store.getState().project.tracks[track];
  if (!trackObj) return `Track ${track} not found`;
  const slotId = addNativePluginSlotToRack(store, pluginId, { kind: "track", id: trackObj.id });
  return slotId
    ? `Track ${track} native audio plug-in rack slot ${slotId} (${pluginId}, inventory only)`
    : `Native audio plug-in not found: ${pluginId}`;
}

function parsePluginStateJson(json: string): Record<string, EffectParamValue> | null {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, EffectParamValue> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return null;
        out[key] = value;
      } else if (typeof value === "string" || typeof value === "boolean" || value === null) {
        out[key] = value;
      } else {
        return null;
      }
    }
    return out;
  } catch {
    return null;
  }
}

function parsePluginCandidateMetadataJson(json: string): IO.NativeAudioPluginCandidate[] | string {
  try {
    const parsed: unknown = JSON.parse(json || "[]");
    if (!Array.isArray(parsed)) return "Candidate metadata JSON must be an array";
    const candidates: IO.NativeAudioPluginCandidate[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return "Each candidate metadata entry must be an object";
      const rec = item as Record<string, unknown>;
      if (typeof rec.path !== "string" || !rec.path.trim()) return "Each candidate metadata entry must include a path";
      const candidate: IO.NativeAudioPluginCandidate = { path: rec.path };
      for (const field of ["name", "vendor", "version", "bundleIdentifier"] as const) {
        if (rec[field] !== undefined) {
          if (typeof rec[field] !== "string") return `Candidate metadata field ${field} must be a string`;
          candidate[field] = rec[field];
        }
      }
      if (rec.kind !== undefined) {
        if (rec.kind !== "vst3" && rec.kind !== "vst2" && rec.kind !== "audioUnit" && rec.kind !== "unknown") {
          return "Candidate metadata field kind must be vst3, vst2, audioUnit, or unknown";
        }
        candidate.kind = rec.kind;
      }
      if (rec.validationStatus !== undefined) {
        if (rec.validationStatus !== "pathOnly" && rec.validationStatus !== "metadataVerified" && rec.validationStatus !== "invalid") {
          return "Candidate metadata field validationStatus must be pathOnly, metadataVerified, or invalid";
        }
        candidate.validationStatus = rec.validationStatus;
      }
      if (rec.validationIssues !== undefined) {
        if (!Array.isArray(rec.validationIssues) || !rec.validationIssues.every((issue) => typeof issue === "string")) {
          return "Candidate metadata field validationIssues must be an array of strings";
        }
        candidate.validationIssues = rec.validationIssues;
      }
      if (rec.entryPointVerified !== undefined) {
        if (typeof rec.entryPointVerified !== "boolean") return "Candidate metadata field entryPointVerified must be a boolean";
        candidate.entryPointVerified = rec.entryPointVerified;
      }
      candidates.push(candidate);
    }
    return candidates;
  } catch {
    return "Candidate metadata JSON could not be parsed";
  }
}

// ── Generate ────────────────────────────────────────────────────────────────────

/**
 * Generate a tone or noise clip and insert it at the playhead on the active track.
 * @mcp generate.insert
 * @param kind Generator kind.
 * @param freq Tone frequency in Hz (for tones/chirp) (1..20000).
 * @param seconds Clip length in seconds (0.01..600).
 * @param amplitude Peak amplitude (0..1).
 */
export function generateInsert(
  kind: "sine" | "square" | "sawtooth" | "triangle" | "white" | "pink" | "brown" | "chirp" | "silence",
  freq = 440,
  seconds = 2,
  amplitude = 0.7,
): string {
  insertGenerated(getMcpStore(), kind, { freq, seconds, amplitude });
  return `Inserted ${seconds}s ${kind}`;
}

/**
 * Generate a Tones clip (Audition Generate ▸ Tones) with frequency modulation and
 * harmonics, inserted at the playhead on the active track.
 * @mcp generate.tones
 * @param freq Base frequency in Hz (1..20000).
 * @param seconds Clip length in seconds (0.01..600).
 * @param modDepthHz Frequency-modulation depth in Hz; the pitch swings ±depth/2 (0..5000).
 * @param modRateHz Frequency-modulation rate in Hz, the warble speed (0..100).
 * @param harmonics Overtones added above the fundamental, 0..5.
 */
export function generateTones(freq = 440, seconds = 2, modDepthHz = 0, modRateHz = 0, harmonics = 0): string {
  insertTones(getMcpStore(), freq, { seconds, modDepthHz, modRateHz, harmonics });
  return `Generated Tones ${freq} Hz${modDepthHz ? ` ±${modDepthHz / 2} Hz @ ${modRateHz} Hz` : ""}${harmonics ? `, ${harmonics} harmonics` : ""}`;
}

/**
 * Generate a DTMF dial-string clip (Audition Generate ▸ DTMF Signals), inserted
 * at the playhead. Keys 0–9, *, #, A–D; a space / comma / dash inserts a pause.
 * @mcp generate.dtmf
 * @param dial The dial string, e.g. "1 800 555 0100".
 * @param toneMs Length of each key's tone, ms (10..2000).
 * @param breakMs Silence between tones, ms (0..2000).
 */
export function generateDtmf(dial = "0123456789", toneMs = 100, breakMs = 50): string {
  insertDtmfSequence(getMcpStore(), dial, { toneMs, breakMs });
  return `Generated DTMF "${dial}"`;
}

// ── Effects ─────────────────────────────────────────────────────────────────────

/**
 * Pitch-shift the current selection (or scope) by semitones, preserving duration.
 * @mcp effect.pitchShift
 * @param semitones Pitch shift in semitones (-24..24).
 */
export function effectPitchShift(semitones: number): string {
  applyPitchShift(getMcpStore(), semitones);
  return `Pitch shifted ${semitones} st`;
}

/**
 * Time-stretch the current selection (or scope) by a factor, preserving pitch.
 * @mcp effect.timeStretch
 * @param factor Stretch factor (>1 = longer, <1 = shorter) (0.25..4).
 */
export function effectTimeStretch(factor: number): string {
  applyTimeStretch(getMcpStore(), factor);
  return `Time stretched ${Math.round(factor * 100)}%`;
}

/**
 * Remix the current selection/scope to a target duration without changing
 * playback speed or pitch, using crossfaded music-bed edits.
 * @mcp effect.remixToDuration
 * @param seconds Target duration in seconds (0.1..7200).
 * @param crossfadeMs Crossfade length at loop/cut points, ms (0..5000).
 */
export function effectRemixToDuration(seconds = 30, crossfadeMs = 120): string {
  applyRemixToDuration(getMcpStore(), seconds, { crossfadeMs });
  return `Remixed to ${seconds}s`;
}

/**
 * Apply a Scientific Filter (high-order analog-prototype IIR) over the current scope.
 * @mcp effect.scientificFilter
 * @param kind Analog prototype family.
 * @param response Frequency response shape.
 * @param order Prototype order; band-pass/stop realize twice this (1..12).
 * @param cutoffHz Corner frequency in Hz; lower edge for band-pass/stop (1..20000).
 * @param cutoffHz2 Upper edge in Hz for band-pass/stop (1..20000).
 */
export function effectScientificFilter(
  kind: "butterworth" | "chebyshev1" | "chebyshev2" | "bessel" | "elliptic" = "butterworth",
  response: "lowpass" | "highpass" | "bandpass" | "bandstop" = "lowpass",
  order = 4,
  cutoffHz = 1000,
  cutoffHz2 = 4000,
): string {
  applyScientificFilter(getMcpStore(), { kind, response, order, cutoffHz, cutoffHz2 });
  return `Scientific Filter ${kind} ${response}`;
}

/**
 * Apply a Graphic Equalizer (10-band octave EQ) preset over the current scope.
 * @mcp effect.graphicEq
 * @param preset Tone-shaping curve: bassBoost · trebleBoost · loudness · vocalPresence · midScoop · telephone.
 */
export function effectGraphicEq(preset = "bassBoost"): string {
  const p = GRAPHIC_EQ_PRESETS.find((x) => x.id === preset) ?? GRAPHIC_EQ_PRESETS[0];
  applyGraphicEq(getMcpStore(), p.gainsDb, `Graphic Equalizer — ${p.label}`);
  return `Graphic Equalizer ${p.label}`;
}

/**
 * Apply a Parametric Equalizer (free-form shelf + bell cascade) preset over the current scope.
 * @mcp effect.parametricEq
 * @param preset Curve: vocalClarity · warm · bright · deMud · loudness · lofi.
 */
export function effectParametricEq(preset = "vocalClarity"): string {
  const p = PARAMETRIC_EQ_PRESETS.find((x) => x.id === preset) ?? PARAMETRIC_EQ_PRESETS[0];
  applyParametricEq(getMcpStore(), p.bands, `Parametric Equalizer — ${p.label}`);
  return `Parametric Equalizer ${p.label}`;
}

/**
 * Bounce to a new track: render the active track (or the whole session mix) down
 * to a single clip on a brand-new track, leaving the sources intact.
 * @mcp multitrack.bounce
 * @param scope What to bounce: the active "track" or the entire "session" mix.
 */
export function multitrackBounce(scope: "track" | "session" = "track"): string {
  const ok = scope === "session" ? bounceProjectToNewTrack(getMcpStore()) : bounceTrackToNewTrack(getMcpStore());
  return ok ? `Bounced ${scope} to a new track` : "Nothing to bounce";
}

/**
 * Apply a Stereo Expander (stereo width + centre placement) over the current scope.
 * @mcp effect.stereoExpander
 * @param expand Stereo width: 100 = unchanged, 0 = mono, up to 300 = wide (0..300).
 * @param centerPan Centre position, −100 hard-left … 100 hard-right (-100..100).
 */
export function effectStereoExpander(expand = 100, centerPan = 0): string {
  applyStereoExpander(getMcpStore(), { expand, centerPan });
  return `Stereo Expander expand=${expand} pan=${centerPan}`;
}

/**
 * Swap the left and right channels over the current scope.
 * @mcp effect.swapChannels
 */
export function effectSwapChannels(): string {
  applySwapChannels(getMcpStore());
  return "Swapped left/right channels";
}

/**
 * Apply an Audition-style Mastering rack preset over the current scope. "Open"
 * enables the ambience/reverb stage; the other presets preserve duration.
 * @mcp effect.mastering
 * @param preset Preset id: "warm", "bright", "loud", "wide", or "open".
 */
export function effectMastering(preset: "warm" | "bright" | "loud" | "wide" | "open" = "warm"): string {
  const id = `master${preset[0].toUpperCase()}${preset.slice(1)}`;
  const p = MASTERING_PRESETS.find((x) => x.id === id) ?? MASTERING_PRESETS[0];
  applyMastering(getMcpStore(), p.opts, `Mastering - ${p.label}`);
  return `Mastering ${p.label}`;
}

/**
 * Apply a Full Reverb (synthesized colored-IR convolution reverb) over the current scope.
 * @mcp effect.fullReverb
 * @param decayMs Decay time / RT60 in ms — how long the tail lasts (20..6000).
 * @param perception Room irregularity 0..100: higher = more, more-varied early reflections.
 * @param mix Dry/wet mix, 0..1.
 * @param colorHighDb Coloration high-shelf gain in dB at ~6 kHz — negative darkens the tail (-24..6).
 */
export function effectFullReverb(decayMs = 1500, perception = 40, mix = 0.3, colorHighDb = -6): string {
  applyFullReverb(getMcpStore(), { decayMs, perception, mix, coloration: { highDb: colorHighDb } });
  return `Full Reverb decay=${decayMs}ms perception=${perception}`;
}

/**
 * Apply Convolution Reverb using a supplied impulse-response audio file. The
 * IR must be base64-encoded WAV or AIFF bytes; Rythme decodes, downmixes,
 * energy-normalizes, and applies it to the current effect scope.
 * @mcp effect.convolutionIr
 * @param name File name for format sniffing, e.g. "room.wav" or "hall.aiff".
 * @param base64 Base64-encoded WAV/AIFF impulse-response audio bytes.
 * @param mix Wet/dry mix, 0..1.
 */
export function effectConvolutionIr(name = "impulse.wav", base64 = "", mix = 0.3): string {
  if (!base64.trim()) return "No impulse response supplied";
  try {
    const bytes = IO.base64ToBytes(base64.trim());
    const impulseAudio = IO.decodeAudio(bytes, name);
    const ok = applyConvolutionReverbImpulse(getMcpStore(), impulseAudio, { mix, normalize: "energy" }, `Convolution Reverb - ${name}`);
    return ok ? `Convolution Reverb IR ${name}` : "Impulse response was empty";
  } catch (err) {
    return `Could not decode impulse response: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Apply Automatic Phase Correction (inter-channel alignment) over the current scope.
 * @mcp effect.autoPhaseCorrect
 * @param maxShiftMs Maximum inter-channel lag searched in ms, 0 = polarity only (0..100).
 * @param correctPolarity Flip the right channel if the channels are anti-correlated.
 */
export function effectAutoPhaseCorrect(maxShiftMs = 5, correctPolarity = true): string {
  applyAutoPhaseCorrect(getMcpStore(), { mode: "auto", maxShiftMs, correctPolarity });
  return `Auto Phase Correction ±${maxShiftMs}ms`;
}

/**
 * Apply a Graphic Phase Shifter (magnitude-preserving all-pass) over the current scope.
 * @mcp effect.graphicPhaseShifter
 * @param phaseDeg Uniform phase shift across all frequencies, in degrees (-360..360).
 * @param channel Which channels to shift — "both", "left", or "right".
 */
export function effectGraphicPhaseShifter(
  phaseDeg = 90,
  channel: "both" | "left" | "right" = "both",
): string {
  applyGraphicPhaseShifter(getMcpStore(), { channel, curve: [{ freq: 0, phaseDeg }, { freq: 22050, phaseDeg }] });
  return `Graphic Phase Shifter ${phaseDeg}° (${channel})`;
}

/**
 * Apply a Gain Envelope (time-varying amplitude) over the current scope, as a
 * start → middle → end shape (1 = unity, 0 = silence, >1 = boost).
 * @mcp effect.gainEnvelope
 * @param startGain Linear gain at the start of the selection (0..4).
 * @param midGain Linear gain at the middle of the selection (0..4).
 * @param endGain Linear gain at the end of the selection (0..4).
 * @param spline Use a smooth spline curve instead of straight segments.
 */
export function effectGainEnvelope(startGain = 1, midGain = 1, endGain = 1, spline = false): string {
  applyGainEnvelope(getMcpStore(), {
    points: [{ time: 0, gain: startGain }, { time: 0.5, gain: midGain }, { time: 1, gain: endGain }],
    interpolation: spline ? "spline" : "linear",
  });
  return `Gain Envelope ${startGain}→${midGain}→${endGain}`;
}

/**
 * Frequency Band Splitter: split the current scope into bands at the two crossover
 * frequencies, each on its own new track (three bands; the bands recombine exactly).
 * @mcp effect.splitBands
 * @param crossover1 Lower crossover frequency in Hz (1..20000).
 * @param crossover2 Upper crossover frequency in Hz (1..20000).
 */
export function effectSplitBands(crossover1 = 800, crossover2 = 3200): string {
  const n = splitIntoBands(getMcpStore(), [crossover1, crossover2]);
  return `Frequency Band Splitter → ${n} band track(s)`;
}

/**
 * Apply gain to a rectangular spectral selection: time range plus frequency band.
 * @mcp effect.spectralGain
 * @param start Selection start time in seconds (0..86400).
 * @param end Selection end time in seconds (0..86400).
 * @param minHz Lower frequency edge in Hz (0..24000).
 * @param maxHz Upper frequency edge in Hz (0..24000).
 * @param gainDb Gain applied inside the rectangle; -120 is practical silence (-120..24).
 */
export function effectSpectralGain(start: number, end: number, minHz: number, maxHz: number, gainDb = -24): string {
  const store = getMcpStore();
  store.dispatch(selectSpectralRange({ time: { start, end }, frequency: { minHz, maxHz }, channel: "all" }), { history: false });
  store.dispatch(applySpectralSelectionGain(gainDb), { label: gainDb <= -100 ? "Spectral Silence" : "Spectral Gain" });
  return `Spectral gain ${gainDb} dB from ${start}s to ${end}s, ${minHz}-${maxHz} Hz`;
}

/**
 * Amplitude Statistics for the current scope — peak, RMS, dynamic range, DC offset
 * and possibly-clipped sample count, as a readable summary.
 * @mcp analysis.amplitudeStats
 */
export function analysisAmplitudeStats(): string {
  const stats = analyzeAmplitude(getMcpStore());
  if (!stats) return "Nothing to analyze";
  const o = stats.overall;
  const db = (v: number) => `${v.toFixed(1)} dB`;
  return [
    `Peak ${db(o.peakDb)}`,
    `Total RMS ${db(o.totalRmsDb)}`,
    `Max/Min RMS ${db(o.maxRmsDb)} / ${db(o.minRmsDb)}`,
    `Dynamic Range ${o.dynamicRangeDb.toFixed(1)} dB`,
    `DC Offset ${o.dcOffset.toFixed(4)}`,
    `Possibly Clipped ${o.possiblyClippedSamples}`,
    `Sample [${o.minSample.toFixed(3)}, ${o.maxSample.toFixed(3)}]`,
  ].join(" · ");
}

/**
 * Phase Analysis for the current scope — stereo correlation (−1 out of phase … +1
 * in phase), balance, width and mono compatibility.
 * @mcp analysis.phaseAnalysis
 */
export function analysisPhaseAnalysis(): string {
  const p = analyzePhase(getMcpStore());
  if (!p) return "Nothing to analyze";
  if (!p.stereo) return "Mono — no phase relationship to measure";
  const bal = p.balance === 0 ? "centre" : `${p.balance < 0 ? "left" : "right"} ${Math.abs(p.balance * 100).toFixed(0)}%`;
  return `Correlation ${p.correlation.toFixed(2)} · Width ${p.width.toFixed(2)} · Balance ${bal} · Mono compat ${p.monoCompatibility.toFixed(2)}`;
}

/**
 * Loudness metering for the current scope — EBU R128 / ITU-R BS.1770 integrated
 * loudness (LUFS), True Peak (dBTP, oversampled), short-term max and the
 * Loudness Range (LRA), as shown in Audition's Loudness / Match Loudness panel.
 * @mcp analysis.loudness
 */
export function analysisLoudness(): string {
  const l = analyzeLoudness(getMcpStore());
  if (!l) return "Nothing to analyze";
  const lufs = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} LUFS` : "−∞ LUFS");
  const tp = Number.isFinite(l.truePeak) ? `${l.truePeak.toFixed(1)} dBTP` : "−∞ dBTP";
  return `Integrated ${lufs(l.integrated)} · True Peak ${tp} · Short-term ${lufs(l.shortTermMax)} · LRA ${l.range.toFixed(1)} LU`;
}

/**
 * Loudness Radar — loudness over time for the current scope. Reports the momentary
 * loudness span (min … max), the integrated value, the range, and how many
 * momentary / short-term points were measured.
 * @mcp analysis.loudnessGraph
 */
export function analysisLoudnessGraph(): string {
  const ts = analyzeLoudnessSeries(getMcpStore());
  if (!ts) return "Nothing to analyze";
  const finite = ts.momentary.lufs.filter((v) => Number.isFinite(v));
  const span = finite.length ? `${Math.min(...finite).toFixed(1)} … ${Math.max(...finite).toFixed(1)} LUFS` : "no momentary data";
  const integ = Number.isFinite(ts.integrated) ? `${ts.integrated.toFixed(1)} LUFS` : "−∞ LUFS";
  return `Momentary ${span} · Integrated ${integ} · LRA ${ts.range.toFixed(1)} LU · ${ts.momentary.lufs.length} mom / ${ts.shortTerm.lufs.length} short-term points`;
}

/**
 * True Peak (ISP) Limiter over the current scope — a brickwall limiter that holds
 * the inter-sample (true) peak under a dBTP ceiling using 4× oversampled
 * detection, so the reconstructed signal never clips the converter.
 * @mcp effect.truePeakLimiter
 * @param ceilingDb Inter-sample peak ceiling, dBTP (-24..0).
 * @param inputBoostDb Gain applied before limiting, dB (0..36).
 * @param lookAheadMs Peak anticipation window, ms (0..50).
 * @param releaseMs Gain recovery time after a peak, ms (1..1000).
 */
export function effectTruePeakLimiter(ceilingDb = -1, inputBoostDb = 0, lookAheadMs = 5, releaseMs = 100): string {
  applyTruePeakLimiter(getMcpStore(), { ceilingDb, inputBoostDb, lookAheadMs, releaseMs });
  return `True Peak Limiter (≤ ${ceilingDb} dBTP, boost ${inputBoostDb} dB)`;
}

/**
 * Sidechain Ducking (Auto-Duck) — dip the active track whenever the key track is
 * present, baking the result over the active track's timeline. Like Audition's
 * Essential Sound ▸ Ducking (music ducks under dialogue).
 * @mcp effect.sidechainDuck
 * @param keyTrack Index of the track that triggers ducking (0-based).
 * @param amountDb Attenuation while the key is active, dB (-48..0).
 * @param thresholdDb Key level that engages ducking, dBFS (-90..0).
 * @param attackMs Time to duck down once the key crosses the threshold, ms (1..2000).
 * @param releaseMs Time to recover after the key falls silent, ms (1..5000).
 * @param holdMs Keep ducking this long after the key drops below threshold, ms (0..5000).
 */
export function effectSidechainDuck(keyTrack = 0, amountDb = -12, thresholdDb = -30, attackMs = 60, releaseMs = 400, holdMs = 200): string {
  const store = getMcpStore();
  const keyId = store.getState().project.tracks[keyTrack]?.id;
  applySidechainDuck(store, keyId, { amountDb, thresholdDb, attackMs, releaseMs, holdMs });
  return `Sidechain Duck (key track ${keyTrack}, ${amountDb} dB)`;
}

/**
 * Essential Sound role preset for the current scope. If role is "auto", Rythme
 * uses the active track's assigned role, then falls back to Dialogue.
 * @mcp effect.essentialSound
 * @param role Role preset to apply, or "auto" to use the active track role.
 */
export function effectEssentialSound(role: "auto" | "dialogue" | "music" | "sfx" | "ambience" = "auto"): string {
  const applied = applyEssentialSoundPreset(getMcpStore(), role === "auto" ? undefined : role);
  return applied ? `Essential Sound ${role}` : "Nothing to process";
}

/**
 * Essential Sound Auto-Duck: bake ducking onto every Music-role track using
 * every Dialogue-role track as a key.
 * @mcp effect.essentialDuck
 * @param amountDb Attenuation while dialogue is active, dB (-48..0).
 * @param thresholdDb Dialogue level that engages ducking, dBFS (-90..0).
 * @param attackMs Time to duck down once dialogue crosses threshold, ms (1..2000).
 * @param releaseMs Time to recover after dialogue falls silent, ms (1..5000).
 * @param holdMs Keep ducking this long after dialogue drops below threshold, ms (0..5000).
 */
export function effectEssentialDuck(amountDb = -12, thresholdDb = -30, attackMs = 60, releaseMs = 400, holdMs = 200): string {
  const count = applyEssentialSoundAutoDuck(getMcpStore(), { amountDb, thresholdDb, attackMs, releaseMs, holdMs });
  return count > 0 ? `Essential Sound ducked ${count} music/dialogue pair(s)` : "Assign Dialogue and Music roles first";
}

/**
 * Sidechain Compressor — compress the active track using the key track as the
 * detector (the "pumping" effect), baking the result over the active track's
 * timeline. Continuous and proportional, unlike the binary Auto-Duck.
 * @mcp effect.sidechainCompress
 * @param keyTrack Index of the detector (key) track, 0-based.
 * @param thresholdDb Key level above which the target is compressed, dBFS (-90..0).
 * @param ratio Compression ratio (1..20).
 * @param kneeDb Soft-knee width around the threshold, dB (0..24).
 * @param attackMs Gain-reduction onset time, ms (1..500).
 * @param releaseMs Gain-recovery time, ms (1..5000).
 * @param makeupDb Make-up gain applied to the whole target, dB (0..24).
 */
export function effectSidechainCompress(keyTrack = 0, thresholdDb = -24, ratio = 4, kneeDb = 6, attackMs = 10, releaseMs = 150, makeupDb = 0): string {
  const store = getMcpStore();
  const keyId = store.getState().project.tracks[keyTrack]?.id;
  applySidechainCompress(store, keyId, { thresholdDb, ratio, kneeDb, attackMs, releaseMs, makeupDb });
  return `Sidechain Compressor (key track ${keyTrack}, ${ratio}:1 @ ${thresholdDb} dB)`;
}

/**
 * Sidechain Gate — gate the active track by the key track so it is audible only
 * while the key plays (the inverse of Auto-Duck), baked over the active track's
 * timeline. A keyed / "trance" gate.
 * @mcp effect.sidechainGate
 * @param keyTrack Index of the detector (key) track, 0-based.
 * @param thresholdDb Key level above which the gate opens, dBFS (-90..0).
 * @param rangeDb Attenuation while the gate is closed, dB (-90..0).
 * @param attackMs Time to open once the key crosses the threshold, ms (1..500).
 * @param holdMs Keep the gate open after the key drops below threshold, ms (0..5000).
 * @param releaseMs Time to close after the hold, ms (1..5000).
 */
export function effectSidechainGate(keyTrack = 0, thresholdDb = -30, rangeDb = -60, attackMs = 5, holdMs = 50, releaseMs = 150): string {
  const store = getMcpStore();
  const keyId = store.getState().project.tracks[keyTrack]?.id;
  applySidechainGate(store, keyId, { thresholdDb, rangeDb, attackMs, holdMs, releaseMs });
  return `Sidechain Gate (key track ${keyTrack}, range ${rangeDb} dB @ ${thresholdDb} dB)`;
}

/**
 * Auto-Crossfade every overlapping pair of clips on a track — the earlier clip
 * fades out as the later fades in across the overlap (Audition's multitrack
 * crossfade), smoothing the seam.
 * @mcp clip.autoCrossfade
 * @param track Track index whose overlapping clips to crossfade, 0-based.
 * @param linear Use a linear (equal-gain) curve instead of equal-power (0 = equal-power, 1 = linear).
 */
export function clipAutoCrossfade(track = 0, linear = 0): string {
  const store = getMcpStore();
  const trackId = store.getState().project.tracks[track]?.id;
  applyAutoCrossfade(store, trackId, { shape: linear ? "linear" : "equalPower" });
  return `Auto-Crossfade track ${track} (${linear ? "linear" : "equal-power"})`;
}

/**
 * Match Clip Volume — bring the selected clips to a common level by setting each
 * clip's gain trim (non-destructive); matches to the loudest clip in the set.
 * @mcp clip.matchVolume
 * @param mode What to equalise: "peak", "rms", or "loudness".
 */
export function clipMatchVolume(mode = "peak"): string {
  const m = mode === "rms" || mode === "loudness" ? mode : "peak";
  applyMatchClipVolume(getMcpStore(), { mode: m });
  return `Match Clip Volume (${m})`;
}

/**
 * Split Clips at Markers — razor every clip at each marker position (region
 * markers cut at both edges), turning Mark Audio / Mark Beats markers into clip
 * boundaries.
 * @mcp clip.splitAtMarkers
 */
export function clipSplitAtMarkers(): string {
  const added = applySplitAtMarkers(getMcpStore());
  return `Split at Markers → ${added} new clip(s)`;
}

/**
 * Merge Clips — render the currently selected clips (which must share a track)
 * into a single clip spanning from the earliest start to the latest end, the
 * inverse of Split.
 * @mcp clip.merge
 */
export function clipMerge(): string {
  const store = getMcpStore();
  const n = store.getState().selection.clipIds.length;
  applyMergeClips(store);
  return n >= 2 ? `Merged ${n} clips into one` : "Select at least two clips to merge";
}

/**
 * Delete Silence over the current scope — trim the gaps between phrases.
 * @mcp effect.deleteSilence
 * @param thresholdDb Level at or below which audio counts as silence, dBFS (-90..0).
 * @param minSilenceMs Only gaps at least this long are trimmed, ms (0..5000).
 * @param keepMs Silence left in each trimmed gap, ms; 0 removes it entirely (0..2000).
 */
export function effectDeleteSilence(thresholdDb = -50, minSilenceMs = 200, keepMs = 100): string {
  applyDeleteSilence(getMcpStore(), { thresholdDb, minSilenceMs, keepMs });
  return `Delete Silence (< ${thresholdDb} dB, > ${minSilenceMs} ms, keep ${keepMs} ms)`;
}

/**
 * Spectrogram (Spectral Frequency Display) of the current scope — reports the
 * matrix dimensions and the loudest time/frequency cell.
 * @mcp analysis.spectrogram
 */
export function analysisSpectrogram(): string {
  const sg = analyzeSpectrogram(getMcpStore(), { fftSize: 1024, hop: 512 });
  if (!sg) return "Nothing to analyze";
  let best = -Infinity;
  let bestIdx = 0;
  for (let i = 0; i < sg.db.length; i++) {
    if (sg.db[i] > best) {
      best = sg.db[i];
      bestIdx = i;
    }
  }
  const peakHz = sg.freqs[bestIdx % sg.bins];
  return `Spectrogram ${sg.frames}×${sg.bins} (fft ${sg.fftSize}) · loudest ${peakHz.toFixed(0)} Hz @ ${best.toFixed(1)} dB`;
}

/**
 * Convert Sample Type over the current scope — change channel count and/or bit depth.
 * @mcp effect.convertSampleType
 * @param channels Target channel count, 1 (mono) or 2 (stereo).
 * @param bitDepth Target bit depth (8..32); 32 = no re-quantization.
 * @param dither Add triangular dither when lowering the bit depth.
 */
export function effectConvertSampleType(channels = 2, bitDepth = 16, dither = true): string {
  const ch = channels === 1 ? 1 : 2;
  applyConvertSampleType(getMcpStore(), { channels: ch, bitDepth, dither });
  return `Convert Sample Type → ${ch === 1 ? "mono" : "stereo"}, ${bitDepth}-bit${dither ? " (dither)" : ""}`;
}

/**
 * Convert the whole session to a new sample rate (resamples every clip).
 * @mcp project.convertSampleRate
 * @param rate Target sample rate in Hz (8000..192000).
 */
export function projectConvertSampleRate(rate = 48000): string {
  convertProjectSampleRate(getMcpStore(), rate);
  return `Converted session to ${rate} Hz`;
}

/**
 * Mark Audio: detect the non-silent regions of the mix and drop a range marker on
 * each (great for splitting a long recording into takes).
 * @mcp analysis.markAudio
 * @param thresholdDb Level at or below which audio counts as silence, dBFS (-90..0).
 * @param minSilenceMs A silent gap at least this long separates two regions, ms (0..5000).
 */
export function analysisMarkAudio(thresholdDb = -45, minSilenceMs = 300): string {
  const n = markAudioRegions(getMcpStore(), { thresholdDb, minSilenceMs });
  return `Mark Audio → ${n} region marker(s)`;
}

/**
 * Tempo / beat detection for the current scope — reports the estimated BPM and
 * how many rhythmic onsets were found, without changing the project.
 * @mcp analysis.tempo
 * @param sensitivity Onset threshold as a multiple of the mean energy flux (higher = fewer beats).
 */
export function analysisTempo(sensitivity = 3): string {
  const r = analyzeTempo(getMcpStore(), { sensitivity });
  if (!r) return "Nothing to analyze";
  return r.bpm > 0 ? `${r.bpm} BPM · ${r.beats.length} beats` : `No clear tempo (${r.beats.length} onsets)`;
}

/**
 * Amplitude histogram for the current scope — the dBFS distribution of sample
 * values: the modal (most common) level, how many bins hold ≥1% of the samples,
 * and the total sample count.
 * @mcp analysis.histogram
 * @param binDb dB per histogram bin (0.1..12).
 */
export function analysisHistogram(binDb = 1): string {
  const h = analyzeHistogram(getMcpStore(), { binDb });
  if (!h) return "Nothing to analyze";
  const significant = h.counts.filter((c) => c > h.total * 0.01).length;
  return `Modal ${h.peakBinDb.toFixed(1)} dBFS · ${significant} bin(s) ≥1% · ${h.total} samples`;
}

/**
 * Pitch detection for the current scope — the dominant fundamental (Hz), its
 * nearest note + octave, cents off, and a confidence (YIN algorithm).
 * @mcp analysis.pitch
 */
export function analysisPitch(): string {
  const r = analyzePitch(getMcpStore());
  if (!r) return "Nothing to analyze";
  if (r.hz <= 0 || r.confidence < 0.5) return `No clear pitch (confidence ${r ? r.confidence.toFixed(2) : "0"})`;
  const sign = r.cents >= 0 ? "+" : "";
  return `${r.note}${r.octave} · ${r.hz.toFixed(1)} Hz · ${sign}${r.cents}¢ · confidence ${r.confidence.toFixed(2)}`;
}

/**
 * Mark Beats: detect the rhythmic onsets of the mix and drop a cue marker on
 * each (Audition's "generate markers from beats").
 * @mcp analysis.markBeats
 * @param sensitivity Onset threshold as a multiple of the mean energy flux (higher = fewer beats).
 */
export function analysisMarkBeats(sensitivity = 3): string {
  const r = markBeats(getMcpStore(), { sensitivity });
  return `Mark Beats → ${r.beats.length} marker(s) at ${r.bpm > 0 ? `${r.bpm} BPM` : "irregular tempo"}`;
}

/**
 * Export the project's markers as Audition-style CSV (Name, Start, End, Duration,
 * Type), returned as text.
 * @mcp marker.exportCsv
 */
export function markerExportCsv(): string {
  return markersCsv(getMcpStore());
}

/**
 * Import markers from an Audition-style marker CSV, adding them to the project.
 * @mcp marker.importCsv
 * @param csv The CSV text (a header plus Name,Start,End,Duration,Type rows).
 */
export function markerImportCsv(csv = ""): string {
  const n = importMarkersCsv(getMcpStore(), csv);
  return `Imported ${n} marker(s)`;
}

/**
 * Phase Scope / vectorscope of the current scope — reports the goniometer point
 * cloud's shape (vertical = mono, horizontal = out of phase, diagonal = offset).
 * @mcp analysis.vectorscope
 */
export function analysisVectorscope(): string {
  const vs = analyzeVectorscope(getMcpStore(), { maxPoints: 4000 });
  if (!vs || vs.count === 0) return "Nothing to analyze";
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < vs.count; i++) {
    sx += vs.x[i] * vs.x[i];
    sy += vs.y[i] * vs.y[i];
  }
  const rx = Math.sqrt(sx / vs.count);
  const ry = Math.sqrt(sy / vs.count);
  const ratio = ry > 0 ? rx / ry : Infinity;
  const shape = ratio < 0.2 ? "vertical (mono / centred)" : ratio > 1 ? "horizontal (wide / out of phase)" : "diagonal (offset stereo)";
  return `Phase scope: ${vs.count} pts · spread x/y ${ratio.toFixed(2)} → ${shape}`;
}
