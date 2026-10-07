// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// shortcuts-lock-above.test — ⌥⇧⌘2 wiring (Lock All Artwork Above)
// ─────────────────────────────────────────────────────────────
// Regression guard: ⌥⇧⌘2 must reach lockAllArtworkAbove, while ⌘2 / ⌥⌘2 still
// Lock Selection / Unlock All. Mounts the real useShortcuts hook and dispatches
// the real keydown so the wiring is exercised end-to-end.

import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useShortcuts } from "./ui/use-shortcuts";
import { ArtisanStore, makeDocument, makeRect, Ops, Query } from "./engine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Harness = ({ store }: { store: ArtisanStore }) => {
  useShortcuts(store);
  return null;
};

// a (back) · b · c · d (front); b selected.
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const rects = [makeRect(0, 0, 10, 10), makeRect(0, 0, 10, 10), makeRect(0, 0, 10, 10), makeRect(0, 0, 10, 10)];
  for (const r of rects) doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([rects[1].id]);
  return { store, rects };
};
const isLocked = (store: ArtisanStore, id: string) => !!Query.getItem(store.getState().doc, id)!.locked;

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
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", metaKey: true, ...opts }));
  });

describe("useShortcuts — Lock All Artwork Above", () => {
  it("⌥⇧⌘2 locks the artwork above the selection", () => {
    const { store, rects } = setup();
    mount(store);
    press({ altKey: true, shiftKey: true });
    expect(isLocked(store, rects[2].id)).toBe(true); // above b
    expect(isLocked(store, rects[3].id)).toBe(true);
    expect(isLocked(store, rects[0].id)).toBe(false); // below
    expect(store.getState().selection).toEqual([rects[1].id]); // selection preserved (unlike Lock Selection)
  });

  it("plain ⌘2 still Locks the Selection", () => {
    const { store, rects } = setup();
    mount(store);
    press({});
    expect(isLocked(store, rects[1].id)).toBe(true); // b itself locked
    expect(store.getState().selection).toEqual([]); // and deselected
  });

  it("⌥⌘2 still Unlocks All", () => {
    const { store, rects } = setup();
    mount(store);
    store.transact("lock", (d) => Ops.Items.setLocked(d, [rects[3].id], true));
    press({ altKey: true });
    expect(isLocked(store, rects[3].id)).toBe(false); // unlocked
  });
});
