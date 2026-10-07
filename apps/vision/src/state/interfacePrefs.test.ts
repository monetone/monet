// Preferences ▸ Interface — the theme/density choice is an application
// preference written the moment it changes, and re-stamped onto :root at boot.
// Engine-free (node); the dialog itself is e2e-covered.
import { describe, expect, it, beforeEach } from "vitest";

import {
  DEFAULT_INTERFACE_PREFS, applyInterfacePrefs, loadInterfacePrefs,
  normalizeInterfacePrefs, saveInterfacePrefs, type AttrTarget,
} from "./interfacePrefs";

// Minimal Storage stand-in — the unit suite runs in node, which has none.
function installStorage(): Map<string, string> {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
  return cells;
}

// Stands in for document.documentElement; records the attributes stamped on it.
function fakeRoot() {
  const attrs = new Map<string, string>();
  const root: AttrTarget = {
    setAttribute: (name, value) => { attrs.set(name, value); },
    removeAttribute: (name) => { attrs.delete(name); },
  };
  return { root, attrs };
}

let cells: Map<string, string>;
beforeEach(() => { cells = installStorage(); });

describe("interface preferences", () => {
  it("defaults to the design system's unscoped dark/default chrome", () => {
    expect(loadInterfacePrefs()).toEqual({ theme: "dark", density: "default" });
    expect(DEFAULT_INTERFACE_PREFS).toEqual({ theme: "dark", density: "default" });
  });

  it("writes the choice the moment it changes and reopens on it", () => {
    expect(saveInterfacePrefs({ theme: "light" })).toEqual({ theme: "light", density: "default" });
    expect(cells.get("mv.interfacePrefs")).toBe(JSON.stringify({ theme: "light", density: "default" }));
    expect(loadInterfacePrefs()).toEqual({ theme: "light", density: "default" });
    // A second patch merges over the saved value rather than resetting it.
    expect(saveInterfacePrefs({ density: "compact" })).toEqual({ theme: "light", density: "compact" });
    expect(loadInterfacePrefs()).toEqual({ theme: "light", density: "compact" });
  });

  it("ignores junk in user-editable storage", () => {
    for (const junk of ["", "null", "abc", "[]", "{}", '{"theme":"neon","density":7}']) {
      cells.set("mv.interfacePrefs", junk);
      expect(loadInterfacePrefs()).toEqual(DEFAULT_INTERFACE_PREFS);
    }
    expect(normalizeInterfacePrefs({ theme: "light", density: "nope" })).toEqual({ theme: "light", density: "default" });
  });

  it("stamps non-default choices on the root and clears them again", () => {
    const { root, attrs } = fakeRoot();
    applyInterfacePrefs({ theme: "light", density: "compact" }, root);
    expect(attrs.get("data-theme")).toBe("light");
    expect(attrs.get("data-density")).toBe("compact");
    // Defaults are the unscoped CSS, so they must remove the attribute, not write it.
    applyInterfacePrefs(DEFAULT_INTERFACE_PREFS, root);
    expect(attrs.size).toBe(0);
  });
});
