import {
  normalizeShortcutOverrides, preserveToolActionOverrides, shortcutConflict,
  type ShortcutCommand, type ShortcutOverrides,
} from "./keyboardShortcuts";

export interface ShortcutSet { name: string; shortcuts: ShortcutOverrides }
type Commands = readonly Pick<ShortcutCommand, "id" | "label" | "defaultChord">[];
export const DEFAULT_SHORTCUT_SET_NAME = "Monet Defaults";
export const SHORTCUT_SET_FILTERS = [{ name: "Monet Shortcut Set", extensions: ["monetkeys"] }];
export const SHORTCUT_SET_LIMIT = { maxBytes: 256 * 1024, label: "shortcut set" };
const STORAGE_KEY = "mv.keyboardShortcutSets";
const UNREADABLE = "Saved shortcut sets are unreadable. Export your current shortcuts before replacing the saved sets.";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateSet(value: unknown, commands?: Commands): ShortcutSet {
  if (!record(value) || typeof value.name !== "string" || !record(value.shortcuts)) {
    throw new Error("Choose a Monet .monetkeys file containing a name and shortcuts.");
  }
  const name = value.name.trim();
  if (!name || name.length > 80 || Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error("Enter a shortcut set name of 1–80 characters without control characters.");
  }
  const shortcuts = normalizeShortcutOverrides(value.shortcuts, commands && new Set(commands.map((command) => command.id)));
  for (const [id, chord] of Object.entries(value.shortcuts)) {
    if (!Object.hasOwn(shortcuts, id) || shortcuts[id] !== chord) {
      throw new Error(`Invalid or unknown shortcut “${id}”. Use a supported command and shortcut, then import again.`);
    }
  }
  const next = preserveToolActionOverrides(shortcuts);
  if (commands) {
    for (const [id, chord] of Object.entries(next)) {
      const command = commands.find((item) => item.id === id);
      // Contextual aliases intentionally share defaults (for example Group).
      if (!command || chord === command.defaultChord) continue;
      const conflict = shortcutConflict(next, commands, id, chord);
      if (conflict) throw new Error(`${command.label} conflicts with ${conflict.label}. Remove the duplicate shortcut and import again.`);
    }
  }
  return { name, shortcuts: next };
}

export function parseShortcutSet(text: string, commands?: Commands): ShortcutSet {
  if (new TextEncoder().encode(text).byteLength > SHORTCUT_SET_LIMIT.maxBytes) throw new Error("Shortcut set exceeds the 256 KiB limit.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Shortcut set is not valid JSON. Choose a Monet .monetkeys file."); }
  if (!record(value) || value.format !== "monet-shortcut-set" || value.version !== 1) {
    throw new Error("Unsupported shortcut set format or version. Export a .monetkeys file from Monet Vision.");
  }
  return validateSet(value, commands);
}

export function serializeShortcutSet(set: ShortcutSet): string {
  return JSON.stringify({ format: "monet-shortcut-set", version: 1, ...validateSet(set) }, null, 2);
}

export function putShortcutSet(sets: readonly ShortcutSet[], name: string, shortcuts: ShortcutOverrides, replace = false, commands?: Commands): ShortcutSet[] {
  const set = validateSet({ name, shortcuts }, commands);
  if (set.name.toLowerCase() === DEFAULT_SHORTCUT_SET_NAME.toLowerCase()) throw new Error("Monet Defaults cannot be overwritten. Choose another name.");
  const index = sets.findIndex((item) => item.name.toLowerCase() === set.name.toLowerCase());
  if (index >= 0 && !replace) throw new Error(`A shortcut set named “${set.name}” already exists. Choose another name or use Save.`);
  return index < 0 ? [...sets, set] : sets.map((item, i) => i === index ? set : item);
}

export function sameShortcuts(a: ShortcutOverrides, b: ShortcutOverrides): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([id, chord]) => Object.hasOwn(b, id) && b[id] === chord);
}

export function loadShortcutSets(): ShortcutSet[] {
  const text = localStorage.getItem(STORAGE_KEY);
  if (!text) return [];
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(UNREADABLE); }
  if (!record(value) || value.version !== 1 || !Array.isArray(value.sets)) throw new Error("Unsupported saved shortcut sets version.");
  return value.sets.reduce<ShortcutSet[]>((sets, value) => {
    const set = validateSet(value);
    return putShortcutSet(sets, set.name, set.shortcuts);
  }, []);
}

export function loadShortcutSetSelection(): string | null {
  let value: unknown;
  try { value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"); } catch { throw new Error(UNREADABLE); }
  return record(value) && typeof value.selected === "string" ? value.selected : null;
}

/** Persist the library in one write; let callers report storage failures before applying preferences. */
export function saveShortcutSets(sets: readonly ShortcutSet[], selected?: string | null): void {
  const checked = sets.reduce<ShortcutSet[]>((out, set) => putShortcutSet(out, set.name, set.shortcuts), []);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, sets: checked,
    ...(selected === "" || checked.some((set) => set.name === selected) ? { selected } : {}),
  }));
}
