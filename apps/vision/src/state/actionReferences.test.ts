// A droplet on disk and a Script Events binding in localStorage outlive the
// session that wrote them. They stored the runtime action id — which restarts
// at 1 on every module load and is handed out in persisted-array order — so
// editing the action list silently re-pointed or broke every one of them (#494).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

const SEED = JSON.stringify({
  format: "mvactions",
  version: 1,
  app: "monet-vision",
  exportedAt: 0,
  actions: [
    { name: "Deselect", favorite: false, createdAt: 0, steps: [["deselect", []]] },
    { name: "Watermark", favorite: false, createdAt: 0, steps: [["deselect", []]] },
  ],
});

/** Load state/app fresh, the way a relaunch does. */
async function boot() {
  vi.resetModules();
  return await import("./app") as typeof import("./app");
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("a persisted action reference", () => {
  // Each boot() re-imports state/app, which is a large module; twice in one
  // test can outrun the 5s default on a loaded machine.
  it("still finds its action after the list is renumbered", { timeout: 20_000 }, async () => {
    const first = await boot();
    expect(first.actions.importJson(SEED).imported).toBe(2);
    const saved = first.actions.list();
    expect(saved.map((a) => a.name)).toEqual(["Deselect", "Watermark"]);
    // What a droplet written today records about its action.
    const ref = { id: saved[1].id, name: saved[1].name };
    expect(ref.id).toBe(2);

    // The user deletes the earlier action; the ids are rebuilt on next launch.
    first.actions.delete(saved[0].id);
    const next = await boot();
    expect(next.actions.list().map((a) => a.id)).toEqual([1]);

    // The stored id now names nothing (or, with one more action recorded, the
    // WRONG one). The name is the durable handle.
    expect(await next.actions.playNamed(ref.id)).toBe(false);
    expect(next.actions.resolve(ref)).toBe(1);
    next.engine.engine = new Proxy({}, { get: () => () => 0 }) as never; // the step touches the engine
    expect(await next.actions.playNamed(next.actions.resolve(ref)!)).toBe(true);
  });

  it("falls back to the id for a reference written before names were stored", { timeout: 20_000 }, async () => {
    const app = await boot();
    app.actions.importJson(SEED);
    expect(app.actions.resolve({ id: 2 })).toBe(2);
    expect(app.actions.resolve({ id: 99 })).toBeNull();
    expect(app.actions.resolve({ name: "Nothing" })).toBeNull();
  });
});
