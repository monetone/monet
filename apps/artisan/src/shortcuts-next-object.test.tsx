// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// shortcuts-next-object.test — ⌥⌘] / ⌥⌘[ keyboard wiring
// ─────────────────────────────────────────────────────────────
// Regression guard: Select ▸ Next Object Above/Below advertises ⌥⌘] / ⌥⌘[.
// Those keystrokes must reach commands.selectNextObject (a selection-only,
// non-undoable change) — NOT the destructive bringForward/sendBackward that the
// alt-less ⌘] / ⌘[ fire. Mounts the real useShortcuts hook and dispatches the
// real keydown so the wiring itself is exercised end-to-end.

import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useShortcuts } from "./ui/use-shortcuts";
import { ArtisanStore, makeDocument, makeRect } from "./engine";

// Tell React this is an act() environment so effects flush deterministically.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Harness = ({ store }: { store: ArtisanStore }) => {
  useShortcuts(store);
  return null;
};

// a (back) · b (middle) · c (front).
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(0, 0, 10, 10);
  const b = makeRect(0, 0, 10, 10);
  const c = makeRect(0, 0, 10, 10);
  for (const r of [a, b, c]) doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([b.id]);
  return { store, a, b, c };
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
const order = (store: ArtisanStore) => store.getState().doc.layers[0].items.map((i) => i.id);

describe("useShortcuts — Next Object Above/Below", () => {
  it("⌥⌘] selects the next object above (selection-only: no undo entry, z-order untouched)", () => {
    const { store, c } = setup();
    mount(store);
    const before = order(store);
    press("]", { altKey: true });
    expect(store.getState().selection).toEqual([c.id]); // b → c (front)
    expect(store.canUndo).toBe(false);
    expect(order(store)).toEqual(before); // did NOT reorder (would have, if it hit bringForward)
  });

  it("⌥⌘[ selects the next object below", () => {
    const { store, a } = setup();
    mount(store);
    press("[", { altKey: true });
    expect(store.getState().selection).toEqual([a.id]); // b → a (back)
    expect(store.canUndo).toBe(false);
  });

  it("plain ⌘] still brings the selection forward (alt-less path unchanged)", () => {
    const { store } = setup();
    mount(store);
    const before = order(store);
    press("]", {}); // no altKey
    expect(order(store)).not.toEqual(before); // z-order changed → bringForward ran
    expect(store.canUndo).toBe(true); // an undoable mutation, not a selection change
  });
});
