// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// shortcuts-make-guides.test — ⌘5 keyboard wiring for View ▸ Make Guides
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useShortcuts } from "./ui/use-shortcuts";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RED = solid(rgba(220, 0, 0, 1));
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

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(200, 150, 80, 60, 0, 0, { fill: RED });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return store;
};
const guideSet = (store: ArtisanStore) => new Set(store.getState().guides.map((g) => `${g.orientation}:${g.pos}`));

describe("useShortcuts — ⌘5 Make Guides", () => {
  it("adds the selection's edge guides", () => {
    const store = setup();
    mount(store);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "5", metaKey: true }));
    });
    expect(guideSet(store)).toEqual(new Set(["v:200", "v:280", "h:150", "h:210"]));
  });

  it("is ignored while typing in a text field", () => {
    const store = setup();
    mount(store);
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "5", metaKey: true, bubbles: true }));
    });
    expect(store.getState().guides.length).toBe(0); // guard skipped the shortcut
    input.remove();
  });
});
