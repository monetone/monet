import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers";

test("seeded edits preserve isolated per-document undo, redo, and reopen state", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);

  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const seed = 0x5eedc0de;
    let randomState = seed;
    const random = () => (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0);
    const fail = (message: string): never => { throw new Error(`seed 0x${seed.toString(16)}: ${message}`); };

    const fingerprint = () => {
      const engine = mv.engine.engine;
      const width = engine.width();
      const height = engine.height();
      const layers = [];
      for (let index = 0; index < engine.layer_count(); index++) {
        const id = engine.layer_id_at(index);
        layers.push([
          id,
          engine.layer_name(id),
          engine.layer_kind(id),
          engine.layer_visible(id),
          engine.layer_opacity(id),
          engine.layer_blend(id),
          engine.layer_fill_opacity(id),
          Array.from(engine.layer_offset(id)),
          engine.layer_has_mask(id),
          engine.layer_mask_enabled(id),
          engine.layer_mask_linked(id),
          engine.layer_mask_density(id),
          engine.layer_mask_feather(id),
          Array.from(engine.layer_effect_params(id, 9)),
          Array.from(engine.layer_thumb(id, width, height)),
          Array.from(engine.layer_mask_gray(id)),
        ]);
      }
      return JSON.stringify([
        width,
        height,
        engine.active_layer_id(),
        Array.from(mv.engine.outputCopy() as Uint8ClampedArray),
        layers,
      ]);
    };

    const makeDocument = (name: string, color: [number, number, number]) => {
      mv.store.newDocument(48, 36, name, "transparent");
      const engine = mv.engine.engine;
      engine.fill_selection(color[0], color[1], color[2], 255);
      engine.purge();
      mv.engine.commit();
      return mv.store.state.activeDocId as number;
    };

    const docs = [
      makeDocument("history-A", [31, 79, 151]),
      makeDocument("history-B", [173, 67, 29]),
    ];
    const states = new Map<number, string[]>();
    for (const id of docs) {
      mv.store.activateDoc(id);
      states.set(id, [fingerprint()]);
    }

    const mutate = (step: number, operation: number) => {
      const engine = mv.engine.engine;
      const before = engine.undo_depth();
      const active = () => engine.active_layer_id();
      switch (operation) {
        case 0:
          mv.store.addLayer();
          break;
        case 1:
          engine.fill_selection((step * 47) & 255, (step * 83) & 255, (step * 131) & 255, 255);
          mv.engine.commit();
          break;
        case 2: {
          mv.store.endPropEdit();
          const opacity = engine.layer_opacity(active()) > 0.7 ? 43 : 91;
          mv.store.setLayerOpacity(active(), opacity);
          mv.store.endPropEdit();
          break;
        }
        case 3: {
          const id = active();
          engine.set_layer_blend(id, engine.layer_blend(id) === 3 ? 4 : 3);
          mv.engine.commit();
          break;
        }
        case 4: {
          const id = active();
          if (engine.layer_has_mask(id)) engine.set_layer_mask_enabled(id, !engine.layer_mask_enabled(id));
          else engine.add_layer_mask(id);
          mv.engine.commit();
          break;
        }
        case 5: {
          const id = active();
          mv.store.beginHistory(`Seed effect ${step}`);
          engine.set_layer_effect(id, 9, new Float32Array([1, 0, 0.65, (step & 1), 0.25, 1 - (step & 1), 2 + step, 1]));
          mv.store.commitHistory();
          break;
        }
        case 6:
          engine.duplicate_layer(active());
          mv.engine.commit();
          break;
        default:
          if (engine.layer_count() > 1) engine.delete_layer(active());
          else engine.add_layer(`Seed ${step}`);
          mv.engine.commit();
          break;
      }
      const after = engine.undo_depth();
      if (after !== before + 1) fail(`step ${step}, op ${operation}: undo depth ${before} -> ${after}`);
    };

    for (let step = 0; step < 32; step++) {
      const id = docs[step % docs.length];
      mv.store.activateDoc(id);
      const operation = random() >>> 29;
      mutate(step, operation);
      states.get(id)!.push(fingerprint());
    }

    for (const id of docs) {
      mv.store.activateDoc(id);
      const expected = states.get(id)!;
      if (mv.engine.engine.undo_depth() !== expected.length - 1) fail(`document ${id}: wrong final depth`);

      for (let index = expected.length - 2; index >= 0; index--) {
        mv.store.undo();
        const actual = fingerprint();
        if (actual !== expected[index]) fail(`document ${id}: undo mismatch at state ${index}`);
      }
      for (let index = 1; index < expected.length; index++) {
        mv.store.redo();
        const actual = fingerprint();
        if (actual !== expected[index]) fail(`document ${id}: redo mismatch at state ${index}`);
      }

      const final = expected[expected.length - 1];
      const bytes = mv.saveProjectBytes();
      mv.store.openProject(bytes, `history-${id}-reopened.mvision`);
      const reopenedId = mv.store.state.activeDocId;
      if (fingerprint() !== final) fail(`document ${id}: reopened state mismatch`);
      mv.store.activateDoc(id);
      mv.store.closeDoc(reopenedId);
      if (fingerprint() !== final) fail(`document ${id}: state changed after reopening sibling`);
    }

    return {
      seed,
      steps: 32,
      openDocuments: mv.store.state.documents.length,
      statesPerDocument: docs.map((id) => states.get(id)!.length),
    };
  });

  expect(result).toEqual({
    seed: 0x5eedc0de,
    steps: 32,
    openDocuments: 2,
    statesPerDocument: [17, 17],
  });
});
