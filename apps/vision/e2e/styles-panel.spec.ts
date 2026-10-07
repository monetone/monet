import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Styles panel (Window ▸ Styles) ──────────────────────
// Adobe: the Styles panel is a library of saved layer-effect stacks — click one
// to apply the whole effect stack to the active layer; "New Style" saves the
// active layer's current style. Vision persists the library across launches
// (localStorage mv.stylePresets), mirroring swatches/brushes/tools/gradients.
//   https://helpx.adobe.com/photoshop/using/layer-effects-styles.html

// A drop shadow (effect id 0): [on, blend(multiply=3), opacity, r,g,b, angle, distance, spread, size].
const SHADOW = [1, 3, 0.75, 0, 0, 0, 120, 20, 0, 12];

/** New doc + a partially-covered layer carrying a drop shadow; returns the fx layer id. */
async function sceneWithStyledLayer(page: Page): Promise<number> {
  await gotoApp(page);
  return page.evaluate((shadow) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 90, "styles");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(40, 60, 90, 255); E.select_none();
    const fx = E.add_layer("fx"); // new layer is active
    E.select_rect(20, 15, 60, 40, 0); E.fill_selection(230, 210, 120, 255); E.select_none();
    mv.store.setEffect(fx, 0, shadow);
    mv.engine.commit();
    return fx;
  }, SHADOW);
}

test("saving then applying a style round-trips the layer's effect stack", async ({ page }) => {
  const fx = await sceneWithStyledLayer(page);
  const r = await page.evaluate((id) => {
    const mv = (window as any).__mv;
    const before = mv.store.state.stylePresets.length; // built-in library seeded
    mv.store.addStylePreset(); // captures the active layer's style, appended at the end
    const i = mv.store.state.stylePresets.length - 1;
    const saved = mv.store.state.stylePresets[i].style.effects[0];
    mv.store.clearLayerStyle(); // wipe the layer's effects
    const cleared = mv.store.effectParams(id, 0);
    mv.store.applyStylePreset(i); // re-apply the saved style
    const reapplied = mv.store.effectParams(id, 0);
    const persisted = JSON.parse(localStorage.getItem("mv.stylePresets") || "null");
    return { name: mv.store.state.stylePresets[i].name, before, count: mv.store.state.stylePresets.length, saved, cleared, reapplied, persistedLen: persisted?.length };
  }, fx);
  expect(r.name).toBe("Style 1"); // auto-named (built-in names don't match "Style N")
  expect(r.count).toBe(r.before + 1);
  expect(r.saved.fx).toBe(0);
  expect(r.saved.params[0]).toBe(1); // captured the enabled drop shadow
  expect(r.cleared.length === 0 || r.cleared[0] === 0).toBe(true); // effect gone after clear
  expect(r.reapplied).toEqual(r.saved.params); // exact round-trip
  expect(r.persistedLen).toBe(r.count); // whole library written to localStorage
});

test("the Styles panel ships built-in styles that apply to the active layer", async ({ page }) => {
  const fx = await sceneWithStyledLayer(page);
  const r = await page.evaluate((id) => {
    const mv = (window as any).__mv;
    const names = mv.store.state.stylePresets.map((p: any) => p.name);
    mv.store.clearLayerStyle(); // start from no effects
    const strokeIdx = names.indexOf("Stroke");
    mv.store.applyStylePreset(strokeIdx); // built-in "Stroke" enables the stroke effect (id 9)
    return { names, stroke: mv.store.effectParams(id, 9) };
  }, fx);
  expect(r.names).toContain("Drop Shadow");
  expect(r.names).toContain("Stroke");
  expect(r.stroke[0]).toBe(1); // the stroke effect is enabled on the layer
});

test("loadStylePresets restores a saved library; a corrupt payload is ignored", async ({ page }) => {
  await sceneWithStyledLayer(page);
  const restored = await page.evaluate(() => {
    const mv = (window as any).__mv;
    // blendIf is 0 or 32 entries since #143 — a 4-entry one is a corrupt
    // payload the loader is right to refuse, so the saved library uses none.
    const lib = [{ name: "Saved FX", style: { effects: [{ fx: 0, params: [1, 0, 1, 0, 0, 0, 90, 3, 0, 4] }], blendIf: [], fillOpacity: 80 } }];
    localStorage.setItem("mv.stylePresets", JSON.stringify(lib));
    mv.store.set({ stylePresets: [] });
    mv.store.loadStylePresets();
    return mv.store.state.stylePresets;
  });
  expect(restored).toEqual([{ name: "Saved FX", style: { effects: [{ fx: 0, params: [1, 0, 1, 0, 0, 0, 90, 3, 0, 4] }], blendIf: [], fillOpacity: 80 } }]);
  const kept = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const before = [...mv.store.state.stylePresets];
    localStorage.setItem("mv.stylePresets", "{ not json");
    mv.store.loadStylePresets(); // must not throw, must not clobber
    return { before, after: mv.store.state.stylePresets };
  });
  expect(kept.after).toEqual(kept.before);
});

test("Preset Manager reorders, renames and deletes style presets", async ({ page }) => {
  await sceneWithStyledLayer(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.addStylePreset(); // Style 1
    mv.store.addStylePreset(); // Style 2
    const n = mv.store.state.stylePresets.length;
    mv.store.renameStylePreset(0, "  Chrome  "); // trimmed
    const renamed = mv.store.state.stylePresets[0].name;
    mv.store.reorderStylePreset(0, 1); // renamed preset moves to index 1
    const moved = mv.store.state.stylePresets[1].name;
    mv.store.removeStylePreset(mv.store.state.stylePresets.length - 1); // drop last
    const persisted = JSON.parse(localStorage.getItem("mv.stylePresets") || "[]");
    return { n, renamed, moved, count: mv.store.state.stylePresets.length, persistedLen: persisted.length };
  });
  expect(r.renamed).toBe("Chrome");
  expect(r.moved).toBe("Chrome"); // rename survived the reorder
  expect(r.count).toBe(r.n - 1); // one deleted
  expect(r.persistedLen).toBe(r.count); // persisted through every mutation
});

test("the Styles panel saves via '+ Save Style' and applies on tile click", async ({ page }) => {
  const fx = await sceneWithStyledLayer(page);
  await page.locator('[data-tab-id="styles"]').click();
  await expect(page.locator("[data-mv-style-save]")).toBeVisible();
  const before = await page.locator("[data-mv-style]").count(); // built-in tiles
  // Save the active layer's style from the panel — a new tile appears.
  await page.locator("[data-mv-style-save]").click();
  await expect(page.locator("[data-mv-style]")).toHaveCount(before + 1);
  // Clear the layer, then click the just-saved (last) tile to re-apply it.
  await page.evaluate(() => (window as any).__mv.store.clearLayerStyle());
  await page.locator("[data-mv-style]").last().click();
  const reapplied = await page.evaluate((id) => (window as any).__mv.store.effectParams(id, 0), fx);
  expect(reapplied[0]).toBe(1); // the drop shadow is enabled again
});
