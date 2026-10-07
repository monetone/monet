// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// shortcuts-transparency-grid.test — ⇧⌘D keyboard wiring for Transparency Grid
// ─────────────────────────────────────────────────────────────
// Mounts the real useShortcuts hook and dispatches a real ⇧⌘D keydown, asserting
// it toggles the transparencyGrid flag — while plain ⌘D does NOT (that duplicates).

import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useShortcuts } from "./ui/use-shortcuts";
import { ArtisanStore, makeDocument } from "./engine";

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

describe("useShortcuts — ⇧⌘D Show Transparency Grid", () => {
  it("toggles transparencyGrid on each ⇧⌘D, without touching the document", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    mount(store);
    expect(store.getState().transparencyGrid).toBe(false);
    press("d", { shiftKey: true });
    expect(store.getState().transparencyGrid).toBe(true);
    expect(store.canUndo).toBe(false); // view flag, no undo entry
    press("d", { shiftKey: true });
    expect(store.getState().transparencyGrid).toBe(false);
  });

  it("plain ⌘D does not toggle the transparency grid (it duplicates)", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    mount(store);
    press("d", {}); // no shift → Duplicate
    expect(store.getState().transparencyGrid).toBe(false); // unchanged
  });
});
