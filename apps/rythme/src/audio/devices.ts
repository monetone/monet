// ─────────────────────────────────────────────────────────────
// audio/devices — browser-facing audio hardware discovery
// ─────────────────────────────────────────────────────────────
// MediaDevices access belongs in the audio layer, not the pure engine. The
// engine stores opaque device ids; this module discovers readable choices.

export type AudioDeviceKind = "audioinput" | "audiooutput";

export interface AudioDeviceOption {
  id: string;
  label: string;
  kind: AudioDeviceKind;
  groupId?: string;
  isDefault: boolean;
}

export interface AudioDeviceInventory {
  supported: boolean;
  permissionRequested: boolean;
  permissionGranted: boolean;
  inputs: AudioDeviceOption[];
  outputs: AudioDeviceOption[];
  error?: string;
}

export interface AudioDeviceRange {
  min?: number;
  max?: number;
}

export interface AudioInputCapabilities {
  supported: boolean;
  deviceId?: string;
  label?: string;
  sampleRate?: AudioDeviceRange;
  channelCount?: AudioDeviceRange;
  latency?: AudioDeviceRange;
  echoCancellation?: boolean[];
  noiseSuppression?: boolean[];
  autoGainControl?: boolean[];
  error?: string;
}

export interface MediaDeviceInfoLike {
  deviceId?: string;
  kind: string;
  label?: string;
  groupId?: string;
}

interface MediaTrackCapabilitiesLike {
  sampleRate?: NumberRangeLike | number;
  channelCount?: NumberRangeLike | number;
  latency?: NumberRangeLike | number;
  echoCancellation?: boolean[];
  noiseSuppression?: boolean[];
  autoGainControl?: boolean[];
}

interface MediaTrackSettingsLike {
  deviceId?: string;
  groupId?: string;
  sampleRate?: number;
  channelCount?: number;
  latency?: number;
}

interface NumberRangeLike {
  min?: number;
  max?: number;
}

interface StoppableTrack {
  label?: string;
  getCapabilities?: () => MediaTrackCapabilitiesLike;
  getSettings?: () => MediaTrackSettingsLike;
  stop(): void;
}

interface PermissionStreamLike {
  getTracks(): StoppableTrack[];
}

export interface MediaDevicesLike {
  enumerateDevices?: () => Promise<readonly MediaDeviceInfoLike[]>;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<PermissionStreamLike>;
}

export interface DiscoverAudioDevicesOptions {
  requestPermission?: boolean;
  mediaDevices?: MediaDevicesLike;
}

export function emptyAudioDeviceInventory(): AudioDeviceInventory {
  return {
    supported: audioDeviceDiscoverySupported(),
    permissionRequested: false,
    permissionGranted: false,
    inputs: [],
    outputs: [],
  };
}

export function audioDeviceDiscoverySupported(mediaDevices = currentMediaDevices()): boolean {
  return typeof mediaDevices?.enumerateDevices === "function";
}

export async function discoverAudioDevices(options: DiscoverAudioDevicesOptions = {}): Promise<AudioDeviceInventory> {
  const mediaDevices = options.mediaDevices ?? currentMediaDevices();
  const requestPermission = options.requestPermission ?? false;
  if (!audioDeviceDiscoverySupported(mediaDevices)) {
    return { ...emptyAudioDeviceInventory(), supported: false, permissionRequested: requestPermission };
  }

  let permissionGranted = false;
  let error: string | undefined;

  if (requestPermission && mediaDevices?.getUserMedia) {
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      permissionGranted = true;
      for (const track of stream.getTracks()) track.stop();
    } catch (err) {
      error = audioDeviceErrorMessage(err);
    }
  }

  try {
    const rawDevices = await mediaDevices!.enumerateDevices!();
    const normalized = normalizeAudioDevices(rawDevices);
    const labelsVisible = rawDevices.some((device) => isAudioDeviceKind(device.kind) && !!device.label?.trim());
    return {
      supported: true,
      permissionRequested: requestPermission,
      permissionGranted: permissionGranted || labelsVisible,
      inputs: normalized.inputs,
      outputs: normalized.outputs,
      error,
    };
  } catch (err) {
    return {
      supported: true,
      permissionRequested: requestPermission,
      permissionGranted,
      inputs: [],
      outputs: [],
      error: audioDeviceErrorMessage(err),
    };
  }
}

export async function probeAudioInputCapabilities(
  deviceId?: string,
  mediaDevices = currentMediaDevices(),
): Promise<AudioInputCapabilities> {
  if (typeof mediaDevices?.getUserMedia !== "function") {
    return { supported: false, error: "Audio input capability probing is unavailable" };
  }

  const audio: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };

  try {
    const stream = await mediaDevices.getUserMedia({ audio });
    const tracks = stream.getTracks();
    const inputTrack = tracks[0];
    try {
      if (!inputTrack) return { supported: true, deviceId, error: "No audio input track was opened" };
      const capabilities = inputTrack.getCapabilities?.();
      const settings = inputTrack.getSettings?.();
      return {
        supported: true,
        deviceId: settings?.deviceId ?? deviceId,
        label: stringOrUndefined(inputTrack.label),
        sampleRate: numberRangeOrSetting(capabilities?.sampleRate, settings?.sampleRate),
        channelCount: numberRangeOrSetting(capabilities?.channelCount, settings?.channelCount),
        latency: numberRangeOrSetting(capabilities?.latency, settings?.latency),
        echoCancellation: capabilities?.echoCancellation,
        noiseSuppression: capabilities?.noiseSuppression,
        autoGainControl: capabilities?.autoGainControl,
      };
    } finally {
      for (const track of tracks) track.stop();
    }
  } catch (err) {
    return { supported: true, deviceId, error: audioDeviceErrorMessage(err) };
  }
}

export function normalizeAudioDevices(devices: readonly MediaDeviceInfoLike[]): Pick<AudioDeviceInventory, "inputs" | "outputs"> {
  const inputs: AudioDeviceOption[] = [];
  const outputs: AudioDeviceOption[] = [];
  const seen = new Set<string>();
  let inputIndex = 0;
  let outputIndex = 0;

  for (const device of devices) {
    if (!isAudioDeviceKind(device.kind)) continue;
    const id = (device.deviceId ?? "").trim();
    if (!id) continue;
    const key = `${device.kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isInput = device.kind === "audioinput";
    const ordinal = isInput ? ++inputIndex : ++outputIndex;
    const isDefault = id === "default";
    const fallback = isDefault ? (isInput ? "System input" : "System output") : `${isInput ? "Input" : "Output"} ${ordinal}`;
    const option: AudioDeviceOption = {
      id,
      label: deviceLabel(device.label, fallback),
      kind: device.kind,
      groupId: stringOrUndefined(device.groupId),
      isDefault,
    };
    (isInput ? inputs : outputs).push(option);
  }

  return { inputs: sortAudioDevices(inputs), outputs: sortAudioDevices(outputs) };
}

function currentMediaDevices(): MediaDevicesLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.mediaDevices;
}

function isAudioDeviceKind(kind: string): kind is AudioDeviceKind {
  return kind === "audioinput" || kind === "audiooutput";
}

function sortAudioDevices(devices: AudioDeviceOption[]): AudioDeviceOption[] {
  return [...devices].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label));
}

function deviceLabel(label: string | undefined, fallback: string): string {
  return label?.trim() || fallback;
}

function stringOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function numberRangeOrSetting(range: NumberRangeLike | number | undefined, setting: number | undefined): AudioDeviceRange | undefined {
  if (typeof range === "number" && Number.isFinite(range)) return { min: range, max: range };
  if (range && typeof range === "object") {
    const min = finiteNumber(range.min);
    const max = finiteNumber(range.max);
    if (min !== undefined || max !== undefined) return { min, max };
  }
  const value = finiteNumber(setting);
  return value === undefined ? undefined : { min: value, max: value };
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function audioDeviceErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Audio device access failed";
}
