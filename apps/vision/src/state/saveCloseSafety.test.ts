import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dialog = vi.hoisted(() => ({
  target: "/out/copy.png" as string | null,
  targets: [] as (string | null)[],
}));
const windowState = vi.hoisted(() => ({
  close: null as ((event: { preventDefault(): void }) => unknown) | null,
  destroy: vi.fn(async () => {}),
  quit: null as (() => boolean | Promise<boolean>) | null,
}));
const recoveryFs = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  remove: vi.fn(async (_path: string) => {}),
}));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/data",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async () => true,
  mkdir: async () => {},
  remove: recoveryFs.remove,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: async () => "Save",
  confirm: async () => true,
  ask: async () => true,
  save: async () => dialog.targets.length ? dialog.targets.shift()! : dialog.target,
}));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));
vi.mock("@monet-ui/monet-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  installQuitGuard: async (guard: () => boolean | Promise<boolean>) => { windowState.quit = guard; },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: (event: { preventDefault(): void }) => unknown) => {
      windowState.close = handler;
      return () => {};
    },
    destroy: windowState.destroy,
  }),
}));

import { closeDocumentTab, engine, installUnsavedWorkGuard, store, writeRecoverySnapshots } from "./app";
import { atomicWriteBytes } from "./atomicWrite";
import { flatLayerProbe } from "./flatLayerProbe";

function fakeEngine() {
  const bytes = Uint8Array.of(1, 2, 3);
  const target: Record<string, unknown> = {
    ...flatLayerProbe(),
    layer_count: () => 2,
    layer_id_at: (index: number) => index + 1,
    layer_name: () => "Layer",
    width: () => 64,
    height: () => 48,
    export_png_with_icc: () => bytes,
    export_psd_tagged: () => bytes,
    try_save_project: () => bytes,
    save_project: () => bytes,
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      return typeof prop === "string" ? () => 0 : undefined;
    },
  });
}

function openDocument(name = "painting.mvision", dirty = true): number {
  vi.spyOn(engine, "buildNew").mockReturnValue(fakeEngine() as never);
  store.newDocument(64, 48, name);
  if (dirty) store.markDirty();
  return store.state.activeDocId;
}

type CloseSurface = "tab" | "window" | "native quit";
const surfaces: CloseSurface[] = ["tab", "window", "native quit"];

/** Exercise the actual tab policy or the callbacks installed for native events. */
async function requestClose(surface: CloseSurface, id: number): Promise<boolean> {
  if (surface === "tab") return closeDocumentTab(id);
  await installUnsavedWorkGuard();
  if (surface === "native quit") return await windowState.quit!();
  const preventDefault = vi.fn();
  await windowState.close!({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  return windowState.destroy.mock.calls.length > 0;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const SESSION_LOCK = "/data/recovery/session.lock";
function seedSessionLock(): Uint8Array {
  const bytes = new TextEncoder().encode(String(process.pid));
  recoveryFs.files.set(SESSION_LOCK, bytes);
  vi.stubEnv("DEV", false);
  vi.stubEnv("TAURI_ENV_DEBUG", "");
  return bytes;
}

beforeEach(() => {
  const cells = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => cells.get(key) ?? null,
    setItem: (key: string, value: string) => { cells.set(key, value); },
    removeItem: (key: string) => { cells.delete(key); },
  });
  const ctx = {
    drawImage() {}, putImageData() {},
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
  };
  vi.stubGlobal("document", {
    body: { appendChild() {} },
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx, toDataURL: () => "data:image/png;base64,AA", remove() {} }),
  });
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("alert", () => {});
  dialog.target = "/out/copy.png";
  dialog.targets.length = 0;
  windowState.close = null;
  windowState.quit = null;
  windowState.destroy.mockClear();
  recoveryFs.files.clear();
  vi.mocked(atomicWriteBytes).mockReset().mockImplementation(async (path, bytes) => {
    recoveryFs.files.set(path, bytes.slice());
  });
  recoveryFs.remove.mockReset().mockImplementation(async (path) => {
    recoveryFs.files.delete(path);
  });
});

afterEach(() => {
  for (const id of [...store.openDocIds()]) store.closeDoc(id);
  engine.engine = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(surfaces)("Save on %s preserves editable documents", (surface) => {
  it.each(["png", "psd"])("stays open when Save writes only a %s export copy", async (extension) => {
    const id = openDocument();
    dialog.target = `/out/copy.${extension}`;

    expect(await requestClose(surface, id)).toBe(false);

    expect(atomicWriteBytes).toHaveBeenCalledWith(dialog.target, expect.any(Uint8Array));
    expect(store.openDocIds()).toContain(id);
    expect(store.docDirty(id)).toBe(true);
    expect(store.activePath()).toBeNull();
    expect(windowState.destroy).not.toHaveBeenCalled();
  });

  it("stays open when the destination dialog is cancelled", async () => {
    const id = openDocument();
    dialog.target = null;

    expect(await requestClose(surface, id)).toBe(false);

    expect(atomicWriteBytes).not.toHaveBeenCalled();
    expect(store.openDocIds()).toContain(id);
    expect(store.docDirty(id)).toBe(true);
  });

  it("stays open when writing the project fails", async () => {
    const id = openDocument();
    dialog.target = "/out/painting.mvision";
    vi.mocked(atomicWriteBytes).mockRejectedValueOnce(new Error("disk full"));

    expect(await requestClose(surface, id)).toBe(false);

    expect(atomicWriteBytes).toHaveBeenCalledWith(dialog.target, expect.any(Uint8Array));
    expect(store.openDocIds()).toContain(id);
    expect(store.docDirty(id)).toBe(true);
    expect(store.activePath()).toBeNull();
  });

  it("allows closing after the current revision is saved as a project", async () => {
    const id = openDocument();
    dialog.target = "/out/painting.mvision";

    expect(await requestClose(surface, id)).toBe(true);

    expect(atomicWriteBytes).toHaveBeenCalledWith(dialog.target, expect.any(Uint8Array));
    if (surface === "tab") {
      expect(store.openDocIds()).not.toContain(id);
    } else {
      expect(store.docDirty(id)).toBe(false);
      expect(store.activePath()).toBe(dialog.target);
    }
  });

  it("stays open when an edit lands during the project write", async () => {
    const id = openDocument();
    dialog.target = "/out/painting.mvision";
    const started = deferred();
    const finish = deferred();
    vi.mocked(atomicWriteBytes).mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
    });

    const close = requestClose(surface, id);
    await started.promise;
    store.markDirty();
    finish.resolve();

    expect(await close).toBe(false);
    expect(store.openDocIds()).toContain(id);
    expect(store.docDirty(id)).toBe(true);
    expect(store.activePath()).toBe(dialog.target);
    expect(windowState.destroy).not.toHaveBeenCalled();
  });

  it("stays open when an edit lands while the saved recovery snapshot is removed", async () => {
    const id = openDocument();
    vi.stubEnv("DEV", false);
    vi.stubEnv("TAURI_ENV_DEBUG", "");
    expect(await writeRecoverySnapshots()).toBe(1);
    dialog.target = "/out/painting.mvision";
    const started = deferred();
    const finish = deferred();
    recoveryFs.remove.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
    });

    const close = requestClose(surface, id);
    await started.promise;
    // The save has settled, while the asynchronous recovery cleanup still waits.
    await new Promise<void>((done) => setTimeout(done, 0));
    store.markDocDirty(id);
    finish.resolve();

    expect(await close).toBe(false);
    expect(store.openDocIds()).toContain(id);
    expect(store.docDirty(id)).toBe(true);
    expect(windowState.destroy).not.toHaveBeenCalled();
  });
});

describe.each(["window", "native quit"] as const)("%s rechecks the entire workspace before exiting", (surface) => {
  it("retains session ownership when the Save guard approves closing", async () => {
    const id = openDocument();
    const owner = seedSessionLock();
    dialog.target = "/out/painting.mvision";

    expect(await requestClose(surface, id)).toBe(true);

    expect(store.docDirty(id)).toBe(false);
    expect(recoveryFs.files.get(SESSION_LOCK)).toEqual(owner);
  });

  it("retains session ownership when an edit during recovery cleanup cancels closing", async () => {
    const id = openDocument();
    const owner = seedSessionLock();
    expect(await writeRecoverySnapshots()).toBe(1);
    dialog.target = "/out/painting.mvision";
    const started = deferred();
    const finish = deferred();
    recoveryFs.remove.mockImplementationOnce(async (path) => {
      recoveryFs.files.delete(path);
      started.resolve();
      await finish.promise;
    });

    const close = requestClose(surface, id);
    await started.promise;
    await new Promise<void>((done) => setTimeout(done, 0));
    store.markDocDirty(id);
    finish.resolve();

    expect(await close).toBe(false);
    expect(store.openDocIds()).toContain(id);
    expect(store.docDirty(id)).toBe(true);
    expect(windowState.destroy).not.toHaveBeenCalled();
    expect(recoveryFs.files.get(SESSION_LOCK)).toEqual(owner);
  });

  it.each([true, false])("stays open if an earlier document becomes dirty during a later save (initially dirty: %s)", async (initiallyDirty) => {
    const first = openDocument("first.mvision", initiallyDirty);
    const second = openDocument("second.mvision");
    dialog.targets.push(...(initiallyDirty ? ["/out/first.mvision"] : []), "/out/second.mvision");
    vi.mocked(atomicWriteBytes).mockImplementation(async (path) => {
      if (path === "/out/second.mvision") store.markDocDirty(first);
    });

    expect(await requestClose(surface, second)).toBe(false);

    expect(store.openDocIds()).toEqual([first, second]);
    expect(store.docDirty(first)).toBe(true);
    expect(store.docDirty(second)).toBe(false);
    expect(windowState.destroy).not.toHaveBeenCalled();
  });

  it("stays open if a new dirty document appears during saving", async () => {
    const first = openDocument();
    dialog.target = "/out/painting.mvision";
    let added = -1;
    vi.mocked(atomicWriteBytes).mockImplementationOnce(async () => {
      added = openDocument("new-work.mvision");
    });

    expect(await requestClose(surface, first)).toBe(false);

    expect(store.openDocIds()).toEqual([first, added]);
    expect(store.docDirty(first)).toBe(false);
    expect(store.docDirty(added)).toBe(true);
    expect(windowState.destroy).not.toHaveBeenCalled();
  });

  it("allows exiting only after every dirty document is saved", async () => {
    const first = openDocument("first.mvision");
    const second = openDocument("second.mvision");
    dialog.targets.push("/out/first.mvision", "/out/second.mvision");

    expect(await requestClose(surface, second)).toBe(true);

    expect(vi.mocked(atomicWriteBytes).mock.calls.map(([path]) => path)).toEqual(["/out/first.mvision", "/out/second.mvision"]);
    expect(store.docDirty(first)).toBe(false);
    expect(store.docDirty(second)).toBe(false);
  });
});
