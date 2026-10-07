import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { normalizeWebExportPrefs } from "../state/webExportPrefs";
import { addEffect, removeEffect, moveEffect } from "../state/filterGallery";

// Dialogs.tsx / Panels.tsx pull the WASM engine through state/app, so they can't
// be imported in the Node unit run — the wiring is asserted from source, the
// same discipline as ./gradientOverlayStopsWiring.test.ts. The pure index/param
// maths those call sites depend on is modelled here alongside the anchor so a
// regression shows up as a failing behaviour, not just a missing string.
const dialogs = readFileSync(fileURLToPath(new URL("./Dialogs.tsx", import.meta.url)), "utf8");
const panels = readFileSync(fileURLToPath(new URL("./Panels.tsx", import.meta.url)), "utf8");

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

const layerStyle = () => section(dialogs, "function LayerStyle()", "// ── document browser");
const filterGallery = () => section(dialogs, "function FilterGallery()", "\n}\n");
const typeDialog = () => section(dialogs, "function TypeDialog()", "function FxFieldRow");
const saveForWeb = () => section(dialogs, "function SaveForWebDialog()", "function LayerCleanup()");

// #30 — the three advanced-blending checkboxes reach the engine through
// non-undoable setters (store.setTransparencyShapes & co. push no history), so
// the dialog's own beginHistory snapshot is their ONLY undo record. Omitting
// them from ok()'s "nothing changed" test dropped that record while the change
// stayed applied: the next Cmd+Z then hit the previous, unrelated edit.
describe("Blending Options keeps its undo step for the advanced-blending toggles (#30)", () => {
  it("compares every snapshotted field in ok()", () => {
    const ok = section(layerStyle(), "const ok = () => {", "\n  };");
    for (const field of ["fillOp", "knock", "txShapes", "blendGroup", "blendClipped", "bif", "fx"]) {
      expect(ok, `${field} is snapshotted but not compared — its undo step gets dropped`).toContain(field);
    }
  });

  it("snapshots exactly the fields ok() compares", () => {
    expect(layerStyle()).toContain("snap.current = { fillOp, knock, txShapes, blendGroup, blendClipped, bif: [...bif], fx: { ...fx } };");
  });
});

// #48 — legacy documents legitimately carry param vectors shorter than the
// current def (a missing slot reads as its default). patchInstance copied that
// short array and assigned by slot index, so editing a newer control left array
// holes; Float32Array.from turns holes into NaN, which reads as knockout-off and
// as full dissolve noise in the Rust effect.
describe("Blending Options never writes sparse params (#48)", () => {
  /** The slot write patchInstance performs, with the padding it must do first. */
  const patch = (base: number[], def: number[], updates: Record<number, number>) => {
    const np = [...base];
    const maxSlot = Math.max(0, ...Object.keys(updates).map(Number));
    while (np.length < maxSlot) np.push(def[np.length] ?? 0);
    for (const k in updates) np[+k] = updates[+k];
    np[0] = 1;
    return np;
  };

  it("pads a short legacy vector instead of leaving holes", () => {
    const def = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]; // drop shadow: knockout defaults to 1
    const legacy = def.slice(0, 10);                     // saved before slots 10..12 existed
    const np = patch(legacy, def, { 12: 0.4 });           // drag Noise
    expect(np).toHaveLength(13);
    expect(Array.from(Float32Array.from(np)).some(Number.isNaN)).toBe(false);
    expect(np[11], "knockout must keep its default, not become NaN").toBe(1);
    expect(np[12]).toBeCloseTo(0.4);
  });

  it("leaves an already-full vector alone", () => {
    const def = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];
    expect(patch(def, def, { 12: 1 })).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it("patchInstance pads to the highest written slot before assigning", () => {
    const body = section(layerStyle(), "const patchInstance = ", "if (mutate(() => store.setEffectAt(id, eid, idx, np, true)))");
    expect(body).toContain("const maxSlot = Math.max(0, ...Object.keys(updates).map(Number));");
    expect(body).toContain("while (np.length < maxSlot) np.push(def[np.length] ?? 0);");
  });
});

// #97/#83 — TypeDialog creates/edits live engine state. Its transaction must
// restore the opening redo branch on Cancel or forced unmount, while OK keeps the
// edits and ends that branch.
describe("TypeDialog Cancel leaves history untouched (#97)", () => {
  it("cancels its transaction instead of undoing or adding forward ops", () => {
    const cancel = section(typeDialog(), "const cancel = () => {", "\n  };");
    expect(cancel, "deleteLayer pushes a step whose undo resurrects the layer").not.toContain("store.deleteLayer");
    expect(cancel, "re-applying the original spec is just another edit").not.toContain("text.apply");
    expect(cancel).not.toContain(".undo()");
    expect(cancel).toContain("cancelTransaction()");
  });

  it("begins before create and commits only on OK", () => {
    const body = typeDialog();
    expect(body.indexOf("targetEngine.begin_history_transaction()"))
      .toBeLessThan(body.indexOf("const id = text.create(base);"));
    expect(section(body, "const finish = () => {", "\n  };")).toContain("commit_history_transaction()");
  });

  it("pins the opening engine/layer and force-unmounts existing edits through Cancel", () => {
    const body = typeDialog();
    expect(body).toContain("const targetDocId = useRef(activeDocId).current;");
    expect(body).toContain("const targetEngine = useRef(engine.e as HistoryTransactionEngine).current;");
    expect(body).toContain("store.state.activeLayerId === idRef.current");
    expect(body).toContain("openedExisting = true;");
    expect(body).toContain("return () => { if (!doneRef.current) cancelTransaction(); };");
  });
});

describe("Filter Gallery preview owns a target-pinned transaction (#28/#83)", () => {
  it("cancels the captured engine on Cancel and forced unmount", () => {
    const body = filterGallery();
    expect(body).toContain("const targetDocId = useRef(activeDocId).current;");
    expect(body).toContain("const targetLayerId = useRef(activeLayerId).current;");
    expect(body).toContain("revertGalleryStack(transactionRef.current, targetEngine);");
    const cleanup = section(body, "useEffect(() => () => {", "\n  }, []);");
    expect(cleanup).toContain("cancelPreview()");
  });

  it("refuses preview/OK after the active document or layer changes", () => {
    const body = filterGallery();
    expect(body).toContain("store.state.activeDocId === targetDocId && store.state.activeLayerId === targetLayerId");
    expect(body).toContain("if (!onTarget()) { cancelPreview(); return; }");
    expect(body).toContain("if (!onTarget()) { cancel(); return; }");
  });
});

// #98 — every gallery row carries its own ↑/↓/✕, so the row acted on is rarely
// the selected one. del() only re-pointed the selection when the LAST row went,
// and move() only when the moved row was the selected one, so the param sliders
// silently started editing a different effect.
describe("Filter Gallery selection follows its effect (#98)", () => {
  const del = (stack: unknown[], sel: number, i: number) => ({
    stack: removeEffect(stack as never, i),
    sel: i < sel ? sel - 1 : Math.min(sel, stack.length - 2),
  });
  const move = (stack: unknown[], sel: number, i: number, dir: number) => {
    const to = Math.max(0, Math.min(stack.length - 1, i + dir));
    return { stack: moveEffect(stack as never, i, dir), sel: sel === i ? to : sel === to ? i : sel };
  };
  const build = () => {
    const s = ["posterEdges", "cutout", "grain"].reduce((acc, id) => addEffect(acc, id), [] as ReturnType<typeof addEffect>);
    expect(s.map((e) => e.id)).toEqual(["posterEdges", "cutout", "grain"]);
    return s;
  };

  it("keeps pointing at the same effect when an earlier one is deleted", () => {
    const stack = build();
    const r = del(stack, 1, 0);
    expect(r.stack[r.sel].id).toBe("cutout");
  });

  it("still clamps when the selected (last) row is deleted", () => {
    const stack = build();
    const r = del(stack, 2, 2);
    expect(r.sel).toBe(1);
    expect(r.stack[r.sel].id).toBe("cutout");
  });

  it("follows the selected effect when it is moved", () => {
    const stack = build();
    const r = move(stack, 1, 1, -1);
    expect(r.stack[r.sel].id).toBe("cutout");
  });

  it("follows the selected effect when another row is swapped onto its slot", () => {
    const stack = build();
    const r = move(stack, 1, 2, -1); // Grain moves up onto index 1
    expect(r.stack[r.sel].id).toBe("cutout");
  });

  it("wires those rules into the dialog", () => {
    const body = filterGallery();
    expect(body).toContain("setSelected((sel) => (i < sel ? sel - 1 : Math.min(sel, stack.length - 2)));");
    expect(body).toContain("else if (selected === to) setSelected(i);");
  });
});

// #145 — metadata is a first-class persisted pref, but the dialog seeded it from
// a literal and left it out of the patch, so normalizeWebExportPrefs fell back to
// the stored value forever and the dropdown could never stick.
describe("Save for Web persists the Metadata choice (#145)", () => {
  it("round-trips metadata through the normalizer only when the patch carries it", () => {
    const saved = normalizeWebExportPrefs({ format: "jpeg", quality: 70, matte: "white", convertToSRgb: true, metadata: "none" });
    expect(saved.metadata).toBe("none");
    // The pre-fix patch shape: the choice is silently discarded.
    expect(normalizeWebExportPrefs({ format: "jpeg", quality: 70, matte: "white", convertToSRgb: true }, saved).metadata).toBe("none");
  });

  it("seeds from prefs and writes metadata back on both branches", () => {
    const body = saveForWeb();
    expect(body).toContain("useState<SaveForWebMetadata>(prefs.metadata)");
    expect(body).toContain("? { format, quality, matte, convertToSRgb, metadata }");
    expect(body).toContain(": { quality, matte, convertToSRgb, metadata }");
  });
});

// #103 — the Properties panel's name field is uncontrolled and was keyed by the
// layer id alone, so a rename from the Layers panel / MCP / undo never reached
// the DOM value; blurring the stale field then committed the OLD name back.
describe("Properties panel layer name cannot go stale (#103)", () => {
  it("keys the uncontrolled input by the name as well as the id", () => {
    const input = section(panels, 'aria-label="Layer name"\n            onBlur', "onKeyDown");
    expect(input).toBeTruthy();
    expect(panels).toContain("key={`${layer.id}:${layer.name}`} defaultValue={layer.name} aria-label=\"Layer name\"");
    expect(panels, "keying by id alone leaves the field showing the old name").not.toContain("key={layer.id} defaultValue={layer.name}");
  });
});
