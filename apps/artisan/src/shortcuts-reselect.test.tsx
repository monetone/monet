// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// shortcuts-reselect.test — ⌘6 keyboard wiring for Select ▸ Reselect
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useShortcuts } from "./ui/use-shortcuts";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RED = solid(rgba(220, 0, 0, 1));
const BLUE = solid(rgba(0, 0, 220, 1));
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

describe("useShortcuts — ⌘6 Reselect", () => {
  it("re-runs the last Select Same query against the current selection", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: RED });
    const b1 = makeRect(40, 0, 10, 10, 0, 0, { fill: BLUE });
    const b2 = makeRect(60, 0, 10, 10, 0, 0, { fill: BLUE });
    doc.layers[0].items.push(r, b1, b2);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    commands.selectSame(store, "fill"); // remembers {same, fill}; selects just r
    store.setSelection([b1.id]); // new basis
    mount(store);
    press("6", {}); // ⌘6
    expect(new Set(store.getState().selection)).toEqual(new Set([b1.id, b2.id]));
  });
});
