// #554 Save is a choice on Close and Quit, and it really writes.
// #552 Don't Save deletes the recovery snapshot instead of offering it next launch.
// #549 opening a recovered document keeps the snapshot (autoRecover.test.ts).
// #553 a blocked second process does not read or delete snapshots.
// #514 quit and restore are exercised here and in autoRecover.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: true }));
const dialog = vi.hoisted(() => ({ answer: "Don't Save" }));
const recoveryFs = vi.hoisted(() => ({
  exists: vi.fn(async () => true),
  mkdir: vi.fn(async () => {}),
  readDir: vi.fn(async () => []),
  remove: vi.fn(async () => {}),
}));
const quitGuard = vi.hoisted(() => ({ installed: null as (() => boolean | Promise<boolean>) | null }));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/data",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => recoveryFs);
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: async () => dialog.answer,
  ask: async () => false,
  save: async () => null,
  open: async () => null,
}));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));
vi.mock("@monet-ui/monet-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  installQuitGuard: async (guard: () => boolean | Promise<boolean>) => { quitGuard.installed = guard; },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async () => () => {},
    destroy: async () => {},
  }),
}));

import { closeDocumentTab, engine, installUnsavedWorkGuard, recoverLastSession, store, writeRecoverySnapshots } from "./app";
import { atomicWriteBytes } from "./atomicWrite";
import { recoveryFileName } from "./autoRecover";
import { flatLayerProbe } from "./flatLayerProbe";

function installStorage(): void {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
}

function installDom(): void {
  const ctx = {
    drawImage() {}, putImageData() {},
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
  (globalThis as { document?: unknown }).document = {
    body: { appendChild() {} },
    createElement: () => ({
      width: 0, height: 0, style: {},
      getContext: () => ctx,
      toDataURL: () => "data:image/png;base64,AA",
      remove() {},
    }),
  };
}

function fakeEngine() {
  const target: Record<string, unknown> = {
    ...flatLayerProbe(),
    layer_count: () => 1,
    width: () => 64,
    height: () => 64,
    export_png_with_icc: () => new Uint8Array([137, 80, 78, 71]),
    save_project: () => new Uint8Array([1]),
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      if (typeof prop !== "string") return undefined;
      return () => 0;
    },
    has() { return true; },
  });
}

function openDirtyFile(name: string): number {
  vi.spyOn(engine, "buildNew").mockReturnValue(fakeEngine() as never);
  store.newDocument(64, 64, name);
  store.setDocPath(store.state.activeDocId, `/docs/${name}`);
  store.markDirty();
  return store.state.activeDocId;
}

beforeEach(() => {
  installStorage();
  installDom();
  tauri.enabled = true;
  dialog.answer = "Don't Save";
  quitGuard.installed = null;
  recoveryFs.exists.mockClear();
  recoveryFs.readDir.mockClear();
  recoveryFs.remove.mockClear();
  vi.mocked(atomicWriteBytes).mockClear();
  vi.stubGlobal("alert", () => {});
});

afterEach(() => {
  for (const id of [...store.openDocIds()]) store.closeDoc(id);
  tauri.enabled = false;
  engine.engine = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("close and quit offer Save and drop a discarded recovery snapshot (#554, #552, #514)", () => {
  async function snapshot(id: number, name: string) {
    vi.stubEnv("DEV", false);
    vi.stubEnv("TAURI_ENV_DEBUG", "");
    vi.spyOn(store, "saveProjectForDoc").mockReturnValue(new Uint8Array([1, 2, 3]));
    expect(await writeRecoverySnapshots()).toBe(1);
    const file = `/data/recovery/${recoveryFileName(id, name)}`;
    expect(vi.mocked(atomicWriteBytes).mock.calls.map((call) => call[0])).toContain(file);
    return file;
  }

  it("Save writes the document, closes the tab, and deletes the recovery snapshot", async () => {
    const id = openDirtyFile("flat.png");
    const file = await snapshot(id, "flat.png");
    dialog.answer = "Save";

    await expect(closeDocumentTab(id)).resolves.toBe(true);

    expect(vi.mocked(atomicWriteBytes).mock.calls.map((call) => call[0])).toContain("/docs/flat.png");
    expect(recoveryFs.remove).toHaveBeenCalledWith(file);
    expect(store.openDocIds()).not.toContain(id);
  });

  it("Don't Save closes without writing the document and deletes the recovery snapshot", async () => {
    const id = openDirtyFile("flat.png");
    const file = await snapshot(id, "flat.png");
    vi.mocked(atomicWriteBytes).mockClear();
    dialog.answer = "Don't Save";

    await expect(closeDocumentTab(id)).resolves.toBe(true);

    expect(atomicWriteBytes).not.toHaveBeenCalled();
    expect(recoveryFs.remove).toHaveBeenCalledWith(file);
    expect(store.openDocIds()).not.toContain(id);
  });

  it("Cancel leaves the document and its recovery snapshot", async () => {
    const id = openDirtyFile("flat.png");
    const file = await snapshot(id, "flat.png");
    recoveryFs.remove.mockClear();
    dialog.answer = "Cancel";

    await expect(closeDocumentTab(id)).resolves.toBe(false);

    expect(recoveryFs.remove).not.toHaveBeenCalledWith(file);
    expect(store.docDirty(id)).toBe(true);
    expect(store.openDocIds()).toContain(id);
  });

  it("Quit Don't Save deletes the snapshot and approves the quit (#514)", async () => {
    const id = openDirtyFile("flat.png");
    const file = await snapshot(id, "flat.png");
    recoveryFs.remove.mockClear();
    dialog.answer = "Don't Save";
    await installUnsavedWorkGuard();

    await expect(quitGuard.installed!()).resolves.toBe(true);

    expect(recoveryFs.remove).toHaveBeenCalledWith(file);
    expect(store.docDirty(id)).toBe(true); // quit does not close the tab; it discards the snapshot
  });
});

describe("a blocked second process does not touch recovery files (#553)", () => {
  it("returns before reading or deleting the folder", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("TAURI_ENV_DEBUG", "");
    vi.stubGlobal("location", { search: "?recoveryBlocked=1" });
    recoveryFs.readDir.mockRejectedValue(new Error("must not scan"));
    recoveryFs.remove.mockRejectedValue(new Error("must not delete"));

    await expect(recoverLastSession()).resolves.toBe(0);

    expect(recoveryFs.readDir).not.toHaveBeenCalled();
    expect(recoveryFs.remove).not.toHaveBeenCalled();
  });
});
