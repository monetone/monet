import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { MenuBarEntry } from "@monet-ui/monet-react";
import { buildPhotoshopMenus } from "../ui/psMenus";
import {
  applyShortcutOverrides,
  collectShortcutCommands,
  formatShortcut,
  isToolShortcutAllowed,
  normalizeShortcutOverrides,
  parseShortcutLabel,
  preserveToolActionOverrides,
  reassignShortcut,
  shortcutCommandMap,
  shortcutConflict,
  shortcutFromEvent,
  toolShortcutFromEvent,
} from "./keyboardShortcuts";

const key = (patch: Partial<KeyboardEvent>): KeyboardEvent => ({
  altKey: false,
  code: "",
  ctrlKey: false,
  key: "",
  metaKey: false,
  shiftKey: false,
  ...patch,
} as KeyboardEvent);

const menus = (levels = vi.fn(), curves = vi.fn()): MenuBarEntry[] => [{
  id: "image",
  label: "Image",
  items: [{
    id: "adjustments",
    label: "Adjustments",
    items: [
      { id: "lv", label: "Levels…", shortcut: "⌘L", action: levels },
      { id: "cv", label: "Curves…", shortcut: "⌘M", action: curves },
    ],
  }],
}];

describe("keyboard shortcuts", () => {
  it("canonicalizes events and Photoshop labels without layout-dependent key values", () => {
    expect(shortcutFromEvent(key({ code: "KeyL", key: "¬", metaKey: true, altKey: true }))).toBe("Mod+Alt+KeyL");
    expect(formatShortcut("Mod+Alt+KeyL", "mac")).toBe("⌥⌘L");
    expect(formatShortcut("Mod+Alt+KeyL", "windows")).toBe("Ctrl+Alt+L");
    expect(parseShortcutLabel("⌥⇧⌘K")).toBe("Mod+Alt+Shift+KeyK");
    expect(shortcutFromEvent(key({ code: "Equal", key: "+", metaKey: true, shiftKey: true }))).toBe("Mod+Equal");
    expect(shortcutFromEvent(key({ code: "KeyB", key: "b" }))).toBeNull();
    expect(toolShortcutFromEvent(key({ code: "KeyB", key: "B", shiftKey: true }))).toBe("KeyB");
    expect(toolShortcutFromEvent(Object.create(key({ code: "KeyN", key: "n" })) as KeyboardEvent)).toBe("KeyN");
    expect(toolShortcutFromEvent(key({ code: "KeyB", key: "b", metaKey: true }))).toBeNull();
    expect(toolShortcutFromEvent(key({ code: "BracketLeft", key: "[" }))).toBe("BracketLeft");
    expect(toolShortcutFromEvent(key({ code: "BracketRight", key: "}", shiftKey: true }))).toBe("Shift+BracketRight");
    expect(toolShortcutFromEvent(key({ code: "Comma", key: "," }))).toBe("Comma");
    expect(toolShortcutFromEvent(key({ code: "Comma", key: "<", shiftKey: true }))).toBe("Shift+Comma");
    expect(toolShortcutFromEvent(key({ code: "Period", key: ">", shiftKey: true }))).toBe("Shift+Period");
    expect(toolShortcutFromEvent(key({ code: "BracketLeft", key: "[", altKey: true }))).toBeNull();
    expect(isToolShortcutAllowed("tool-brush-preset-previous", "Comma")).toBe(true);
    expect(isToolShortcutAllowed("tool-brush-preset-first", "Shift+Comma")).toBe(true);
    expect(isToolShortcutAllowed("tool-brush-preset-previous", "BracketLeft")).toBe(false);
  });

  it("applies an override to menu hints and dispatches only the effective chord", () => {
    const levels = vi.fn();
    const base = menus(levels);
    const commands = collectShortcutCommands(base, { lv: "Mod+Alt+KeyL" });
    expect(shortcutCommandMap(commands).has("Mod+KeyL")).toBe(false);
    shortcutCommandMap(commands).get("Mod+Alt+KeyL")?.run();
    expect(levels).toHaveBeenCalledOnce();

    const custom = applyShortcutOverrides(base, { lv: "Mod+Alt+KeyL", cv: null }, "mac");
    const items = custom[0].items[0].items!;
    expect(items[0].shortcut).toBe("⌥⌘L");
    expect(items[1].shortcut).toBeUndefined();
  });

  it("dispatches a shared contextual chord to its later menu owner", () => {
    const first = vi.fn();
    const contextual = vi.fn();
    const commands = collectShortcutCommands([{
      id: "layer",
      label: "Layer",
      items: [
        { id: "newgroup", label: "New Group…", shortcut: "⌘G", action: first },
        { id: "grp", label: "Group Layers", shortcut: "⌘G", action: contextual },
      ],
    }], {});
    shortcutCommandMap(commands).get("Mod+KeyG")?.run();
    expect(first).not.toHaveBeenCalled();
    expect(contextual).toHaveBeenCalledOnce();
  });

  it("reports conflicts, transfers ownership, restores defaults, and rejects malformed persistence", () => {
    const commands = collectShortcutCommands(menus(), {});
    expect(shortcutConflict({}, commands, "cv", "Mod+KeyL")?.id).toBe("lv");
    const moved = reassignShortcut({}, commands, "cv", "Mod+KeyL");
    expect(moved).toEqual({ lv: null, cv: "Mod+KeyL" });
    expect(reassignShortcut(moved, commands, "cv", "Mod+KeyM")).toEqual({ lv: null });

    expect(normalizeShortcutOverrides({
      lv: "Mod+Alt+KeyL",
      cv: "Alt+Mod+KeyM",
      "tool-b": "KeyN",
      "tool-v": "BracketLeft",
      "tool-d": "BracketRight",
      "tool-screen-mode": "BracketLeft",
      "tool-brush-size-decrease": "BracketLeft",
      "tool-brush-hardness-increase": "Shift+BracketRight",
      "tool-brush-preset-previous": "Comma",
      "tool-brush-preset-next": "Shift+Period",
      "tool-brush-preset-first": "BracketLeft",
      "tool-brush-preset-last": "Shift+Comma",
      "tool-bad": "Mod+KeyB",
      unknown: "Mod+KeyU",
      bad: 42,
    }, new Set(["lv", "cv", "tool-b", "tool-v", "tool-d", "tool-screen-mode", "tool-brush-size-decrease", "tool-brush-hardness-increase", "tool-brush-preset-previous", "tool-brush-preset-next", "tool-brush-preset-first", "tool-brush-preset-last", "tool-bad"]))).toEqual({
      lv: "Mod+Alt+KeyL",
      "tool-b": "KeyN",
      "tool-d": "BracketRight",
      "tool-brush-size-decrease": "BracketLeft",
      "tool-brush-hardness-increase": "Shift+BracketRight",
      "tool-brush-preset-previous": "Comma",
      "tool-brush-preset-next": "Shift+Period",
      "tool-brush-preset-last": "Shift+Comma",
    });
    expect(preserveToolActionOverrides({ "tool-b": "KeyD" })).toEqual({ "tool-b": "KeyD", "tool-d": null });
    expect(preserveToolActionOverrides({ "tool-b": "KeyD", "tool-d": "KeyN" })).toEqual({ "tool-b": "KeyD", "tool-d": "KeyN" });
    expect(preserveToolActionOverrides({ "tool-b": "KeyF" })).toEqual({ "tool-b": "KeyF", "tool-screen-mode": null });
    expect(preserveToolActionOverrides({ lv: "Shift+KeyF" })).toEqual({ lv: "Shift+KeyF", "tool-screen-mode": null });
    expect(preserveToolActionOverrides({ lv: "Shift+BracketLeft" })).toEqual({
      lv: "Shift+BracketLeft",
      "tool-brush-hardness-decrease": null,
    });
    expect(preserveToolActionOverrides({ lv: "Shift+Comma" })).toEqual({
      lv: "Shift+Comma",
      "tool-brush-preset-first": null,
    });
  });

  it("reserves shifted Tools-letter companions and exact punctuation across categories", () => {
    const commands = [
      { id: "lv", label: "Image ▸ Adjustments ▸ Levels…", defaultChord: "Mod+KeyL" },
      { id: "tool-screen-mode", label: "Toggle Screen Modes", defaultChord: "KeyF" },
    ];
    expect(shortcutConflict({}, commands, "lv", "Shift+KeyF")?.id).toBe("tool-screen-mode");
    expect(reassignShortcut({}, commands, "lv", "Shift+KeyF")).toEqual({
      lv: "Shift+KeyF",
      "tool-screen-mode": null,
    });

    const appOwnsN = { lv: "Shift+KeyN" };
    expect(shortcutConflict(appOwnsN, commands, "tool-screen-mode", "KeyN")?.id).toBe("lv");
    expect(reassignShortcut(appOwnsN, commands, "tool-screen-mode", "KeyN")).toEqual({
      lv: null,
      "tool-screen-mode": "KeyN",
    });

    const brackets = [
      commands[0],
      { id: "tool-brush-size-decrease", label: "Decrease Brush Size", defaultChord: "BracketLeft" },
      { id: "tool-brush-hardness-decrease", label: "Decrease Brush Hardness", defaultChord: "Shift+BracketLeft" },
    ];
    expect(shortcutConflict({}, brackets, "lv", "Shift+BracketLeft")?.id).toBe("tool-brush-hardness-decrease");
    const presets = [
      commands[0],
      { id: "tool-brush-preset-previous", label: "Select Previous Brush Preset", defaultChord: "Comma" },
      { id: "tool-brush-preset-first", label: "Select First Brush Preset", defaultChord: "Shift+Comma" },
    ];
    expect(shortcutConflict({}, presets.slice(0, 2), "lv", "Shift+Comma")).toBeNull();
    expect(shortcutConflict({}, presets, "lv", "Shift+Comma")?.id).toBe("tool-brush-preset-first");
    expect(reassignShortcut({}, presets, "lv", "Shift+Comma")).toEqual({
      lv: "Shift+Comma",
      "tool-brush-preset-first": null,
    });
    expect(shortcutConflict({}, commands, "lv", "Mod+Shift+KeyF")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// The shortcut editor's catalog (#501)
// ─────────────────────────────────────────────────────────────
// Edit ▸ Keyboard Shortcuts listed the commands that were runnable at the
// moment it opened, which is a different set from the commands that HAVE a
// shortcut. ⌘Z with nothing to undo is still ⌘Z: it has to be listed, so it can
// be rebound and so a reassignment of ⌘Z is reported as the conflict it is.
describe("the shortcut editor catalog", () => {
  const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
  const dialogsSource = readFileSync(fileURLToPath(new URL("../ui/Dialogs.tsx", import.meta.url)), "utf8");
  const actions = { undo: () => {}, redo: () => {} };

  it("drops a disabled command from the runnable list", () => {
    // Not a defect — this list is what dispatch and Edit ▸ Search run.
    const runnable = buildPhotoshopMenus(
      actions, [], () => {}, undefined, undefined, undefined, new Set(), false, new Set(), { undo: false },
    );
    expect(collectShortcutCommands(runnable, {}).some((c) => c.id === "undo")).toBe(false);
  });

  it("keeps it in the unfiltered tree the editor is built from", () => {
    const catalog = buildPhotoshopMenus(
      actions, [], () => {}, undefined, undefined, undefined, new Set(), false, new Set(), {},
    );
    const commands = collectShortcutCommands(catalog, {});
    const undo = commands.find((c) => c.id === "undo");
    expect(undo, "⌘Z is listed even when there is nothing to undo").toBeDefined();
    expect(undo!.defaultChord).toBeTruthy();
  });

  it("is what the app publishes and the editor reads", () => {
    expect(appSource).toContain("commandPalette.catalog = shortcutCatalog");
    expect(appSource).toMatch(/catalogMenus\s*=\s*useMemo\(\(\)\s*=>\s*buildMenus\(NO_HIDDEN, \{\}\)/);
    expect(dialogsSource).toContain("commandPalette.catalog");
  });
});
