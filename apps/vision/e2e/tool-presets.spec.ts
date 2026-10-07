import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Photoshop Tool Presets: a saved tool + its option-bar settings, recalled with
// one click. Vision snapshots the tool + brush + foreground colour.
//   https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html
test("applying a tool preset selects its tool and restores its brush", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(20, 20, "tp"));
  // The default "Eraser 40" preset is at index 2.
  await page.evaluate(() => (window as any).__mv.store.applyToolPreset(2));
  const after = await page.evaluate(() => ({
    tool: (window as any).__mv.store.state.tool,
    size: (window as any).__mv.store.state.brush.size,
  }));
  expect(after.tool).toBe("erase");
  expect(after.size).toBe(40);
});

test("Add saves the current tool as a new preset", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "tp");
    mv.store.setTool("smudge");
    mv.store.setBrush({ size: 77 });
  });
  const before = await page.evaluate(() => (window as any).__mv.store.state.toolPresets.length);
  await page.evaluate(() => (window as any).__mv.store.addToolPreset());
  const saved = await page.evaluate(() => {
    const list = (window as any).__mv.store.state.toolPresets;
    const p = list[list.length - 1];
    return { count: list.length, tool: p.tool, size: p.brush.size };
  });
  expect(saved.count).toBe(before + 1);
  expect(saved.tool).toBe("smudge");
  expect(saved.size).toBe(77);
});
