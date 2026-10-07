// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// shortcuts-paste-place.test — ⌥⌘V / ⌥⇧⌘V keyboard wiring
// ─────────────────────────────────────────────────────────────
// Regression guard: ⌥⌘V → Paste in Place, ⌥⇧⌘V → Paste on All Artboards, while
// the alt-less ⌘V still pastes once. Mounts the real useShortcuts hook and
// dispatches real keydowns so the wiring is exercised end-to-end.

import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useShortcuts } from "./ui/use-shortcuts";
import { ArtisanStore, makeDocument, makeArtboard, makeRect } from "./engine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Harness = ({ store }: { store: ArtisanStore }) => {
  useShortcuts(store);
  return null;
};

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument(); // AB1 (0,0,1000,1000)
  doc.artboards.push(makeArtboard("Artboard 2", 1200, 0, 1000, 1000));
  const r = makeRect(100, 100, 80, 80);
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
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
const count = (store: ArtisanStore) => store.getState().doc.layers[0].items.length;

describe("useShortcuts — Paste in Place / Paste on All Artboards", () => {
  it("⌥⌘V pastes a single copy in place", () => {
    const { store } = setup();
    mount(store);
    press("c", {}); // copy
    const before = count(store);
    press("v", { altKey: true });
    expect(count(store)).toBe(before + 1);
  });

  it("⌥⇧⌘V pastes one copy per artboard (two artboards ⇒ +2)", () => {
    const { store } = setup();
    mount(store);
    press("c", {});
    const before = count(store);
    press("v", { altKey: true, shiftKey: true });
    expect(count(store)).toBe(before + 2);
  });

  it("plain ⌘V still pastes once (alt-less path unchanged)", () => {
    const { store } = setup();
    mount(store);
    press("c", {});
    const before = count(store);
    press("v", {});
    expect(count(store)).toBe(before + 1);
  });
});
