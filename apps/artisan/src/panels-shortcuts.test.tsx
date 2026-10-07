// @vitest-environment happy-dom
// panels-shortcuts.test - shortcut editor transactions and dispatch

import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ArtisanStore, Ops, makeDocument, makeRect, shortcutBindingId } from "./engine";
import { useShortcuts } from "./ui/use-shortcuts";

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

const press = (key: string, opts: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true, ...opts }));
  });

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Shortcut Panel");
  const rect = makeRect(0, 0, 20, 20);
  doc.layers[0].items.push(rect);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([rect.id]);
  return { store, rect };
};

const itemCount = (store: ArtisanStore) => store.getState().doc.layers[0].items.length;

describe("Shortcuts panel transactions", () => {
  it("stores a shortcut override in one undoable transaction", () => {
    const { store } = setup();

    store.transact("Keyboard Shortcut", (doc) => {
      Ops.Shortcuts.setShortcutOverride(doc, "edit.duplicate", {
        binding: { key: "x", modifiers: ["meta", "shift"] },
        now: "2026-07-03T13:30:00.000Z",
      });
    });

    const override = store.getState().doc.shortcuts?.overrides.find((entry) => entry.actionId === "edit.duplicate");
    expect(override?.enabled).toBe(true);
    expect(override?.binding && shortcutBindingId(override.binding)).toBe("meta+shift+x");
    expect(override?.updatedAt).toBe("2026-07-03T13:30:00.000Z");

    store.undo();
    expect(store.getState().doc.shortcuts?.overrides).toEqual([]);
  });

  it("remaps an existing shortcut and blocks the old default binding", () => {
    const { store } = setup();
    store.transact("Keyboard Shortcut", (doc) => {
      Ops.Shortcuts.setShortcutOverride(doc, "edit.duplicate", {
        binding: { key: "x", modifiers: ["meta", "shift"] },
      });
    });
    mount(store);

    const before = itemCount(store);
    press("d", {});
    expect(itemCount(store)).toBe(before);

    press("x", { shiftKey: true });
    expect(itemCount(store)).toBe(before + 1);
  });
});
