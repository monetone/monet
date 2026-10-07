// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// shortcuts-menu-parity.test — every menu-advertised shortcut must work
// ─────────────────────────────────────────────────────────────
// A menu item that prints "⌥⌘B" next to "Make Blend" is a promise. This walks
// the whole menu tree, and for each item carrying a `shortcut` string it (a)
// runs the menu action and records which command it called, then (b) dispatches
// the real keydown through the real `useShortcuts` hook and records that. The
// two must be the same command — otherwise the menu is advertising a key that
// does nothing, or worse, does something else.

import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MenuItemDef } from "@monet-ui/monet-react";
import { useShortcuts } from "./ui/use-shortcuts";
import { buildMenus } from "./ui/menus";
import { commands } from "./commands";
import { fileCommands } from "./io/commands";
import { ArtisanStore } from "./engine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Harness = ({ store }: { store: ArtisanStore }) => {
  useShortcuts(store);
  return null;
};

let root: Root | null = null;
let container: HTMLElement | null = null;
const mount = (store: ArtisanStore) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(Harness, { store })));
};
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

// ── Recording stubs ────────────────────────────────────────────
// Both menus.ts and use-shortcuts.ts reach their actions through the SAME
// `commands` / `fileCommands` objects, so swapping the function properties for
// recorders captures which one each route picks — without mutating a document.
type AnyFns = Record<string, unknown>;
const calls: string[] = [];
const install = (obj: AnyFns, ns: string): (() => void) => {
  const saved: AnyFns = {};
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] !== "function") continue;
    saved[k] = obj[k];
    obj[k] = () => {
      calls.push(`${ns}.${k}`);
    };
  }
  return () => Object.assign(obj, saved);
};

/** Runs `fn` with every command stubbed out; returns the commands it invoked. */
const record = (fn: () => void): string[] => {
  const restore = [install(commands as unknown as AnyFns, "commands"), install(fileCommands as unknown as AnyFns, "file")];
  calls.length = 0;
  try {
    fn();
    return [...calls];
  } finally {
    for (const r of restore) r();
  }
};

// ── Shortcut glyphs → KeyboardEvent ───────────────────────────
const keyFor = (rest: string): string => (rest === "⌫" ? "Backspace" : rest);
const eventInit = (shortcut: string): KeyboardEventInit => ({
  key: keyFor(shortcut.replace(/[⌘⌥⇧⌃]/g, "")),
  metaKey: shortcut.includes("⌘"),
  altKey: shortcut.includes("⌥"),
  shiftKey: shortcut.includes("⇧"),
});

interface Advertised {
  path: string;
  shortcut: string;
  action: () => void;
}

const collect = (items: MenuItemDef[], prefix: string, out: Advertised[]): void => {
  for (const item of items) {
    if (item.separator) continue;
    const path = `${prefix} ▸ ${item.label}`;
    if (item.items) collect(item.items, path, out);
    else if (item.shortcut && item.action) out.push({ path, shortcut: item.shortcut, action: item.action });
  }
};

const advertised = (): Advertised[] => {
  const store = new ArtisanStore();
  const out: Advertised[] = [];
  for (const menu of buildMenus(store, store.getState())) collect(menu.items, menu.label, out);
  return out;
};

describe("menu shortcuts ↔ keyboard", () => {
  it("advertises a healthy number of shortcuts", () => {
    expect(advertised().length).toBeGreaterThan(40);
  });

  it("each advertised shortcut dispatches the very command its menu item runs", () => {
    const store = new ArtisanStore();
    mount(store);

    const mismatches: string[] = [];
    for (const { path, shortcut, action } of advertised()) {
      const viaMenu = record(action);
      const viaKey = record(() => {
        act(() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { ...eventInit(shortcut), bubbles: true }));
        });
      });
      if (viaMenu.join() !== viaKey.join()) {
        mismatches.push(`${shortcut}  ${path}: menu ran [${viaMenu.join() || "—"}], key ran [${viaKey.join() || "—"}]`);
      }
    }
    expect(mismatches, `\n${mismatches.join("\n")}\n`).toEqual([]);
  });
});
