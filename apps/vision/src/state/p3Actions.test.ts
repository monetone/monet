// Cluster 5 (#551, #543, #540, #531, #522, #539, #542). Each test calls the
// shipped action, script, droplet, or document function. The assertions fail
// when a shared name hides the later action, when a Stop or a refused step is
// reported as a successful play, when a script batch ignores a fired timer,
// when a droplet save overwrites an arbitrary path, or when closing a document
// leaves its engine for the garbage collector.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: false }));
const dialog = vi.hoisted(() => ({
  confirm: vi.fn(async () => false),
  ask: vi.fn(async () => false),
  save: vi.fn(async () => null),
  open: vi.fn(async () => null),
}));
const fs = vi.hoisted(() => ({ exists: vi.fn(async () => false) }));
const invoke = vi.hoisted(() => vi.fn(async () => {}));
const atomic = vi.hoisted(() => ({ atomicWriteBytes: vi.fn(async () => {}) }));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
  invoke,
}));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);
vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("./atomicWrite", () => atomic);
vi.mock("./nativeBoundedRead", () => ({ readNativeFileBounded: vi.fn(async () => new Uint8Array()) }));

import { authorActionStop, actions, batchProcess, engine, replayScriptOps, saveDropletFile, store } from "./app";
import { serializeActionsFile } from "./actionSets";
import { SCRIPT_LIMIT_ERROR } from "./scriptLimits";
import { playAction, saveDroplet } from "../mcp/commands";
import { flatLayerProbe } from "./flatLayerProbe";
import { Store } from "./store";

const panelsSource = readFileSync(fileURLToPath(new URL("../ui/Panels.tsx", import.meta.url)), "utf8");

function installStorage(): void {
  const cells = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    get length() { return cells.size; },
  });
}

beforeEach(() => {
  installStorage();
  tauri.enabled = false;
  dialog.ask.mockReset();
  dialog.ask.mockResolvedValue(false);
  dialog.confirm.mockReset();
  fs.exists.mockReset();
  fs.exists.mockResolvedValue(false);
  invoke.mockClear();
  atomic.atomicWriteBytes.mockClear();
  actions.clearNamed();
  engine.engine = {
    deselect: vi.fn(),
    width: () => 8,
    height: () => 8,
    layer_count: () => 1,
    export_png_with_icc: () => new Uint8Array([1]),
  } as never;
});

afterEach(() => {
  actions.clearNamed();
  engine.engine = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("#551 action identity", () => {
  it("resolves the requested id when two saved actions share a name", async () => {
    localStorage.setItem("mv.actions", serializeActionsFile([
      { name: "Sharpen", favorite: false, createdAt: 1, steps: [["deselect", []]] },
      { name: "Sharpen", favorite: false, createdAt: 2, steps: [["deselect", []]] },
    ]));
    vi.resetModules();
    const booted = await import("./app");
    const list = booted.actions.list();
    expect(list.map((a) => a.name)).toEqual(["Sharpen", "Sharpen"]);
    expect(booted.actions.resolve({ id: list[1].id, name: "Sharpen" })).toBe(list[1].id);
    expect(booted.actions.resolve({ id: list[0].id, name: "Sharpen" })).toBe(list[0].id);
  });

  it("does not keep a second Sharpen when saving or renaming", () => {
    actions.start();
    actions.record(() => {});
    const first = actions.save("Sharpen");
    actions.start();
    actions.record(() => {});
    const second = actions.save("Sharpen");
    const names = () => actions.list().map((a) => a.name);
    expect(names()).toContain("Sharpen");
    expect(names().filter((name) => name === "Sharpen")).toHaveLength(1);
    expect(actions.list().find((a) => a.id === second)?.name).not.toBe("Sharpen");
    actions.rename(second, "Sharpen");
    expect(actions.list().find((a) => a.id === second)?.name).not.toBe("Sharpen");
    expect(actions.list().find((a) => a.id === first)?.name).toBe("Sharpen");
  });
});

describe("#543 playback reports a stop", () => {
  it("returns false and does not run the step after one that refused", async () => {
    const order: string[] = [];
    actions.start();
    actions.record(() => { order.push("a"); return false; });
    actions.record(() => { order.push("b"); });
    const id = actions.save("Refuse");
    expect(await actions.playNamed(id)).toBe(false);
    expect(order).toEqual(["a"]);
  });

  it("returns false when Stop halts, and the following step does not run", async () => {
    const order: string[] = [];
    actions.start();
    actions.record(() => { order.push("before"); });
    const id = actions.save("Halted");
    actions.insertStop(id, "halt", false);
    expect(actions.insertMenuItem(id, "deselect")).toBe(true);
    (engine.engine as unknown as { deselect: ReturnType<typeof vi.fn> }).deselect.mockImplementation(() => order.push("after"));
    expect(await actions.playNamed(id)).toBe(false);
    expect(order).toEqual(["before"]);
  });

  it("makes batch and MCP action.play report that failure", async () => {
    actions.start();
    actions.record(() => false);
    const id = actions.save("BatchStop");
    vi.spyOn(store, "openDocIds").mockReturnValue([4]);
    vi.spyOn(store, "docName").mockReturnValue("a.png");
    vi.spyOn(store, "activateDoc").mockImplementation(() => {});
    const batch = await batchProcess({ source: "opened", actionId: id, destination: "none" });
    expect(batch?.processed).toBe(0);
    expect(batch?.errors.map((error) => error.message).join("\n")).toMatch(/stopped/);
    await expect(playAction(id)).rejects.toThrow(/stopped/);
  });
});

describe("#540 the Actions panel renames an action", () => {
  it("commits the edited name through actions.rename", () => {
    actions.start();
    actions.record(() => {});
    const id = actions.save("Action 1");
    actions.rename(id, "Web Export");
    expect(actions.list().find((a) => a.id === id)?.name).toBe("Web Export");
    expect(panelsSource).toContain("data-mv-action-name");
    expect(panelsSource).toContain("actions.rename(a.id, next)");
  });
});

describe("#531 script replay can be stopped", () => {
  it("charges every op and stops the batch when the charge exceeds the budget", async () => {
    const ran: string[] = [];
    let cost = 0;
    await expect(replayScriptOps(
      [["a", []], ["b", []]],
      { a: () => { ran.push("a"); }, b: () => { ran.push("b"); } },
      { charge: () => { cost += 1; if (cost > 1) throw new Error(SCRIPT_LIMIT_ERROR); } },
    )).rejects.toThrow(SCRIPT_LIMIT_ERROR);
    expect(cost).toBe(2);
    expect(ran).toEqual(["a"]);
  });

  it("stops the remaining ops after the runtime timer fires", async () => {
    const ran: string[] = [];
    let stop: string | null = null;
    const timer = setTimeout(() => { stop = "Script exceeded the 30000 ms runtime budget"; }, 0);
    await expect(replayScriptOps(
      [["a", []], ["b", []], ["c", []]],
      {
        a: () => { ran.push("a"); },
        b: () => { ran.push("b"); },
        c: () => { ran.push("c"); },
      },
      { aborted: () => stop },
    )).rejects.toThrow(/runtime budget/);
    clearTimeout(timer);
    expect(ran).not.toContain("c");
  });
});

describe("#522 droplet save refuses a quiet overwrite", () => {
  const droplet = { actionId: 1, actionName: "Sharpen", format: "png" as const, template: "", stopOnError: false };

  it("rejects a path that is not .json or .app, and an existing .app", async () => {
    await expect(saveDropletFile("/tmp/notes.png", droplet)).rejects.toThrow(/\.json or \.app/);
    expect(atomic.atomicWriteBytes).not.toHaveBeenCalled();
    tauri.enabled = true;
    fs.exists.mockResolvedValue(true);
    await expect(saveDropletFile("/drops/Web.app", droplet)).rejects.toThrow(/already exists/);
    expect(invoke).not.toHaveBeenCalled();
    actions.start();
    actions.record(() => {});
    const id = actions.save("Sharpen");
    await expect(saveDroplet("/tmp/photo.png", id)).rejects.toThrow(/\.json or \.app/);
  });

  it("writes a new .json droplet", async () => {
    tauri.enabled = true;
    await saveDropletFile("/drops/Web.json", droplet);
    expect(atomic.atomicWriteBytes).toHaveBeenCalledWith("/drops/Web.json", expect.any(Uint8Array));
  });
});

describe("#539 closing, reverting, or replacing a document frees its engine", () => {
  function isolated() {
    const freed: ReturnType<typeof vi.fn>[] = [];
    const client = {
      onCommit: null as null | (() => void),
      engine: null as unknown,
      e: null as unknown,
      sync: () => {},
      commit: () => {},
      blit: () => {},
      refreshFromEngine: () => {},
      afterDocChange: () => {},
      setDisplayProfile() {},
      setIccProofLut() {},
      deactivate() { this.engine = null; this.e = null; },
      activate(eng: unknown) { this.engine = eng; this.e = eng; },
      buildNew() {
        const free = vi.fn();
        freed.push(free);
        const eng = new Proxy({ ...flatLayerProbe(), free, width: () => 8, height: () => 8, layer_count: () => 1 }, {
          get(target, prop) {
            if (prop in target) return target[prop as keyof typeof target];
            if (typeof prop !== "string") return undefined;
            return () => 0;
          },
        });
        this.engine = eng;
        this.e = eng;
        return eng;
      },
    };
    const docs = new Store(client as never);
    return { docs, freed, client };
  }

  it("frees the engine that close, revert, and a replaced blank tab drop", () => {
    const { docs, freed, client } = isolated();
    docs.newDocument(8, 8, "Blank", "white", 1, { pristineBlank: true });
    docs.newDocument(8, 8, "Photo");
    expect(freed[0]).toHaveBeenCalled();
    expect(freed[1]).not.toHaveBeenCalled();

    const replacement = client.buildNew();
    docs.revertActiveDoc(replacement as never, null);
    expect(freed[1]).toHaveBeenCalled();
    expect(freed[2]).not.toHaveBeenCalled();

    const kept = docs.state.documents[0]?.id;
    docs.newDocument(8, 8, "Other");
    docs.closeDoc(kept!);
    expect(freed[2]).toHaveBeenCalled();
  });
});

describe("#542 desktop playback uses the native dialog", () => {
  it("asks with the desktop dialog and stops when that answer is Cancel", async () => {
    tauri.enabled = true;
    const prompt = vi.fn(() => "nope");
    const webConfirm = vi.fn(() => true);
    vi.stubGlobal("prompt", prompt);
    vi.stubGlobal("confirm", webConfirm);
    const authored = await authorActionStop();
    expect(dialog.ask).toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(authored).toEqual({ message: "Stop", allowContinue: false });

    const order: string[] = [];
    actions.start();
    actions.record(() => { order.push("before"); });
    const id = actions.save("Pause");
    actions.insertStop(id, "hold", true);
    expect(actions.insertMenuItem(id, "deselect")).toBe(true);
    (engine.engine as unknown as { deselect: ReturnType<typeof vi.fn> }).deselect.mockImplementation(() => order.push("after"));
    // Playback imports plugin-dialog `confirm` (aliased ask). Insert Stop uses `ask`.
    dialog.confirm.mockResolvedValueOnce(false);
    expect(await actions.playNamed(id)).toBe(false);
    expect(order).toEqual(["before"]);
    expect(dialog.confirm).toHaveBeenCalledWith(
      "hold\n\nContinue playing this action?",
      { title: "Actions" },
    );
    expect(webConfirm).not.toHaveBeenCalled();
  });
});
