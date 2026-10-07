// #54 — closing a document TAB has always prompted, but quitting the app or
// closing the window discarded every unsaved document with no warning.
//
// The guard is driven for real here: a fake Tauri window hands back the
// `onCloseRequested` handler app.ts registers, and the handler is invoked with a
// fake close event to prove what it does with a clean vs. a dirty workspace.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: true }));
const dialog = vi.hoisted(() => ({
  answer: "Don't Save" as string,
  asked: [] as string[],
  buttons: [] as unknown[],
}));
const win = vi.hoisted(() => ({
  handlers: [] as ((event: { preventDefault: () => void }) => unknown)[],
  destroyed: 0,
  fail: false,
}));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (win.fail) throw new Error("no window API in this webview");
    return {
      onCloseRequested: async (fn: (event: { preventDefault: () => void }) => unknown) => {
        win.handlers.push(fn);
        return () => {};
      },
      destroy: async () => { win.destroyed++; },
    };
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: async (message: string) => { dialog.asked.push(message); return dialog.answer === "Don't Save"; },
  message: async (message: string, opts?: { buttons?: unknown }) => {
    dialog.asked.push(message);
    dialog.buttons.push(opts?.buttons);
    return dialog.answer;
  },
}));

// #506: the app registers its dirty check with the shared quit guard; capture it.
const quitGuard = vi.hoisted(() => ({ installed: null as (() => boolean | Promise<boolean>) | null }));
vi.mock("@monet-ui/monet-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  installQuitGuard: async (guard: () => boolean | Promise<boolean>) => { quitGuard.installed = guard; },
}));

const cli = vi.hoisted(() => ({ boot: false }));
vi.mock("../native/cli", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCliBoot: () => cli.boot,
}));

import { chooseUnsavedAction, closeDocumentTab, confirmDiscardAll, installUnsavedWorkGuard, store } from "./app";

type SeedDoc = { id: number; name: string; dirty: boolean };
const seedDocs = (docs: SeedDoc[]) => { (store as unknown as { docs: SeedDoc[] }).docs = docs; };

/** Register the guard and hand back the close handler it installed. */
async function guard() {
  win.handlers.length = 0;
  await installUnsavedWorkGuard();
  return win.handlers[0];
}

/** Fire a close request and report whether the close was stopped. */
async function requestClose(handler: (event: { preventDefault: () => void }) => unknown) {
  let prevented = false;
  await handler({ preventDefault: () => { prevented = true; } });
  return prevented;
}

beforeEach(() => {
  tauri.enabled = true;
  dialog.answer = "Don't Save";
  dialog.asked.length = 0;
  dialog.buttons.length = 0;
  win.handlers.length = 0;
  win.destroyed = 0;
  win.fail = false;
  quitGuard.installed = null;
  cli.boot = false;
  seedDocs([]);
});
afterEach(() => { seedDocs([]); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("unsaved-work guard on quit / window close", () => {
  it("hooks the close request under Tauri, and not in the browser build", async () => {
    expect(await guard()).toBeTypeOf("function");

    tauri.enabled = false;
    win.handlers.length = 0;
    await installUnsavedWorkGuard();
    expect(win.handlers).toHaveLength(0);
  });

  it("lets a clean workspace close immediately", async () => {
    seedDocs([{ id: 1, name: "a.psd", dirty: false }, { id: 2, name: "b.psd", dirty: false }]);
    const handler = await guard();

    // Nothing unsaved must close immediately; otherwise the guard is a nuisance.
    expect(await requestClose(handler)).toBe(false);
    expect(dialog.asked).toEqual([]);
    expect(win.destroyed).toBe(0); // the close was never stopped, so Tauri completes it
  });

  it("stops the close and destroys the window only once the prompt is accepted", async () => {
    seedDocs([{ id: 1, name: "a.psd", dirty: true }]);
    const handler = await guard();

    expect(await requestClose(handler)).toBe(true);
    expect(win.destroyed).toBe(1);
  });

  it("keeps the app alive when the prompt is declined", async () => {
    seedDocs([{ id: 1, name: "a.psd", dirty: true }]);
    dialog.answer = "Cancel";
    const handler = await guard();

    expect(await requestClose(handler)).toBe(true);
    expect(win.destroyed).toBe(0); // the work is still there
  });

  it("does not commit a live symmetry transform when tab close is declined", async () => {
    tauri.enabled = false;
    vi.stubGlobal("confirm", () => false);
    // The store — not the published summary — is the authority on unsaved work,
    // so the open document has to be genuinely dirty, as it is in the app.
    seedDocs([{ id: 7, name: "painting.psd", dirty: true }]);
    const current = store.state;
    vi.spyOn(store, "state", "get").mockReturnValue({
      ...current,
      activeDocId: 7,
      paintSymmetryTransforming: true,
      documents: [{ id: 7, name: "painting.psd", dirty: true }],
    } as never);
    const commit = vi.spyOn(store, "commitPaintSymmetryTransform");
    const close = vi.spyOn(store, "closeDoc");

    await expect(closeDocumentTab(7)).resolves.toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("does not block startup when the webview has no window API", async () => {
    win.fail = true;
    await expect(installUnsavedWorkGuard()).resolves.toBeUndefined();
    expect(win.handlers).toHaveLength(0);
  });

  it("lists every dirty document, not just the active one", () => {
    seedDocs([
      { id: 1, name: "a.psd", dirty: true },
      { id: 2, name: "b.psd", dirty: false },
      { id: 3, name: "c.psd", dirty: true },
    ]);
    expect(store.dirtyDocNames()).toEqual(["a.psd", "c.psd"]); // tab order, dirty only
  });

  it("names the documents in the prompt", async () => {
    seedDocs([
      { id: 1, name: "a.psd", dirty: true },
      { id: 2, name: "b.psd", dirty: true },
      { id: 3, name: "c.psd", dirty: true },
    ]);
    const handler = await guard();
    await requestClose(handler);

    expect(dialog.asked).toHaveLength(1);
    expect(dialog.asked[0]).toContain("Save changes");
    for (const name of ["a.psd", "b.psd", "c.psd"]) expect(dialog.asked[0]).toContain(name);
  });

  it("offers Save, Don't Save and Cancel, and elides a long list (#554)", async () => {
    expect(await chooseUnsavedAction(["a.psd"], "quit")).toBe("discard");
    expect(dialog.asked[0]).toBe("Save changes to “a.psd” before quitting?");
    expect(dialog.buttons[0]).toEqual({ yes: "Save", no: "Don't Save", cancel: "Cancel" });
    expect(await confirmDiscardAll(["a.psd"])).toBe(true);

    dialog.asked.length = 0;
    await chooseUnsavedAction(["a.psd", "b.psd", "c.psd", "d.psd"], "close");
    expect(dialog.asked[0]).toBe(
      "Save changes to 4 documents (“a.psd”, “b.psd”, “c.psd”, …) before closing?",
    );

    dialog.answer = "Save";
    expect(await chooseUnsavedAction(["a.psd"], "close")).toBe("save");
    dialog.answer = "Cancel";
    expect(await chooseUnsavedAction(["a.psd"], "close")).toBe("cancel");
    expect(await confirmDiscardAll(["a.psd"])).toBe(false);
  });

  it("falls back to the browser confirm when there is no native dialog", async () => {
    tauri.enabled = false;
    const confirmed = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmed);

    expect(await confirmDiscardAll(["a.psd"])).toBe(false);
    expect(confirmed).toHaveBeenNthCalledWith(1, "Save changes to “a.psd” before quitting?\n\nChoose OK to save.");
    expect(confirmed).toHaveBeenNthCalledWith(2, "Quit without saving?");
    expect(dialog.asked).toEqual([]); // the native dialog is never reached
  });
});

// #506 — ⌘Q / App menu ▸ Quit / Dock ▸ Quit / logout never reached the close
// guard above: the predefined Quit called NSApp terminate:, which tao answers
// with applicationWillTerminate only. The shared quit guard (monet-react's
// installQuitGuard) routes those native quits through the same dirty check.
describe("the quit guard (⌘Q / Dock ▸ Quit / logout)", () => {
  it("is installed with the close guard, and quits clean work without asking", async () => {
    seedDocs([{ id: 1, name: "a.psd", dirty: false }]);
    await installUnsavedWorkGuard();

    expect(quitGuard.installed).toBeTypeOf("function");
    await expect(quitGuard.installed!()).resolves.toBe(true);
    expect(dialog.asked).toEqual([]);
  });

  it("asks before quitting with unsaved documents, and honors the answer", async () => {
    seedDocs([{ id: 1, name: "a.psd", dirty: true }, { id: 2, name: "b.psd", dirty: false }]);
    await installUnsavedWorkGuard();

    dialog.answer = "Cancel";
    await expect(quitGuard.installed!()).resolves.toBe(false); // Cancel: stay
    expect(dialog.asked[0]).toContain("Save changes to “a.psd”");
    expect(dialog.buttons[0]).toEqual({ yes: "Save", no: "Don't Save", cancel: "Cancel" });

    dialog.answer = "Don't Save";
    await expect(quitGuard.installed!()).resolves.toBe(true); // Don't Save: quit
  });

  it("is not installed for a headless command-line job (nothing watches its prompt)", async () => {
    cli.boot = true;
    await installUnsavedWorkGuard();
    expect(quitGuard.installed).toBeNull();
  });
});

// Boot wiring stays a SOURCE check: main.tsx is the app entry point — importing
// it mounts React, boots the WASM engine and starts collab, none of which this
// node unit suite has. The one thing worth guarding is that the guard installed
// above is actually called at startup.
describe("the guard is installed at boot", () => {
  it("main.tsx calls installUnsavedWorkGuard()", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    expect(main).toContain("installUnsavedWorkGuard()");
  });
});
