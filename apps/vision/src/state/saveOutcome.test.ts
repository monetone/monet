// A save that was cancelled or that failed is not a save. Script Events'
// "Save Document" fired on the promise settling, so it ran on both — the exact
// misfire the code says it excluded Open Document to avoid (#495).
import { afterEach, describe, expect, it, vi } from "vitest";

let saveTarget: string | null = null;
const written: string[] = [];

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: async () => saveTarget }));
vi.mock("./atomicWrite", () => ({
  atomicWriteBytes: async (path: string) => { written.push(path); },
}));

import { engine, saveDocumentAs, store as appStore } from "./app";

/** Enough of an engine for the Save As prologue (layer count, name, flatness). */
const stubEngine = () => new Proxy({}, { get: () => () => 1 });

function activeDoc() {
  engine.engine = stubEngine() as never;
  (appStore as unknown as { docs: unknown[] }).docs = [
    { id: 1, name: "shot.png", dirty: true, contentRevision: 1, pristineBlank: false },
  ];
  const current = appStore.state;
  vi.spyOn(appStore, "state", "get").mockReturnValue({ ...current, activeDocId: 1 } as never);
}

afterEach(() => {
  engine.engine = null as never;
  (appStore as unknown as { docs: unknown[] }).docs = [];
  written.length = 0;
  saveTarget = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Save As reports whether it saved", () => {
  it("says no when the user cancels the destination dialog", async () => {
    activeDoc();
    saveTarget = null;

    await expect(saveDocumentAs()).resolves.toBe(false);
    expect(written).toEqual([]);
  });

  it("says no when there is no active document", async () => {
    (appStore as unknown as { docs: unknown[] }).docs = [];
    await expect(saveDocumentAs()).resolves.toBe(false);
  });
});
