import { keyboardShortcutPresetIdForName, normalizeKeyboardShortcuts, type KeyboardShortcut, type KeyboardShortcutAction, type KeyboardShortcutPreset } from "../engine";

export type KeyboardShortcutEventLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;
export type KeyboardShortcutPresetStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const GLOBAL_KEYBOARD_SHORTCUT_PRESETS_KEY = "monet-rythme:keyboard-shortcut-presets";

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { action: "transport.playPause", key: "space" },
  { action: "transport.returnToStart", key: "home" },
  { action: "clip.nudgeLeft", key: "arrowleft", alt: true },
  { action: "clip.nudgeRight", key: "arrowright", alt: true },
  { action: "edit.undo", key: "z", mod: true, shift: false },
  { action: "edit.redo", key: "z", mod: true, shift: true },
  { action: "edit.selectAll", key: "a", mod: true },
  { action: "edit.cut", key: "x", mod: true },
  { action: "edit.copy", key: "c", mod: true },
  { action: "edit.paste", key: "v", mod: true },
  { action: "edit.split", key: "k", mod: true },
  { action: "edit.duplicate", key: "d", mod: true },
  { action: "edit.silence", key: "l", mod: true },
  { action: "edit.trim", key: "t", mod: true },
  { action: "project.save", key: "s", mod: true },
  { action: "effect.noiseReduction", key: "p", mod: true, shift: true },
  { action: "view.zoomIn", key: "=", mod: true },
  { action: "view.zoomIn", key: "+", mod: true },
  { action: "view.zoomOut", key: "-", mod: true },
  { action: "edit.delete", key: "backspace" },
  { action: "edit.delete", key: "delete" },
  { action: "effect.captureNoisePrint", key: "p", mod: false, shift: true },
  { action: "tool.select", key: "v", mod: false },
  { action: "tool.marquee", key: "t", mod: false },
  { action: "tool.razor", key: "r", mod: false },
  { action: "tool.envelope", key: "e", mod: false },
  { action: "tool.fade", key: "f", mod: false },
  { action: "tool.marker", key: "m", mod: false },
  { action: "tool.hand", key: "h", mod: false },
  { action: "tool.zoom", key: "z", mod: false },
];

export const KEYBOARD_SHORTCUT_ACTION_LABELS: Record<KeyboardShortcutAction, string> = {
  "transport.playPause": "Play/Pause",
  "transport.returnToStart": "Return to Start",
  "clip.nudgeLeft": "Nudge Left",
  "clip.nudgeRight": "Nudge Right",
  "edit.undo": "Undo",
  "edit.redo": "Redo",
  "edit.selectAll": "Select All",
  "edit.cut": "Cut",
  "edit.copy": "Copy",
  "edit.paste": "Paste",
  "edit.split": "Split",
  "edit.duplicate": "Duplicate",
  "edit.silence": "Silence",
  "edit.trim": "Trim",
  "edit.delete": "Delete",
  "project.save": "Save Session",
  "effect.noiseReduction": "Noise Reduction",
  "effect.captureNoisePrint": "Capture Noise Print",
  "view.zoomIn": "Zoom In",
  "view.zoomOut": "Zoom Out",
  "tool.select": "Tool: Select",
  "tool.razor": "Tool: Razor",
  "tool.marquee": "Tool: Marquee",
  "tool.envelope": "Tool: Envelope",
  "tool.fade": "Tool: Fade",
  "tool.marker": "Tool: Marker",
  "tool.hand": "Tool: Hand",
  "tool.zoom": "Tool: Zoom",
};

export const KEYBOARD_SHORTCUT_ACTION_OPTIONS = Object.entries(KEYBOARD_SHORTCUT_ACTION_LABELS).map(([value, label]) => ({
  value: value as KeyboardShortcutAction,
  label,
}));

export function normalizeEventKey(key: string): string {
  return key === " " ? "space" : key.toLowerCase();
}

export function formatKeyboardShortcut(shortcut: KeyboardShortcut): string {
  const parts = [
    shortcut.mod ? "Cmd/Ctrl" : "",
    shortcut.alt ? "Alt" : "",
    shortcut.shift ? "Shift" : "",
    shortcut.key === "space" ? "Space" : shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
  ].filter(Boolean);
  return parts.join("+");
}

export function keyboardShortcutPresetFileName(preset: KeyboardShortcutPreset): string {
  const base = (preset.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || preset.id || "shortcut-preset").slice(0, 64);
  return `${base}.rythme-shortcuts.json`;
}

export function parseKeyboardShortcutPresetJson(presetJson: string): { id?: string; name: string; shortcuts: KeyboardShortcut[] } | string {
  try {
    const parsed = JSON.parse(presetJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Keyboard shortcut preset JSON must be an object";
    const rec = parsed as Partial<KeyboardShortcutPreset>;
    const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : "Imported Shortcuts";
    const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : undefined;
    const shortcuts = normalizeKeyboardShortcuts(rec.shortcuts);
    if (shortcuts.length === 0) return "Keyboard shortcut preset must include at least one supported shortcut";
    return { id, name, shortcuts };
  } catch {
    return "Keyboard shortcut preset JSON could not be parsed";
  }
}

export function globalKeyboardShortcutPresetStorage(): KeyboardShortcutPresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadGlobalKeyboardShortcutPresets(storage = globalKeyboardShortcutPresetStorage()): KeyboardShortcutPreset[] {
  if (!storage) return [];
  try {
    return normalizeKeyboardShortcutPresets(JSON.parse(storage.getItem(GLOBAL_KEYBOARD_SHORTCUT_PRESETS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function upsertGlobalKeyboardShortcutPreset(
  preset: { id?: string; name: string; shortcuts?: KeyboardShortcut[] },
  storage = globalKeyboardShortcutPresetStorage(),
): KeyboardShortcutPreset | null {
  if (!storage) return null;
  const current = loadGlobalKeyboardShortcutPresets(storage);
  const normalized = normalizeKeyboardShortcutPreset(preset, current.filter((entry) => entry.id !== preset.id));
  if (!normalized) return null;
  try {
    storage.setItem(GLOBAL_KEYBOARD_SHORTCUT_PRESETS_KEY, JSON.stringify([...current.filter((entry) => entry.id !== normalized.id), normalized]));
    return normalized;
  } catch {
    return null;
  }
}

export function deleteGlobalKeyboardShortcutPreset(id: string, storage = globalKeyboardShortcutPresetStorage()): KeyboardShortcutPreset[] {
  if (!storage) return [];
  const next = loadGlobalKeyboardShortcutPresets(storage).filter((preset) => preset.id !== id);
  try {
    storage.setItem(GLOBAL_KEYBOARD_SHORTCUT_PRESETS_KEY, JSON.stringify(next));
  } catch {
    return loadGlobalKeyboardShortcutPresets(storage);
  }
  return next;
}

export async function loadGlobalKeyboardShortcutPresetsAsync(storage = globalKeyboardShortcutPresetStorage()): Promise<KeyboardShortcutPreset[]> {
  const nativeJson = await readNativeGlobalKeyboardShortcutPresets();
  if (nativeJson !== null) {
    try {
      return normalizeKeyboardShortcutPresets(JSON.parse(nativeJson));
    } catch {
      return [];
    }
  }
  return loadGlobalKeyboardShortcutPresets(storage);
}

export async function upsertGlobalKeyboardShortcutPresetAsync(
  preset: { id?: string; name: string; shortcuts?: KeyboardShortcut[] },
  storage = globalKeyboardShortcutPresetStorage(),
): Promise<KeyboardShortcutPreset | null> {
  const current = await loadGlobalKeyboardShortcutPresetsAsync(storage);
  const normalized = normalizeKeyboardShortcutPreset(preset, current.filter((entry) => entry.id !== preset.id));
  if (!normalized) return null;
  const next = [...current.filter((entry) => entry.id !== normalized.id), normalized];
  const nativeSaved = await writeNativeGlobalKeyboardShortcutPresets(JSON.stringify(next));
  if (nativeSaved === true) return normalized;
  if (nativeSaved === false) return null;
  return upsertGlobalKeyboardShortcutPreset(normalized, storage);
}

export async function deleteGlobalKeyboardShortcutPresetAsync(id: string, storage = globalKeyboardShortcutPresetStorage()): Promise<KeyboardShortcutPreset[]> {
  const next = (await loadGlobalKeyboardShortcutPresetsAsync(storage)).filter((preset) => preset.id !== id);
  const nativeSaved = await writeNativeGlobalKeyboardShortcutPresets(JSON.stringify(next));
  if (nativeSaved === true) return next;
  if (nativeSaved === false) return loadGlobalKeyboardShortcutPresets(storage);
  return deleteGlobalKeyboardShortcutPreset(id, storage);
}

export function resolveKeyboardShortcut(event: KeyboardShortcutEventLike, customShortcuts: KeyboardShortcut[] = []): KeyboardShortcutAction | null {
  const customMatch = customShortcuts.find((shortcut) => shortcutMatches(event, shortcut));
  if (customMatch) return customMatch.action;
  const customActions = new Set(customShortcuts.map((shortcut) => shortcut.action));
  const defaultMatch = DEFAULT_KEYBOARD_SHORTCUTS.find((shortcut) => !customActions.has(shortcut.action) && shortcutMatches(event, shortcut));
  return defaultMatch?.action ?? null;
}

export function defaultKeyboardShortcutForAction(action: KeyboardShortcutAction): KeyboardShortcut | undefined {
  return DEFAULT_KEYBOARD_SHORTCUTS.find((shortcut) => shortcut.action === action);
}

export function effectiveKeyboardShortcuts(customShortcuts: KeyboardShortcut[] = []): KeyboardShortcut[] {
  const customActions = new Set(customShortcuts.map((shortcut) => shortcut.action));
  return [
    ...DEFAULT_KEYBOARD_SHORTCUTS.filter((shortcut) => !customActions.has(shortcut.action)),
    ...customShortcuts,
  ];
}

export function findKeyboardShortcutConflict(shortcut: KeyboardShortcut, customShortcuts: KeyboardShortcut[] = []): KeyboardShortcut | null {
  return effectiveKeyboardShortcuts(customShortcuts).find((candidate) => (
    candidate.action !== shortcut.action &&
    shortcutSignature(candidate) === shortcutSignature(shortcut)
  )) ?? null;
}

function shortcutSignature(shortcut: KeyboardShortcut): string {
  return [
    shortcut.key,
    shortcut.mod === true ? "mod" : "",
    shortcut.alt === true ? "alt" : "",
    shortcut.shift === true ? "shift" : "",
  ].join(":");
}

function normalizeKeyboardShortcutPresets(value: unknown): KeyboardShortcutPreset[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<KeyboardShortcutPreset[]>((presets, entry) => {
    const preset = normalizeKeyboardShortcutPreset(entry, presets);
    return preset ? [...presets, preset] : presets;
  }, []);
}

function normalizeKeyboardShortcutPreset(value: unknown, existing: KeyboardShortcutPreset[]): KeyboardShortcutPreset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Partial<KeyboardShortcutPreset>;
  const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : "Shortcut Preset";
  const shortcuts = normalizeKeyboardShortcuts(rec.shortcuts);
  if (shortcuts.length === 0) return null;
  const requestedId = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : keyboardShortcutPresetIdForName(name, existing);
  return { id: uniquePresetId(requestedId, existing), name, shortcuts };
}

function uniquePresetId(id: string, existing: KeyboardShortcutPreset[]): string {
  const used = new Set(existing.map((preset) => preset.id));
  if (!used.has(id)) return id;
  let suffix = 2;
  while (used.has(`${id}-${suffix}`)) suffix++;
  return `${id}-${suffix}`;
}

async function readNativeGlobalKeyboardShortcutPresets(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const core = await import("@tauri-apps/api/core");
    return await core.invoke<string>("read_global_keyboard_shortcut_presets");
  } catch {
    return null;
  }
}

async function writeNativeGlobalKeyboardShortcutPresets(presetsJson: string): Promise<boolean | null> {
  if (!isTauriRuntime()) return null;
  try {
    const core = await import("@tauri-apps/api/core");
    await core.invoke("write_global_keyboard_shortcut_presets", { presetsJson });
    return true;
  } catch {
    return false;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

function shortcutMatches(event: KeyboardShortcutEventLike, shortcut: KeyboardShortcut): boolean {
  return (
    normalizeEventKey(event.key) === shortcut.key &&
    modifierMatches(shortcut.mod, event.metaKey || event.ctrlKey) &&
    modifierMatches(shortcut.alt, event.altKey) &&
    modifierMatches(shortcut.shift, event.shiftKey)
  );
}

function modifierMatches(expected: boolean | undefined, actual: boolean): boolean {
  return expected === undefined || expected === actual;
}
