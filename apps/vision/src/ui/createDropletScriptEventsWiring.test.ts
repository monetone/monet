// File ▸ Automate ▸ Create Droplet… and File ▸ Scripts ▸ Script Events Manager…
// psMenusAutomation.test.ts pins the menu-layer wiring (blueprint label → host
// action id "createdroplet" / "scripteventsmanager"). This is the other half:
// the host actions (App.tsx menuActions) must open a dialog that actually
// exists, and the Script Events Manager must only bind events Vision can really
// raise — and actually run them.
//
// SCRIPT_EVENTS and runScriptEventBindings are exported, so the event side is
// tested for real against localStorage, the actions layer and the script runner.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { SCRIPT_EVENTS, runScriptEventBindings, type ScriptEventBinding, type ScriptEventId } from "./Dialogs";
import type { DialogName } from "./dialogs/common";
import * as app from "../state/app";

const SCRIPT_EVENTS_KEY = "mv.scriptEvents";

function installStorage(): Map<string, string> {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
  return cells;
}

let cells: Map<string, string>;
const store = (enabled: boolean, bindings: ScriptEventBinding[]) =>
  cells.set(SCRIPT_EVENTS_KEY, JSON.stringify({ enabled, bindings }));

beforeEach(() => { cells = installStorage(); });
afterEach(() => { vi.restoreAllMocks(); });

// A binding resolves through actions.resolve (ids are per session, so the name
// is the durable handle); these tests are about the wiring, not the lookup.
const stubPlay = () => {
  vi.spyOn(app.actions, "resolve").mockImplementation((ref) => ref.id ?? null);
  return vi.spyOn(app.actions, "playNamed").mockResolvedValue(true);
};

describe("Script Events Manager", () => {
  it("only binds events Vision can raise without lying about it", () => {
    expect(SCRIPT_EVENTS.map((e) => e.id)).toEqual(["newDocument", "saveDocument", "openDocument", "closeDocument", "exportDocument"]);
    expect(SCRIPT_EVENTS.map((e) => e.label)).toEqual(["New Document", "Save Document", "Open Document", "Close Document", "Export Document"]);
  });

  it("plays the bound action when its event fires, and nothing else", async () => {
    const play = stubPlay();
    store(true, [
      { event: "newDocument", actionId: 3 },
      { event: "saveDocument", actionId: 9 },
      { event: "newDocument", actionId: 4 },
    ]);

    await runScriptEventBindings("newDocument");

    expect(play.mock.calls.map((c) => c[0]), "bindings run in order, and only for the event raised").toEqual([3, 4]);
  });

  it("runs an inline script binding through the script runner", async () => {
    const run = vi.spyOn(app, "runScript").mockResolvedValue("");
    const play = stubPlay();
    store(true, [{ event: "saveDocument", code: "doc.flatten()" }]);

    await runScriptEventBindings("saveDocument");

    expect(run).toHaveBeenCalledWith("doc.flatten()");
    expect(play).not.toHaveBeenCalled();
  });

  it("honours the master Enable switch", async () => {
    const play = stubPlay();
    const run = vi.spyOn(app, "runScript").mockResolvedValue("");
    store(false, [{ event: "newDocument", actionId: 3 }, { event: "newDocument", code: "x" }]);

    await runScriptEventBindings("newDocument");

    expect(play).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("is a no-op on a fresh profile and survives unreadable storage", () => {
    const play = stubPlay();
    expect(() => runScriptEventBindings("newDocument")).not.toThrow();

    cells.set(SCRIPT_EVENTS_KEY, "{not json");
    expect(() => runScriptEventBindings("newDocument")).not.toThrow();
    expect(play).not.toHaveBeenCalled();
  });

  it("ignores a binding with neither an action nor a script", async () => {
    const play = stubPlay();
    const run = vi.spyOn(app, "runScript").mockResolvedValue("");
    store(true, [{ event: "newDocument" }]);

    await runScriptEventBindings("newDocument");

    expect(play).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("Create Droplet / Script Events Manager dialog names", () => {
  it("registers both dialog names on the DialogName union", () => {
    // Compile-checked: an unregistered name fails `pnpm typecheck`, which is
    // what the old regex over common.tsx was standing in for.
    const names: DialogName[] = ["createDroplet", "scriptEvents"];
    expect(names).toHaveLength(2);
    const events: ScriptEventId[] = SCRIPT_EVENTS.map((e) => e.id);
    expect(events).toEqual(["newDocument", "saveDocument", "openDocument", "closeDocument", "exportDocument"]);
  });
});

// ── residual source-level guard ────────────────────────────────
// A wired handler pointing at a nonexistent dialog is worse than the disabled
// placeholder it replaces, but neither end of that link is reachable from a unit
// test: App.tsx's `menuActions` map is built inside the App component over the
// live engine/canvas, and DialogHost's open() switch plus both dialog
// components are module-private. Pinning the call sites is the only check
// available below the e2e suite.
const dialogsSource = readFileSync(fileURLToPath(new URL("./Dialogs.tsx", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

describe("host action → dialog routing", () => {
  it("routes menuActions' createdroplet/scripteventsmanager ids to those dialog names", () => {
    expect(appSource).toContain('createdroplet: () => open("createDroplet"),');
    expect(appSource).toContain('scripteventsmanager: () => open("scriptEvents"),');
  });

  it("wires both dialogs into the open() switch, alongside an implemented component", () => {
    expect(dialogsSource).toContain('case "createDroplet": return <CreateDropletDialog />;');
    expect(dialogsSource).toContain('case "scriptEvents": return <ScriptEventsManagerDialog />;');
    expect(dialogsSource).toContain("function CreateDropletDialog()");
    expect(dialogsSource).toContain("function ScriptEventsManagerDialog()");
  });
});
