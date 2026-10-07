import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite, layerCount } from "./helpers";

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page); });

test("content-aware fill synthesizes over a selection", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; E().select_rect(90, 70, 70, 55, 0); mv.contentAwareFill(); E().select_none(); mv.engine.commit(); });
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("patch selection replaces a region", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; E().select_rect(60, 60, 60, 50, 0); mv.patchSelection(); E().select_none(); mv.engine.commit(); });
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("generative fill (PatchMatch) synthesizes over a selection", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; E().select_rect(90, 70, 70, 55, 0); mv.generativeFill(); E().select_none(); mv.engine.commit(); });
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("exposure fusion (HDR merge) produces a new layer", async ({ page }) => {
  const before = await layerCount(page);
  await page.evaluate(() => (window as any).__mv.exposureFusion());
  expect(await layerCount(page)).toBeGreaterThan(before);
});
