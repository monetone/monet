// HistoryPanel pointer logic: ⌘Z/⇧⌘Z stepping over the newest-first stack, and
// the echo bookkeeping that keeps the visible list LR-pointer-shaped even though
// every restore appends a row (DevelopView's baseline-diff recorder).

import { describe, expect, it } from "vitest";

import { createDefaultRecipe } from "@monet-ui/monet-photo";

import type { HistoryRow } from "../catalog/types";
import { classifyReload, IMPORT_STEP_ID, importStep, sameRecipeJson, stepDetail, stepTarget } from "./HistoryPanel";

let nextId = 1;
const row = (json: string, label = json): HistoryRow => ({
  id: nextId++,
  photoId: 1,
  label,
  recipeJson: json,
  processVersion: null,
  createdAt: 0,
});

describe("stepTarget", () => {
  // Newest first: [C, B, A]
  const A = row("a");
  const B = row("b");
  const C = row("c");
  const stack = [C, B, A];

  it("null pointer sits on the newest step; ⌘Z goes one older", () => {
    expect(stepTarget(stack, null, 1)).toBe(B);
  });

  it("steps older from the pointer and stops at the oldest", () => {
    expect(stepTarget(stack, B.id, 1)).toBe(A);
    expect(stepTarget(stack, A.id, 1)).toBeNull();
  });

  it("⇧⌘Z steps newer and stops at the newest", () => {
    expect(stepTarget(stack, A.id, -1)).toBe(B);
    expect(stepTarget(stack, B.id, -1)).toBe(C);
    expect(stepTarget(stack, C.id, -1)).toBeNull();
    expect(stepTarget(stack, null, -1)).toBeNull();
  });

  it("empty stack and vanished pointer are safe", () => {
    expect(stepTarget([], null, 1)).toBeNull();
    // Unknown pointer id is treated as the newest step.
    expect(stepTarget(stack, 9999, 1)).toBe(B);
  });
});

describe("classifyReload", () => {
  it("tags the appended copy of our own restore as an echo, keeping the pointer", () => {
    const A = row("a");
    const B = row("b");
    const echo = row("a"); // recorder re-appended A's json after we restored it
    expect(classifyReload([echo, B, A], "a", new Set())).toEqual({
      echoId: echo.id,
      resetPointer: false,
    });
  });

  it("resets the pointer on a genuine new edit and on fresh loads", () => {
    const A = row("a");
    const B = row("b");
    expect(classifyReload([B, A], null, new Set())).toEqual({ echoId: null, resetPointer: true });
    // Restored "a" but the user edited before the persist landed → the recorded
    // step is the edit, not our echo.
    expect(classifyReload([B, A], "a", new Set())).toEqual({ echoId: null, resetPointer: true });
    expect(classifyReload([], "a", new Set())).toEqual({ echoId: null, resetPointer: true });
  });

  it("never re-tags an already-known echo row", () => {
    const A = row("a");
    const echo = row("a");
    expect(classifyReload([echo, A], "a", new Set([echo.id]))).toEqual({
      echoId: null,
      resetPointer: true,
    });
  });
});

describe("importStep", () => {
  it("is the as-imported default recipe with the sentinel id below sqlite rowids", () => {
    const s = importStep(7);
    expect(s.id).toBe(IMPORT_STEP_ID);
    expect(s.id).toBe(0);
    expect(s.label).toBe("Import");
    expect(JSON.parse(s.recipeJson)).toEqual(createDefaultRecipe());
  });

  it("⌘Z from the oldest real step lands on Import, then stops", () => {
    const A = row("a");
    const stack = [A, importStep(1)];
    expect(stepTarget(stack, null, 1)?.id).toBe(IMPORT_STEP_ID);
    expect(stepTarget(stack, IMPORT_STEP_ID, 1)).toBeNull();
    expect(stepTarget(stack, IMPORT_STEP_ID, -1)).toBe(A);
  });
});

describe("sameRecipeJson", () => {
  it("matches identical strings and key-reordered canonical copies", () => {
    expect(sameRecipeJson("a", "a")).toBe(true);
    expect(sameRecipeJson('{"x":1,"y":{"a":[1,2],"b":null}}', '{"y":{"b":null,"a":[1,2]},"x":1}')).toBe(true);
  });

  it("rejects different values and invalid json", () => {
    expect(sameRecipeJson('{"x":1}', '{"x":2}')).toBe(false);
    expect(sameRecipeJson("a", "b")).toBe(false);
  });

  it("keeps echo detection working when canonicalization reorders keys", () => {
    const A = row("a");
    const echo = row('{"y":2,"x":1}'); // Rust re-serialized our restore
    expect(classifyReload([echo, A], '{"x":1,"y":2}', new Set())).toEqual({
      echoId: echo.id,
      resetPointer: false,
    });
  });
});

describe("stepDetail", () => {
  const recipe = (basic: Partial<ReturnType<typeof createDefaultRecipe>["basic"]>) =>
    JSON.stringify({ ...createDefaultRecipe(), basic: { ...createDefaultRecipe().basic, ...basic } });

  it("names the changed Basic slider with its UI-unit value", () => {
    // exposure scale 0.04 → recipe 1.0 is UI +25.
    expect(stepDetail(recipe({}), recipe({ exposure: 1 }))).toBe("Exposure +25");
    expect(stepDetail(recipe({}), recipe({ contrast: -0.4 }))).toBe("Contrast -40");
  });

  it("returns null for non-Basic changes and malformed json", () => {
    const base = createDefaultRecipe();
    const cropped = JSON.stringify({ ...base, crop: { ...base.crop, angle: 5 } });
    expect(stepDetail(JSON.stringify(base), cropped)).toBeNull();
    expect(stepDetail("a", recipe({ exposure: 1 }))).toBeNull();
  });
});

describe("undo/redo session over the append-echo model", () => {
  // Drives the same state machine the component runs: restore → recorder
  // appends an echo → reload classifies it → next keystroke steps from the
  // (unchanged) pointer over the visible rows.
  it("⌘Z ⌘Z ⇧⌘Z lands back on the middle step with only real rows visible", () => {
    const A = row("a");
    const B = row("b");
    const C = row("c");
    let steps = [C, B, A];
    const echoIds = new Set<number>();
    let pointerId: number | null = null;

    const reload = (restoredJson: string | null) => {
      const { echoId, resetPointer } = classifyReload(steps, restoredJson, echoIds);
      if (echoId != null) echoIds.add(echoId);
      if (resetPointer) pointerId = null;
    };
    const visible = () => steps.filter((s) => !echoIds.has(s.id));
    const press = (delta: 1 | -1): string | null => {
      const target = stepTarget(visible(), pointerId, delta);
      if (!target) return null;
      pointerId = target.id;
      steps = [row(target.recipeJson), ...steps]; // recorder appends the echo
      reload(target.recipeJson);
      return target.recipeJson;
    };

    expect(press(1)).toBe("b"); // undo → B
    expect(press(1)).toBe("a"); // undo → A
    expect(press(-1)).toBe("b"); // redo → B
    expect(pointerId).toBe(B.id);
    // Echo rows stay hidden: the panel still shows the three real steps.
    expect(visible()).toEqual([C, B, A]);
    // A genuine new edit re-anchors the pointer to the newest step.
    steps = [row("d"), ...steps];
    reload(null);
    expect(pointerId).toBeNull();
    expect(visible().map((s) => s.recipeJson)).toEqual(["d", "c", "b", "a"]);
  });
});
