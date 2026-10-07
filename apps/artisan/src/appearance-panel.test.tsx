// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ArtisanStore, makeDocument, makeGroup, makeRect } from "./engine";
import { EditorProvider } from "./state/store-context";
import { AppearancePanel } from "./ui/panels/appearance-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("Appearance panel", () => {
  it("disables paint-entry actions for a group", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const group = makeGroup([makeRect(0, 0, 10, 10)]);
    doc.layers[0].items.push(group);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([group.id]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root!.render(<EditorProvider store={store}><AppearancePanel /></EditorProvider>));

    expect(container.querySelector<HTMLButtonElement>('[data-appearance-action="add-fill"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-appearance-action="add-stroke"]')!.disabled).toBe(true);
  });
});
