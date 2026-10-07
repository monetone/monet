// Playback Options is one setting for the Actions panel, so both Play buttons
// have to honour it. Only playNamed did: the panel toolbar's Play replayed the
// live recording through a bare forEach (#499).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const backing = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
      clear: () => backing.clear(),
    },
  });
});

// The desktop webview's window.confirm is tauri-plugin-dialog's async override,
// so a pause there has to wait on the plugin's own dialog (#480).
const tauri = vi.hoisted(() => ({ enabled: false }));
const pending = vi.hoisted(() => [] as { m: string; r: (ok: boolean) => void }[]);

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: (m: string) => new Promise<boolean>((r) => { pending.push({ m, r }); }),
}));

import { actions } from "./app";

/** Record two steps, then hand back a counter reset for the replay. */
function recordTwo(): number[] {
  const ran: number[] = [];
  actions.start();
  actions.record(() => ran.push(1), ["deselect", []]);
  actions.record(() => ran.push(2), ["deselect", []]);
  actions.stop();
  ran.length = 0;
  return ran;
}

afterEach(() => {
  tauri.enabled = false;
  pending.length = 0;
  actions.setPlaybackMode("accelerated");
  actions.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Actions panel's Play button", () => {
  it("honours Step By Step, and stops when a step is cancelled", async () => {
    const ran = recordTwo();
    actions.setPlaybackMode("stepByStep");
    vi.stubGlobal("confirm", () => false);

    await actions.play();

    expect(ran).toEqual([]);
  });

  it("runs every step when each is confirmed", async () => {
    const ran = recordTwo();
    actions.setPlaybackMode("stepByStep");
    vi.stubGlobal("confirm", () => true);

    await actions.play();

    expect(ran).toEqual([1, 2]);
  });

  it("asks nothing in Accelerated mode", async () => {
    const ran = recordTwo();
    const confirmed = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmed);

    await actions.play();

    expect(ran).toEqual([1, 2]);
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("on the desktop Step By Step waits for the native answer before each step", async () => {
    tauri.enabled = true;
    const ran = recordTwo();
    actions.setPlaybackMode("stepByStep");

    const run = actions.play();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(ran).toEqual([]);
    expect(pending[0].m).toContain("Deselect");

    pending[0].r(true);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(ran).toEqual([1]);

    pending[1].r(false);
    await run;
    expect(ran).toEqual([1]);
  });
});
