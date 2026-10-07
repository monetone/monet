import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({
  tauri: true,
  answer: false,
  ask: vi.fn<() => Promise<boolean>>(),
  quitGuard: null as (() => boolean | Promise<boolean>) | null,
}));
const win = vi.hoisted(() => ({
  handler: null as ((event: { preventDefault(): void }) => Promise<void>) | null,
  destroy: vi.fn(async () => {}),
}));

vi.mock("@monet-ui/monet-react", () => ({
  isTauri: () => ui.tauri,
  ask: ui.ask,
  installQuitGuard: async (guard: () => boolean | Promise<boolean>) => { ui.quitGuard = guard; },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: typeof win.handler) => { win.handler = handler; return () => {}; },
    destroy: win.destroy,
  }),
}));

const { ArtisanStore } = await import("../engine");
const { installUnsavedWorkGuard } = await import("./app");

beforeEach(() => {
  ui.tauri = true;
  ui.answer = false;
  ui.ask.mockClear();
  ui.ask.mockImplementation(async () => ui.answer);
  ui.quitGuard = null;
  win.handler = null;
  win.destroy.mockClear();
});

describe("unsaved work guard", () => {
  it("blocks a native close until discarding dirty work is accepted", async () => {
    const store = new ArtisanStore();
    await installUnsavedWorkGuard(store);
    const preventDefault = vi.fn();

    await win.handler?.({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();

    store.transact("edit", (doc) => void (doc.name = "Poster"));
    await win.handler?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(win.destroy).not.toHaveBeenCalled();

    ui.answer = true;
    await win.handler?.({ preventDefault });
    expect(win.destroy).toHaveBeenCalledOnce();
  });

  it("registers the browser's native beforeunload guard", async () => {
    const store = new ArtisanStore();
    store.transact("edit", (doc) => void (doc.name = "Poster"));
    let handler: ((event: { preventDefault(): void }) => void) | undefined;
    ui.tauri = false;
    vi.stubGlobal("window", { addEventListener: (_type: string, fn: typeof handler) => { handler = fn; } });

    await installUnsavedWorkGuard(store);
    const preventDefault = vi.fn();
    handler?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  // #506 — ⌘Q / Dock ▸ Quit / logout never reached onCloseRequested (the
  // predefined Quit calls NSApp terminate:); the shared quit guard routes
  // those native quits through the same dirty check.
  it("registers the shared quit guard, answering with the same dirty check", async () => {
    const store = new ArtisanStore();
    await installUnsavedWorkGuard(store);
    expect(ui.quitGuard).toBeTypeOf("function");

    await expect(ui.quitGuard!()).resolves.toBe(true); // clean: quit, no prompt
    expect(ui.ask).not.toHaveBeenCalled();

    store.transact("edit", (doc) => void (doc.name = "Poster"));
    await expect(ui.quitGuard!()).resolves.toBe(false); // dirty, declined: stay
    ui.answer = true;
    await expect(ui.quitGuard!()).resolves.toBe(true); // dirty, accepted: quit
  });

  it("is installed by the app entry point", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    expect(main).toContain("installUnsavedWorkGuard()");
  });
});
