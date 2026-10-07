// Action-recording coverage (V-ACT-2): store layer/selection/pixel/clipboard
// commands, type commands and Save/Export record persistable action steps, not
// just the six proxied namespaces. app.ts can't be imported in node (it pulls
// the WASM engine), so like photoshopAppWiring.test.ts this verifies the wiring
// in source, then exercises the real persistence path for the new op shapes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSerializableArgs, parseActionsFile, serializeActionsFile, stepLabel } from "./actionSets";

const appSource = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
const storeSource = readFileSync(fileURLToPath(new URL("./store.ts", import.meta.url)), "utf8");
const dialogsSource = readFileSync(fileURLToPath(new URL("../ui/Dialogs.tsx", import.meta.url)), "utf8");

function section(start: string, end: string): string {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return appSource.slice(from, to);
}

/** Parse the quoted names out of a `const X = [ ... ] as const` list in app.ts. */
function opList(constName: string): string[] {
  const body = section(`const ${constName} = [`, "] as const satisfies");
  const names = [...body.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
  expect(names.length).toBeGreaterThan(0);
  return names;
}

const storeOps = opList("RECORDED_STORE_OPS");
const textOps = opList("RECORDED_TEXT_OPS");

/** app.ts's LIVE_STORE_OPS table, parsed back out of the source. */
const liveShapes: Record<string, { key: number; args?: number }> = Object.fromEntries(
  [...section("const LIVE_STORE_OPS: Record<string, LiveShape> = {", "\n};")
    .matchAll(/(\w+): \{ key: (\d+)(?:, args: (\d+))? \}/g)]
    .map((m) => [m[1], { key: +m[2], args: m[3] ? +m[3] : undefined }]),
);

/** Store methods whose last parameter is the `live = false` preview flag. */
function liveFlagMethods(): [name: string, params: string[]][] {
  return [...storeSource.matchAll(/\n {2}([a-zA-Z]\w*)\(([^)]*)\) \{/g)]
    .filter((m) => m[2].trimEnd().endsWith("live = false"))
    .map((m) => [m[1], m[2].split(",")]);
}

describe("recorded command surface", () => {
  it("covers Photoshop's layer / selection / pixel / clipboard command categories", () => {
    for (const required of [
      // layer create/delete/duplicate/merge/arrange/rename/opacity/blend/mask
      "newDocument", "addLayer", "deleteLayer", "duplicateLayer", "mergeDown", "mergeVisible", "flatten",
      "arrangeLayer", "moveLayer", "renameLayer", "setLayerVisible", "setLayerOpacity", "setLayerBlend",
      "addLayerMask", "deleteLayerMask", "createGroup", "ungroup", "selectLayer",
      // selection commands
      "selectAll", "deselect", "invertSelection", "featherSelection", "expandSelection", "contractSelection",
      "saveSelection", "loadSelection", "colorRangeSelect",
      // pixel commands
      "fillContents", "strokeSelection", "spotHeal", "contentAwareScale",
      // fill-layer property dialogs
      "setFillParams", "replacePatternFill",
      // clipboard
      "cut", "copy", "paste",
    ]) expect(storeOps, `RECORDED_STORE_OPS is missing ${required}`).toContain(required);
    expect(storeOps.length).toBeGreaterThanOrEqual(60);
  });

  it("lists only real Store methods (a typo would crash the wrap loop at boot)", () => {
    for (const name of storeOps) {
      expect(new RegExp(`\\n  (?:async )?${name}\\(`).test(storeSource), `Store.${name} not found in store.ts`).toBe(true);
    }
  });

  it("covers type edits and lists only real text-namespace entries", () => {
    for (const required of ["create", "createAt", "apply", "rasterizeLayer", "insertGlyph", "toggleParagraph", "findReplace"]) {
      expect(textOps, `RECORDED_TEXT_OPS is missing ${required}`).toContain(required);
    }
    const textBody = section("export const text = {", "const RECORDED_TEXT_OPS = [");
    for (const name of textOps) {
      expect(textBody.includes(`${name}(`) || textBody.includes(`${name}:`), `text.${name} not found`).toBe(true);
    }
  });

  it("wraps the live store and text namespaces through the depth-guarded recorder", () => {
    // The depth guard is what keeps nested calls (store method → store method,
    // proxied impl → store method) from double-recording.
    expect(appSource).toContain("if (_opDepth > 0) return fn(...args);");
    expect(appSource).toContain("recordedCall(`store.${name}`, orig, LIVE_STORE_OPS[name])");
    expect(appSource).toContain('recordedCall(`text.${name}`, orig, name === "apply" ? { key: 1 } : undefined)');
  });

  it("covers layer styles / advanced blending (Blending Options, Styles panel)", () => {
    for (const required of [
      "setEffect", "clearEffect", "clearAllEffects", "toggleEffectsVisible", "setBlendIf",
      "setKnockout", "setTransparencyShapes", "setBlendInteriorGroup", "setBlendClippedGroup",
      "setFillOpacityInTransaction", "copyLayerStyle", "pasteLayerStyle", "clearLayerStyle",
      "createLayersFromStyle", "rasterizeLayerStyle", "applyStylePreset",
      "applyLayerStyleState", "scaleEffects", "setGlobalLight",
    ]) expect(storeOps, `RECORDED_STORE_OPS is missing ${required}`).toContain(required);
  });

  it("covers the PER-INSTANCE effect ops, not just the whole-type setters", () => {
    // Layer effects became a multiset (stacked strokes, layered shadows). The
    // whole-type setters stayed recordable and their per-instance replacements
    // did not, so adjusting a stacked drop shadow while recording produced no
    // step and the action replayed without the change.
    for (const required of ["setEffectAt", "removeEffectAt", "moveEffectInstance"])
      expect(storeOps, `RECORDED_STORE_OPS is missing ${required}`).toContain(required);
  });

  it("keys setEffectAt on the instance, so one shadow's drag cannot eat another's step", () => {
    // The coalesce key is a leading-arg PREFIX of (id, effectId, index, params).
    // Keyed on layer+effect only, dragging the SECOND drop shadow's slider would
    // pop the first shadow's recorded step — the same trap the setEffect comment
    // warns about, one level down.
    expect(liveShapes.setEffectAt?.key, "setEffectAt must key on layer + effect + index").toBe(3);
    expect(liveShapes.setFillParams?.key, "fill previews must collapse to their final params").toBe(1);
  });

  it("covers Image ▸ Mode, mask properties and Align/Distribute/Link", () => {
    for (const required of [
      // Photoshop records mode and bit-depth conversions.
      "convertGrayscale", "convertIndexed", "convertBitmap", "setColorMode", "setDepth",
      "setLayerMaskDensity", "setLayerMaskFeather",
      "alignLayer", "distributeLayers", "linkLayers",
    ]) expect(storeOps, `RECORDED_STORE_OPS is missing ${required}`).toContain(required);
  });

  it("trims the live-preview flag off every recorded live-drag op", () => {
    // A step recorded WITH `live = true` replays as a preview frame and never
    // commits, so any recorded store method carrying the flag must cap `args`
    // below it. This is computed from store.ts, so a newly recorded live-flag
    // command fails here until it gets a LIVE_STORE_OPS entry.
    const checked = liveFlagMethods().filter(([name]) => storeOps.includes(name));
    expect(checked.length).toBeGreaterThanOrEqual(3);
    for (const [name, params] of checked) {
      expect(liveShapes[name], `store.${name} is recorded but has no LIVE_STORE_OPS entry`).toBeDefined();
      expect(liveShapes[name].args, `store.${name} must record ${params.length - 1} args, not the live flag`)
        .toBe(params.length - 1);
    }
    // The coalesce key is a leading-arg PREFIX, and setEffect's identity is
    // layer + effect: keyed on the layer alone, enabling a second effect on the
    // same layer would swallow the first one's step.
    expect(appSource).toContain("op[1].slice(0, live.key).every((v, i) => v === lastOp[1][i])");
    expect(liveShapes.setEffect.key).toBe(2);
  });

  it("unwinds recorded steps when a dialog drops its history transaction", () => {
    // Blending Options restores its snapshot through the same recorded store
    // methods on Cancel; those restores must not land in the recording.
    const tx = section("let _txMark: ActionRecorderMark | null = null;", "// ── Adjustments");
    expect(tx).toContain("const mark = actions.mark();");
    expect(tx).toContain("if (opened) _txMark = mark;");
    expect(tx).toContain("return opened;");
    expect(tx).toContain("if (!committed && mark) actions.rollback(mark);");
    expect(tx).toContain("if (mark) actions.rollback(mark);");
  });

  it("records accepted Blending Options as one undo-owning compound op", () => {
    expect(dialogsSource).toContain('["store.applyLayerStyleState", [acceptedStyle]]');
    expect(storeOps).toContain("applyLayerStyleState");
  });

  it("records Save / Save As / Export commands", () => {
    for (const op of ["saveDocument", "saveDocumentAs", "revertDocument", "exportPNG", "exportJPEG", "exportPSD", "exportPSB", "exportAs"]) {
      expect(appSource, `${op} is not a recorded command`).toContain(`recordedCall("${op}"`);
    }
    // saveDocument's pathless fallback runs after awaits (past the depth
    // guard) and must call the UNWRAPPED impl or replay saves twice.
    const save = section('export const saveDocument = recordedCall("saveDocument"', "/** Save the active document to a newly chosen");
    expect(save).toContain("return saveDocumentAsImpl();");
    expect(save).not.toContain("return saveDocumentAs();");
  });

  it("registers every recorded op in the visionOps allowlist so steps persist and replay", () => {
    const ops = section("function visionOps()", "export function runScript");
    expect(ops).toContain("for (const name of RECORDED_STORE_OPS) top[`store.${name}`]");
    expect(ops).toContain("for (const name of RECORDED_TEXT_OPS) top[`text.${name}`]");
    for (const op of ["saveDocument", "saveDocumentAs", "revertDocument", "exportPNG", "exportJPEG", "exportPSD", "exportPSB", "exportAs"]) {
      expect(ops).toContain(`${op}:`);
    }
    expect(ops).toContain("selectAndMask:");
  });

  it("keeps Select and Mask actions compact, and marks painted masks volatile", () => {
    expect(storeOps).not.toContain("selectAndMask");
    expect(dialogsSource).toContain('["selectAndMask", [params, output, decontaminate]]');
    expect(dialogsSource).toContain("actions.commit(actionMark, apply, null);");
    expect(isSerializableArgs([{ radius: 2, smartRadius: false, smooth: 0, feather: 0, contrast: 0, shift: 0 }, "selection", false])).toBe(true);
    expect(isSerializableArgs([new Uint8Array(1024 * 1024 + 1)])).toBe(false);
  });
});

describe("recorded step persistence", () => {
  it("typical recorded args are serializable (steps persist instead of going volatile)", () => {
    expect(isSerializableArgs([])).toBe(true); // addLayer / selectAll / saveDocument
    expect(isSerializableArgs([12, "multiply"])).toBe(true); // setLayerBlend
    expect(isSerializableArgs([3, new Float32Array([0.1, 0.2])])).toBe(true); // addAdjustmentLayer params
    expect(isSerializableArgs(["foreground", 100, "normal", [0, 0, 0], false])).toBe(true); // fillContents
    expect(isSerializableArgs([3, { kind: "point", text: "hi", runs: [] }])).toBe(true); // text.apply spec
  });

  it("namespaced store/text/save ops round-trip through the .mvactions format", () => {
    const json = serializeActionsFile([{
      name: "Layer macro", favorite: false, createdAt: 1,
      steps: [["store.addLayer", []], ["store.setLayerOpacity", [2, 50]], ["text.insertGlyph", ["✓"]], ["saveDocument", []]],
    }]);
    const allow = new Set(["store.addLayer", "store.setLayerOpacity", "text.insertGlyph", "saveDocument"]);
    const { actions, rejected } = parseActionsFile(json, allow);
    expect(rejected).toEqual([]);
    expect(actions[0].steps.map(([path]) => path)).toEqual([...allow]);
    // And an op outside the allowlist still rejects the whole action.
    const bad = parseActionsFile(json, new Set(["store.addLayer"]));
    expect(bad.actions).toEqual([]);
    expect(bad.rejected).toHaveLength(1);
  });

  it("namespaced op paths get human step labels", () => {
    expect(stepLabel("store.addLayer")).toBe("Add Layer");
    expect(stepLabel("text.insertGlyph")).toBe("Insert Glyph");
    expect(stepLabel("saveDocument")).toBe("Save Document");
  });
});
