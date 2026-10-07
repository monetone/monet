// Guards #467: Insert Menu Item, Insert Conditional and Playback Options were
// implemented on the actions facade but unreachable — the panel offered no way
// to append either step or to switch playback mode. This pins the facade's
// contract with the picker: everything it lists is insertable. The panel half
// renders for real in ui/panelInventory.test.ts.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { actions } from "./app";
import { IF_OP, serializeActionsFile, type PortableAction } from "./actionSets";

let seq = 0;
/** A saved action to insert into, seeded with one real op so it imports. */
function freshAction(): number {
  const name = `Insert Target ${++seq}`;
  const portable: PortableAction = {
    name, favorite: false, createdAt: 1, set: "Test",
    steps: [[actions.menuItemPaths()[0], []]],
  };
  expect(actions.importJson(serializeActionsFile([portable])).imported).toBe(1);
  const found = actions.list().find((a) => a.name === name);
  expect(found).toBeDefined();
  return found!.id;
}

describe("Insert Menu Item (#467)", () => {
  it("lists the commands it accepts, sorted, and accepts every one of them", () => {
    const paths = actions.menuItemPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toEqual([...paths].sort());
    const id = freshAction();
    for (const path of paths) expect(actions.insertMenuItem(id, path)).toBe(true);
    expect(actions.getSteps(id).length).toBe(1 + paths.length);
  });

  it("refuses a command outside the allowlist without touching the action", () => {
    const id = freshAction();
    expect(actions.insertMenuItem(id, "no.such.command")).toBe(false);
    expect(actions.insertMenuItem(id, "")).toBe(false);
    // Parameterized commands are recorded by using them. An inserted step would
    // replay with the radius, the layer id, or the brightness missing.
    expect(actions.insertMenuItem(id, "store.setLayerOpacity")).toBe(false);
    expect(actions.insertMenuItem(id, "adj.brightnessContrast")).toBe(false);
    expect(actions.insertMenuItem(id, "fil.gaussian")).toBe(false);
    expect(actions.insertMenuItem(id, "store.duplicateLayer")).toBe(false);
    expect(actions.insertMenuItem(id, "log", ["nope"])).toBe(false);
    expect(actions.getSteps(id).length).toBe(1);
    expect(actions.menuItemPaths()).not.toContain("store.setLayerOpacity");
    expect(actions.menuItemPaths()).not.toContain("adj.brightnessContrast");
  });

  it("appends a replayable step, not a volatile one", () => {
    const id = freshAction();
    actions.insertMenuItem(id, actions.menuItemPaths()[0]);
    expect(actions.getSteps(id).at(-1)?.volatile).toBeFalsy();
    expect(actions.isPersistable(id)).toBe(true);
  });
});

describe("Insert Conditional (#467)", () => {
  it("appends a branch step naming its target action", () => {
    const id = freshAction();
    expect(actions.insertConditional(id, "documentLandscape", " Wide ", "Tall")).toBe(true);
    const steps = actions.getSteps(id);
    expect(steps.length).toBe(2);
    expect(actions.exportJson()).toContain(IF_OP);
  });

  it("refuses a condition this build cannot evaluate", () => {
    const id = freshAction();
    expect(actions.insertConditional(id, "documentIsPurple", "Wide")).toBe(false);
    expect(actions.getSteps(id).length).toBe(1);
  });
});

describe("Playback Options (#467)", () => {
  it("round-trips the mode and ignores anything not a mode", () => {
    actions.setPlaybackMode("stepByStep");
    expect(actions.playbackMode()).toBe("stepByStep");
    actions.setPlaybackMode("dawdle" as never);
    expect(actions.playbackMode()).toBe("accelerated");
  });
});
