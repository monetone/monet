import { describe, expect, it } from "vitest";
import { deleteGlobalKeyboardShortcutPreset, deleteGlobalKeyboardShortcutPresetAsync, effectiveKeyboardShortcuts, findKeyboardShortcutConflict, formatKeyboardShortcut, keyboardShortcutPresetFileName, loadGlobalKeyboardShortcutPresets, loadGlobalKeyboardShortcutPresetsAsync, parseKeyboardShortcutPresetJson, resolveKeyboardShortcut, upsertGlobalKeyboardShortcutPreset, upsertGlobalKeyboardShortcutPresetAsync, type KeyboardShortcutPresetStorage } from "./keyboard-shortcuts";

const ev = (key: string, opts: Partial<KeyboardEvent> = {}) => ({
  key,
  metaKey: opts.metaKey ?? false,
  ctrlKey: opts.ctrlKey ?? false,
  altKey: opts.altKey ?? false,
  shiftKey: opts.shiftKey ?? false,
});

function fakeStorage(seed: Record<string, string> = {}): KeyboardShortcutPresetStorage {
  const data = { ...seed };
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}

describe("keyboard shortcut resolver", () => {
  it("keeps built-in shortcuts when no custom override exists", () => {
    expect(resolveKeyboardShortcut(ev("k", { metaKey: true }))).toBe("edit.split");
    expect(resolveKeyboardShortcut(ev("v", { metaKey: true }))).toBe("edit.paste");
    expect(resolveKeyboardShortcut(ev("v"))).toBe("tool.select");
  });

  it("lets custom shortcuts override built-in gestures and old action keys", () => {
    const custom = [{ action: "edit.split" as const, key: "x", mod: true, shift: true, alt: false }];
    expect(resolveKeyboardShortcut(ev("x", { metaKey: true, shiftKey: true }), custom)).toBe("edit.split");
    expect(resolveKeyboardShortcut(ev("k", { metaKey: true }), custom)).toBeNull();
  });

  it("prioritizes a custom conflict over the default action on the same chord", () => {
    const custom = [{ action: "edit.silence" as const, key: "k", mod: true, shift: false, alt: false }];
    expect(resolveKeyboardShortcut(ev("k", { metaKey: true }), custom)).toBe("edit.silence");
  });

  it("formats persisted shortcut labels", () => {
    expect(formatKeyboardShortcut({ action: "transport.playPause", key: "space", mod: true, shift: true })).toBe("Cmd/Ctrl+Shift+Space");
  });

  it("builds the effective shortcut list with custom overrides replacing defaults", () => {
    const custom = [{ action: "edit.split" as const, key: "x", mod: true, shift: true, alt: false }];
    const effective = effectiveKeyboardShortcuts(custom);
    expect(effective.some((shortcut) => shortcut.action === "edit.split" && shortcut.key === "k")).toBe(false);
    expect(effective).toContainEqual(custom[0]);
  });

  it("detects conflicts against active default and custom chords", () => {
    const saveConflict = findKeyboardShortcutConflict({ action: "edit.split", key: "s", mod: true }, []);
    expect(saveConflict?.action).toBe("project.save");

    const custom = [{ action: "edit.silence" as const, key: "j", mod: true, shift: false, alt: false }];
    const customConflict = findKeyboardShortcutConflict({ action: "edit.split", key: "j", mod: true, shift: false, alt: false }, custom);
    expect(customConflict?.action).toBe("edit.silence");
  });

  it("parses keyboard shortcut preset JSON for UI and MCP import", () => {
    const parsed = parseKeyboardShortcutPresetJson(JSON.stringify({
      id: "editing",
      name: "Editing",
      shortcuts: [{ action: "edit.split", key: "X", mod: true, shift: true }],
    }));
    expect(parsed).toEqual({
      id: "editing",
      name: "Editing",
      shortcuts: [{ action: "edit.split", key: "x", mod: true, shift: true, alt: false }],
    });
    expect(parseKeyboardShortcutPresetJson(JSON.stringify({ name: "Empty", shortcuts: [] }))).toContain("at least one");
  });

  it("formats shortcut preset export file names", () => {
    expect(keyboardShortcutPresetFileName({ id: "editing", name: "Editing Keys", shortcuts: [] })).toBe("editing-keys.rythme-shortcuts.json");
  });

  it("stores app-global shortcut presets in browser storage", () => {
    const storage = fakeStorage();
    const saved = upsertGlobalKeyboardShortcutPreset({
      name: "Editing",
      shortcuts: [{ action: "edit.split", key: "x", mod: true }],
    }, storage);
    expect(saved).toMatchObject({ id: "editing", name: "Editing" });
    expect(loadGlobalKeyboardShortcutPresets(storage)).toEqual([{
      id: "editing",
      name: "Editing",
      shortcuts: [{ action: "edit.split", key: "x", mod: true, shift: false, alt: false }],
    }]);

    upsertGlobalKeyboardShortcutPreset({
      id: "editing",
      name: "Editing Updated",
      shortcuts: [{ action: "edit.trim", key: "t", mod: true }],
    }, storage);
    expect(loadGlobalKeyboardShortcutPresets(storage).map((preset) => preset.name)).toEqual(["Editing Updated"]);
    expect(deleteGlobalKeyboardShortcutPreset("editing", storage)).toEqual([]);
  });

  it("uses browser storage as the async app-global fallback outside Tauri", async () => {
    const storage = fakeStorage();
    const saved = await upsertGlobalKeyboardShortcutPresetAsync({
      name: "Editing",
      shortcuts: [{ action: "edit.split", key: "x", mod: true }],
    }, storage);
    expect(saved?.id).toBe("editing");
    expect(await loadGlobalKeyboardShortcutPresetsAsync(storage)).toHaveLength(1);
    expect(await deleteGlobalKeyboardShortcutPresetAsync("editing", storage)).toEqual([]);
  });
});
