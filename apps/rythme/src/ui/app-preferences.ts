import { defaultPanelPreferences, normalizePanelPreferences, type AudioHardwareSettings, type DisplayTimeFormat, type EditorMode, type InputMonitoringMode, type PanelPreferences, type ToolId } from "../engine";
import { normalizeControlSurfaceMappings, type ControlSurfaceMapping, type ControlSurfaceProtocol } from "../audio/control-surfaces";

export type FileExportFormat = "wav" | "aiff";
export type FileExportBitDepth = 16 | 24 | 32;
export type DefaultWorkspaceId = "default" | "maxWaveform" | "maxSpectral" | "mixing" | "radio";
export type AppPreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface FileBehaviorPreferences {
  exportFormat: FileExportFormat;
  exportBitDepth: FileExportBitDepth;
  exportFloat: boolean;
}

export interface WorkspaceBehaviorPreferences {
  defaultWorkspaceId: DefaultWorkspaceId;
  defaultEditorMode: EditorMode;
  defaultTool: ToolId;
  defaultSnap: boolean;
  defaultDisplayTimeFormat: DisplayTimeFormat;
}

export interface AudioHardwarePreferences {
  inputDeviceId?: string;
  outputDeviceId?: string;
  hardwareSampleRate: number;
  inputChannels: number;
  inputMonitoring: InputMonitoringMode;
  latencyCompensationMs: number;
  preRollSeconds: number;
  countInBars: number;
  meterCalibrationDb: number;
  meterPeakHoldMs: number;
}

export interface AppPreferences {
  fileBehavior: FileBehaviorPreferences;
  workspace: WorkspaceBehaviorPreferences;
  audioHardware: AudioHardwarePreferences;
  panelDefaults: PanelPreferences;
  controlSurface: ControlSurfacePreferences;
}

export type PanelDefaultPreferencesPatch = {
  analyze?: Partial<PanelPreferences["analyze"]>;
  effects?: Partial<PanelPreferences["effects"]>;
};

export interface ControlSurfacePreferences {
  enabled: boolean;
  protocol: ControlSurfaceProtocol;
  inputId?: string;
  outputId?: string;
  mappings: ControlSurfaceMapping[];
}

export const DEFAULT_FILE_BEHAVIOR_PREFERENCES: FileBehaviorPreferences = {
  exportFormat: "wav",
  exportBitDepth: 24,
  exportFloat: false,
};

export const DEFAULT_WORKSPACE_BEHAVIOR_PREFERENCES: WorkspaceBehaviorPreferences = {
  defaultWorkspaceId: "default",
  defaultEditorMode: "multitrack",
  defaultTool: "select",
  defaultSnap: true,
  defaultDisplayTimeFormat: "decimal",
};

export const DEFAULT_AUDIO_HARDWARE_PREFERENCES: AudioHardwarePreferences = {
  hardwareSampleRate: 48000,
  inputChannels: 2,
  inputMonitoring: "off",
  latencyCompensationMs: 0,
  preRollSeconds: 0,
  countInBars: 0,
  meterCalibrationDb: 0,
  meterPeakHoldMs: 1200,
};

export const DEFAULT_PANEL_DEFAULT_PREFERENCES = defaultPanelPreferences(48000);

export const DEFAULT_CONTROL_SURFACE_PREFERENCES: ControlSurfacePreferences = {
  enabled: false,
  protocol: "genericMidi",
  mappings: [],
};
export const CONTROL_SURFACE_PREFERENCES_EVENT = "monet-rythme:control-surface-preferences";

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  fileBehavior: DEFAULT_FILE_BEHAVIOR_PREFERENCES,
  workspace: DEFAULT_WORKSPACE_BEHAVIOR_PREFERENCES,
  audioHardware: DEFAULT_AUDIO_HARDWARE_PREFERENCES,
  panelDefaults: DEFAULT_PANEL_DEFAULT_PREFERENCES,
  controlSurface: DEFAULT_CONTROL_SURFACE_PREFERENCES,
};

const APP_PREFERENCES_KEY = "monet-rythme:app-preferences";
const WORKSPACE_IDS = new Set<DefaultWorkspaceId>(["default", "maxWaveform", "maxSpectral", "mixing", "radio"]);
const EDITOR_MODES = new Set<EditorMode>(["multitrack", "waveform"]);
const TOOL_IDS = new Set<ToolId>(["select", "razor", "marquee", "envelope", "fade", "marker", "hand", "zoom"]);
const DISPLAY_TIME_FORMATS = new Set<DisplayTimeFormat>(["decimal", "smpte30", "samples", "barsBeats"]);
const INPUT_MONITORING_MODES = new Set<InputMonitoringMode>(["off", "armed", "always"]);
const CONTROL_SURFACE_PROTOCOLS = new Set<ControlSurfaceProtocol>(["genericMidi", "mackieControl", "hui"]);

export function appPreferenceStorage(): AppPreferenceStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function normalizeFileBehaviorPreferences(value: unknown): FileBehaviorPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_FILE_BEHAVIOR_PREFERENCES };
  const rec = value as Partial<FileBehaviorPreferences>;
  const exportFormat: FileExportFormat = rec.exportFormat === "aiff" ? "aiff" : "wav";
  const exportBitDepth: FileExportBitDepth = rec.exportBitDepth === 16 || rec.exportBitDepth === 32 ? rec.exportBitDepth : 24;
  return {
    exportFormat,
    exportBitDepth,
    exportFloat: exportFormat === "wav" && exportBitDepth === 32 && rec.exportFloat === true,
  };
}

export function normalizeWorkspaceBehaviorPreferences(value: unknown): WorkspaceBehaviorPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_WORKSPACE_BEHAVIOR_PREFERENCES };
  const rec = value as Partial<WorkspaceBehaviorPreferences>;
  return {
    defaultWorkspaceId: rec.defaultWorkspaceId && WORKSPACE_IDS.has(rec.defaultWorkspaceId) ? rec.defaultWorkspaceId : "default",
    defaultEditorMode: rec.defaultEditorMode && EDITOR_MODES.has(rec.defaultEditorMode) ? rec.defaultEditorMode : "multitrack",
    defaultTool: rec.defaultTool && TOOL_IDS.has(rec.defaultTool) ? rec.defaultTool : "select",
    defaultSnap: typeof rec.defaultSnap === "boolean" ? rec.defaultSnap : true,
    defaultDisplayTimeFormat: rec.defaultDisplayTimeFormat && DISPLAY_TIME_FORMATS.has(rec.defaultDisplayTimeFormat) ? rec.defaultDisplayTimeFormat : "decimal",
  };
}

export function normalizeAudioHardwarePreferences(value: unknown): AudioHardwarePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_AUDIO_HARDWARE_PREFERENCES };
  const rec = value as Partial<AudioHardwarePreferences>;
  return {
    inputDeviceId: stringOrUndefined(rec.inputDeviceId),
    outputDeviceId: stringOrUndefined(rec.outputDeviceId),
    hardwareSampleRate: Math.round(clamp(finiteOr(rec.hardwareSampleRate, 48000), 8000, 192000)),
    inputChannels: Math.round(clamp(finiteOr(rec.inputChannels, 2), 1, 8)),
    inputMonitoring: rec.inputMonitoring && INPUT_MONITORING_MODES.has(rec.inputMonitoring) ? rec.inputMonitoring : "off",
    latencyCompensationMs: clamp(finiteOr(rec.latencyCompensationMs, 0), -1000, 1000),
    preRollSeconds: clamp(finiteOr(rec.preRollSeconds, 0), 0, 30),
    countInBars: Math.round(clamp(finiteOr(rec.countInBars, 0), 0, 8)),
    meterCalibrationDb: clamp(finiteOr(rec.meterCalibrationDb, 0), -60, 60),
    meterPeakHoldMs: Math.round(clamp(finiteOr(rec.meterPeakHoldMs, 1200), 0, 10000)),
  };
}

export function normalizePanelDefaultPreferences(value: unknown): PanelPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultPanelPreferences(48000);
  return normalizePanelPreferences(value as Partial<PanelPreferences>, 48000);
}

export function normalizeControlSurfacePreferences(value: unknown): ControlSurfacePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_CONTROL_SURFACE_PREFERENCES, mappings: [] };
  const rec = value as Partial<ControlSurfacePreferences>;
  return {
    enabled: rec.enabled === true,
    protocol: rec.protocol && CONTROL_SURFACE_PROTOCOLS.has(rec.protocol) ? rec.protocol : "genericMidi",
    inputId: stringOrUndefined(rec.inputId),
    outputId: stringOrUndefined(rec.outputId),
    mappings: normalizeControlSurfaceMappings(rec.mappings),
  };
}

export function audioHardwarePreferencesFromSettings(settings: Partial<AudioHardwareSettings> | undefined): AudioHardwarePreferences {
  return normalizeAudioHardwarePreferences(settings);
}

export function audioHardwareSettingsFromPreferences(preferences: AudioHardwarePreferences): AudioHardwareSettings {
  return { ...normalizeAudioHardwarePreferences(preferences), punchIn: null };
}

export function normalizeAppPreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_APP_PREFERENCES };
  const rec = value as Partial<AppPreferences>;
  return {
    fileBehavior: normalizeFileBehaviorPreferences(rec.fileBehavior),
    workspace: normalizeWorkspaceBehaviorPreferences(rec.workspace),
    audioHardware: normalizeAudioHardwarePreferences(rec.audioHardware),
    panelDefaults: normalizePanelDefaultPreferences(rec.panelDefaults),
    controlSurface: normalizeControlSurfacePreferences(rec.controlSurface),
  };
}

export function loadAppPreferences(storage = appPreferenceStorage()): AppPreferences {
  if (!storage) return { ...DEFAULT_APP_PREFERENCES };
  try {
    return normalizeAppPreferences(JSON.parse(storage.getItem(APP_PREFERENCES_KEY) ?? "{}"));
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

export function saveAppPreferences(
  preferences: Partial<AppPreferences>,
  storage = appPreferenceStorage(),
): AppPreferences | null {
  if (!storage) return null;
  const normalized = normalizeAppPreferences({ ...loadAppPreferences(storage), ...preferences });
  try {
    storage.setItem(APP_PREFERENCES_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return null;
  }
}

export async function loadAppPreferencesAsync(storage = appPreferenceStorage()): Promise<AppPreferences> {
  const nativeJson = await readNativeAppPreferences();
  if (nativeJson !== null) {
    try {
      return normalizeAppPreferences(JSON.parse(nativeJson));
    } catch {
      return { ...DEFAULT_APP_PREFERENCES };
    }
  }
  return loadAppPreferences(storage);
}

export async function saveAppPreferencesAsync(
  preferences: Partial<AppPreferences>,
  storage = appPreferenceStorage(),
): Promise<AppPreferences | null> {
  const normalized = normalizeAppPreferences({ ...(await loadAppPreferencesAsync(storage)), ...preferences });
  const nativeSaved = await writeNativeAppPreferences(JSON.stringify(normalized));
  if (nativeSaved === true) return normalized;
  if (nativeSaved === false) return null;
  return saveAppPreferences(normalized, storage);
}

export function loadFileBehaviorPreferences(storage = appPreferenceStorage()): FileBehaviorPreferences {
  return loadAppPreferences(storage).fileBehavior;
}

export function saveFileBehaviorPreferences(
  preferences: Partial<FileBehaviorPreferences>,
  storage = appPreferenceStorage(),
): FileBehaviorPreferences | null {
  const current = loadAppPreferences(storage);
  return saveAppPreferences({ fileBehavior: normalizeFileBehaviorPreferences({ ...current.fileBehavior, ...preferences }) }, storage)?.fileBehavior ?? null;
}

export async function loadFileBehaviorPreferencesAsync(storage = appPreferenceStorage()): Promise<FileBehaviorPreferences> {
  return (await loadAppPreferencesAsync(storage)).fileBehavior;
}

export async function saveFileBehaviorPreferencesAsync(
  preferences: Partial<FileBehaviorPreferences>,
  storage = appPreferenceStorage(),
): Promise<FileBehaviorPreferences | null> {
  const current = await loadAppPreferencesAsync(storage);
  return (await saveAppPreferencesAsync({ fileBehavior: normalizeFileBehaviorPreferences({ ...current.fileBehavior, ...preferences }) }, storage))?.fileBehavior ?? null;
}

export function loadWorkspaceBehaviorPreferences(storage = appPreferenceStorage()): WorkspaceBehaviorPreferences {
  return loadAppPreferences(storage).workspace;
}

export function saveWorkspaceBehaviorPreferences(
  preferences: Partial<WorkspaceBehaviorPreferences>,
  storage = appPreferenceStorage(),
): WorkspaceBehaviorPreferences | null {
  const current = loadAppPreferences(storage);
  return saveAppPreferences({ workspace: normalizeWorkspaceBehaviorPreferences({ ...current.workspace, ...preferences }) }, storage)?.workspace ?? null;
}

export async function loadWorkspaceBehaviorPreferencesAsync(storage = appPreferenceStorage()): Promise<WorkspaceBehaviorPreferences> {
  return (await loadAppPreferencesAsync(storage)).workspace;
}

export async function saveWorkspaceBehaviorPreferencesAsync(
  preferences: Partial<WorkspaceBehaviorPreferences>,
  storage = appPreferenceStorage(),
): Promise<WorkspaceBehaviorPreferences | null> {
  const current = await loadAppPreferencesAsync(storage);
  return (await saveAppPreferencesAsync({ workspace: normalizeWorkspaceBehaviorPreferences({ ...current.workspace, ...preferences }) }, storage))?.workspace ?? null;
}

export function loadAudioHardwarePreferences(storage = appPreferenceStorage()): AudioHardwarePreferences {
  return loadAppPreferences(storage).audioHardware;
}

export function saveAudioHardwarePreferences(
  preferences: Partial<AudioHardwarePreferences>,
  storage = appPreferenceStorage(),
): AudioHardwarePreferences | null {
  const current = loadAppPreferences(storage);
  return saveAppPreferences({ audioHardware: normalizeAudioHardwarePreferences({ ...current.audioHardware, ...preferences }) }, storage)?.audioHardware ?? null;
}

export async function loadAudioHardwarePreferencesAsync(storage = appPreferenceStorage()): Promise<AudioHardwarePreferences> {
  return (await loadAppPreferencesAsync(storage)).audioHardware;
}

export async function saveAudioHardwarePreferencesAsync(
  preferences: Partial<AudioHardwarePreferences>,
  storage = appPreferenceStorage(),
): Promise<AudioHardwarePreferences | null> {
  const current = await loadAppPreferencesAsync(storage);
  return (await saveAppPreferencesAsync({ audioHardware: normalizeAudioHardwarePreferences({ ...current.audioHardware, ...preferences }) }, storage))?.audioHardware ?? null;
}

export function loadPanelDefaultPreferences(storage = appPreferenceStorage()): PanelPreferences {
  return loadAppPreferences(storage).panelDefaults;
}

export function savePanelDefaultPreferences(
  preferences: PanelDefaultPreferencesPatch,
  storage = appPreferenceStorage(),
): PanelPreferences | null {
  const current = loadAppPreferences(storage);
  return saveAppPreferences({ panelDefaults: mergePanelDefaultPreferences(current.panelDefaults, preferences) }, storage)?.panelDefaults ?? null;
}

export async function loadPanelDefaultPreferencesAsync(storage = appPreferenceStorage()): Promise<PanelPreferences> {
  return (await loadAppPreferencesAsync(storage)).panelDefaults;
}

export async function savePanelDefaultPreferencesAsync(
  preferences: PanelDefaultPreferencesPatch,
  storage = appPreferenceStorage(),
): Promise<PanelPreferences | null> {
  const current = await loadAppPreferencesAsync(storage);
  return (await saveAppPreferencesAsync({ panelDefaults: mergePanelDefaultPreferences(current.panelDefaults, preferences) }, storage))?.panelDefaults ?? null;
}

export function loadControlSurfacePreferences(storage = appPreferenceStorage()): ControlSurfacePreferences {
  return loadAppPreferences(storage).controlSurface;
}

export function saveControlSurfacePreferences(
  preferences: Partial<ControlSurfacePreferences>,
  storage = appPreferenceStorage(),
): ControlSurfacePreferences | null {
  const current = loadAppPreferences(storage);
  const saved = saveAppPreferences({ controlSurface: normalizeControlSurfacePreferences({ ...current.controlSurface, ...preferences }) }, storage)?.controlSurface ?? null;
  if (saved) emitControlSurfacePreferencesChanged();
  return saved;
}

export async function loadControlSurfacePreferencesAsync(storage = appPreferenceStorage()): Promise<ControlSurfacePreferences> {
  return (await loadAppPreferencesAsync(storage)).controlSurface;
}

export async function saveControlSurfacePreferencesAsync(
  preferences: Partial<ControlSurfacePreferences>,
  storage = appPreferenceStorage(),
): Promise<ControlSurfacePreferences | null> {
  const current = await loadAppPreferencesAsync(storage);
  const saved = (await saveAppPreferencesAsync({ controlSurface: normalizeControlSurfacePreferences({ ...current.controlSurface, ...preferences }) }, storage))?.controlSurface ?? null;
  if (saved) emitControlSurfacePreferencesChanged();
  return saved;
}

async function readNativeAppPreferences(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const core = await import("@tauri-apps/api/core");
    return await core.invoke<string>("read_app_preferences");
  } catch {
    return null;
  }
}

async function writeNativeAppPreferences(preferencesJson: string): Promise<boolean | null> {
  if (!isTauriRuntime()) return null;
  try {
    const core = await import("@tauri-apps/api/core");
    await core.invoke("write_app_preferences", { preferencesJson });
    return true;
  } catch {
    return false;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mergePanelDefaultPreferences(current: PanelPreferences, patch: PanelDefaultPreferencesPatch): PanelPreferences {
  return normalizePanelDefaultPreferences({
    analyze: { ...current.analyze, ...patch.analyze },
    effects: { ...current.effects, ...patch.effects },
  });
}

function emitControlSurfacePreferencesChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CONTROL_SURFACE_PREFERENCES_EVENT));
}
