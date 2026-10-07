// VIS-ACT-03: Insert Menu Item, Insert Conditional and Playback Options — the
// parts of Photoshop's Actions flyout that make a replay more than a frozen
// forEach. Stops and the per-step modal toggle are covered by actionSteps.test.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTION_CONDITIONS, IF_OP, MAX_ACTION_PLAY_DEPTH, PLAYBACK_MODES,
  evalActionCondition, ifBranchTarget, parseActionsFile, parseIfArgs, serializeActionsFile,
  type ActionConditionContext, type PortableAction,
} from "./actionSets";

const ALLOWED = new Set(["adj.invert", "fil.gaussian"]);

// A landscape, RGB, clean document with a visible unlocked pixel layer.
const BASE: ActionConditionContext = {
  documentOpen: true, width: 1600, height: 900, mode: 0, dirty: false, hasSelection: false,
  layerVisible: true, layerLocked: false, layerHasMask: false, layerKind: 0,
};

describe("action conditions", () => {
  it("tests document shape, mode, dirtiness and selection", () => {
    expect(evalActionCondition("documentLandscape", BASE)).toBe(true);
    expect(evalActionCondition("documentPortrait", BASE)).toBe(false);
    expect(evalActionCondition("documentSquare", { ...BASE, height: 1600 })).toBe(true);
    expect(evalActionCondition("documentRgb", BASE)).toBe(true);
    expect(evalActionCondition("documentGrayscale", { ...BASE, mode: 1 })).toBe(true);
    expect(evalActionCondition("documentDirty", { ...BASE, dirty: true })).toBe(true);
    expect(evalActionCondition("hasSelection", { ...BASE, hasSelection: true })).toBe(true);
  });

  it("tests the active layer by flag and kind", () => {
    expect(evalActionCondition("layerVisible", BASE)).toBe(true);
    expect(evalActionCondition("layerLocked", BASE)).toBe(false);
    expect(evalActionCondition("layerHasMask", { ...BASE, layerHasMask: true })).toBe(true);
    expect(evalActionCondition("layerIsPixel", BASE)).toBe(true);
    expect(evalActionCondition("layerIsText", { ...BASE, layerKind: 2 })).toBe(true);
    expect(evalActionCondition("layerIsAdjustment", { ...BASE, layerKind: 1 })).toBe(true);
    expect(evalActionCondition("layerIsShape", { ...BASE, layerKind: 3 })).toBe(true);
    expect(evalActionCondition("layerIsSmartObject", { ...BASE, layerKind: 7 })).toBe(true);
  });

  it("is false with no document or no active layer, and for unknown keys", () => {
    const empty = { ...BASE, documentOpen: false, layerKind: -1 };
    for (const c of ACTION_CONDITIONS) {
      if (c === "hasSelection") continue; // selection state is independent of both
      expect(evalActionCondition(c, empty)).toBe(false);
    }
    expect(evalActionCondition("layerVisible", { ...BASE, layerKind: -1 })).toBe(false);
    expect(evalActionCondition("someFutureTest", BASE)).toBe(false);
  });
});

describe("Insert Conditional pseudo-op", () => {
  it("normalizes untrusted branch args", () => {
    expect(parseIfArgs(["documentLandscape", "  Wide  ", "Tall"]))
      .toEqual({ condition: "documentLandscape", thenAction: "Wide", elseAction: "Tall" });
    expect(parseIfArgs([])).toEqual({ condition: "", thenAction: "", elseAction: "" });
    expect(parseIfArgs([7, 7, null])).toEqual({ condition: "", thenAction: "", elseAction: "" });
    expect(parseIfArgs(["documentRgb", "x".repeat(9999)]).thenAction).toBe("");
  });

  it("picks the then branch when the condition holds and the else branch otherwise", () => {
    const args = ["documentLandscape", "Wide", "Tall"];
    expect(ifBranchTarget(args, BASE)).toBe("Wide");
    expect(ifBranchTarget(args, { ...BASE, width: 900, height: 1600 })).toBe("Tall");
    // An unset branch and an unknown condition both mean "play nothing".
    expect(ifBranchTarget(["documentLandscape", "Wide"], { ...BASE, width: 900, height: 1600 })).toBe("");
    expect(ifBranchTarget(["nope", "Wide", "Tall"], BASE)).toBe("Tall");
  });

  it("survives export/import without the op being in the visionOps allowlist", () => {
    const action: PortableAction = {
      name: "Router", favorite: false, createdAt: 5, set: "Web",
      steps: [[IF_OP, ["documentLandscape", "Wide", "Tall"]], ["adj.invert", []]],
    };
    const { actions, rejected } = parseActionsFile(serializeActionsFile([action]), ALLOWED);
    expect(rejected).toEqual([]);
    expect(actions[0].steps[0]).toEqual([IF_OP, ["documentLandscape", "Wide", "Tall"]]);
  });
});

// Playback lives in a module too heavy to import under node, so — like
// actionSteps.test.ts — assert the wiring against the source text.
describe("playback wiring", () => {
  const appSource = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
  // The step loop is shared by playNamed and the panel's Play (#499), so the
  // wiring assertions read runActionSteps; the recursion guard stays with the
  // two entry points that own the depth counter.
  const slice = (start: string, end: string) => {
    const from = appSource.indexOf(start);
    expect(from, start).toBeGreaterThanOrEqual(0);
    return appSource.slice(from, appSource.indexOf(end, from));
  };
  const body = slice("function runActionSteps(", "export const actions = {");
  const entryPoints = slice("  async play(", "  clearNamed()");

  it("resolves the conditional branch by name and guards against branch recursion", () => {
    expect(body).toContain("ifBranchTarget(s.op[1], actionConditionContext())");
    expect(body).toContain("await actions.playNamed(target.id, 0, skipOps)");
    expect(entryPoints).toContain("_playDepth >= MAX_ACTION_PLAY_DEPTH");
    expect(entryPoints).toContain("_playDepth--");
    expect(MAX_ACTION_PLAY_DEPTH).toBeGreaterThan(0);
  });

  it("plays the live recording through the same step loop as a saved action", () => {
    // Both Play buttons, one machinery — the panel toolbar's Play used to be a
    // bare _recorded.forEach and ignored every playback option (#499).
    expect(entryPoints).toContain("await runActionSteps(_recorded, 0, skipOps)");
    expect(entryPoints).toContain("await runActionSteps(found.steps, fromStep, skipOps)");
  });

  it("Step By Step confirms ordinary steps but leaves the pseudo-ops alone", () => {
    const mode = body.indexOf('_playbackMode === "stepByStep"');
    const modal = body.indexOf("s.dialog && !(await confirmPlaybackPause(");
    expect(mode).toBeGreaterThanOrEqual(0);
    expect(modal).toBeGreaterThan(mode); // the mode has already forced dialog: true
    expect(body).toContain('raw.op?.[0] !== STOP_OP && raw.op?.[0] !== IF_OP');
    expect(PLAYBACK_MODES).toEqual(["accelerated", "stepByStep"]);
  });

  it("Insert Menu Item validates the op against the visionOps allowlist", () => {
    const from = appSource.indexOf("insertMenuItem(id: number, path: string");
    expect(from).toBeGreaterThanOrEqual(0);
    const insert = appSource.slice(from, appSource.indexOf("insertConditional", from));
    expect(insert).toContain("visionOps(), path");
    expect(insert).toContain("isSerializableArgs(args)");
    expect(insert).toContain("opRunner(op)"); // replayable + persistable like a recorded step
  });

  it("Insert Conditional rejects a condition this build cannot evaluate", () => {
    const from = appSource.indexOf("insertConditional(id: number");
    expect(from).toBeGreaterThanOrEqual(0);
    expect(appSource.slice(from, from + 400)).toContain("ACTION_CONDITIONS.includes(");
  });
});
