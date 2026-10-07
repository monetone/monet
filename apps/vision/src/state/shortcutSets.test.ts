import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadShortcutSets, loadShortcutSetSelection, parseShortcutSet, putShortcutSet, sameShortcuts, saveShortcutSets, serializeShortcutSet,
} from "./shortcutSets";

const commands = [
  { id: "lv", label: "Levels", defaultChord: "Mod+KeyL" },
  { id: "cv", label: "Curves", defaultChord: "Mod+KeyM" },
  { id: "tool-b", label: "Brush", defaultChord: "KeyB" },
  { id: "tool-d", label: "Default Colors", defaultChord: "KeyD" },
];
const file = (patch: Record<string, unknown> = {}) => JSON.stringify({
  format: "monet-shortcut-set", version: 1, name: "Retouch", shortcuts: { lv: "Mod+Alt+KeyL", cv: null, "tool-b": "KeyN" }, ...patch,
});

describe("portable keyboard shortcut sets", () => {
  let profile: Map<string, string>;
  beforeEach(() => {
    profile = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => profile.get(key) ?? null,
      setItem: (key: string, value: string) => profile.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves, replaces, deletes, and transfers bindings independently of a profile's active workspace", () => {
    const imported = parseShortcutSet(file(), commands);
    expect(loadShortcutSets()).toEqual([]);
    let sets = putShortcutSet([], " Retouch ", imported.shortcuts);
    saveShortcutSets(sets, "Retouch");
    expect(loadShortcutSetSelection()).toBe("Retouch");
    expect(loadShortcutSets()).toEqual([imported]);
    expect(sameShortcuts(imported.shortcuts, { "tool-b": "KeyN", cv: null, lv: "Mod+Alt+KeyL" })).toBe(true);
    expect(sameShortcuts(imported.shortcuts, { lv: "Mod+KeyL" })).toBe(false);

    const exported = serializeShortcutSet(loadShortcutSets()[0]);
    profile = new Map([["mv.keyboardShortcuts", '{"cv":"Mod+Alt+KeyC"}']]);
    const transferred = parseShortcutSet(exported, commands);
    saveShortcutSets(putShortcutSet(loadShortcutSets(), transferred.name, transferred.shortcuts));
    expect(loadShortcutSets()).toEqual([imported]);
    expect(profile.get("mv.keyboardShortcuts")).toBe('{"cv":"Mod+Alt+KeyC"}');

    sets = putShortcutSet(loadShortcutSets(), "Retouch", { lv: null }, true, commands);
    saveShortcutSets(sets);
    expect(loadShortcutSets()[0].shortcuts).toEqual({ lv: null });
    saveShortcutSets(sets.filter((set) => set.name !== "Retouch"));
    expect(loadShortcutSets()).toEqual([]);
    expect(loadShortcutSetSelection()).toBeNull();
  });

  it("rejects invalid files and conflicts instead of partially loading bindings", () => {
    for (const input of [
      "{", "[]", file({ version: 2 }), file({ format: "other" }),
      file({ name: " " }), file({ name: "x".repeat(81) }), file({ name: "bad\nname" }),
      file({ shortcuts: [] }), file({ shortcuts: { lv: 3 } }),
      file({ shortcuts: { lv: "Alt+Mod+KeyL" } }),
      file({ shortcuts: { missing: "Mod+KeyP" } }),
      file({ shortcuts: { "tool-b": "Mod+KeyB" } }),
      file({ shortcuts: JSON.parse('{"__proto__":null}') }),
      file({ shortcuts: { lv: "Mod+KeyM" } }),
      file({ shortcuts: { lv: "Shift+KeyB" } }),
      " ".repeat(256 * 1024 + 1),
    ]) expect(() => parseShortcutSet(input, commands), input.slice(0, 100)).toThrow();
    expect(profile.size).toBe(0);
    expect(parseShortcutSet(file({ shortcuts: { lv: "Mod+KeyM", cv: null } }), commands).shortcuts).toEqual({ lv: "Mod+KeyM", cv: null });
    expect(parseShortcutSet(file({ shortcuts: { "tool-b": "KeyD" } }), commands).shortcuts).toEqual({ "tool-b": "KeyD", "tool-d": null });
  });

  it("protects built-ins and duplicate names and leaves persisted sets intact on invalid or failed saves", () => {
    const sets = putShortcutSet([], "Retouch", {});
    saveShortcutSets(sets);
    for (const name of ["Retouch", " retouch ", "Monet Defaults", "monet defaults"]) {
      expect(() => putShortcutSet(sets, name, {})).toThrow();
    }
    expect(() => saveShortcutSets([...sets, { name: "", shortcuts: {} }])).toThrow();
    expect(loadShortcutSets()).toEqual(sets);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    expect(() => saveShortcutSets([])).toThrow("Storage full");
    expect(loadShortcutSets()).toEqual(sets);
  });

  it("reports corrupt saved sets without replacing them", () => {
    for (const text of ["{", '{"version":2,"sets":[]}', '{"version":1,"sets":[{"name":"bad"}]}']) {
      profile.set("mv.keyboardShortcutSets", text);
      expect(() => loadShortcutSets()).toThrow();
      expect(profile.get("mv.keyboardShortcutSets")).toBe(text);
    }
    profile.set("mv.keyboardShortcutSets", "{");
    expect(() => loadShortcutSetSelection()).toThrow("Saved shortcut sets are unreadable");
  });
});
