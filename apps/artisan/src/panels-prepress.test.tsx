// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ArtisanStore, Query } from "./engine";
import { EditorProvider } from "./state/store-context";
import { SeparationsPanel } from "./ui/panels/separations-panel";
import { SwatchesPanel } from "./ui/panels/swatches-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

const mount = (store: ArtisanStore, panel: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EditorProvider store={store}>{panel}</EditorProvider>));
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("prepress panel controls", () => {
  it("toggles process plate visibility", () => {
    const store = new ArtisanStore();
    mount(store, <SeparationsPanel />);

    const cyan = container!.querySelector<HTMLInputElement>('input[aria-label="Hide Cyan plate"]')!;
    act(() => cyan.click());

    expect(Query.separationPreview(store.doc).plates.find((plate) => plate.id === "process:Cyan")?.enabled).toBe(false);
  });

  it("creates a spot ink from the active solid color", () => {
    const store = new ArtisanStore();
    mount(store, <SwatchesPanel />);

    const button = [...container!.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Spot Color")!;
    act(() => button.click());

    expect(store.getState().fill).toMatchObject({ ink: { kind: "spot", name: "Spot #FFFFFF" } });
    expect(store.doc.prepress?.inks?.some((ink) => ink.kind === "spot" && ink.name === "Spot #FFFFFF")).toBe(true);
  });
});
