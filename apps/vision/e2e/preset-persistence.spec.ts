import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// End-to-end brush/tool-preset persistence — Photoshop keeps its Brushes and
// Tool Presets libraries across launches; Monet only persisted swatches before.
// Adding/removing a preset must write it to localStorage, and the boot loaders
// (loadBrushPresets / loadToolPresets) must restore a saved library.

test("adding a brush preset persists it to localStorage", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const before = mv.store.state.brushPresets.length;
    mv.store.addBrushPreset(); // snapshots current brush as "Brush N"
    const after = mv.store.state.brushPresets;
    const persisted = JSON.parse(localStorage.getItem("mv.brushPresets") || "null");
    return { before, count: after.length, live: after, persisted };
  });
  expect(r.count).toBe(r.before + 1);
  expect(r.persisted).toEqual(r.live); // localStorage mirrors the live library
});

test("adding a tool preset persists it to localStorage", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const before = mv.store.state.toolPresets.length;
    mv.store.addToolPreset(); // snapshots current tool + brush + fg as "Tool N"
    const after = mv.store.state.toolPresets;
    const persisted = JSON.parse(localStorage.getItem("mv.toolPresets") || "null");
    return { before, count: after.length, live: after, persisted };
  });
  expect(r.count).toBe(r.before + 1);
  expect(r.persisted).toEqual(r.live);
});

test("loadBrushPresets / loadToolPresets restore a saved library", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    // Seed a distinctive saved library, wipe the live state, then reload.
    const brushLib = [{ name: "Saved Brush", brush: { size: 77, hardness: 0.25 } }];
    const toolLib = [{ name: "Saved Tool", tool: "brush", brush: { size: 5 }, fg: { h: 10, s: 1, v: 1, a: 1 } }];
    localStorage.setItem("mv.brushPresets", JSON.stringify(brushLib));
    localStorage.setItem("mv.toolPresets", JSON.stringify(toolLib));
    mv.store.set({ brushPresets: [], toolPresets: [] });
    mv.store.loadBrushPresets();
    mv.store.loadToolPresets();
    return { brush: mv.store.state.brushPresets, tool: mv.store.state.toolPresets };
  });
  expect(r.brush).toEqual([{ name: "Saved Brush", brush: { size: 77, hardness: 0.25 } }]);
  expect(r.tool).toEqual([{ name: "Saved Tool", tool: "brush", brush: { size: 5 }, fg: { h: 10, s: 1, v: 1, a: 1 } }]);
});

test("a corrupt saved library is ignored (live state kept)", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const before = [...mv.store.state.brushPresets];
    localStorage.setItem("mv.brushPresets", "{ not json");
    mv.store.loadBrushPresets(); // must not throw, must not clobber
    return { before, after: mv.store.state.brushPresets };
  });
  expect(r.after).toEqual(r.before); // malformed payload left the library untouched
});
