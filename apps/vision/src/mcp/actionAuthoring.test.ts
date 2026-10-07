// Guards #474: MCP could list and play actions but never author one, so an
// agent could only replay what a human had recorded. These drive the REAL
// action layer (only the wasm engine is stubbed), so the assertions are that a
// tool call actually changes what the Actions panel would show — not that a
// wrapper called a mock.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

import { actions } from "../state/app";
import { serializeActionsFile, serializeAtn, type PortableAction } from "../state/actionSets";
import {
  deleteAction, deleteActionStep, importActions, listActionSteps, listActions,
  moveActionStep, recordAction, renameAction, saveAction, setActionStep,
} from "./commands";

const steps: PortableAction["steps"] = [["adj.invert", []], ["fil.gaussian", [4]], ["store.deselect", []]];
const portable = (name: string): PortableAction => ({ name, favorite: false, createdAt: 1, set: "Agent", steps });

/** Import one action and hand back its id — the fixture every step tool needs. */
function seed(name = "Seeded"): number {
  importActions(serializeActionsFile([portable(name)]));
  return actions.list().find((a) => a.name === name)!.id;
}

beforeEach(() => {
  for (const a of actions.list()) actions.delete(a.id);
  actions.stop();
});

describe("recording an action from MCP (#474)", () => {
  it("records, saves under a name, and the action is then listed and playable", () => {
    expect(recordAction(true)).toContain("Recording");
    expect(actions.isRecording()).toBe(true);
    // Any recorded command works; a tool gesture is the one an agent cannot type.
    actions.setAllowToolRecording(true);
    actions.recordTool(["selectRect", [0, 0, 10, 10, 0]]);
    actions.setAllowToolRecording(false);

    expect(recordAction(false)).toContain("1 step");
    expect(actions.isRecording()).toBe(false);

    const saved = JSON.parse(saveAction("From MCP"));
    expect(saved).toMatchObject({ name: "From MCP", stepCount: 1 });
    expect(JSON.parse(listActions("from mcp"))).toHaveLength(1);
    expect(JSON.parse(listActionSteps(saved.id))).toEqual([
      { index: 0, label: "Select Rect", args: "[0,0,10,10,0]", enabled: true, dialog: false, volatile: false },
    ]);
  });

  it("refuses to save mid-recording, or with nothing recorded", () => {
    recordAction(true);
    expect(() => saveAction("Half")).toThrow("Still recording");
    recordAction(false);
    expect(() => saveAction("Empty")).toThrow("Nothing recorded");
    expect(actions.list()).toEqual([]);
  });
});

describe("editing a saved action from MCP (#474)", () => {
  it("renames and deletes", () => {
    const id = seed();
    expect(renameAction(id, "Renamed")).toBe('Renamed "Seeded" to "Renamed"');
    expect(actions.list()[0].name).toBe("Renamed");
    expect(() => renameAction(id, "   ")).toThrow("needs a name");
    expect(deleteAction(id)).toBe('Deleted "Renamed"');
    expect(actions.list()).toEqual([]);
  });

  it("reorders a recorded sequence and drops a step", () => {
    const id = seed();
    expect(moveActionStep(id, 2, 0)).toBe("Moved step 2 to 0");
    expect(JSON.parse(listActionSteps(id)).map((s: { label: string }) => s.label))
      .toEqual(["Deselect", "Invert", "Gaussian"]);
    expect(deleteActionStep(id, 1)).toBe("Deleted step 1 (Invert)");
    expect(JSON.parse(listActionSteps(id)).map((s: { label: string }) => s.label)).toEqual(["Deselect", "Gaussian"]);
  });

  it("sets both step flags at once", () => {
    const id = seed();
    expect(setActionStep(id, 1, false, true)).toContain("disabled");
    expect(JSON.parse(listActionSteps(id))[1]).toMatchObject({ enabled: false, dialog: true });
    setActionStep(id, 1);
    expect(JSON.parse(listActionSteps(id))[1]).toMatchObject({ enabled: true, dialog: false });
  });

  // The facade no-ops on an unknown id or index, so a thin wrapper would report
  // a successful edit of something that does not exist.
  it("refuses an unknown action or step instead of reporting a fake edit", () => {
    const id = seed();
    expect(() => renameAction(99, "x")).toThrow("No such action #99");
    expect(() => listActionSteps(99)).toThrow("No such action #99");
    expect(() => setActionStep(id, 7)).toThrow("No step 7 in action");
    expect(() => moveActionStep(id, 0, 9)).toThrow("No step 9 in action");
    expect(() => deleteActionStep(id, -1)).toThrow("No step -1 in action");
    expect(JSON.parse(listActionSteps(id))).toHaveLength(3); // …and nothing moved
  });
});

describe("importing packs from MCP (#474)", () => {
  it("imports Vision's own format and reports what it refused", () => {
    const bad: PortableAction = { ...portable("Bogus"), steps: [["no.such.op", []]] };
    const out = JSON.parse(importActions(serializeActionsFile([portable("Good"), bad])));
    expect(out).toEqual({ imported: 1, rejected: [{ name: "Bogus", reason: "unknown op: no.such.op" }] });
    expect(actions.list().map((a) => a.name)).toEqual(["Good"]);
  });

  it("imports an Adobe .atn pack from base64", () => {
    const bytes = serializeAtn([portable("Adobe")], "Pack");
    const base64 = btoa(String.fromCharCode(...bytes));
    expect(JSON.parse(importActions(base64, "atn"))).toEqual({ imported: 1, rejected: [] });
    expect(actions.list()[0]).toMatchObject({ name: "Adobe", set: "Pack", stepCount: 3 });
    expect(JSON.parse(listActionSteps(actions.list()[0].id)).map((s: { label: string }) => s.label))
      .toEqual(["Invert", "Gaussian", "Deselect"]);
  });

  it("refuses a payload that is not what it says it is", () => {
    expect(() => importActions("not base64 at all!", "atn")).toThrow("not valid base64");
    expect(() => importActions("[]")).toThrow("Imported nothing: (file) (not an mvactions file)");
    expect(actions.list()).toEqual([]);
  });
});
