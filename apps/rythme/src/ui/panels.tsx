// ─────────────────────────────────────────────────────────────
// ui/panels — mixer, generate, markers, files, history, properties
// ─────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, I, ScrubbyNumber, Select, Slider } from "@monet-ui/monet-react";
import {
  addBus,
  addBusSend,
  addMarker,
  addTrackSend,
  addTrack,
  activeVideoClipAt,
  applyProjectKeyboardShortcutPreset,
  clipById,
  deleteProjectKeyboardShortcutPreset,
  MASTER_BUS_ID,
  normalizePanelPreferences,
  normalizeShortcutKey,
  Ops,
  removeProjectKeyboardShortcut,
  removeBus,
  removeBusSend,
  removeMarker,
  removeTrack,
  removeTrackSend,
  renameMarker,
  setBusAutomationMode,
  setBusOutput,
  setBusSendEnabled,
  setBusSendGainAutomationPoint,
  setBusSendPanAutomationPoint,
  setBusSendPreFader,
  setClipFadesCmd,
  setMasterAutomationMode,
  setProjectAudioHardware,
  setProjectEditorPreferences,
  setProjectKeyboardShortcut,
  setProjectPanelPreferences,
  saveProjectKeyboardShortcutPreset,
  setPlayhead,
  setProjectChannelCount,
  setTempo,
  setTrackAudioRole,
  setTrackAutomationMode,
  setTrackInput,
  setTrackOutput,
  setTrackSendEnabled,
  setTrackSendGainAutomationPoint,
  setTrackSendPanAutomationPoint,
  setTrackSendPreFader,
  setTrackSurroundPan,
  setVideoClipLocked,
  updateProjectMeta,
  toggleBusMute,
  toggleBusSolo,
  toggleMute,
  toggleSolo,
  type AutomationMode,
  type AudioRole,
  type DisplayTimeFormat,
  type EditorMode,
  type InputMonitoringMode,
  type KeyboardShortcut,
  type KeyboardShortcutAction,
  type KeyboardShortcutPreset,
  type ToolId,
  type TrackInputChannel,
  videoAssetById,
} from "../engine";
import type { GeneratorId } from "./commands";
import { discoverAudioDevices, emptyAudioDeviceInventory, probeAudioInputCapabilities, type AudioDeviceInventory, type AudioDeviceOption, type AudioInputCapabilities } from "../audio/devices";
import { captureControlSurfaceTrigger, discoverControlSurfaces, emptyControlSurfaceInventory, normalizeControlSurfaceMappings, type ControlSurfaceInventory, type ControlSurfaceMappedAction, type ControlSurfacePort } from "../audio/control-surfaces";
import { useEditorState, useStore } from "../state/store-context";
import { exportDefaultMixdown, exportMixdownAiff, exportPremiereEdl, exportPremiereXml, importAudio, importVideo, importVideoWithAudio, insertGenerated, newSession, openProject, relinkVideoMedia, saveProject, setBusGainFromMixer, setBusPanFromMixer, setBusSendGainFromMixer, setBusSendPanFromMixer, setMasterGainFromMixer, setTrackGainFromMixer, setTrackPanFromMixer, setTrackSendGainFromMixer, setTrackSendPanFromMixer } from "./commands";
import { dbLabel, timecode } from "./format";
import { defaultKeyboardShortcutForAction, deleteGlobalKeyboardShortcutPresetAsync, findKeyboardShortcutConflict, formatKeyboardShortcut, KEYBOARD_SHORTCUT_ACTION_OPTIONS, keyboardShortcutPresetFileName, loadGlobalKeyboardShortcutPresets, loadGlobalKeyboardShortcutPresetsAsync, normalizeEventKey, parseKeyboardShortcutPresetJson, upsertGlobalKeyboardShortcutPresetAsync } from "./keyboard-shortcuts";
import { downloadText, pickFiles } from "./io-web";
import { videoPreviewUrl } from "./video-preview";
import { audioHardwarePreferencesFromSettings, loadAudioHardwarePreferencesAsync, DEFAULT_CONTROL_SURFACE_PREFERENCES, DEFAULT_FILE_BEHAVIOR_PREFERENCES, DEFAULT_WORKSPACE_BEHAVIOR_PREFERENCES, loadControlSurfacePreferencesAsync, loadFileBehaviorPreferencesAsync, loadPanelDefaultPreferencesAsync, loadWorkspaceBehaviorPreferencesAsync, normalizeControlSurfacePreferences, normalizeFileBehaviorPreferences, normalizeWorkspaceBehaviorPreferences, saveAudioHardwarePreferencesAsync, saveControlSurfacePreferencesAsync, saveFileBehaviorPreferencesAsync, savePanelDefaultPreferencesAsync, saveWorkspaceBehaviorPreferencesAsync, type ControlSurfacePreferences, type FileBehaviorPreferences, type WorkspaceBehaviorPreferences } from "./app-preferences";
import { WORKSPACES } from "./workspace-layout";

const accent = "var(--accent-audio)";
const AUTOMATION_MODE_OPTIONS: { value: AutomationMode; label: string }[] = [
  { value: "read", label: "Read" },
  { value: "off", label: "Off" },
  { value: "write", label: "Write" },
  { value: "touch", label: "Touch" },
  { value: "latch", label: "Latch" },
];
const DISPLAY_TIME_OPTIONS: { value: DisplayTimeFormat; label: string }[] = [
  { value: "decimal", label: "Decimal" },
  { value: "smpte30", label: "SMPTE 30" },
  { value: "samples", label: "Samples" },
  { value: "barsBeats", label: "Bars/Beats" },
];
const EDITOR_MODE_OPTIONS: { value: EditorMode; label: string }[] = [
  { value: "multitrack", label: "Multitrack" },
  { value: "waveform", label: "Waveform" },
];
const TOOL_OPTIONS: { value: ToolId; label: string }[] = [
  { value: "select", label: "Select" },
  { value: "razor", label: "Razor" },
  { value: "marquee", label: "Marquee" },
  { value: "envelope", label: "Envelope" },
  { value: "fade", label: "Fade" },
  { value: "marker", label: "Marker" },
  { value: "hand", label: "Hand" },
  { value: "zoom", label: "Zoom" },
];
const FILE_EXPORT_FORMAT_OPTIONS = [
  { value: "wav", label: "WAV" },
  { value: "aiff", label: "AIFF" },
];
const FILE_EXPORT_BIT_DEPTH_OPTIONS = [
  { value: "16", label: "16-bit" },
  { value: "24", label: "24-bit" },
  { value: "32", label: "32-bit" },
];
const WORKSPACE_DEFAULT_OPTIONS = WORKSPACES.map((workspace) => ({ value: workspace.id, label: workspace.label }));
const CONTROL_SURFACE_PROTOCOL_OPTIONS = [
  { value: "genericMidi", label: "Generic MIDI" },
  { value: "mackieControl", label: "Mackie Control" },
  { value: "hui", label: "HUI" },
];
const CONTROL_SURFACE_MAPPING_OPTIONS = [
  { value: "togglePlay", label: "Toggle play" },
  { value: "play", label: "Play" },
  { value: "stop", label: "Stop" },
  { value: "returnToZero", label: "Return" },
  { value: "jog", label: "Jog" },
  { value: "masterGain", label: "Master gain" },
  ...Array.from({ length: 8 }, (_, index) => [
    { value: `trackGain:${index}`, label: `Track ${index + 1} gain` },
    { value: `trackPan:${index}`, label: `Track ${index + 1} pan` },
    { value: `trackMute:${index}`, label: `Track ${index + 1} mute` },
    { value: `trackSolo:${index}`, label: `Track ${index + 1} solo` },
    { value: `trackArm:${index}`, label: `Track ${index + 1} arm` },
  ]).flat(),
];

function automationModeValue(mode: AutomationMode | undefined): AutomationMode {
  return mode ?? "read";
}

function meterWidth(value: number | undefined): string {
  return `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%`;
}

function StripMeter({ meter, accent }: { meter?: Ops.MeterBridgeEntry; accent: string }) {
  const clipped = (meter?.clippedSamples ?? 0) > 0 || (meter?.peak ?? 0) >= 1;
  const hold = meter?.peakHold;
  const holdDb = hold?.peakDb ?? meter?.peakDb ?? -Infinity;
  return (
    <div
      className={`rh-strip-meter ${clipped ? "is-clipping" : ""}`}
      title={`Peak ${dbLabel(meter?.peakDb ?? -Infinity)} · Hold ${dbLabel(holdDb)} · RMS ${dbLabel(meter?.rmsDb ?? -Infinity)}${clipped ? " · clipped" : ""}`}
    >
      <span>PK</span>
      <div className="rh-strip-meter-rail">
        <i style={{ width: meterWidth(meter?.peak), background: clipped ? "oklch(0.68 0.22 28)" : accent }} />
        <b style={{ width: meterWidth(meter?.rms) }} />
        <em style={{ left: meterWidth(hold?.peak ?? meter?.peak) }} />
      </div>
      <span>{dbLabel(holdDb)}</span>
    </div>
  );
}

function MiniTapMeter({ meter, accent }: { meter?: Ops.MeterBridgeEntry; accent: string }) {
  const clipped = (meter?.clippedSamples ?? 0) > 0 || (meter?.peak ?? 0) >= 1;
  return (
    <div
      className={`rh-send-meter ${clipped ? "is-clipping" : ""}`}
      title={`Send tap peak ${dbLabel(meter?.peakDb ?? -Infinity)} · RMS ${dbLabel(meter?.rmsDb ?? -Infinity)}`}
    >
      <i style={{ width: meterWidth(meter?.peak), background: clipped ? "oklch(0.68 0.22 28)" : accent }} />
      <b style={{ width: meterWidth(meter?.rms) }} />
    </div>
  );
}

// ── Mixer ────────────────────────────────────────────────────────────────────
export function MixerPanel() {
  const store = useStore();
  const st = useEditorState();
  const normToDb = (n: number) => n * 72 - 60;
  const dbToNorm = (db: number) => (db + 60) / 72;
  const buses = st.project.buses ?? [];
  const rawMeters = useMemo(
    () => Ops.measureMeterBridge(st.project, { atSec: st.transport.playhead, windowSec: 0.25 }),
    [st.project, st.transport.playhead],
  );
  const meterHoldRef = useRef<Ops.MeterBridgeSnapshot | null>(null);
  const meters = useMemo(() => {
    const held = Ops.applyMeterBridgePeakHold(rawMeters, meterHoldRef.current, { holdMs: rawMeters.meterPeakHoldMs });
    meterHoldRef.current = held;
    return held;
  }, [rawMeters]);
  const trackMeters = new Map(meters.tracks.map((meter) => [meter.id, meter]));
  const busMeters = new Map(meters.buses.map((meter) => [meter.id, meter]));
  const tapMeters = new Map(meters.taps.map((meter) => [meter.id, meter]));
  const routeOptions = [
    { value: MASTER_BUS_ID, label: "Master" },
    ...buses.map((b) => ({ value: b.id, label: b.name })),
  ];
  const busName = (id: string) => (id === MASTER_BUS_ID ? "Master" : buses.find((b) => b.id === id)?.name ?? id);
  const writeTrackSendAutomation = (trackId: string, sendId: string, target: "gain" | "pan", value: number) => {
    const command = target === "gain"
      ? setTrackSendGainAutomationPoint(trackId, sendId, st.transport.playhead, value)
      : setTrackSendPanAutomationPoint(trackId, sendId, st.transport.playhead, value);
    store.dispatch(command, { label: target === "gain" ? "Write send gain automation" : "Write send pan automation" });
  };
  const writeBusSendAutomation = (busId: string, sendId: string, target: "gain" | "pan", value: number) => {
    const command = target === "gain"
      ? setBusSendGainAutomationPoint(busId, sendId, st.transport.playhead, value)
      : setBusSendPanAutomationPoint(busId, sendId, st.transport.playhead, value);
    store.dispatch(command, { label: target === "gain" ? "Write bus send gain automation" : "Write bus send pan automation" });
  };
  return (
    <div className="rh-mixer">
      <div className="rh-mixer-toolbar">
        <Button size="sm" iconStart={I.plus} onClick={() => store.dispatch(addBus(), { label: "Add bus" })}>Bus</Button>
        <span>{buses.length} bus{buses.length === 1 ? "" : "es"}</span>
      </div>
      {st.project.tracks.map((t) => {
        const availableSends = buses.filter((b) => !(t.sends ?? []).some((send) => send.targetBusId === b.id));
        return (
          <div key={t.id} className={`rh-strip ${t.id === st.activeTrackId ? "is-active" : ""}`}>
            <div className="rh-strip-name" style={{ color: t.color }} title={t.name}>{t.name}</div>
            <div className="rh-strip-btns">
              <button className={`rh-msr ${t.mute ? "is-mute" : ""}`} onClick={() => store.dispatch(toggleMute(t.id), { label: "Mute" })}>M</button>
              <button className={`rh-msr ${t.solo ? "is-solo" : ""}`} onClick={() => store.dispatch(toggleSolo(t.id), { label: "Solo" })}>S</button>
            </div>
            <div className="rh-strip-pan">
              <span className="rh-mini-lbl">PAN</span>
              <Slider value={(t.pan + 1) / 2} accent={t.color} onChange={(v) => setTrackPanFromMixer(store, t.id, v * 2 - 1)} />
            </div>
            <div className="rh-strip-fader">
              <Slider value={dbToNorm(t.gainDb)} accent={t.color} onChange={(v) => setTrackGainFromMixer(store, t.id, normToDb(v))} />
            </div>
            <div className="rh-strip-db">{dbLabel(t.gainDb)}</div>
            <StripMeter meter={trackMeters.get(t.id)} accent={t.color} />
            <div className="rh-strip-routing has-auto">
              <span className="rh-route-label">AUTO</span>
              <Select
                options={AUTOMATION_MODE_OPTIONS}
                value={automationModeValue(t.automationMode)}
                size="sm"
                block
                onChange={(v) => store.dispatch(setTrackAutomationMode(t.id, v as AutomationMode), { label: "Track automation mode" })}
              />
              <span className="rh-route-label">OUT</span>
              <Select
                options={routeOptions}
                value={t.outputId ?? MASTER_BUS_ID}
                size="sm"
                block
                onChange={(v) => store.dispatch(setTrackOutput(t.id, v), { label: "Track output" })}
              />
              {availableSends.length > 0 ? (
                <Select
                  options={[{ value: "", label: "Add send" }, ...availableSends.map((b) => ({ value: b.id, label: b.name }))]}
                  value=""
                  size="sm"
                  block
                  onChange={(v) => {
                    if (v) store.dispatch(addTrackSend(t.id, v), { label: "Add send" });
                  }}
                />
              ) : (
                <span className="rh-route-muted">No send target</span>
              )}
            </div>
            {(t.sends ?? []).length > 0 && (
              <div className="rh-send-list">
                {(t.sends ?? []).map((send) => (
                  <div key={send.id} className={`rh-send-row ${send.enabled ? "" : "is-disabled"}`} data-send-id={send.id}>
                    <button
                      className={`rh-send-toggle ${send.enabled ? "is-on" : ""}`}
                      onClick={() => store.dispatch(setTrackSendEnabled(t.id, send.id, !send.enabled), { label: "Send" })}
                    >
                      {send.enabled ? "On" : "Off"}
                    </button>
                    <button
                      className="rh-send-toggle"
                      onClick={() => store.dispatch(setTrackSendPreFader(t.id, send.id, !send.preFader), { label: "Send tap" })}
                    >
                      {send.preFader ? "Pre" : "Post"}
                    </button>
                    <span className="rh-send-name" title={busName(send.targetBusId)}>{busName(send.targetBusId)}</span>
                    <MiniTapMeter meter={tapMeters.get(Ops.meterTapId("track", t.id, "send", send.id))} accent={t.color} />
                    <ScrubbyNumber
                      value={send.gainDb}
                      min={-60}
                      max={12}
                      step={0.5}
                      suffix="dB"
                      accent={t.color}
                      onChange={(v) => setTrackSendGainFromMixer(store, t.id, send.id, v)}
                    />
                    <ScrubbyNumber
                      value={send.pan}
                      min={-1}
                      max={1}
                      step={0.05}
                      precision={2}
                      accent={t.color}
                      onChange={(v) => setTrackSendPanFromMixer(store, t.id, send.id, v)}
                    />
                    <div className="rh-send-auto">
                      <button title="Write send gain automation" data-action="write-send-gain-automation" onClick={() => writeTrackSendAutomation(t.id, send.id, "gain", send.gainDb)}>
                        G
                      </button>
                      <button title="Write send pan automation" data-action="write-send-pan-automation" onClick={() => writeTrackSendAutomation(t.id, send.id, "pan", send.pan)}>
                        P
                      </button>
                    </div>
                    <button className="rh-send-remove" title="Remove send" onClick={() => store.dispatch(removeTrackSend(t.id, send.id), { label: "Remove send" })}>
                      <Icon d={I.minus} size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {buses.map((bus) => {
        const availableBusSends = buses.filter((item) => item.id !== bus.id && !(bus.sends ?? []).some((send) => send.targetBusId === item.id));
        return (
          <div key={bus.id} className="rh-strip is-bus">
            <div className="rh-strip-name" style={{ color: bus.color }} title={bus.name}>{bus.name}</div>
            <div className="rh-strip-btns">
              <button className={`rh-msr ${bus.mute ? "is-mute" : ""}`} onClick={() => store.dispatch(toggleBusMute(bus.id), { label: "Bus mute" })}>M</button>
              <button className={`rh-msr ${bus.solo ? "is-solo" : ""}`} onClick={() => store.dispatch(toggleBusSolo(bus.id), { label: "Bus solo" })}>S</button>
              <button className="rh-msr" title="Remove bus" onClick={() => store.dispatch(removeBus(bus.id), { label: "Remove bus" })}>
                <Icon d={I.minus} size={10} />
              </button>
            </div>
            <div className="rh-strip-pan">
              <span className="rh-mini-lbl">PAN</span>
              <Slider value={(bus.pan + 1) / 2} accent={bus.color} onChange={(v) => setBusPanFromMixer(store, bus.id, v * 2 - 1)} />
            </div>
            <div className="rh-strip-fader">
              <Slider value={dbToNorm(bus.gainDb)} accent={bus.color} onChange={(v) => setBusGainFromMixer(store, bus.id, normToDb(v))} />
            </div>
            <div className="rh-strip-db">{dbLabel(bus.gainDb)}</div>
            <StripMeter meter={busMeters.get(bus.id)} accent={bus.color} />
            <div className="rh-strip-routing has-auto">
              <span className="rh-route-label">AUTO</span>
              <Select
                options={AUTOMATION_MODE_OPTIONS}
                value={automationModeValue(bus.automationMode)}
                size="sm"
                block
                onChange={(v) => store.dispatch(setBusAutomationMode(bus.id, v as AutomationMode), { label: "Bus automation mode" })}
              />
              <span className="rh-route-label">OUT</span>
              <Select
                options={routeOptions.filter((option) => option.value !== bus.id)}
                value={bus.outputId ?? MASTER_BUS_ID}
                size="sm"
                block
                onChange={(v) => store.dispatch(setBusOutput(bus.id, v), { label: "Bus output" })}
              />
              {availableBusSends.length > 0 ? (
                <Select
                  options={[{ value: "", label: "Add send" }, ...availableBusSends.map((item) => ({ value: item.id, label: item.name }))]}
                  value=""
                  size="sm"
                  block
                  onChange={(v) => {
                    if (v) store.dispatch(addBusSend(bus.id, v), { label: "Add bus send" });
                  }}
                />
              ) : (
                <span className="rh-route-muted">No bus send target</span>
              )}
            </div>
            {(bus.sends ?? []).length > 0 && (
              <div className="rh-send-list">
                {(bus.sends ?? []).map((send) => (
                  <div key={send.id} className={`rh-send-row ${send.enabled ? "" : "is-disabled"}`} data-bus-send-id={send.id}>
                    <button
                      className={`rh-send-toggle ${send.enabled ? "is-on" : ""}`}
                      onClick={() => store.dispatch(setBusSendEnabled(bus.id, send.id, !send.enabled), { label: "Bus send" })}
                    >
                      {send.enabled ? "On" : "Off"}
                    </button>
                    <button
                      className="rh-send-toggle"
                      onClick={() => store.dispatch(setBusSendPreFader(bus.id, send.id, !send.preFader), { label: "Bus send tap" })}
                    >
                      {send.preFader ? "Pre" : "Post"}
                    </button>
                    <span className="rh-send-name" title={busName(send.targetBusId)}>{busName(send.targetBusId)}</span>
                    <MiniTapMeter meter={tapMeters.get(Ops.meterTapId("bus", bus.id, "send", send.id))} accent={bus.color} />
                    <ScrubbyNumber
                      value={send.gainDb}
                      min={-60}
                      max={12}
                      step={0.5}
                      suffix="dB"
                      accent={bus.color}
                      onChange={(v) => setBusSendGainFromMixer(store, bus.id, send.id, v)}
                    />
                    <ScrubbyNumber
                      value={send.pan}
                      min={-1}
                      max={1}
                      step={0.05}
                      precision={2}
                      accent={bus.color}
                      onChange={(v) => setBusSendPanFromMixer(store, bus.id, send.id, v)}
                    />
                    <div className="rh-send-auto">
                      <button title="Write bus send gain automation" data-action="write-bus-send-gain-automation" onClick={() => writeBusSendAutomation(bus.id, send.id, "gain", send.gainDb)}>
                        G
                      </button>
                      <button title="Write bus send pan automation" data-action="write-bus-send-pan-automation" onClick={() => writeBusSendAutomation(bus.id, send.id, "pan", send.pan)}>
                        P
                      </button>
                    </div>
                    <button className="rh-send-remove" title="Remove bus send" onClick={() => store.dispatch(removeBusSend(bus.id, send.id), { label: "Remove bus send" })}>
                      <Icon d={I.minus} size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="rh-strip is-master">
        <div className="rh-strip-name" style={{ color: "#fff" }}>MASTER</div>
        <div className="rh-strip-btns" />
        <div className="rh-strip-pan" />
        <div className="rh-strip-fader">
          <Slider value={dbToNorm(st.project.masterGainDb)} accent="#fff" onChange={(v) => setMasterGainFromMixer(store, normToDb(v))} />
        </div>
        <div className="rh-strip-db">{dbLabel(st.project.masterGainDb)}</div>
        <StripMeter meter={meters.master} accent="#fff" />
        <div className="rh-strip-routing is-master-auto">
          <span className="rh-route-label">AUTO</span>
          <Select
            options={AUTOMATION_MODE_OPTIONS}
            value={automationModeValue(st.project.masterAutomationMode)}
            size="sm"
            block
            onChange={(v) => store.dispatch(setMasterAutomationMode(v as AutomationMode), { label: "Master automation mode" })}
          />
        </div>
      </div>
    </div>
  );
}

// ── Generate ─────────────────────────────────────────────────────────────────
const GENERATORS: { id: GeneratorId; label: string }[] = [
  { id: "sine", label: "Sine" },
  { id: "square", label: "Square" },
  { id: "sawtooth", label: "Saw" },
  { id: "triangle", label: "Triangle" },
  { id: "white", label: "White Noise" },
  { id: "pink", label: "Pink Noise" },
  { id: "brown", label: "Brown Noise" },
  { id: "chirp", label: "Chirp Sweep" },
  { id: "silence", label: "Silence" },
];

export function GeneratePanel() {
  const store = useStore();
  const st = useEditorState();
  void st;
  const params = useGenParams();
  return (
    <div className="rh-panel">
      <div className="monet-section-label">Parameters</div>
      <PropRow label="Frequency">
        <ScrubbyNumber value={params.freq} min={20} max={20000} step={1} suffix="Hz" accent={accent} onChange={params.setFreq} />
      </PropRow>
      <PropRow label="Length">
        <ScrubbyNumber value={params.seconds} min={0.1} max={60} step={0.1} precision={2} suffix="s" accent={accent} onChange={params.setSeconds} />
      </PropRow>
      <PropRow label="Amplitude">
        <ScrubbyNumber value={params.amplitude} min={0} max={1} step={0.01} precision={2} accent={accent} onChange={params.setAmplitude} />
      </PropRow>
      <div className="monet-section-label" style={{ marginTop: 10 }}>Insert at playhead</div>
      <div className="rh-btn-grid">
        {GENERATORS.map((g) => (
          <Button key={g.id} size="sm" onClick={() => insertGenerated(store, g.id, params.values())}>{g.label}</Button>
        ))}
      </div>
    </div>
  );
}

function useGenParams() {
  const [freq, setFreq] = useState(440);
  const [seconds, setSeconds] = useState(2);
  const [amplitude, setAmplitude] = useState(0.7);
  return { freq, setFreq, seconds, setSeconds, amplitude, setAmplitude, values: () => ({ freq, seconds, amplitude }) };
}

// ── Markers ──────────────────────────────────────────────────────────────────
export function MarkersPanel() {
  const store = useStore();
  const st = useEditorState();
  const markers = [...st.project.markers].sort((a, b) => a.time - b.time);
  return (
    <div className="rh-panel">
      <div className="rh-row-actions">
        <Button size="sm" iconStart={I.plus} onClick={() => store.dispatch(addMarker({ time: st.transport.playhead, name: `Marker ${markers.length + 1}` }), { label: "Add marker" })}>
          Add at playhead
        </Button>
      </div>
      {markers.length === 0 && <div className="rh-empty">No markers</div>}
      {markers.map((m) => (
        <div key={m.id} className="monet-row" style={{ height: 28 }}>
          <span style={{ width: 10, height: 10, background: m.color, clipPath: "polygon(50% 0,100% 50%,50% 100%,0 50%)" }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, cursor: "pointer" }} onClick={() => store.dispatch(setPlayhead(m.time), { history: false })}>{timecode(m.time)}</span>
          <input
            className="rh-inline-input"
            value={m.name}
            onChange={(e) => store.dispatch(renameMarker(m.id, e.target.value), { label: "Rename marker" })}
            style={{ flex: 1 }}
          />
          <span className="monet-iconbtn" title="Delete" onClick={() => store.dispatch(removeMarker(m.id), { label: "Remove marker" })}>
            <Icon d={I.minus} size={11} />
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Files ────────────────────────────────────────────────────────────────────
export function FilesPanel() {
  const store = useStore();
  const st = useEditorState();
  return (
    <div className="rh-panel">
      <div className="monet-section-label">Session</div>
      <div className="rh-btn-grid">
        <Button size="sm" onClick={() => void newSession(store)}>New</Button>
        <Button size="sm" onClick={() => void openProject(store)}>Open…</Button>
        <Button size="sm" onClick={() => saveProject(store)}>Save</Button>
        <Button size="sm" onClick={() => void importAudio(store)}>Import Audio…</Button>
        <Button size="sm" data-action="import-video" onClick={() => void importVideo(store)}>Import Video…</Button>
        <Button size="sm" data-action="import-video-audio" onClick={() => void importVideoWithAudio(store)}>Import Video + Audio…</Button>
        <Button size="sm" variant="primary" onClick={() => void exportDefaultMixdown(store)}>Export Mix (Default)</Button>
        <Button size="sm" onClick={() => exportMixdownAiff(store)}>Export Mix (AIFF)</Button>
        <Button size="sm" onClick={() => exportPremiereXml(store)}>Premiere XML</Button>
        <Button size="sm" onClick={() => exportPremiereEdl(store)}>EDL</Button>
        <Button size="sm" onClick={() => store.dispatch(addTrack())}>Add Track</Button>
      </div>
      <div className="monet-section-label" style={{ marginTop: 10 }}>Tracks &amp; clips</div>
      {(st.project.videoTracks ?? []).map((t) => (
        <div key={t.id} className="rh-file-track">
          <div className="monet-row" style={{ height: 24 }}>
            <span className="rh-dot" style={{ background: t.color }} />
            <span style={{ flex: 1, fontSize: 11 }}>{t.name}</span>
            <span style={{ color: "var(--text-3)", fontSize: 10 }}>VIDEO</span>
          </div>
          {t.clips.map((c) => (
            <div key={c.id} className="rh-file-clip">
              <Icon d="M3 4 H13 V12 H3 Z M5 6 L10 8 L5 10 Z" size={11} />
              <span style={{ flex: 1 }}>{c.name}</span>
              <span style={{ color: "var(--text-3)" }}>{c.duration.toFixed(2)}s</span>
            </div>
          ))}
        </div>
      ))}
      {st.project.tracks.map((t) => (
        <div key={t.id} className="rh-file-track">
          <div className="monet-row" style={{ height: 24 }}>
            <span className="rh-dot" style={{ background: t.color }} />
            <span style={{ flex: 1, fontSize: 11 }}>{t.name}</span>
            <span className="monet-iconbtn" title="Remove track" onClick={() => store.dispatch(removeTrack(t.id), { label: "Remove track" })}>
              <Icon d={I.minus} size={11} />
            </span>
          </div>
          {t.clips.map((c) => (
            <div key={c.id} className="rh-file-clip">
              <Icon d="M2 7 L4 4 L6 10 L8 3 L10 11 L12 6 L14 9" size={11} />
              <span style={{ flex: 1 }}>{c.name}</span>
              <span style={{ color: "var(--text-3)" }}>{c.duration.toFixed(2)}s</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function VideoPanel() {
  const st = useEditorState();
  const store = useStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const active = activeVideoClipAt(st.project, st.transport.playhead);
  const fallbackClip = st.project.videoTracks?.find((t) => t.visible !== false && t.clips.length > 0)?.clips[0];
  const clip = active?.clip ?? fallbackClip;
  const track = active?.track ?? st.project.videoTracks?.find((t) => t.clips.some((c) => c.id === clip?.id));
  const asset = active?.asset ?? videoAssetById(st.project, clip?.assetId ?? "");
  const url = videoPreviewUrl(asset?.id);
  const targetTime = clip ? Math.max(0, Math.min(clip.duration, st.transport.playhead - clip.start) + clip.inPoint) : 0;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url || !clip) return;
    if (Math.abs(el.currentTime - targetTime) > 0.1) el.currentTime = targetTime;
    if (st.transport.playing) {
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, [clip, st.transport.playing, targetTime, url]);

  return (
    <div className="rh-panel" data-action="video-panel">
      <div className="monet-section-label">Video</div>
      {!clip || !asset ? (
        <div className="rh-empty">No video reference</div>
      ) : (
        <>
          <div className="rh-row-actions" style={{ marginBottom: 8 }}>
            <Button size="sm" data-action="relink-video" onClick={() => void relinkVideoMedia(store, asset.id)}>Relink Media…</Button>
            <Button
              size="sm"
              data-action="toggle-picture-lock"
              onClick={() => store.dispatch(setVideoClipLocked(clip.id, !(clip.locked ?? false)), { label: clip.locked ? "Unlock picture" : "Lock picture" })}
            >
              {clip.locked ? "Unlock Picture" : "Lock Picture"}
            </Button>
          </div>
          <div
            style={{
              aspectRatio: asset.width && asset.height ? `${asset.width} / ${asset.height}` : "16 / 9",
              background: "rgba(0,0,0,0.45)",
              border: "1px solid var(--stroke-soft)",
              display: "grid",
              placeItems: "center",
              overflow: "hidden",
            }}
          >
            {url ? (
              <video
                ref={videoRef}
                src={url}
                controls
                muted
                data-action="video-preview-player"
                style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
              />
            ) : (
              <div className="rh-empty">Preview media not linked</div>
            )}
          </div>
          <PropRow label="Clip">{clip.name}</PropRow>
          <PropRow label="Track">{track?.name ?? "Video"}</PropRow>
          <PropRow label="Start">{timecode(clip.start)}</PropRow>
          <PropRow label="Length">{clip.duration.toFixed(3)}s</PropRow>
          <PropRow label="Picture Lock">{clip.locked ? "Locked" : "Unlocked"}</PropRow>
          <PropRow label="Asset">{asset.name}</PropRow>
          <PropRow label="Format">
            {[asset.width && asset.height ? `${asset.width}x${asset.height}` : null, asset.frameRate ? `${asset.frameRate} fps` : null]
              .filter(Boolean)
              .join(" · ") || "Reference"}
          </PropRow>
        </>
      )}
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────
export function HistoryPanel() {
  const store = useStore();
  const st = useEditorState();
  void st;
  const labels = store.undoLabels();
  return (
    <div className="rh-panel">
      <div className="rh-row-actions">
        <Button size="sm" disabled={!store.canUndo()} onClick={() => store.undo()} iconStart={I.rewind}>Undo</Button>
        <Button size="sm" disabled={!store.canRedo()} onClick={() => store.redo()}>Redo</Button>
      </div>
      {labels.length === 0 && <div className="rh-empty">Nothing to undo</div>}
      <ol className="rh-history">
        {labels.map((l, i) => (
          <li key={i} className="rh-history-item">{l}</li>
        ))}
      </ol>
    </div>
  );
}

// ── Properties ───────────────────────────────────────────────────────────────
export function PropertiesPanel() {
  const store = useStore();
  const st = useEditorState();
  const id = st.selection.clipIds[0];
  const found = id ? clipById(st.project, id) : undefined;
  const activeTrack = st.project.tracks.find((t) => t.id === st.activeTrackId);
  const hardware = st.project.audioHardware;
  const preferences = st.project.editorPreferences;
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInventory>(() => emptyAudioDeviceInventory());
  const [audioDevicesLoading, setAudioDevicesLoading] = useState(false);
  const [inputCapabilities, setInputCapabilities] = useState<AudioInputCapabilities | null>(null);
  const [inputCapabilitiesLoading, setInputCapabilitiesLoading] = useState(false);
  const [controlSurfaceInventory, setControlSurfaceInventory] = useState<ControlSurfaceInventory>(() => emptyControlSurfaceInventory());
  const [controlSurfaceLoading, setControlSurfaceLoading] = useState(false);
  const [filePreferences, setFilePreferences] = useState<FileBehaviorPreferences>(() => DEFAULT_FILE_BEHAVIOR_PREFERENCES);
  const [workspacePreferences, setWorkspacePreferences] = useState<WorkspaceBehaviorPreferences>(() => DEFAULT_WORKSPACE_BEHAVIOR_PREFERENCES);
  const [controlSurfacePreferences, setControlSurfacePreferences] = useState<ControlSurfacePreferences>(() => DEFAULT_CONTROL_SURFACE_PREFERENCES);
  const [controlSurfaceLearnTarget, setControlSurfaceLearnTarget] = useState("togglePlay");
  const [controlSurfaceLearning, setControlSurfaceLearning] = useState(false);

  useEffect(() => {
    let active = true;
    setAudioDevicesLoading(true);
    discoverAudioDevices()
      .then((devices) => {
        if (active) setAudioDevices(devices);
      })
      .finally(() => {
        if (active) setAudioDevicesLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setControlSurfaceLoading(true);
    discoverControlSurfaces()
      .then((inventory) => {
        if (active) setControlSurfaceInventory(inventory);
      })
      .finally(() => {
        if (active) setControlSurfaceLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void loadFileBehaviorPreferencesAsync().then((preferences) => {
      if (active) setFilePreferences(preferences);
    });
    void loadWorkspaceBehaviorPreferencesAsync().then((preferences) => {
      if (active) setWorkspacePreferences(preferences);
    });
    void loadControlSurfacePreferencesAsync().then((preferences) => {
      if (active) setControlSurfacePreferences(preferences);
    });
    return () => { active = false; };
  }, []);

  const refreshAudioDevices = (requestPermission = false) => {
    setAudioDevicesLoading(true);
    discoverAudioDevices({ requestPermission })
      .then(setAudioDevices)
      .finally(() => setAudioDevicesLoading(false));
  };

  useEffect(() => {
    setInputCapabilities(null);
  }, [hardware?.inputDeviceId]);

  const probeSelectedInputCapabilities = () => {
    setInputCapabilitiesLoading(true);
    probeAudioInputCapabilities(hardware?.inputDeviceId)
      .then(setInputCapabilities)
      .finally(() => setInputCapabilitiesLoading(false));
  };

  const updateFilePreferences = (patch: Partial<FileBehaviorPreferences>) => {
    const next = normalizeFileBehaviorPreferences({ ...filePreferences, ...patch });
    setFilePreferences(next);
    void saveFileBehaviorPreferencesAsync(next).then((saved) => {
      if (saved) setFilePreferences(saved);
    });
  };

  const updateWorkspacePreferences = (patch: Partial<WorkspaceBehaviorPreferences>) => {
    const next = normalizeWorkspaceBehaviorPreferences({ ...workspacePreferences, ...patch });
    setWorkspacePreferences(next);
    void saveWorkspaceBehaviorPreferencesAsync(next).then((saved) => {
      if (saved) setWorkspacePreferences(saved);
    });
  };

  const refreshControlSurfaces = (requestPermission = false) => {
    setControlSurfaceLoading(true);
    discoverControlSurfaces({ requestPermission })
      .then(setControlSurfaceInventory)
      .finally(() => setControlSurfaceLoading(false));
  };

  const updateControlSurfacePreferences = (patch: Partial<ControlSurfacePreferences>) => {
    const next = normalizeControlSurfacePreferences({ ...controlSurfacePreferences, ...patch });
    setControlSurfacePreferences(next);
    void saveControlSurfacePreferencesAsync(next).then((saved) => {
      if (saved) setControlSurfacePreferences(saved);
    });
  };

  const learnControlSurfaceMapping = () => {
    if (!controlSurfacePreferences.inputId || controlSurfaceLearning) return;
    setControlSurfaceLearning(true);
    captureControlSurfaceTrigger({ inputId: controlSurfacePreferences.inputId })
      .then((trigger) => {
        if (!trigger) return;
        const action = controlSurfaceMappedActionFromValue(controlSurfaceLearnTarget);
        const mappings = normalizeControlSurfaceMappings([
          ...controlSurfacePreferences.mappings,
          { label: controlSurfaceMappingLabel(action), trigger, action },
        ]);
        updateControlSurfacePreferences({ mappings });
      })
      .catch(() => undefined)
      .finally(() => setControlSurfaceLearning(false));
  };

  const savePanelDefaults = () => {
    void savePanelDefaultPreferencesAsync(normalizePanelPreferences(st.project.panelPreferences, st.project.sampleRate));
  };

  const applyPanelDefaults = () => {
    void loadPanelDefaultPreferencesAsync().then((defaults) => {
      store.dispatch(setProjectPanelPreferences(normalizePanelPreferences(defaults, st.project.sampleRate)), { history: false, dirty: true, label: "Panel defaults" });
    });
  };

  const saveHardwareDefaults = () => {
    void saveAudioHardwarePreferencesAsync(audioHardwarePreferencesFromSettings(hardware));
  };

  const applyHardwareDefaults = () => {
    void loadAudioHardwarePreferencesAsync().then((defaults) => {
      store.dispatch(setProjectAudioHardware(defaults), { history: false, dirty: true, label: "Audio hardware defaults" });
    });
  };

  const inputDeviceOptions = audioDeviceSelectOptions(audioDevices.inputs, "System input", hardware?.inputDeviceId);
  const outputDeviceOptions = audioDeviceSelectOptions(audioDevices.outputs, "System output", hardware?.outputDeviceId);
  const trackInputDeviceOptions = audioDeviceSelectOptions(audioDevices.inputs, "Session input", activeTrack?.input?.deviceId);
  const controlInputOptions = controlSurfaceSelectOptions(controlSurfaceInventory.inputs, "No MIDI input", controlSurfacePreferences.inputId);
  const controlOutputOptions = controlSurfaceSelectOptions(controlSurfaceInventory.outputs, "No MIDI output", controlSurfacePreferences.outputId);
  if (!found) {
    return (
      <div className="rh-panel">
        {st.selection.range ? (
          <>
            <div className="monet-section-label">Time selection</div>
            <PropRow label="Start">{timecode(st.selection.range.start)}</PropRow>
            <PropRow label="End">{timecode(st.selection.range.end)}</PropRow>
            <PropRow label="Length">{(st.selection.range.end - st.selection.range.start).toFixed(3)}s</PropRow>
            <div className="monet-section-label" style={{ marginTop: 10 }}>Tempo</div>
            <PropRow label="BPM">
              <ScrubbyNumber value={st.project.tempo} min={20} max={400} step={1} accent={accent} onChange={(v) => store.dispatch(setTempo(v), { coalesceKey: "tempo", label: "Tempo" })} />
            </PropRow>
          </>
        ) : (
          <>
            <div className="monet-section-label">Session format</div>
            <PropRow label="Channels">
              <ScrubbyNumber value={st.project.channelCount} min={1} max={8} step={1} precision={0} accent={accent} onChange={(v) => store.dispatch(setProjectChannelCount(v), { coalesceKey: "channels", label: "Channels" })} />
            </PropRow>
            <div className="monet-section-label" style={{ marginTop: 10 }}>Editor Preferences</div>
            <PropRow label="Time">
              <Select
                options={DISPLAY_TIME_OPTIONS}
                value={preferences?.displayTimeFormat ?? "decimal"}
                block
                onChange={(v) => store.dispatch(setProjectEditorPreferences({ displayTimeFormat: v as DisplayTimeFormat }), { history: false, dirty: true, label: "Display time format" })}
              />
            </PropRow>
            <PropRow label="Mode">
              <Select
                options={EDITOR_MODE_OPTIONS}
                value={preferences?.editorMode ?? st.mode}
                block
                onChange={(v) => store.dispatch(setProjectEditorPreferences({ editorMode: v as EditorMode }), { history: false, dirty: true, label: "Editor mode preference" })}
              />
            </PropRow>
            <PropRow label="Tool">
              <Select
                options={TOOL_OPTIONS}
                value={preferences?.tool ?? st.tool}
                block
                onChange={(v) => store.dispatch(setProjectEditorPreferences({ tool: v as ToolId }), { history: false, dirty: true, label: "Tool preference" })}
              />
            </PropRow>
            <PropRow label="Snap">
              <Select
                options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]}
                value={(preferences?.snap ?? st.view.snap) ? "on" : "off"}
                block
                onChange={(v) => store.dispatch(setProjectEditorPreferences({ snap: v === "on" }), { history: false, dirty: true, label: "Snapping preference" })}
              />
            </PropRow>
            <PropRow label="Spec min">
              <ScrubbyNumber value={preferences?.spectralMinHz ?? 0} min={0} max={st.project.sampleRate / 2} step={10} precision={0} suffix="Hz" accent={accent} onChange={(v) => store.dispatch(setProjectEditorPreferences({ spectralMinHz: v }), { coalesceKey: "pref:spec-min", label: "Spectral min" })} />
            </PropRow>
            <PropRow label="Spec max">
              <ScrubbyNumber value={preferences?.spectralMaxHz ?? st.project.sampleRate / 2} min={1} max={st.project.sampleRate / 2} step={10} precision={0} suffix="Hz" accent={accent} onChange={(v) => store.dispatch(setProjectEditorPreferences({ spectralMaxHz: v }), { coalesceKey: "pref:spec-max", label: "Spectral max" })} />
            </PropRow>
            <div className="monet-section-label" style={{ marginTop: 10 }}>File Preferences</div>
            <PropRow label="Mixdown">
              <Select
                options={FILE_EXPORT_FORMAT_OPTIONS}
                value={filePreferences.exportFormat}
                block
                onChange={(v) => updateFilePreferences({ exportFormat: v as FileBehaviorPreferences["exportFormat"] })}
              />
            </PropRow>
            <PropRow label="Bit depth">
              <Select
                options={FILE_EXPORT_BIT_DEPTH_OPTIONS}
                value={String(filePreferences.exportBitDepth)}
                block
                onChange={(v) => updateFilePreferences({ exportBitDepth: Number(v) as FileBehaviorPreferences["exportBitDepth"] })}
              />
            </PropRow>
            <PropRow label="32f WAV">
              <Select
                options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]}
                value={filePreferences.exportFloat ? "on" : "off"}
                block
                onChange={(v) => updateFilePreferences(v === "on" ? { exportFormat: "wav", exportBitDepth: 32, exportFloat: true } : { exportFloat: false })}
              />
            </PropRow>
            <div className="monet-section-label" style={{ marginTop: 10 }}>App Defaults</div>
            <PropRow label="Workspace">
              <Select
                options={WORKSPACE_DEFAULT_OPTIONS}
                value={workspacePreferences.defaultWorkspaceId}
                block
                onChange={(v) => updateWorkspacePreferences({ defaultWorkspaceId: v as WorkspaceBehaviorPreferences["defaultWorkspaceId"] })}
              />
            </PropRow>
            <PropRow label="New mode">
              <Select
                options={EDITOR_MODE_OPTIONS}
                value={workspacePreferences.defaultEditorMode}
                block
                onChange={(v) => updateWorkspacePreferences({ defaultEditorMode: v as EditorMode })}
              />
            </PropRow>
            <PropRow label="New tool">
              <Select
                options={TOOL_OPTIONS}
                value={workspacePreferences.defaultTool}
                block
                onChange={(v) => updateWorkspacePreferences({ defaultTool: v as ToolId })}
              />
            </PropRow>
            <PropRow label="New snap">
              <Select
                options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]}
                value={workspacePreferences.defaultSnap ? "on" : "off"}
                block
                onChange={(v) => updateWorkspacePreferences({ defaultSnap: v === "on" })}
              />
            </PropRow>
            <PropRow label="New time">
              <Select
                options={DISPLAY_TIME_OPTIONS}
                value={workspacePreferences.defaultDisplayTimeFormat}
                block
                onChange={(v) => updateWorkspacePreferences({ defaultDisplayTimeFormat: v as DisplayTimeFormat })}
              />
            </PropRow>
            <div className="rh-btn-grid">
              <Button size="sm" onClick={savePanelDefaults}>Save Panel Defaults</Button>
              <Button size="sm" onClick={applyPanelDefaults}>Apply Panel Defaults</Button>
            </div>
            <div className="monet-section-label" style={{ marginTop: 10 }}>Control Surface</div>
            <PropRow label="Enabled">
              <Select
                options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]}
                value={controlSurfacePreferences.enabled ? "on" : "off"}
                block
                onChange={(v) => updateControlSurfacePreferences({ enabled: v === "on" })}
              />
            </PropRow>
            <PropRow label="Protocol">
              <Select
                options={CONTROL_SURFACE_PROTOCOL_OPTIONS}
                value={controlSurfacePreferences.protocol}
                block
                onChange={(v) => updateControlSurfacePreferences({ protocol: v as ControlSurfacePreferences["protocol"] })}
              />
            </PropRow>
            <PropRow label="MIDI in">
              <Select
                options={controlInputOptions}
                value={controlSurfacePreferences.inputId ?? ""}
                block
                onChange={(v) => updateControlSurfacePreferences({ inputId: v || undefined })}
              />
            </PropRow>
            <PropRow label="MIDI out">
              <Select
                options={controlOutputOptions}
                value={controlSurfacePreferences.outputId ?? ""}
                block
                onChange={(v) => updateControlSurfacePreferences({ outputId: v || undefined })}
              />
            </PropRow>
            <PropRow label="Map to">
              <Select
                options={CONTROL_SURFACE_MAPPING_OPTIONS}
                value={controlSurfaceLearnTarget}
                block
                onChange={setControlSurfaceLearnTarget}
              />
            </PropRow>
            <PropRow label="Maps">
              {controlSurfacePreferences.mappings.length}
            </PropRow>
            <PropRow label="MIDI">
              <span title={controlSurfaceInventory.error ?? undefined}>{controlSurfaceStatus(controlSurfaceInventory, controlSurfaceLoading)}</span>
            </PropRow>
            <div className="rh-btn-grid">
              <Button size="sm" onClick={() => refreshControlSurfaces(false)} disabled={controlSurfaceLoading}>Refresh MIDI</Button>
              <Button size="sm" onClick={() => refreshControlSurfaces(true)} disabled={controlSurfaceLoading || !controlSurfaceInventory.supported}>Authorize MIDI</Button>
              <Button size="sm" onClick={learnControlSurfaceMapping} disabled={controlSurfaceLearning || !controlSurfacePreferences.inputId}>{controlSurfaceLearning ? "Learning" : "Learn MIDI"}</Button>
              <Button size="sm" onClick={() => updateControlSurfacePreferences({ mappings: [] })} disabled={controlSurfacePreferences.mappings.length === 0}>Clear Maps</Button>
            </div>
            <KeyboardShortcutPreferences shortcuts={preferences?.keyboardShortcuts ?? []} presets={preferences?.keyboardShortcutPresets ?? []} />
            <div className="monet-section-label" style={{ marginTop: 10 }}>Audio Hardware</div>
            <PropRow label="Sample rate">
              <ScrubbyNumber value={hardware?.hardwareSampleRate ?? st.project.sampleRate} min={8000} max={192000} step={100} precision={0} suffix="Hz" accent={accent} onChange={(v) => store.dispatch(setProjectAudioHardware({ hardwareSampleRate: v }), { coalesceKey: "hw:sr", label: "Hardware sample rate" })} />
            </PropRow>
            <PropRow label="Input ch">
              <ScrubbyNumber value={hardware?.inputChannels ?? 2} min={1} max={8} step={1} precision={0} accent={accent} onChange={(v) => store.dispatch(setProjectAudioHardware({ inputChannels: v }), { coalesceKey: "hw:ch", label: "Input channels" })} />
            </PropRow>
            <PropRow label="Input">
              <Select
                options={inputDeviceOptions}
                value={hardware?.inputDeviceId ?? ""}
                block
                onChange={(v) => store.dispatch(setProjectAudioHardware({ inputDeviceId: v || undefined }), { label: "Input device" })}
              />
            </PropRow>
            <PropRow label="Output">
              <Select
                options={outputDeviceOptions}
                value={hardware?.outputDeviceId ?? ""}
                block
                onChange={(v) => store.dispatch(setProjectAudioHardware({ outputDeviceId: v || undefined }), { label: "Output device" })}
              />
            </PropRow>
            <PropRow label="Devices">
              <span title={audioDevices.error ?? undefined}>{audioDeviceStatus(audioDevices, audioDevicesLoading)}</span>
            </PropRow>
            <PropRow label="Input caps">
              <span title={inputCapabilities?.error ?? inputCapabilities?.label ?? undefined}>{audioInputCapabilitiesStatus(inputCapabilities, inputCapabilitiesLoading)}</span>
            </PropRow>
            <PropRow label="Monitor">
              <Select
                options={[
                  { value: "off", label: "Off" },
                  { value: "armed", label: "Armed" },
                  { value: "always", label: "Always" },
                ]}
                value={hardware?.inputMonitoring ?? "off"}
                onChange={(v) => store.dispatch(setProjectAudioHardware({ inputMonitoring: v as InputMonitoringMode }), { label: "Input monitoring" })}
              />
            </PropRow>
            <PropRow label="Pre-roll">
              <ScrubbyNumber value={hardware?.preRollSeconds ?? 0} min={0} max={30} step={0.25} precision={2} suffix="s" accent={accent} onChange={(v) => store.dispatch(setProjectAudioHardware({ preRollSeconds: v }), { coalesceKey: "hw:pre", label: "Pre-roll" })} />
            </PropRow>
            <PropRow label="Count-in">
              <ScrubbyNumber value={hardware?.countInBars ?? 0} min={0} max={8} step={1} precision={0} suffix="bars" accent={accent} onChange={(v) => store.dispatch(setProjectAudioHardware({ countInBars: v }), { coalesceKey: "hw:count", label: "Count-in" })} />
            </PropRow>
            <PropRow label="Latency">
              <ScrubbyNumber value={hardware?.latencyCompensationMs ?? 0} min={-1000} max={1000} step={1} precision={0} suffix="ms" accent={accent} onChange={(v) => store.dispatch(setProjectAudioHardware({ latencyCompensationMs: v }), { coalesceKey: "hw:lat", label: "Latency compensation" })} />
            </PropRow>
            <PropRow label="Meter cal">
              <ScrubbyNumber value={hardware?.meterCalibrationDb ?? 0} min={-60} max={60} step={0.5} precision={1} suffix="dB" accent={accent} onChange={(v) => store.dispatch(setProjectAudioHardware({ meterCalibrationDb: v }), { coalesceKey: "hw:meter-cal", label: "Meter calibration" })} />
            </PropRow>
            <PropRow label="Peak hold">
              <ScrubbyNumber value={hardware?.meterPeakHoldMs ?? 1200} min={0} max={10000} step={100} precision={0} suffix="ms" accent={accent} onChange={(v) => store.dispatch(setProjectAudioHardware({ meterPeakHoldMs: v }), { coalesceKey: "hw:meter-hold", label: "Meter peak hold" })} />
            </PropRow>
            <div className="rh-btn-grid">
              <Button size="sm" onClick={saveHardwareDefaults}>Save Defaults</Button>
              <Button size="sm" onClick={applyHardwareDefaults}>Apply Defaults</Button>
              <Button size="sm" onClick={() => refreshAudioDevices(false)} disabled={audioDevicesLoading}>Refresh</Button>
              <Button size="sm" onClick={() => refreshAudioDevices(true)} disabled={audioDevicesLoading || !audioDevices.supported}>Authorize</Button>
              <Button size="sm" onClick={probeSelectedInputCapabilities} disabled={inputCapabilitiesLoading}>Probe input</Button>
              <Button
                size="sm"
                disabled={!st.selection.range}
                onClick={() => {
                  if (st.selection.range) store.dispatch(setProjectAudioHardware({ punchIn: st.selection.range }), { label: "Punch range" });
                }}
              >
                Punch selection
              </Button>
              <Button size="sm" disabled={!hardware?.punchIn} onClick={() => store.dispatch(setProjectAudioHardware({ punchIn: null }), { label: "Clear punch" })}>Clear punch</Button>
            </div>
            {activeTrack && (
              <>
                <div className="monet-section-label" style={{ marginTop: 10 }}>Essential Sound</div>
                <PropRow label="Track">{activeTrack.name}</PropRow>
                <PropRow label="Role">
                  <Select
                    options={[
                      { value: "", label: "None" },
                      { value: "dialogue", label: "Dialogue" },
                      { value: "music", label: "Music" },
                      { value: "sfx", label: "SFX" },
                      { value: "ambience", label: "Ambience" },
                    ]}
                    value={activeTrack.audioRole ?? ""}
                    onChange={(v) => store.dispatch(setTrackAudioRole(activeTrack.id, v ? (v as AudioRole) : null), { label: "Audio role" })}
                  />
                </PropRow>
              </>
            )}
            {activeTrack && (
              <>
                <div className="monet-section-label" style={{ marginTop: 10 }}>Track Input</div>
                <PropRow label="Track">{activeTrack.name}</PropRow>
                <PropRow label="Channel">
                  <Select
                    options={trackInputChannelOptions(hardware?.inputChannels ?? 2, activeTrack.input?.channel)}
                    value={activeTrack.input?.channel ?? "stereo"}
                    onChange={(v) => store.dispatch(setTrackInput(activeTrack.id, { channel: v as TrackInputChannel }), { label: "Track input" })}
                  />
                </PropRow>
                <PropRow label="Device">
                  <Select
                    options={trackInputDeviceOptions}
                    value={activeTrack.input?.deviceId ?? ""}
                    block
                    onChange={(v) => store.dispatch(setTrackInput(activeTrack.id, { deviceId: v || undefined }), { label: "Track input device" })}
                  />
                </PropRow>
                <PropRow label="Monitor">
                  <Select
                    options={[
                      { value: "", label: "Session" },
                      { value: "off", label: "Off" },
                      { value: "armed", label: "Armed" },
                      { value: "always", label: "Always" },
                    ]}
                    value={activeTrack.input?.monitoring ?? ""}
                    onChange={(v) => store.dispatch(setTrackInput(activeTrack.id, v ? { monitoring: v as InputMonitoringMode } : { monitoring: undefined }), { label: "Track monitoring" })}
                  />
                </PropRow>
              </>
            )}
            {activeTrack && st.project.channelCount >= 6 && (
              <>
                <div className="monet-section-label" style={{ marginTop: 10 }}>Surround panner</div>
                <PropRow label="Track">{activeTrack.name}</PropRow>
                <PropRow label="Left/Right">
                  <ScrubbyNumber value={activeTrack.surroundPan?.x ?? 0} min={-1} max={1} step={0.05} precision={2} accent={accent} onChange={(v) => store.dispatch(setTrackSurroundPan(activeTrack.id, { x: v }), { coalesceKey: "surx:" + activeTrack.id, label: "Surround pan" })} />
                </PropRow>
                <PropRow label="Front/Rear">
                  <ScrubbyNumber value={activeTrack.surroundPan?.y ?? 1} min={-1} max={1} step={0.05} precision={2} accent={accent} onChange={(v) => store.dispatch(setTrackSurroundPan(activeTrack.id, { y: v }), { coalesceKey: "sury:" + activeTrack.id, label: "Surround pan" })} />
                </PropRow>
                <PropRow label="Center">
                  <ScrubbyNumber value={activeTrack.surroundPan?.center ?? 0} min={0} max={1} step={0.05} precision={2} accent={accent} onChange={(v) => store.dispatch(setTrackSurroundPan(activeTrack.id, { center: v }), { coalesceKey: "surc:" + activeTrack.id, label: "Surround center" })} />
                </PropRow>
                <PropRow label="LFE">
                  <ScrubbyNumber value={activeTrack.surroundPan?.lfe ?? 0} min={0} max={1} step={0.05} precision={2} accent={accent} onChange={(v) => store.dispatch(setTrackSurroundPan(activeTrack.id, { lfe: v }), { coalesceKey: "surlfe:" + activeTrack.id, label: "Surround LFE" })} />
                </PropRow>
                <PropRow label="Spread">
                  <ScrubbyNumber value={activeTrack.surroundPan?.divergence ?? 1} min={0} max={1} step={0.05} precision={2} accent={accent} onChange={(v) => store.dispatch(setTrackSurroundPan(activeTrack.id, { divergence: v }), { coalesceKey: "surd:" + activeTrack.id, label: "Surround spread" })} />
                </PropRow>
              </>
            )}
            <div className="monet-section-label" style={{ marginTop: 10 }}>Session metadata</div>
            <MetaInput label="Title" value={st.project.meta.title ?? ""} onChange={(value) => store.dispatch(updateProjectMeta({ title: value }), { label: "Metadata" })} />
            <MetaInput label="Artist" value={st.project.meta.artist ?? st.project.meta.author ?? ""} onChange={(value) => store.dispatch(updateProjectMeta({ artist: value, author: value }), { label: "Metadata" })} />
            <MetaInput label="Album" value={st.project.meta.album ?? ""} onChange={(value) => store.dispatch(updateProjectMeta({ album: value }), { label: "Metadata" })} />
            <MetaInput label="Genre" value={st.project.meta.genre ?? ""} onChange={(value) => store.dispatch(updateProjectMeta({ genre: value }), { label: "Metadata" })} />
            <MetaInput label="Comment" value={st.project.meta.comment ?? st.project.meta.description ?? ""} onChange={(value) => store.dispatch(updateProjectMeta({ comment: value, description: value }), { label: "Metadata" })} />
            <MetaInput label="Copyright" value={st.project.meta.copyright ?? ""} onChange={(value) => store.dispatch(updateProjectMeta({ copyright: value }), { label: "Metadata" })} />
            <MetaInput label="Keywords" value={st.project.meta.keywords ?? ""} onChange={(value) => store.dispatch(updateProjectMeta({ keywords: value }), { label: "Metadata" })} />
          </>
        )}
      </div>
    );
  }
  const c = found.clip;
  return (
    <div className="rh-panel">
      <div className="monet-section-label">Clip</div>
      <PropRow label="Name">{c.name}</PropRow>
      <PropRow label="Start">{timecode(c.start)}</PropRow>
      <PropRow label="Length">{c.duration.toFixed(3)}s</PropRow>
      <PropRow label="Gain">
        <ScrubbyNumber value={c.gainDb} min={-60} max={24} step={0.5} suffix="dB" accent={accent} onChange={(v) => setClipGainCmd(store, c.id, v)} />
      </PropRow>
      <PropRow label="Fade In">
        <ScrubbyNumber value={c.fadeIn} min={0} max={c.duration} step={0.01} precision={2} suffix="s" accent={accent} onChange={(v) => store.dispatch(setClipFadesCmd(c.id, { fadeIn: v }), { coalesceKey: "fi:" + c.id, label: "Fade in" })} />
      </PropRow>
      <PropRow label="Fade Out">
        <ScrubbyNumber value={c.fadeOut} min={0} max={c.duration} step={0.01} precision={2} suffix="s" accent={accent} onChange={(v) => store.dispatch(setClipFadesCmd(c.id, { fadeOut: v }), { coalesceKey: "fo:" + c.id, label: "Fade out" })} />
      </PropRow>
      <div className="monet-row" style={{ marginTop: 6 }}>
        <Select
          options={[
            { value: "linear", label: "Linear" },
            { value: "equalPower", label: "Equal Power" },
            { value: "exponential", label: "Exponential" },
            { value: "logarithmic", label: "Logarithmic" },
          ]}
          value={c.fadeInShape}
          onChange={(v) => store.dispatch(setClipFadesCmd(c.id, { fadeInShape: v as never }), { label: "Fade shape" })}
        />
      </div>
    </div>
  );
}

function audioDeviceSelectOptions(devices: AudioDeviceOption[], defaultLabel: string, currentId?: string) {
  const options = [
    { value: "", label: defaultLabel },
    ...devices.map((device) => ({
      value: device.id,
      label: device.isDefault ? `${device.label} (default)` : device.label,
    })),
  ];
  if (currentId && !options.some((option) => option.value === currentId)) {
    options.push({ value: currentId, label: `Saved: ${currentId}` });
  }
  return options;
}

function controlSurfaceSelectOptions(ports: ControlSurfacePort[], defaultLabel: string, currentId?: string) {
  const options = [
    { value: "", label: defaultLabel },
    ...ports.map((port) => ({
      value: port.id,
      label: port.manufacturer ? `${port.name} (${port.manufacturer})` : port.name,
    })),
  ];
  if (currentId && !options.some((option) => option.value === currentId)) {
    options.push({ value: currentId, label: `Saved: ${currentId}` });
  }
  return options;
}

function controlSurfaceMappedActionFromValue(value: string): ControlSurfaceMappedAction {
  const [type, index] = value.split(":");
  if (type === "trackGain" || type === "trackPan" || type === "trackMute" || type === "trackSolo" || type === "trackArm") {
    return { type, trackIndex: Math.max(0, Math.min(63, Number(index) || 0)) };
  }
  if (type === "play" || type === "stop" || type === "togglePlay" || type === "returnToZero" || type === "masterGain" || type === "jog") {
    return type === "jog" ? { type: "jog", sensitivitySeconds: 0.05 } : { type };
  }
  return { type: "togglePlay" };
}

function controlSurfaceMappingLabel(action: ControlSurfaceMappedAction): string {
  switch (action.type) {
    case "trackGain": return `Track ${action.trackIndex + 1} gain`;
    case "trackPan": return `Track ${action.trackIndex + 1} pan`;
    case "trackMute": return `Track ${action.trackIndex + 1} mute`;
    case "trackSolo": return `Track ${action.trackIndex + 1} solo`;
    case "trackArm": return `Track ${action.trackIndex + 1} arm`;
    case "returnToZero": return "Return";
    case "masterGain": return "Master gain";
    case "togglePlay": return "Toggle play";
    default: return action.type[0].toUpperCase() + action.type.slice(1);
  }
}

function trackInputChannelOptions(inputChannels: number, current?: TrackInputChannel) {
  const count = Math.max(1, Math.min(8, Math.round(inputChannels)));
  const options: { value: TrackInputChannel; label: string }[] = [
    { value: "stereo", label: "Stereo pair" },
    { value: "mono", label: "Mono sum" },
    { value: "left", label: "Input 1 left" },
    { value: "right", label: "Input 2 right" },
  ];
  for (let index = 1; index <= count; index++) {
    options.push({ value: `input${index}` as TrackInputChannel, label: `Input ${index}` });
  }
  if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: `Saved: ${current}` });
  return options;
}

function audioDeviceStatus(devices: AudioDeviceInventory, loading: boolean): string {
  if (loading) return "Scanning";
  if (!devices.supported) return "Unavailable";
  if (devices.error) return "Blocked";
  const inputCount = devices.inputs.length;
  const outputCount = devices.outputs.length;
  if (inputCount + outputCount === 0) return "0 found";
  return `${inputCount} in / ${outputCount} out`;
}

function controlSurfaceStatus(inventory: ControlSurfaceInventory, loading: boolean): string {
  if (loading) return "Scanning";
  if (!inventory.supported) return "Unavailable";
  if (inventory.error) return "Blocked";
  const inputCount = inventory.inputs.length;
  const outputCount = inventory.outputs.length;
  if (inputCount + outputCount === 0) return "0 found";
  return `${inputCount} in / ${outputCount} out`;
}

function audioInputCapabilitiesStatus(capabilities: AudioInputCapabilities | null, loading: boolean): string {
  if (loading) return "Probing";
  if (!capabilities) return "Not probed";
  if (!capabilities.supported) return "Unavailable";
  if (capabilities.error) return "Blocked";
  const channelLabel = audioRangeLabel(capabilities.channelCount, "ch");
  const sampleRateLabel = audioRangeLabel(capabilities.sampleRate, "Hz");
  const latencyLabel = audioRangeLabel(capabilities.latency, "ms", 1000);
  return [channelLabel, sampleRateLabel, latencyLabel].filter(Boolean).join(" / ") || "Available";
}

function audioRangeLabel(range: AudioInputCapabilities["sampleRate"], suffix: string, scale = 1): string | undefined {
  const min = typeof range?.min === "number" ? range.min * scale : undefined;
  const max = typeof range?.max === "number" ? range.max * scale : undefined;
  if (min === undefined && max === undefined) return undefined;
  if (min === undefined) return `<= ${formatAudioRangeNumber(max!)} ${suffix}`;
  if (max === undefined) return `>= ${formatAudioRangeNumber(min)} ${suffix}`;
  if (Math.abs(min - max) < 0.001) return `${formatAudioRangeNumber(min)} ${suffix}`;
  return `${formatAudioRangeNumber(min)}-${formatAudioRangeNumber(max)} ${suffix}`;
}

function formatAudioRangeNumber(value: number): string {
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString();
  if (Math.abs(value) >= 10) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function KeyboardShortcutPreferences({ shortcuts, presets }: { shortcuts: KeyboardShortcut[]; presets: KeyboardShortcutPreset[] }) {
  const store = useStore();
  const [action, setAction] = useState<KeyboardShortcutAction>("edit.split");
  const [presetName, setPresetName] = useState("Custom Shortcuts");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [globalPresets, setGlobalPresets] = useState(() => loadGlobalKeyboardShortcutPresets());
  const [selectedGlobalPresetId, setSelectedGlobalPresetId] = useState("");
  const [presetImportStatus, setPresetImportStatus] = useState("");
  const current = shortcuts.find((shortcut) => shortcut.action === action) ?? defaultKeyboardShortcutForAction(action);
  const [key, setKey] = useState(current?.key ?? "");
  const [mod, setMod] = useState(current?.mod === true);
  const [shift, setShift] = useState(current?.shift === true);
  const [alt, setAlt] = useState(current?.alt === true);

  useEffect(() => {
    const next = shortcuts.find((shortcut) => shortcut.action === action) ?? defaultKeyboardShortcutForAction(action);
    setKey(next?.key ?? "");
    setMod(next?.mod === true);
    setShift(next?.shift === true);
    setAlt(next?.alt === true);
  }, [action, shortcuts]);

  useEffect(() => {
    let mounted = true;
    void loadGlobalKeyboardShortcutPresetsAsync().then((next) => {
      if (mounted) setGlobalPresets(next);
    });
    return () => { mounted = false; };
  }, []);

  const normalizedKey = normalizeShortcutKey(key);
  const draft: KeyboardShortcut | null = normalizedKey ? { action, key: normalizedKey, mod, shift, alt } : null;
  const conflict = draft ? findKeyboardShortcutConflict(draft, shortcuts) : null;
  const isCustom = shortcuts.some((shortcut) => shortcut.action === action);
  const conflictLabel = conflict ? KEYBOARD_SHORTCUT_ACTION_OPTIONS.find((option) => option.value === conflict.action)?.label ?? conflict.action : "";
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
  const selectedGlobalPreset = globalPresets.find((preset) => preset.id === selectedGlobalPresetId);
  const presetOptions = [
    { value: "", label: "Select preset" },
    ...presets.map((preset) => ({ value: preset.id, label: preset.name })),
  ];
  const globalPresetOptions = [
    { value: "", label: "Select global preset" },
    ...globalPresets.map((preset) => ({ value: preset.id, label: preset.name })),
  ];

  const captureKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) return;
    event.preventDefault();
    setKey(normalizeEventKey(event.key));
    setMod(event.metaKey || event.ctrlKey);
    setShift(event.shiftKey);
    setAlt(event.altKey);
  };

  const save = () => {
    if (!draft || conflict) return;
    store.dispatch(setProjectKeyboardShortcut(draft), { history: false, dirty: true, label: "Keyboard shortcut" });
  };
  const exportPreset = () => {
    if (!selectedPreset) return;
    downloadText(keyboardShortcutPresetFileName(selectedPreset), JSON.stringify(selectedPreset, null, 2), "application/json");
  };
  const importPreset = async () => {
    const [file] = await pickFiles(".json,.rythme-shortcuts.json,application/json", false);
    if (!file) return;
    const parsed = parseKeyboardShortcutPresetJson(new TextDecoder().decode(file.bytes));
    if (typeof parsed === "string") {
      setPresetImportStatus(parsed);
      return;
    }
    store.dispatch(saveProjectKeyboardShortcutPreset(parsed), { history: false, dirty: true, label: "Shortcut preset" });
    setPresetImportStatus(`Imported ${parsed.name}`);
    if (parsed.id) setSelectedPresetId(parsed.id);
  };
  const saveGlobalPreset = async () => {
    const saved = await upsertGlobalKeyboardShortcutPresetAsync(selectedPreset ?? { name: presetName, shortcuts });
    if (!saved) {
      setPresetImportStatus("Global shortcut presets are unavailable");
      return;
    }
    setGlobalPresets(await loadGlobalKeyboardShortcutPresetsAsync());
    setSelectedGlobalPresetId(saved.id);
    setPresetImportStatus(`Saved global ${saved.name}`);
  };
  const applyGlobalPreset = () => {
    if (!selectedGlobalPreset) return;
    store.dispatch(setProjectEditorPreferences({ keyboardShortcuts: selectedGlobalPreset.shortcuts }), { history: false, dirty: true, label: "Global shortcut preset" });
    setPresetImportStatus(`Applied global ${selectedGlobalPreset.name}`);
  };
  const removeGlobalPreset = async () => {
    if (!selectedGlobalPreset) return;
    setGlobalPresets(await deleteGlobalKeyboardShortcutPresetAsync(selectedGlobalPreset.id));
    setSelectedGlobalPresetId("");
    setPresetImportStatus(`Deleted global ${selectedGlobalPreset.name}`);
  };

  return (
    <>
      <div className="monet-section-label" style={{ marginTop: 10 }}>Keyboard Shortcuts</div>
      <PropRow label="Action">
        <Select options={KEYBOARD_SHORTCUT_ACTION_OPTIONS} value={action} block onChange={(value) => setAction(value as KeyboardShortcutAction)} />
      </PropRow>
      <PropRow label="Key">
        <input
          className="rh-inline-input"
          value={key}
          onChange={(event) => setKey(event.currentTarget.value)}
          onKeyDown={captureKey}
          style={{ width: "100%" }}
        />
      </PropRow>
      <PropRow label="Modifiers">
        <span className="rh-shortcut-mods">
          <label><input type="checkbox" checked={mod} onChange={(event) => setMod(event.currentTarget.checked)} /> Cmd</label>
          <label><input type="checkbox" checked={shift} onChange={(event) => setShift(event.currentTarget.checked)} /> Shift</label>
          <label><input type="checkbox" checked={alt} onChange={(event) => setAlt(event.currentTarget.checked)} /> Alt</label>
        </span>
      </PropRow>
      <PropRow label="Current">{current ? formatKeyboardShortcut(current) : "None"}</PropRow>
      {conflict && <PropRow label="Conflict">{conflictLabel}</PropRow>}
      <div className="rh-row-actions">
        <Button size="sm" disabled={!draft || !!conflict} onClick={save}>Save</Button>
        <Button size="sm" disabled={!isCustom} onClick={() => store.dispatch(removeProjectKeyboardShortcut(action), { history: false, dirty: true, label: "Keyboard shortcut" })}>Reset</Button>
      </div>
      {shortcuts.length > 0 && (
        <div className="rh-shortcut-list">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.action} className="rh-shortcut-row">
              <span>{KEYBOARD_SHORTCUT_ACTION_OPTIONS.find((option) => option.value === shortcut.action)?.label ?? shortcut.action}</span>
              <b>{formatKeyboardShortcut(shortcut)}</b>
            </div>
          ))}
        </div>
      )}
      <PropRow label="Preset">
        <Select options={presetOptions} value={selectedPresetId} block onChange={setSelectedPresetId} />
      </PropRow>
      <PropRow label="Name">
        <input className="rh-inline-input" value={presetName} onChange={(event) => setPresetName(event.currentTarget.value)} style={{ width: "100%" }} />
      </PropRow>
      <div className="rh-row-actions">
        <Button size="sm" disabled={shortcuts.length === 0} onClick={() => store.dispatch(saveProjectKeyboardShortcutPreset({ name: presetName }), { history: false, dirty: true, label: "Shortcut preset" })}>Save preset</Button>
        <Button size="sm" disabled={!selectedPreset} onClick={() => selectedPreset && store.dispatch(applyProjectKeyboardShortcutPreset(selectedPreset.id), { history: false, dirty: true, label: "Shortcut preset" })}>Apply</Button>
        <Button size="sm" disabled={!selectedPreset} onClick={() => selectedPreset && store.dispatch(deleteProjectKeyboardShortcutPreset(selectedPreset.id), { history: false, dirty: true, label: "Shortcut preset" })}>Delete</Button>
        <Button size="sm" disabled={!selectedPreset} onClick={exportPreset}>Export</Button>
        <Button size="sm" onClick={() => void importPreset()}>Import</Button>
      </div>
      <PropRow label="Global">
        <Select options={globalPresetOptions} value={selectedGlobalPresetId} block onChange={setSelectedGlobalPresetId} />
      </PropRow>
      <div className="rh-row-actions">
        <Button size="sm" disabled={shortcuts.length === 0 && !selectedPreset} onClick={() => void saveGlobalPreset()}>Save global</Button>
        <Button size="sm" disabled={!selectedGlobalPreset} onClick={applyGlobalPreset}>Apply global</Button>
        <Button size="sm" disabled={!selectedGlobalPreset} onClick={() => void removeGlobalPreset()}>Delete global</Button>
      </div>
      {presetImportStatus && <PropRow label="Status">{presetImportStatus}</PropRow>}
    </>
  );
}

function MetaInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <PropRow label={label}>
      <input className="rh-inline-input" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }} />
    </PropRow>
  );
}

function setClipGainCmd(store: ReturnType<typeof useStore>, clipId: string, db: number) {
  store.dispatch((s) => ({ ...s, project: Ops.setClipGain(s.project, clipId, db) }), { coalesceKey: "cgain:" + clipId, label: "Clip gain" });
}

// ── shared row ───────────────────────────────────────────────────────────────
export function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rh-proprow">
      <span className="rh-proprow-lbl">{label}</span>
      <span className="rh-proprow-val">{children}</span>
    </div>
  );
}
