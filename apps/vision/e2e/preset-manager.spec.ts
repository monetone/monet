import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// End-to-end Preset Manager (Edit ▸ Presets) — reorder / rename / delete saved
// presets. Drives the store methods the dialog calls through window.__mv (the
// dialog itself is a thin view over these). Swatches, brush presets and tool
// presets all persist to localStorage (see preset-persistence.spec.ts).

test("reorders a swatch and persists the new order", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const before = [...mv.store.state.swatches];
    mv.store.reorderSwatch(0, 1); // first swatch → position 1
    const after = [...mv.store.state.swatches];
    const persisted = JSON.parse(localStorage.getItem("mv.swatches") || "[]");
    return { before, after, persisted };
  });
  expect(r.after[0]).toBe(r.before[1]);
  expect(r.after[1]).toBe(r.before[0]);
  expect(r.after).not.toEqual(r.before);
  expect(r.persisted).toEqual(r.after); // saved to localStorage
});

test("renames a brush preset and moves it, keeping the count", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const n = mv.store.state.brushPresets.length;
    mv.store.renameBrushPreset(0, "  My Brush  "); // trimmed
    const renamed = mv.store.state.brushPresets[0].name;
    mv.store.reorderBrushPreset(0, 1); // the renamed preset moves to index 1
    return { n, renamed, moved: mv.store.state.brushPresets[1].name, count: mv.store.state.brushPresets.length };
  });
  expect(r.renamed).toBe("My Brush");
  expect(r.moved).toBe("My Brush");
  expect(r.count).toBe(r.n); // rename/reorder never change the count
});

test("renames and reorders a tool preset", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const last = mv.store.state.toolPresets.length - 1;
    mv.store.renameToolPreset(last, "Bottom Tool");
    mv.store.reorderToolPreset(last, -1); // move it up one
    return { atLastMinus1: mv.store.state.toolPresets[last - 1].name, atLast: mv.store.state.toolPresets[last].name };
  });
  expect(r.atLastMinus1).toBe("Bottom Tool"); // moved up
  expect(r.atLast).not.toBe("Bottom Tool");
});

test("deletes a swatch (via the existing remove path) and no-ops at the boundary", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const before = mv.store.state.swatches.length;
    mv.store.removeSwatch(0);
    const afterDelete = mv.store.state.swatches.length;
    const snapshot = [...mv.store.state.swatches];
    mv.store.reorderSwatch(0, -1); // already first → no-op
    return { before, afterDelete, unchanged: JSON.stringify(snapshot) === JSON.stringify(mv.store.state.swatches) };
  });
  expect(r.afterDelete).toBe(r.before - 1);
  expect(r.unchanged).toBe(true);
});
