// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./render/canvas-view", () => ({ CanvasView: () => null }));
vi.mock("./ui/panels/vectorscope-panel", () => ({ VectorscopePanel: () => null }));
vi.mock("./ui/panels/waveform-panel", () => ({ WaveformPanel: () => null }));

vi.mock("@monet-ui/monet-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@monet-ui/monet-react")>();
  const React = await import("react");
  return {
    ...actual,
    Canvas: ({ children }: { children: ReactNode }) => children,
    DockableWorkspace: ({ menus }: { menus: Array<{ items: Array<{ id: string; disabled?: boolean }> }> }) => {
      const paste = menus.flatMap((menu) => menu.items).find((item) => item.id === "pasteall");
      return React.createElement("button", { "data-paste-all": "", disabled: paste?.disabled });
    },
    MenuBar: () => null,
    StatusBar: ({ children }: { children: ReactNode }) => children,
    ToastProvider: ({ children }: { children: ReactNode }) => children,
    useFileDrop: () => undefined,
    useMonetContext: () => ({ platform: "mac" }),
    useToast: () => ({ push: () => undefined }),
  };
});

import { App } from "./App";
import { commands } from "./commands";
import { ArtisanStore, makeArtboard, makeDocument, makeRect } from "./engine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("App clipboard menus", () => {
  it("enables Paste on All Artboards immediately after Copy", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.artboards.push(makeArtboard("Artboard 2", 1200, 0, 1000, 1000));
    const rect = makeRect(100, 100, 80, 80);
    doc.layers[0].items.push(rect);
    store.replaceDoc(doc, { markClean: true });
    commands.copy(store); // clear any clipboard retained by this module
    store.setSelection([rect.id]);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<App store={store} />));
    expect(container.querySelector<HTMLButtonElement>("[data-paste-all]")!.disabled).toBe(true);

    act(() => commands.copy(store));
    expect(container.querySelector<HTMLButtonElement>("[data-paste-all]")!.disabled).toBe(false);
  });
});
