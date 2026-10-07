// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// shortcuts-hide-edges.test — ⌘H keyboard wiring for View ▸ Hide Edges
// ─────────────────────────────────────────────────────────────
// Mounts the real useShortcuts hook and dispatches a real ⌘H keydown, asserting
// it toggles the hideEdges view flag (and leaves the document untouched).

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

describe("useShortcuts — ⌘H Hide Edges", () => {
  it("toggles the hideEdges flag on each ⌘H, without touching the document", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    mount(store);
    expect(store.getState().hideEdges).toBe(false);
    press("h", {});
    expect(store.getState().hideEdges).toBe(true);
    expect(store.canUndo).toBe(false); // view flag, no undo entry
    press("h", {});
    expect(store.getState().hideEdges).toBe(false);
  });
});
