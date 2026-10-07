import type { MenuBarEntry, MenuItemDef } from "@monet-ui/monet-react";

export type ShortcutChord = string;
export type ShortcutOverrides = Record<string, ShortcutChord | null>;

export interface ShortcutCommand {
  id: string;
  label: string;
  defaultChord: ShortcutChord | null;
  chord: ShortcutChord | null;
  run: () => void;
  cycle?: () => void;
  shiftRun?: () => void;
  repeatable?: boolean;
}

const STORAGE_KEY = "mv.keyboardShortcuts";
export const TOOL_ACTION_SHORTCUT_DEFAULTS = {
  "tool-d": "KeyD",
  "tool-x": "KeyX",
  "tool-q": "KeyQ",
  "tool-screen-mode": "KeyF",
  "tool-brush-size-decrease": "BracketLeft",
  "tool-brush-size-increase": "BracketRight",
  "tool-brush-hardness-decrease": "Shift+BracketLeft",
  "tool-brush-hardness-increase": "Shift+BracketRight",
  "tool-brush-preset-previous": "Comma",
  "tool-brush-preset-next": "Period",
  "tool-brush-preset-first": "Shift+Comma",
  "tool-brush-preset-last": "Shift+Period",
  // Photoshop's `\`: preview the active layer's mask as a red rubylith.
  "tool-mask-rubylith": "Backslash",
} as const satisfies Record<string, ShortcutChord>;
const CODE_RE = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Backspace|Delete|Enter|Escape|Space|Tab|Arrow(?:Up|Down|Left|Right)|Bracket(?:Left|Right)|Semicolon|Quote|Slash|Backslash|Comma|Period|Minus|Equal)$/;

const LABEL_CODE: Record<string, string> = {
  "⌫": "Backspace",
  "⌦": "Delete",
  "↩": "Enter",
  "←": "ArrowLeft",
  "→": "ArrowRight",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "[": "BracketLeft",
  "]": "BracketRight",
  ";": "Semicolon",
  "'": "Quote",
  "/": "Slash",
  "\\": "Backslash",
  ",": "Comma",
  ".": "Period",
  "-": "Minus",
  "+": "Equal",
};

const CODE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(LABEL_CODE).map(([label, code]) => [code, label]),
);

function keyCode(code: string, key: string): string | null {
  if (CODE_RE.test(code)) return code;
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return LABEL_CODE[key] ?? null;
}

function chord(parts: readonly string[], code: string): ShortcutChord {
  return [...parts, code].join("+");
}

export function shortcutFromEvent(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  allowBare = false,
): ShortcutChord | null {
  const code = keyCode(event.code, event.key);
  if (!code || ["AltLeft", "AltRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight", "ShiftLeft", "ShiftRight"].includes(event.code)) return null;
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  // Photoshop writes Command + Plus as ⌘+ even though Plus needs Shift on
  // many layouts. Treat that physical chord as Mod+Equal so the displayed and
  // dispatched defaults agree across keyboard layouts.
  if (event.shiftKey && !(code === "Equal" && event.key === "+")) parts.push("Shift");
  const value = chord(parts, code);
  return isShortcutChord(value, allowBare) ? value : null;
}

/** Photoshop tool bindings use physical letters or paint-action punctuation.
 *  Shift cycles a letter flyout, but remains an exact part of punctuation
 *  actions such as brush hardness or first/last preset. */
export function toolShortcutFromEvent(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
): ShortcutChord | null {
  const letter = /^Key[A-Z]$/.test(event.code);
  const bracket = /^Bracket(?:Left|Right)$/.test(event.code);
  const presetNavigation = /^(?:Comma|Period)$/.test(event.code);
  const maskPreview = event.code === "Backslash"; // `\` — mask rubylith
  if (event.altKey || event.ctrlKey || event.metaKey || (!letter && !bracket && !presetNavigation && !maskPreview)) return null;
  return shortcutFromEvent({
    altKey: false,
    code: event.code,
    ctrlKey: false,
    key: event.key,
    metaKey: false,
    shiftKey: (bracket || presetNavigation || maskPreview) && event.shiftKey,
  }, true);
}

export function isToolShortcutAllowed(id: string, value: ShortcutChord): boolean {
  return /^Key[A-Z]$/.test(value)
    || (/^tool-brush-preset-(?:previous|next|first|last)$/.test(id) && /^(?:Shift\+)?(?:Comma|Period)$/.test(value))
    || (id !== "tool-screen-mode" && !/^tool-brush-preset-(?:previous|next|first|last)$/.test(id)
      && Object.hasOwn(TOOL_ACTION_SHORTCUT_DEFAULTS, id)
      && /^(?:Shift\+)?(?:Bracket(?:Left|Right)|Backslash)$/.test(value));
}

function shortcutChordsOverlap(
  firstId: string,
  first: ShortcutChord | null,
  secondId: string,
  second: ShortcutChord | null,
): boolean {
  if (!first || !second) return false;
  if (first === second) return true;
  const firstTool = firstId.startsWith("tool-");
  const secondTool = secondId.startsWith("tool-");
  if (firstTool === secondTool) return false;
  const tool = firstTool ? first : second;
  const application = firstTool ? second : first;
  return /^Key[A-Z]$/.test(tool) && application === `Shift+${tool}`;
}

export function parseShortcutLabel(label: string | undefined): ShortcutChord | null {
  if (!label) return null;
  let rest = label;
  const parts: string[] = [];
  if (rest.includes("⌘")) parts.push("Mod");
  if (rest.includes("⌥")) parts.push("Alt");
  if (rest.includes("⇧")) parts.push("Shift");
  rest = rest.replace(/[⌘⌥⇧]/g, "");
  let code = LABEL_CODE[rest];
  if (!code && /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(rest)) code = rest;
  if (!code && /^[A-Z]$/i.test(rest)) code = `Key${rest.toUpperCase()}`;
  if (!code && /^[0-9]$/.test(rest)) code = `Digit${rest}`;
  const value = code ? chord(parts, code) : "";
  return isShortcutChord(value) ? value : null;
}

export function isShortcutChord(value: unknown, allowBare = false): value is ShortcutChord {
  if (typeof value !== "string") return false;
  const parts = value.split("+");
  const code = parts.pop();
  if (!code || !CODE_RE.test(code)) return false;
  const mods = new Set(parts);
  if (mods.size !== parts.length || parts.some((part) => !["Mod", "Alt", "Shift"].includes(part))) return false;
  if (parts.join("+") !== ["Mod", "Alt", "Shift"].filter((part) => mods.has(part)).join("+")) return false;
  // Bare letters/punctuation belong to Photoshop's separate Tools category.
  return allowBare || mods.size > 0 || /^F/.test(code) || code === "Backspace" || code === "Delete";
}

export function formatShortcut(value: ShortcutChord | null, platform: "mac" | "windows" | "linux" = "mac"): string {
  if (!value) return "";
  const parts = value.split("+");
  const code = parts.pop()!;
  const base = CODE_LABEL[code]
    ?? (code.startsWith("Key") ? code.slice(3) : code.startsWith("Digit") ? code.slice(5) : code);
  if (platform === "mac") {
    return `${parts.includes("Alt") ? "⌥" : ""}${parts.includes("Shift") ? "⇧" : ""}${parts.includes("Mod") ? "⌘" : ""}${base}`;
  }
  return [...parts.map((part) => part === "Mod" ? "Ctrl" : part), base].join("+");
}

export function normalizeShortcutOverrides(value: unknown, knownIds?: ReadonlySet<string>): ShortcutOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ShortcutOverrides = {};
  for (const [id, candidate] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || (knownIds && !knownIds.has(id))) continue;
    const valid = id.startsWith("tool-")
      ? typeof candidate === "string" && isToolShortcutAllowed(id, candidate)
      : isShortcutChord(candidate);
    if (candidate === null || valid) out[id] = candidate;
  }
  return out;
}

/** Keep an existing custom tool binding when a newly editable action adopts
 *  the same default key. The action remains explicitly unbound until reset. */
export function preserveToolActionOverrides(overrides: ShortcutOverrides): ShortcutOverrides {
  const next = { ...overrides };
  for (const [id, defaultChord] of Object.entries(TOOL_ACTION_SHORTCUT_DEFAULTS)) {
    if (!Object.hasOwn(next, id) && Object.entries(next).some(([other, value]) => (
      other !== id && shortcutChordsOverlap(id, defaultChord, other, value)
    ))) {
      next[id] = null;
    }
  }
  return next;
}

export function loadShortcutOverrides(): ShortcutOverrides {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? preserveToolActionOverrides(normalizeShortcutOverrides(JSON.parse(value))) : {};
  } catch {
    return {};
  }
}

export function saveShortcutOverrides(overrides: ShortcutOverrides): void {
  try {
    if (Object.keys(overrides).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage may be unavailable */ }
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function collectShortcutCommands(menus: MenuBarEntry[], overrides: ShortcutOverrides): ShortcutCommand[] {
  const out: ShortcutCommand[] = [];
  const seen = new Set<string>();
  const walk = (items: MenuItemDef[], path: string) => {
    for (const item of items) {
      if (item.separator) continue;
      const label = text(item.label);
      const nextPath = path ? `${path} ▸ ${label}` : label;
      if (item.items) walk(item.items, nextPath);
      else if (item.action && !seen.has(item.id)) {
        seen.add(item.id);
        const defaultChord = parseShortcutLabel(item.shortcut);
        out.push({
          id: item.id,
          label: nextPath,
          defaultChord,
          chord: Object.hasOwn(overrides, item.id) ? overrides[item.id] : defaultChord,
          run: item.action,
        });
      }
    }
  };
  for (const menu of menus) walk(menu.items, text(menu.label));
  return out;
}

export function shortcutCommandMap(commands: readonly ShortcutCommand[]): Map<ShortcutChord, ShortcutCommand> {
  const out = new Map<ShortcutChord, ShortcutCommand>();
  // Photoshop's menu model has contextual aliases (notably both Layer ▸ New ▸
  // Group… and Group Layers use Command-G). The later, more specific menu entry
  // owns dispatch, matching Vision's established Group Layers key behavior.
  for (const command of commands) if (command.chord) out.set(command.chord, command);
  return out;
}

export function applyShortcutOverrides(
  menus: MenuBarEntry[],
  overrides: ShortcutOverrides,
  platform: "mac" | "windows" | "linux" = "mac",
): MenuBarEntry[] {
  const mapItems = (items: MenuItemDef[]): MenuItemDef[] => items.map((item) => {
    if (item.items) return { ...item, items: mapItems(item.items) };
    if (!item.action || !Object.hasOwn(overrides, item.id)) return item;
    const value = overrides[item.id];
    const next = { ...item };
    if (value) next.shortcut = formatShortcut(value, platform);
    else delete next.shortcut;
    return next;
  });
  return menus.map((menu) => ({ ...menu, items: mapItems(menu.items) }));
}

export function reassignShortcut(
  overrides: ShortcutOverrides,
  commands: readonly Pick<ShortcutCommand, "id" | "defaultChord">[],
  id: string,
  value: ShortcutChord | null,
): ShortcutOverrides {
  const next = { ...overrides };
  if (value) {
    for (const command of commands) {
      if (command.id === id) continue;
      const current = Object.hasOwn(next, command.id) ? next[command.id] : command.defaultChord;
      if (shortcutChordsOverlap(id, value, command.id, current)) next[command.id] = null;
    }
  }
  const command = commands.find((candidate) => candidate.id === id);
  if (value === command?.defaultChord) delete next[id];
  else next[id] = value;
  return next;
}

export function shortcutConflict(
  overrides: ShortcutOverrides,
  commands: readonly Pick<ShortcutCommand, "id" | "label" | "defaultChord">[],
  id: string,
  value: ShortcutChord | null,
): Pick<ShortcutCommand, "id" | "label"> | null {
  if (!value) return null;
  for (const command of commands) {
    if (command.id === id) continue;
    const current = Object.hasOwn(overrides, command.id) ? overrides[command.id] : command.defaultChord;
    if (shortcutChordsOverlap(id, value, command.id, current)) return command;
  }
  return null;
}
