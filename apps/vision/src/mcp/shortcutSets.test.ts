import { afterEach, beforeEach, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({
  store: {
    state: { keyboardShortcuts: {} as Record<string, string | null> },
    setKeyboardShortcuts(value: Record<string, string | null>) { app.store.state.keyboardShortcuts = value; },
  },
  commandPalette: { catalog: [
    { id: "lv", label: "Levels", defaultChord: "Mod+KeyL" },
    { id: "cv", label: "Curves", defaultChord: "Mod+KeyM" },
  ], items: [], toolItems: [] },
}));
vi.mock("../state/app", () => app);

import {
  deleteKeyboardShortcutSet, exportKeyboardShortcutSet, importKeyboardShortcutSet,
  listShortcutSets, saveKeyboardShortcutSet, selectKeyboardShortcutSet,
} from "./commands";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  app.store.state.keyboardShortcuts = { lv: "Mod+Alt+KeyL" };
});
afterEach(() => vi.unstubAllGlobals());

it("manages shortcut sets through MCP using the same validated library and current workspace bindings", () => {
  saveKeyboardShortcutSet("Retouch");
  expect(JSON.parse(listShortcutSets())).toMatchObject({ selected: "Retouch", sets: [{ name: "Monet Defaults" }, { name: "Retouch" }] });
  const exported = exportKeyboardShortcutSet();
  selectKeyboardShortcutSet("Monet Defaults");
  expect(app.store.state.keyboardShortcuts).toEqual({});
  selectKeyboardShortcutSet("Retouch");
  expect(app.store.state.keyboardShortcuts).toEqual({ lv: "Mod+Alt+KeyL" });
  expect(() => saveKeyboardShortcutSet("Retouch")).toThrow("already exists");
  app.store.state.keyboardShortcuts = { lv: null };
  saveKeyboardShortcutSet("Retouch", true);
  expect(JSON.parse(exportKeyboardShortcutSet("Retouch")).shortcuts).toEqual({ lv: null });
  // MCP has no Save button: the refusal names the set and the flag that overrides it.
  expect(() => importKeyboardShortcutSet(exported)).toThrow(/“Retouch” already exists.*replace: true/);
  importKeyboardShortcutSet(exported, true);
  expect(app.store.state.keyboardShortcuts).toEqual({ lv: "Mod+Alt+KeyL" });
  deleteKeyboardShortcutSet("Retouch");
  expect(app.store.state.keyboardShortcuts).toEqual({});
  expect(JSON.parse(listShortcutSets()).sets).toHaveLength(1);
  expect(JSON.parse(exportKeyboardShortcutSet("Monet Defaults")).shortcuts).toEqual({});
});

it("refuses invalid input and failed persistence without changing the active shortcuts or existing sets", () => {
  saveKeyboardShortcutSet("Retouch");
  const before = listShortcutSets();
  expect(() => importKeyboardShortcutSet("{")).toThrow("valid JSON");
  expect(() => importKeyboardShortcutSet(JSON.stringify({
    format: "monet-shortcut-set", version: 1, name: "Conflicting", shortcuts: { lv: "Mod+KeyM" },
  }))).toThrow("conflicts");
  expect(() => selectKeyboardShortcutSet("Missing")).toThrow("No shortcut set");
  expect(() => deleteKeyboardShortcutSet("Monet Defaults")).toThrow("cannot be deleted");
  expect(listShortcutSets()).toBe(before);
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
  expect(() => selectKeyboardShortcutSet("Monet Defaults")).toThrow("Storage full");
  expect(listShortcutSets()).toBe(before);
});

it("reports unreadable saved sets with an actionable error instead of a raw parse error", () => {
  localStorage.setItem("mv.keyboardShortcutSets", "{");
  expect(() => listShortcutSets()).toThrow("Saved shortcut sets are unreadable");
});

it("deleting a saved set does not overwrite unrelated workspace-carried shortcuts", () => {
  saveKeyboardShortcutSet("Retouch");
  app.store.state.keyboardShortcuts = { cv: "Mod+Alt+KeyM" };
  deleteKeyboardShortcutSet("Retouch");
  expect(app.store.state.keyboardShortcuts).toEqual({ cv: "Mod+Alt+KeyM" });
});
