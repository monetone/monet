// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// shortcuts-select-artboard.test — ⌥⌘A wiring (Select All on Active Artboard)
// ─────────────────────────────────────────────────────────────
// Regression guard: ⌥⌘A must reach selectAllOnActiveArtboard, while plain ⌘A /
// ⇧⌘A still Select All / Deselect. Mounts the real useShortcuts hook and
// dispatches the real keydown so the wiring is exercised end-to-end.

import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useShortcuts } from "./ui/use-shortcuts";
import { ArtisanStore, makeDocument, makeRect, makeArtboard } from "./engine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Harness = ({ store }: { store: ArtisanStore }) => {
  useShortcuts(store);
  return null;
};

// Two artboards; `a` on AB0 (active), `b` on AB1.
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.artboards = [makeArtboard("AB0", 0, 0, 200, 200), makeArtboard("AB1", 300, 0, 200, 200)];
  doc.activeArtboard = 0;
  const a = makeRect(10, 10, 50, 50);
  const b = makeRect(310, 10, 50, 50);
  doc.layers[0].items.push(a, b);
  store.replaceDoc(doc, { markClean: true });
  return { store, a, b };
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

const press = (opts: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", metaKey: true, ...opts }));
  });

describe("useShortcuts — Select All on Active Artboard", () => {
  it("⌥⌘A selects only the objects on the active artboard", () => {
    const { store, a } = setup();
    mount(store);
    press({ altKey: true });
    expect(store.getState().selection).toEqual([a.id]); // a (AB0); not b (AB1)
  });

  it("plain ⌘A still Selects All (both objects)", () => {
    const { store, a, b } = setup();
    mount(store);
    press({});
    expect(new Set(store.getState().selection)).toEqual(new Set([a.id, b.id]));
  });

  it("⇧⌘A still Deselects", () => {
    const { store, a } = setup();
    mount(store);
    store.setSelection([a.id]);
    press({ shiftKey: true });
    expect(store.getState().selection).toEqual([]);
  });
});
