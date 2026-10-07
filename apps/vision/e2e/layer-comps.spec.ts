import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gotoApp } from "./helpers";

// ── Window ▸ Layer Comps panel ─────────────────────────────────────
// Adobe: a Layer Comp is a saved snapshot of the layer state (visibility/position/
// appearance); clicking a comp restores it. Vision implements it as TS orchestration
// over one batched engine history operation plus the existing layer-style setters.
//   https://helpx.adobe.com/photoshop/using/layer-comps.html

// New 2-layer doc; returns the added top layer's id.
async function twoLayerDoc(page: Page): Promise<number> {
  return page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "comps");
    const id = mv.engine.engine.add_layer("Top");
    mv.engine.commit();
    return id as number;
  });
}

test("a comp restores visibility, position, and appearance in one history step", async ({ page }) => {
  await gotoApp(page);
  const top = await twoLayerDoc(page);
  const beforeApply = await page.evaluate((id) => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    // Comp A: hidden, moved, partially transparent, Multiply, reduced fill,
    // and a stroke layer style.
    E.set_layer_visible(id, false);
    E.set_layer_offset(id, 3, -2);
    E.set_layer_opacity(id, 0.55);
    E.set_layer_blend(id, 3);
    E.set_layer_fill_opacity(id, 0.4);
    E.set_layer_effect(id, 9, new Float32Array([1, 0, 1, 0, 0, 1, 2, 0]));
    mv.engine.commit();
    mv.store.saveLayerComp();

    // Comp B: default appearance at the document origin.
    E.set_layer_visible(id, true);
    E.set_layer_offset(id, 0, 0);
    E.set_layer_opacity(id, 1);
    E.set_layer_blend(id, 0);
    E.set_layer_fill_opacity(id, 1);
    E.clear_layer_effects(id);
    mv.engine.commit();
    mv.store.saveLayerComp();
    return E.history_current() as number;
  }, top);
  expect(await page.evaluate(() => (window as any).__mv.store.state.layerComps.length)).toBe(2);

  await page.evaluate(() => (window as any).__mv.store.applyLayerComp(0)); // comp A
  expect(await page.evaluate((id) => {
    const E = (window as any).__mv.engine.engine;
    return {
      visible: E.layer_visible(id),
      offset: Array.from(E.layer_offset(id)),
      opacity: Math.round(E.layer_opacity(id) * 100),
      blend: E.layer_blend(id),
      fillOpacity: Math.round(E.layer_fill_opacity(id) * 100),
      stroke: Array.from(E.layer_effect_params(id, 9)),
      history: E.history_current(),
    };
  }, top)).toEqual({
    visible: false,
    offset: [3, -2],
    opacity: 55,
    blend: 3,
    fillOpacity: 40,
    stroke: [1, 0, 1, 0, 0, 1, 2, 0],
    history: beforeApply + 1,
  });

  await page.evaluate(() => (window as any).__mv.store.applyLayerComp(1)); // comp B
  expect(await page.evaluate((id) => {
    const E = (window as any).__mv.engine.engine;
    return {
      visible: E.layer_visible(id),
      offset: Array.from(E.layer_offset(id)),
      opacity: Math.round(E.layer_opacity(id) * 100),
      blend: E.layer_blend(id),
      fillOpacity: Math.round(E.layer_fill_opacity(id) * 100),
      stroke: Array.from(E.layer_effect_params(id, 9)),
      history: E.history_current(),
    };
  }, top)).toEqual({
    visible: true,
    offset: [0, 0],
    opacity: 100,
    blend: 0,
    fillOpacity: 100,
    stroke: [],
    history: beforeApply + 2,
  });
});

test("Layer Comps are per-document metadata and persist through .mvision save/open", async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "comps-a");
    const E = mv.engine.engine;
    const top = E.add_layer("Top");
    E.set_layer_visible(top, false);
    E.set_layer_offset(top, 3, -2);
    E.set_layer_opacity(top, 0.55);
    E.set_layer_blend(top, 3);
    E.set_layer_fill_opacity(top, 0.4);
    E.set_layer_effect(top, 9, new Float32Array([1, 0, 1, 0, 0, 1, 2, 0]));
    mv.engine.commit();
    mv.store.markActiveSaved();
    const docA = mv.store.state.activeDocId;
    mv.store.saveLayerComp();
    const dirtyAfterComp = mv.store.docDirty(docA);
    const snapshotId = mv.store.takeSnapshot("With comp");
    mv.store.restoreSnapshot(snapshotId);
    const compsAfterSnapshot = mv.store.state.layerComps.length;

    mv.store.newDocument(30, 30, "comps-b");
    const docB = mv.store.state.activeDocId;
    const compsInNewDoc = mv.store.state.layerComps.length;
    mv.store.activateDoc(docA);
    const compsAfterReturn = mv.store.state.layerComps.length;
    mv.store.activateDoc(docB);
    const compsAfterSecondReturn = mv.store.state.layerComps.length;

    mv.store.activateDoc(docA);
    const saved = mv.store.saveProject();
    mv.store.openProject(saved, "comps-roundtrip.mvision");
    const restored = mv.store.state.layerComps[0];
    const restoredTop = mv.store.state.layers.find((layer: any) => layer.name === "Top").id;
    const restoredEngine = mv.engine.engine;
    restoredEngine.set_layer_visible(restoredTop, true);
    restoredEngine.set_layer_offset(restoredTop, 0, 0);
    restoredEngine.set_layer_opacity(restoredTop, 1);
    restoredEngine.set_layer_blend(restoredTop, 0);
    restoredEngine.set_layer_fill_opacity(restoredTop, 1);
    restoredEngine.clear_layer_effects(restoredTop);
    mv.engine.commit();
    mv.store.applyLayerComp(0);

    return {
      dirtyAfterComp,
      compsAfterSnapshot,
      compsInNewDoc,
      compsAfterReturn,
      compsAfterSecondReturn,
      restoredName: restored.name,
      restoredLayer: restored.layers[0],
      applied: {
        visible: restoredEngine.layer_visible(restoredTop),
        offset: Array.from(restoredEngine.layer_offset(restoredTop)),
        opacity: Math.round(restoredEngine.layer_opacity(restoredTop) * 100),
        blend: restoredEngine.layer_blend(restoredTop),
        fillOpacity: Math.round(restoredEngine.layer_fill_opacity(restoredTop) * 100),
        stroke: Array.from(restoredEngine.layer_effect_params(restoredTop, 9)),
      },
    };
  });

  expect(result.dirtyAfterComp).toBe(true);
  expect(result.compsAfterSnapshot).toBe(1);
  expect(result.compsInNewDoc).toBe(0);
  expect(result.compsAfterReturn).toBe(1);
  expect(result.compsAfterSecondReturn).toBe(0);
  expect(result.restoredName).toBe("Layer Comp 1");
  expect(result.restoredLayer).toMatchObject({ visible: false, opacity: 55, blendMode: "multiply", offset: [3, -2] });
  expect(result.applied).toEqual({
    visible: false,
    offset: [3, -2],
    opacity: 55,
    blend: 3,
    fillOpacity: 40,
    stroke: [1, 0, 1, 0, 0, 1, 2, 0],
  });
});

test("the Layer Comps panel lists comps and Delete removes one", async ({ page }) => {
  await gotoApp(page);
  await twoLayerDoc(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.saveLayerComp(); mv.store.saveLayerComp(); });
  await page.locator('[data-tab-id="layercomps"]').click();
  await expect(page.locator('[data-mv-comp-row="0"]')).toBeVisible();
  await expect(page.locator('[data-mv-comp-row="1"]')).toBeVisible();
  // the per-row Delete (last icon button) removes a comp
  await page.locator('[data-mv-comp-row="0"] .monet-iconbtn').last().click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.layerComps.length)).toBe(1);
});

test("Layer Comps export distinct files and a multi-page PDF without changing the document", async ({ page }) => {
  await gotoApp(page);
  const top = await twoLayerDoc(page);
  const undoDepth = await page.evaluate((id) => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(20, 80, 220, 255); E.select_none(); mv.engine.commit();
    mv.store.setLayerVisible(id, false); mv.store.saveLayerComp();
    mv.store.setLayerVisible(id, true); mv.store.saveLayerComp();
    return mv.store.state.undoDepth as number;
  }, top);

  const downloads: import("@playwright/test").Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page.waitForFunction(() => (window as any).__mv.commandPalette.items.some((i: any) => i.label.includes("Layer Comps to Files")));
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Layer Comps to Files")).run());
  await expect.poll(() => downloads.length).toBe(2);

  const files = await Promise.all(downloads.map(async (d) => readFile((await d.path())!)));
  expect(downloads.map((d) => d.suggestedFilename())).toEqual(["comps_Layer_Comp_1.png", "comps_Layer_Comp_2.png"]);
  expect(files[0].equals(files[1])).toBe(false);

  const pdfDownload = page.waitForEvent("download");
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Layer Comps to PDF")).run());
  const pdf = await pdfDownload;
  const pdfBytes = await readFile((await pdf.path())!);
  expect(pdf.suggestedFilename()).toBe("comps_Layer_Comps.pdf");
  expect(pdfBytes.subarray(0, 8).toString()).toBe("%PDF-1.4");
  expect(pdfBytes.toString("latin1")).toContain("/Count 2");

  expect(await page.evaluate((id) => {
    const mv = (window as any).__mv;
    return { visible: mv.engine.engine.layer_visible(id), undoDepth: mv.store.state.undoDepth };
  }, top)).toEqual({ visible: true, undoDepth });
});
