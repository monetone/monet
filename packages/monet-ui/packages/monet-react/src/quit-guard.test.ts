// #506 — the predefined Quit item called NSApp terminate:, which tao answers
// with applicationWillTerminate only: no window ever saw a CloseRequested, so
// ⌘Q / App menu ▸ Quit / Dock ▸ Quit / logout discarded unsaved work in every
// Monet app. The shared quit guard routes all of them through the app's
// dirty-work check, and exits for real only once it approves.
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn<(cmd: string) => Promise<void>>(async () => {}),
  listeners: new Map<string, ((event: unknown) => void)[]>(),
  askAnswer: true,
  asked: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => native.tauri,
  invoke: native.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, cb: (e: unknown) => void) => {
    const list = native.listeners.get(event) ?? [];
    list.push(cb);
    native.listeners.set(event, list);
    return () => {};
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: async (message: string) => {
    native.asked.push(message);
    return native.askAnswer;
  },
}));

const win = vi.hoisted(() => ({
  handlers: [] as ((event: { preventDefault: () => void }) => unknown)[],
  destroyed: 0,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (fn: (event: { preventDefault: () => void }) => unknown) => {
      win.handlers.push(fn);
      return () => {};
    },
    destroy: async () => {
      win.destroyed++;
    },
  }),
}));

import {
  QUIT_REQUESTED_EVENT,
  confirmDiscardUnsaved,
  installQuitGuard,
  installUnsavedWorkGuard,
  requestAppQuit,
} from "./quit-guard";

const invoked = (cmd: string) => native.invoke.mock.calls.filter(([c]) => c === cmd).length;
const fireNativeQuit = () => {
  const listeners = native.listeners.get(QUIT_REQUESTED_EVENT) ?? [];
  return Promise.all(listeners.map(async (fn) => fn({})));
};

beforeEach(() => {
  native.tauri = true;
  native.invoke.mockClear();
  native.listeners.clear();
  native.askAnswer = true;
  native.asked.length = 0;
  win.handlers.length = 0;
  win.destroyed = 0;
});

describe("requestAppQuit", () => {
  it("exits through the native quit command once the guard approves", async () => {
    await installQuitGuard(() => true);
    await requestAppQuit();
    expect(invoked("monet_quit_exit")).toBe(1);
  });

  it("stays when the guard declines", async () => {
    await installQuitGuard(() => false);
    await requestAppQuit();
    expect(invoked("monet_quit_exit")).toBe(0);
  });

  it("releases the native termination with a cancel reply when the guard declines", async () => {
    // The native side answers applicationShouldTerminate with NSTerminateLater,
    // which must be released with a cancel reply or the app hangs on quit.
    await installQuitGuard(() => false);
    await requestAppQuit();
    expect(invoked("monet_quit_cancel")).toBe(1);

    native.invoke.mockClear();
    await fireNativeQuit();
    expect(invoked("monet_quit_cancel")).toBe(1);
  });

  it("supports async guards", async () => {
    await installQuitGuard(async () => {
      await Promise.resolve();
      return true;
    });
    await requestAppQuit();
    expect(invoked("monet_quit_exit")).toBe(1);
  });

  it("does not re-enter the guard while its prompt is still open", async () => {
    let calls = 0;
    let release = () => {};
    await installQuitGuard(() => {
      calls++;
      return new Promise<boolean>((resolve) => {
        release = () => resolve(false);
      });
    });
    const first = requestAppQuit();
    const second = requestAppQuit(); // a second ⌘Q / Dock Quit while the prompt is up
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(invoked("monet_quit_exit")).toBe(0);
  });
});

describe("installQuitGuard", () => {
  it("announces the guard to the native side and answers the OS quit event", async () => {
    const guard = vi.fn(() => true);
    await installQuitGuard(guard);
    expect(invoked("monet_quit_guard_ready")).toBe(1);
    expect(native.listeners.get(QUIT_REQUESTED_EVENT)).toHaveLength(1);

    await fireNativeQuit(); // Dock ▸ Quit / logout: applicationShouldTerminate routed here
    expect(guard).toHaveBeenCalledTimes(1);
    expect(invoked("monet_quit_exit")).toBe(1);
  });

  it("keeps the app alive when the native quit is declined", async () => {
    await installQuitGuard(() => false);
    await fireNativeQuit();
    expect(invoked("monet_quit_exit")).toBe(0);
  });

  it("is inert outside Tauri: no readiness, no listener, no throw", async () => {
    native.tauri = false;
    await expect(installQuitGuard(() => true)).resolves.toBeUndefined();
    expect(invoked("monet_quit_guard_ready")).toBe(0);
    expect(native.listeners.size).toBe(0);
  });
});

describe("confirmDiscardUnsaved", () => {
  it("asks natively under Tauri, phrasing one document differently from many", async () => {
    expect(await confirmDiscardUnsaved(["a.psd"])).toBe(true);
    expect(native.asked[0]).toBe("“a.psd” has unsaved changes. Quit without saving?");

    native.asked.length = 0;
    await confirmDiscardUnsaved(["a.psd", "b.psd", "c.psd", "d.psd"]);
    expect(native.asked[0]).toBe("4 documents (“a.psd”, “b.psd”, “c.psd”, …) have unsaved changes. Quit without saving?");
  });

  it("uses the close wording for a window close", async () => {
    await confirmDiscardUnsaved(["a.psd"], "close");
    expect(native.asked[0]).toBe("“a.psd” has unsaved changes. Close without saving?");
  });

  it("answers with the dialog result", async () => {
    native.askAnswer = false;
    expect(await confirmDiscardUnsaved(["a.psd"])).toBe(false);
  });

  it("falls back to the browser confirm outside Tauri", async () => {
    native.tauri = false;
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);

    expect(await confirmDiscardUnsaved(["a.psd"])).toBe(false);
    expect(confirm).toHaveBeenCalledWith("“a.psd” has unsaved changes. Quit without saving?");
    expect(native.asked).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("installUnsavedWorkGuard (shared close + quit wiring)", () => {
  const requestClose = async (handler: (event: { preventDefault: () => void }) => unknown) => {
    let prevented = false;
    await handler({ preventDefault: () => {
      prevented = true;
    } });
    return prevented;
  };

  it("lets a clean workspace close and quit without asking", async () => {
    let dirty = false;
    await installUnsavedWorkGuard({ dirtyNames: () => (dirty ? ["a.psd"] : []) });
    expect(win.handlers).toHaveLength(1);
    expect(await requestClose(win.handlers[0])).toBe(false);
    expect(native.asked).toEqual([]);

    await fireNativeQuit();
    expect(invoked("monet_quit_exit")).toBe(1);
    expect(native.asked).toEqual([]);
    void dirty;
  });

  it("gates the window close on the unsaved-work prompt", async () => {
    await installUnsavedWorkGuard({ dirtyNames: () => ["a.psd"] });

    expect(await requestClose(win.handlers[0])).toBe(true);
    expect(win.destroyed).toBe(1); // askAnswer = true

    native.askAnswer = false;
    expect(await requestClose(win.handlers[0])).toBe(true);
    expect(win.destroyed).toBe(1); // declined: still alive
  });

  it("gates the OS quit on the same prompt", async () => {
    await installUnsavedWorkGuard({ dirtyNames: () => ["a.psd"] });

    native.askAnswer = false;
    await fireNativeQuit();
    expect(invoked("monet_quit_exit")).toBe(0);
    expect(native.asked[0]).toContain("Quit without saving?");

    native.askAnswer = true;
    await fireNativeQuit();
    expect(invoked("monet_quit_exit")).toBe(1);
  });

  it("guards browser tab closes with beforeunload", async () => {
    native.tauri = false;
    const listeners = new Map<string, (event: { preventDefault: () => void }) => void>();
    vi.stubGlobal("window", {
      addEventListener: (type: string, fn: (event: { preventDefault: () => void }) => void) => listeners.set(type, fn),
    });

    let dirty = false;
    await installUnsavedWorkGuard({ dirtyNames: () => (dirty ? ["a.psd"] : []) });
    const beforeunload = listeners.get("beforeunload");
    expect(beforeunload).toBeTypeOf("function");

    const preventDefault = vi.fn();
    beforeunload?.({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();

    dirty = true;
    beforeunload?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
