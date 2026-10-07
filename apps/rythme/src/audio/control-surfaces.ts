// ─────────────────────────────────────────────────────────────
// audio/control-surfaces — browser-facing MIDI control surface discovery
// ─────────────────────────────────────────────────────────────
// Control-surface ids are app preferences. Discovery stays outside the pure
// engine because Web MIDI is host/browser capability.

export type ControlSurfacePortKind = "input" | "output";
export type ControlSurfaceProtocol = "genericMidi" | "mackieControl" | "hui";

export type ControlSurfaceAction =
  | { type: "play" | "stop" | "togglePlay" | "returnToZero" }
  | { type: "jog"; deltaSeconds: number }
  | { type: "trackGain"; trackIndex: number; gainDb: number }
  | { type: "trackPan"; trackIndex: number; pan: number }
  | { type: "trackMute" | "trackSolo" | "trackArm"; trackIndex: number }
  | { type: "masterGain"; gainDb: number };

export type ControlSurfaceMappedAction =
  | { type: "play" | "stop" | "togglePlay" | "returnToZero" }
  | { type: "jog"; sensitivitySeconds?: number }
  | { type: "trackGain"; trackIndex: number }
  | { type: "trackPan"; trackIndex: number }
  | { type: "trackMute"; trackIndex: number }
  | { type: "trackSolo"; trackIndex: number }
  | { type: "trackArm"; trackIndex: number }
  | { type: "masterGain" };

export interface ControlSurfaceMappingTrigger {
  status: number;
  data1?: number;
  data2?: number;
}

export interface ControlSurfaceMapping {
  label?: string;
  trigger: ControlSurfaceMappingTrigger;
  action: ControlSurfaceMappedAction;
}

export interface ControlSurfacePort {
  id: string;
  name: string;
  kind: ControlSurfacePortKind;
  manufacturer?: string;
  state?: "connected" | "disconnected";
  connection?: "open" | "closed" | "pending";
}

export interface ControlSurfaceInventory {
  supported: boolean;
  permissionRequested: boolean;
  inputs: ControlSurfacePort[];
  outputs: ControlSurfacePort[];
  error?: string;
}

interface MidiPortLike {
  id?: string;
  name?: string;
  manufacturer?: string;
  type?: string;
  state?: string;
  connection?: string;
  onmidimessage?: ((event: { data: ArrayLike<number> }) => void) | null;
  send?: (data: number[], timestamp?: number) => void;
}

interface MidiPortCollectionLike {
  values?: () => Iterable<MidiPortLike>;
  [Symbol.iterator]?: () => Iterator<MidiPortLike>;
}

export interface MidiAccessLike {
  inputs?: MidiPortCollectionLike;
  outputs?: MidiPortCollectionLike;
}

export interface NavigatorMidiLike {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MidiAccessLike>;
}

export interface DiscoverControlSurfacesOptions {
  requestPermission?: boolean;
  navigator?: NavigatorMidiLike;
}

export interface BindControlSurfaceInputOptions {
  enabled: boolean;
  protocol: ControlSurfaceProtocol;
  inputId?: string;
  mappings?: ControlSurfaceMapping[];
  navigator?: NavigatorMidiLike;
  onAction(action: ControlSurfaceAction): void;
}

export interface CaptureControlSurfaceTriggerOptions {
  inputId?: string;
  navigator?: NavigatorMidiLike;
  timeoutMs?: number;
}

export interface ControlSurfaceFeedbackTrack {
  gainDb: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  arm: boolean;
}

export interface ControlSurfaceFeedbackSnapshot {
  playing: boolean;
  masterGainDb: number;
  tracks: ControlSurfaceFeedbackTrack[];
}

export interface BindControlSurfaceOutputOptions {
  enabled: boolean;
  protocol: ControlSurfaceProtocol;
  outputId?: string;
  navigator?: NavigatorMidiLike;
  getSnapshot(): ControlSurfaceFeedbackSnapshot;
  subscribe(listener: () => void): () => void;
}

export function emptyControlSurfaceInventory(navigatorLike = currentNavigator()): ControlSurfaceInventory {
  return {
    supported: controlSurfaceDiscoverySupported(navigatorLike),
    permissionRequested: false,
    inputs: [],
    outputs: [],
  };
}

export function controlSurfaceDiscoverySupported(navigatorLike = currentNavigator()): boolean {
  return typeof navigatorLike?.requestMIDIAccess === "function";
}

export async function discoverControlSurfaces(options: DiscoverControlSurfacesOptions = {}): Promise<ControlSurfaceInventory> {
  const navigatorLike = options.navigator ?? currentNavigator();
  const requestPermission = options.requestPermission ?? false;
  if (!controlSurfaceDiscoverySupported(navigatorLike)) {
    return { ...emptyControlSurfaceInventory(navigatorLike), supported: false, permissionRequested: requestPermission };
  }

  try {
    const access = await navigatorLike!.requestMIDIAccess!({ sysex: false });
    return {
      supported: true,
      permissionRequested: requestPermission,
      inputs: normalizeMidiPorts(access.inputs, "input"),
      outputs: normalizeMidiPorts(access.outputs, "output"),
    };
  } catch (err) {
    return {
      supported: true,
      permissionRequested: requestPermission,
      inputs: [],
      outputs: [],
      error: controlSurfaceErrorMessage(err),
    };
  }
}

export function normalizeMidiPorts(collection: MidiPortCollectionLike | undefined, kind: ControlSurfacePortKind): ControlSurfacePort[] {
  const out: ControlSurfacePort[] = [];
  const seen = new Set<string>();
  let ordinal = 0;
  for (const port of iterableMidiPorts(collection)) {
    if (port.type && port.type !== kind) continue;
    const id = stringOrUndefined(port.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordinal += 1;
    out.push({
      id,
      name: stringOrUndefined(port.name) ?? `${kind === "input" ? "Input" : "Output"} ${ordinal}`,
      kind,
      manufacturer: stringOrUndefined(port.manufacturer),
      state: port.state === "disconnected" ? "disconnected" : port.state === "connected" ? "connected" : undefined,
      connection: port.connection === "open" || port.connection === "closed" || port.connection === "pending" ? port.connection : undefined,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function bindControlSurfaceInput(options: BindControlSurfaceInputOptions): Promise<() => void> {
  const navigatorLike = options.navigator ?? currentNavigator();
  if (!options.enabled || !options.inputId || !controlSurfaceDiscoverySupported(navigatorLike)) return noop;
  const access = await navigatorLike!.requestMIDIAccess!({ sysex: false });
  const input = [...iterableMidiPorts(access.inputs)].find((port) => port.id === options.inputId);
  if (!input) return noop;
  const previous = input.onmidimessage ?? null;
  const listener = (event: { data: ArrayLike<number> }) => {
    const action = decodeControlSurfaceMessage(event.data, options.protocol, options.mappings);
    if (action) options.onAction(action);
  };
  input.onmidimessage = listener;
  return () => {
    if (input.onmidimessage === listener) input.onmidimessage = previous;
  };
}

export async function captureControlSurfaceTrigger(options: CaptureControlSurfaceTriggerOptions): Promise<ControlSurfaceMappingTrigger | null> {
  const navigatorLike = options.navigator ?? currentNavigator();
  if (!options.inputId || !controlSurfaceDiscoverySupported(navigatorLike)) return null;
  const access = await navigatorLike!.requestMIDIAccess!({ sysex: false });
  const input = [...iterableMidiPorts(access.inputs)].find((port) => port.id === options.inputId);
  if (!input) return null;

  return await new Promise((resolve) => {
    const previous = input.onmidimessage ?? null;
    let done = false;
    const finish = (trigger: ControlSurfaceMappingTrigger | null) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (input.onmidimessage === listener) input.onmidimessage = previous;
      resolve(trigger);
    };
    // `finish` closes over both bindings but can only run once the timer fires
    // or a message arrives, i.e. after they are initialized below.
    const timeout = setTimeout(() => finish(null), Math.max(1, options.timeoutMs ?? 10000));
    const listener = (event: { data: ArrayLike<number> }) => finish(triggerFromMessage(event.data));
    input.onmidimessage = listener;
  });
}

export async function bindControlSurfaceOutput(options: BindControlSurfaceOutputOptions): Promise<() => void> {
  const navigatorLike = options.navigator ?? currentNavigator();
  if (!options.enabled || !options.outputId || !controlSurfaceDiscoverySupported(navigatorLike)) return noop;
  const access = await navigatorLike!.requestMIDIAccess!({ sysex: false });
  const output = [...iterableMidiPorts(access.outputs)].find((port) => port.id === options.outputId && typeof port.send === "function");
  if (!output?.send) return noop;
  let lastKey = "";
  const flush = () => {
    const snapshot = normalizeFeedbackSnapshot(options.getSnapshot());
    const key = feedbackSnapshotKey(snapshot);
    if (key === lastKey) return;
    lastKey = key;
    for (const message of controlSurfaceFeedbackMessages(snapshot, options.protocol)) output.send!(message);
  };
  flush();
  return options.subscribe(flush);
}

export function controlSurfaceFeedbackMessages(snapshot: ControlSurfaceFeedbackSnapshot, protocol: ControlSurfaceProtocol): number[][] {
  const normalized = normalizeFeedbackSnapshot(snapshot);
  return protocol === "genericMidi" ? genericFeedbackMessages(normalized) : mackieFeedbackMessages(normalized);
}

export function normalizeControlSurfaceMappings(value: unknown): ControlSurfaceMapping[] {
  if (!Array.isArray(value)) return [];
  const mappings: ControlSurfaceMapping[] = [];
  for (const entry of value.slice(0, 64)) {
    const mapping = normalizeControlSurfaceMapping(entry);
    if (mapping) mappings.push(mapping);
  }
  return mappings;
}

export function decodeControlSurfaceMessage(data: ArrayLike<number>, protocol: ControlSurfaceProtocol, mappings: ControlSurfaceMapping[] = []): ControlSurfaceAction | null {
  const mapped = decodeMappedAction(data, mappings);
  if (mapped) return mapped;
  const status = data[0] ?? 0;
  const kind = status & 0xf0;
  const channel = status & 0x0f;
  const a = data[1] ?? 0;
  const b = data[2] ?? 0;
  if (kind === 0x90 && b > 0) return decodeNote(a, protocol);
  if (kind === 0xb0) return decodeControlChange(a, b, protocol);
  if (kind === 0xe0) return decodePitchBend(channel, a, b);
  return null;
}

function decodeMappedAction(data: ArrayLike<number>, mappings: ControlSurfaceMapping[]): ControlSurfaceAction | null {
  for (const mapping of mappings) {
    if (!triggerMatches(data, mapping.trigger)) continue;
    const action = actionFromMapping(data, mapping.action);
    if (action) return action;
  }
  return null;
}

function triggerMatches(data: ArrayLike<number>, trigger: ControlSurfaceMappingTrigger): boolean {
  return midiByte(data[0]) === trigger.status &&
    (trigger.data1 === undefined || midi7(data[1]) === trigger.data1) &&
    (trigger.data2 === undefined || midi7(data[2]) === trigger.data2);
}

function actionFromMapping(data: ArrayLike<number>, action: ControlSurfaceMappedAction): ControlSurfaceAction | null {
  const status = midiByte(data[0]);
  const kind = status & 0xf0;
  const value = midi7(data[2]);
  switch (action.type) {
    case "play":
    case "stop":
    case "togglePlay":
    case "returnToZero":
      return value > 0 || kind === 0xe0 ? action : null;
    case "trackMute":
    case "trackSolo":
    case "trackArm":
      return value > 0 ? action : null;
    case "trackGain":
      return { type: "trackGain", trackIndex: action.trackIndex, gainDb: gainFromMappedValue(data) };
    case "trackPan":
      return kind === 0xb0 || kind === 0x90 ? { type: "trackPan", trackIndex: action.trackIndex, pan: valueToPan(value) } : null;
    case "masterGain":
      return { type: "masterGain", gainDb: gainFromMappedValue(data) };
    case "jog": {
      const steps = relative7BitSteps(value);
      const sensitivity = finiteNumber(action.sensitivitySeconds, 0.05);
      return steps === 0 ? null : { type: "jog", deltaSeconds: Number((steps * sensitivity).toFixed(3)) };
    }
  }
}

function gainFromMappedValue(data: ArrayLike<number>): number {
  const status = midiByte(data[0]);
  if ((status & 0xf0) === 0xe0) return valueToGainDb((midi7(data[2]) << 7) | midi7(data[1]), 16383);
  return valueToGainDb(midi7(data[2]));
}

function mackieFeedbackMessages(snapshot: ControlSurfaceFeedbackSnapshot): number[][] {
  const messages: number[][] = [
    [0x90, 94, snapshot.playing ? 127 : 0],
    [0x90, 93, snapshot.playing ? 0 : 127],
    pitchBendMessage(8, snapshot.masterGainDb),
  ];
  snapshot.tracks.slice(0, 8).forEach((track, index) => {
    messages.push(
      pitchBendMessage(index, track.gainDb),
      [0xb0, 16 + index, panToValue(track.pan)],
      [0x90, index, track.arm ? 127 : 0],
      [0x90, 8 + index, track.solo ? 127 : 0],
      [0x90, 16 + index, track.mute ? 127 : 0],
    );
  });
  return messages;
}

function genericFeedbackMessages(snapshot: ControlSurfaceFeedbackSnapshot): number[][] {
  const messages: number[][] = [
    [0x90, 60, snapshot.playing ? 127 : 0],
    [0x90, 61, snapshot.playing ? 0 : 127],
    [0xb0, 32, gainDbToValue(snapshot.masterGainDb)],
  ];
  snapshot.tracks.slice(0, 8).forEach((track, index) => {
    messages.push(
      [0xb0, 16 + index, gainDbToValue(track.gainDb)],
      [0xb0, 24 + index, panToValue(track.pan)],
      [0x90, 64 + index, track.arm ? 127 : 0],
      [0x90, 72 + index, track.solo ? 127 : 0],
      [0x90, 80 + index, track.mute ? 127 : 0],
    );
  });
  return messages;
}

function decodeNote(note: number, protocol: ControlSurfaceProtocol): ControlSurfaceAction | null {
  if (protocol === "mackieControl" || protocol === "hui") {
    if (note >= 0 && note <= 7) return { type: "trackArm", trackIndex: note };
    if (note >= 8 && note <= 15) return { type: "trackSolo", trackIndex: note - 8 };
    if (note >= 16 && note <= 23) return { type: "trackMute", trackIndex: note - 16 };
    if (note === 93) return { type: "stop" };
    if (note === 94) return { type: "play" };
    if (note === 91) return { type: "returnToZero" };
  }
  if (note === 60) return { type: "togglePlay" };
  if (note === 61) return { type: "stop" };
  if (note === 62) return { type: "returnToZero" };
  if (note >= 64 && note <= 71) return { type: "trackArm", trackIndex: note - 64 };
  if (note >= 72 && note <= 79) return { type: "trackSolo", trackIndex: note - 72 };
  if (note >= 80 && note <= 87) return { type: "trackMute", trackIndex: note - 80 };
  return null;
}

function decodeControlChange(cc: number, value: number, protocol: ControlSurfaceProtocol): ControlSurfaceAction | null {
  if ((protocol === "mackieControl" || protocol === "hui") && cc === 60) return decodeJog(value);
  if (protocol === "genericMidi" && cc === 44) return decodeJog(value);
  if (cc >= 16 && cc <= 23) {
    return protocol === "genericMidi"
      ? { type: "trackGain", trackIndex: cc - 16, gainDb: valueToGainDb(value) }
      : { type: "trackPan", trackIndex: cc - 16, pan: valueToPan(value) };
  }
  if (cc >= 24 && cc <= 31) return { type: "trackPan", trackIndex: cc - 24, pan: valueToPan(value) };
  if (cc === 32) return { type: "masterGain", gainDb: valueToGainDb(value) };
  if (cc === 41 && value > 0) return { type: "togglePlay" };
  if (cc === 42 && value > 0) return { type: "stop" };
  if (cc === 43 && value > 0) return { type: "returnToZero" };
  return null;
}

function decodeJog(value: number): ControlSurfaceAction | null {
  const steps = relative7BitSteps(value);
  return steps === 0 ? null : { type: "jog", deltaSeconds: Number((steps * 0.05).toFixed(3)) };
}

function decodePitchBend(channel: number, lsb: number, msb: number): ControlSurfaceAction | null {
  const gainDb = valueToGainDb(((msb & 0x7f) << 7) | (lsb & 0x7f), 16383);
  if (channel < 8) return { type: "trackGain", trackIndex: channel, gainDb };
  if (channel === 8) return { type: "masterGain", gainDb };
  return null;
}

function valueToGainDb(value: number, max = 127): number {
  return -60 + (Math.max(0, Math.min(max, value)) / max) * 72;
}

function valueToPan(value: number): number {
  return (Math.max(0, Math.min(127, value)) / 127) * 2 - 1;
}

function gainDbToValue(gainDb: number, max = 127): number {
  return Math.round((clamp(finiteNumber(gainDb, 0), -60, 12) + 60) / 72 * max);
}

function panToValue(pan: number): number {
  return Math.round(((clamp(finiteNumber(pan, 0), -1, 1) + 1) / 2) * 127);
}

function pitchBendMessage(channel: number, gainDb: number): number[] {
  const value = gainDbToValue(gainDb, 16383);
  return [0xe0 | Math.max(0, Math.min(15, Math.round(channel))), value & 0x7f, (value >> 7) & 0x7f];
}

function relative7BitSteps(value: number): number {
  const v = Math.max(0, Math.min(127, Math.round(value)));
  if (v >= 1 && v <= 63) return v;
  if (v >= 65 && v <= 127) return v - 128;
  return 0;
}

function triggerFromMessage(data: ArrayLike<number>): ControlSurfaceMappingTrigger {
  const status = midiByte(data[0]);
  const kind = status & 0xf0;
  const trigger: ControlSurfaceMappingTrigger = { status };
  if (kind === 0x80 || kind === 0x90 || kind === 0xb0) trigger.data1 = midi7(data[1]);
  return trigger;
}

function normalizeControlSurfaceMapping(value: unknown): ControlSurfaceMapping | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Partial<ControlSurfaceMapping>;
  const trigger = normalizeControlSurfaceTrigger(rec.trigger);
  const action = normalizeMappedAction(rec.action);
  if (!trigger || !action) return null;
  const label = stringOrUndefined(rec.label);
  return label ? { label: label.slice(0, 80), trigger, action } : { trigger, action };
}

function normalizeControlSurfaceTrigger(value: unknown): ControlSurfaceMappingTrigger | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Partial<ControlSurfaceMappingTrigger>;
  const status = optionalMidiByte(rec.status);
  if (status === undefined || status < 0x80) return null;
  const trigger: ControlSurfaceMappingTrigger = { status };
  const data1 = optionalMidi7(rec.data1);
  const data2 = optionalMidi7(rec.data2);
  if (data1 !== undefined) trigger.data1 = data1;
  if (data2 !== undefined) trigger.data2 = data2;
  return trigger;
}

function normalizeMappedAction(value: unknown): ControlSurfaceMappedAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Partial<ControlSurfaceMappedAction>;
  if (rec.type === "play" || rec.type === "stop" || rec.type === "togglePlay" || rec.type === "returnToZero" || rec.type === "masterGain") {
    return { type: rec.type };
  }
  if (rec.type === "jog") return { type: "jog", sensitivitySeconds: clamp(finiteNumber(rec.sensitivitySeconds, 0.05), 0.001, 5) };
  if (rec.type === "trackGain" || rec.type === "trackPan" || rec.type === "trackMute" || rec.type === "trackSolo" || rec.type === "trackArm") {
    return { type: rec.type, trackIndex: Math.round(clamp(finiteNumber(rec.trackIndex, 0), 0, 63)) };
  }
  return null;
}

function normalizeFeedbackSnapshot(snapshot: ControlSurfaceFeedbackSnapshot): ControlSurfaceFeedbackSnapshot {
  return {
    playing: snapshot.playing === true,
    masterGainDb: clamp(finiteNumber(snapshot.masterGainDb, 0), -60, 12),
    tracks: snapshot.tracks.slice(0, 8).map((track) => ({
      gainDb: clamp(finiteNumber(track.gainDb, 0), -60, 12),
      pan: clamp(finiteNumber(track.pan, 0), -1, 1),
      mute: track.mute === true,
      solo: track.solo === true,
      arm: track.arm === true,
    })),
  };
}

function feedbackSnapshotKey(snapshot: ControlSurfaceFeedbackSnapshot): string {
  return JSON.stringify(snapshot);
}

function midiByte(value: unknown): number {
  return Math.max(0, Math.min(255, Math.round(typeof value === "number" && Number.isFinite(value) ? value : 0)));
}

function midi7(value: unknown): number {
  return Math.max(0, Math.min(127, Math.round(typeof value === "number" && Number.isFinite(value) ? value : 0)));
}

function optionalMidiByte(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? midiByte(value) : undefined;
}

function optionalMidi7(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? midi7(value) : undefined;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function* iterableMidiPorts(collection: MidiPortCollectionLike | undefined): Iterable<MidiPortLike> {
  if (!collection) return;
  if (typeof collection.values === "function") {
    for (const port of collection.values()) yield port;
    return;
  }
  if (typeof collection[Symbol.iterator] === "function") {
    for (const port of collection as Iterable<MidiPortLike>) yield port;
  }
}

function currentNavigator(): NavigatorMidiLike | undefined {
  return typeof navigator === "undefined" ? undefined : navigator as NavigatorMidiLike;
}

function controlSurfaceErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function noop(): void {}
