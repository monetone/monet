// Step-tree model (VIS-ACT-01): per-step enable/reorder/delete helpers, set
// grouping, the extended .mvactions fields (set + disabled + dialogs indices),
// and the Insert Stop pseudo-op.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createActionMeta, filterActionMetas, moveItem, parseActionsFile, parseStopArgs,
  serializeActionsFile, stepArgsPreview, stepLabel, DEFAULT_ACTION_SET, STOP_OP,
  type PortableAction,
} from "./actionSets";

const ALLOWED = new Set(["adj.invert", "adj.posterize", "fil.gaussian"]);

describe("step helpers", () => {
  it("moveItem reorders immutably and ignores out-of-range moves", () => {
    const src = ["a", "b", "c", "d"];
    expect(moveItem(src, 2, 0)).toEqual(["c", "a", "b", "d"]);
    expect(moveItem(src, 0, 3)).toEqual(["b", "c", "d", "a"]);
    expect(src).toEqual(["a", "b", "c", "d"]);
    expect(moveItem(src, 1, 1)).toBe(src);
    expect(moveItem(src, -1, 2)).toBe(src);
    expect(moveItem(src, 0, 4)).toBe(src);
  });

  it("stepLabel humanizes op paths and flags missing descriptors", () => {
    expect(stepLabel("adj.brightnessContrast")).toBe("Brightness Contrast");
    expect(stepLabel("fil.gaussian")).toBe("Gaussian");
    expect(stepLabel(null)).toBe("(non-scriptable)");
  });

  it("stepArgsPreview collapses typed arrays (live and encoded) and truncates", () => {
    expect(stepArgsPreview([4, true])).toBe("[4,true]");
    expect(stepArgsPreview([new Float32Array([1, 2])])).toBe('["[f32]"]');
    expect(stepArgsPreview([{ $ta: "u8", b64: "AAAA" }])).toBe('["[u8]"]');
    const long = stepArgsPreview(["x".repeat(500)], 40);
    expect(long.length).toBe(40);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("action sets", () => {
  it("defaults and trims the set on new metas", () => {
    expect(createActionMeta(1, "A", 0).set).toBe(DEFAULT_ACTION_SET);
    expect(createActionMeta(1, "A", 0, 10, "  Web  ").set).toBe("Web");
    expect(createActionMeta(1, "A", 0, 10, "   ").set).toBe(DEFAULT_ACTION_SET);
  });

  it("filters by set name too", () => {
    const a = { ...createActionMeta(1, "Resize", 3), set: "Web Export" };
    const b = createActionMeta(2, "Retouch", 4);
    expect(filterActionMetas([a, b], "web export", false)).toEqual([a]);
  });
});

describe("mvactions set + disabled round-trip", () => {
  const action: PortableAction = {
    name: "Half", favorite: false, createdAt: 5, set: "Web",
    steps: [["adj.invert", []], ["adj.posterize", [4]], ["fil.gaussian", [2]]],
    disabled: [1],
  };

  it("persists set and disabled indices while keeping bare [path,args] step tuples", () => {
    const json = serializeActionsFile([action], "monet-vision", 9);
    // The step tuple wire shape is a compatibility contract (e2e greps for it).
    expect(json).toContain('["adj.posterize",[4]]');
    const { actions, rejected } = parseActionsFile(json, ALLOWED);
    expect(rejected).toEqual([]);
    expect(actions[0].set).toBe("Web");
    expect(actions[0].disabled).toEqual([1]);
    expect(actions[0].steps).toHaveLength(3);
  });

  it("omits the disabled field when every step is enabled", () => {
    const json = serializeActionsFile([{ ...action, disabled: [] }]);
    expect(json).not.toContain('"disabled"');
  });

  it("parses pre-step-model files (no set/disabled) with safe defaults", () => {
    const legacy = JSON.stringify({
      format: "mvactions", version: 1, app: "monet-vision", exportedAt: 1,
      actions: [{ name: "Old", favorite: true, createdAt: 2, steps: [["adj.invert", []]] }],
    });
    const { actions, rejected } = parseActionsFile(legacy, ALLOWED);
    expect(rejected).toEqual([]);
    expect(actions[0].set).toBe(DEFAULT_ACTION_SET);
    expect(actions[0].disabled).toEqual([]);
  });

  it("drops malformed disabled entries instead of rejecting the action", () => {
    const json = JSON.stringify({
      format: "mvactions", version: 1, app: "monet-vision", exportedAt: 1,
      actions: [{
        name: "Messy", favorite: false, createdAt: 2, set: "Web",
        steps: [["adj.invert", []], ["adj.posterize", [4]]],
        disabled: [1, 1, -1, 99, 0.5, "x", null],
      }],
    });
    const { actions, rejected } = parseActionsFile(json, ALLOWED);
    expect(rejected).toEqual([]);
    expect(actions[0].disabled).toEqual([1]);
  });

  it("falls back to the default set for a blank or oversized set name", () => {
    const mk = (set: unknown) => JSON.stringify({
      format: "mvactions", version: 1, app: "monet-vision", exportedAt: 1,
      actions: [{ name: "A", favorite: false, createdAt: 2, set, steps: [["adj.invert", []]] }],
    });
    expect(parseActionsFile(mk("   "), ALLOWED).actions[0].set).toBe(DEFAULT_ACTION_SET);
    expect(parseActionsFile(mk("x".repeat(300)), ALLOWED).actions[0].set).toBe(DEFAULT_ACTION_SET);
    expect(parseActionsFile(mk(7), ALLOWED).actions[0].set).toBe(DEFAULT_ACTION_SET);
  });

  it("round-trips modal dialog indices and drops out-of-range ones", () => {
    const json = serializeActionsFile([{ ...action, dialogs: [0, 2] }]);
    expect(parseActionsFile(json, ALLOWED).actions[0].dialogs).toEqual([0, 2]);
    const messy = JSON.stringify({
      format: "mvactions", version: 1, app: "monet-vision", exportedAt: 1,
      actions: [{ name: "M", favorite: false, createdAt: 2, steps: [["adj.invert", []]], dialogs: [0, 0, -1, 5, "x"] }],
    });
    expect(parseActionsFile(messy, ALLOWED).actions[0].dialogs).toEqual([0]);
    expect(serializeActionsFile([{ ...action, dialogs: [] }])).not.toContain('"dialogs"');
  });
});

describe("Insert Stop pseudo-op", () => {
  it("normalizes untrusted stop args", () => {
    expect(parseStopArgs(["Sharpen to taste", true])).toEqual({ message: "Sharpen to taste", allowContinue: true });
    expect(parseStopArgs([])).toEqual({ message: "Stop", allowContinue: false });
    expect(parseStopArgs(["   ", "yes"])).toEqual({ message: "Stop", allowContinue: false });
    expect(stepLabel(STOP_OP)).toBe("Stop");
  });

  it("imports stop steps without the op being in the visionOps allowlist", () => {
    const withStop: PortableAction = {
      name: "Paused", favorite: false, createdAt: 5, set: "Web",
      steps: [["adj.invert", []], [STOP_OP, ["Check the mask", true]], ["fil.gaussian", [2]]],
    };
    const { actions, rejected } = parseActionsFile(serializeActionsFile([withStop]), ALLOWED);
    expect(rejected).toEqual([]);
    expect(actions[0].steps[1]).toEqual([STOP_OP, ["Check the mask", true]]);
  });
});

// The playback/UI wiring lives in modules too heavy to import under node, so —
// like photoshopAppWiring.test.ts — assert the source text directly.
describe("stop + modal playback wiring", () => {
  const appSource = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
  const panelsSource = readFileSync(fileURLToPath(new URL("../ui/Panels.tsx", import.meta.url)), "utf8");

  it("playback pauses on STOP_OP and modal-toggled steps before running them", () => {
    // Shared by playNamed and the panel's Play since #499.
    const from = appSource.indexOf("function runActionSteps(");
    const to = appSource.indexOf("export const actions = {", from);
    expect(from).toBeGreaterThanOrEqual(0);
    const body = appSource.slice(from, to);
    const stop = body.indexOf("s.op?.[0] === STOP_OP");
    const modal = body.indexOf("s.dialog && !(await confirmPlaybackPause(");
    const run = body.indexOf("s.run()");
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(modal).toBeGreaterThan(stop);
    expect(run).toBeGreaterThan(modal); // pauses are decided before the step runs
    expect(body).toContain("parseStopArgs(s.op[1])");
  });

  it("the panel exposes insertStop and the per-step modal toggle", () => {
    expect(appSource).toContain("insertStop(id: number, message: string, allowContinue: boolean)");
    expect(panelsSource).toContain("actions.insertStop(a.id, message, allowContinue)");
    expect(panelsSource).toContain("actions.setStepDialog(a.id, s.index, !s.dialog)");
  });
});
