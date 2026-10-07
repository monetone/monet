// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// shortcuts-bounding-box.test — ⇧⌘B keyboard wiring for View ▸ Hide Bounding Box
// ─────────────────────────────────────────────────────────────
// Mounts the real useShortcuts hook and dispatches a real ⇧⌘B keydown, asserting
// it toggles the showBoundingBox view flag — while plain ⌘B does NOT (that pastes
// in back).

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

describe("useShortcuts — ⇧⌘B Hide Bounding Box", () => {
  it("toggles showBoundingBox on each ⇧⌘B, without touching the document", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    mount(store);
    expect(store.getState().showBoundingBox).toBe(true);
    press("b", { shiftKey: true });
    expect(store.getState().showBoundingBox).toBe(false);
    expect(store.canUndo).toBe(false); // view flag, no undo entry
    press("b", { shiftKey: true });
    expect(store.getState().showBoundingBox).toBe(true);
  });

  it("plain ⌘B does not toggle the bounding box (it pastes in back)", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    mount(store);
    press("b", {}); // no shift → Paste in Back
    expect(store.getState().showBoundingBox).toBe(true); // unchanged
  });
});
