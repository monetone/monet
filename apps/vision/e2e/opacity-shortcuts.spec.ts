import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop number-key opacity shortcuts ─────────────────────────
// Adobe: one digit gives 10% steps and two digits give an exact percentage; a
// paint tool's opacity when one is active, otherwise the active layer's. Routed via
// src/state/opacityShortcuts.ts.
//   https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html

const layerOpacity = (page: Page): Promise<number | null> =>
  page.evaluate(() => { const s = (window as any).__mv.store.state; const l = s.layers.find((x: any) => x.id === s.activeLayerId); return l ? l.opacity : null; });
const brushOpacity = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__mv.store.state.brush.opacity);

test("number keys set the active layer's opacity with a non-paint tool", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.newDocument(100, 100, "op"); mv.store.setTool("move"); });
  await page.keyboard.press("3");
  expect(await layerOpacity(page)).toBe(30);
  await page.keyboard.press("Escape");
  await page.keyboard.press("4");
  await page.keyboard.press("5");
  expect(await layerOpacity(page)).toBe(45);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerOpacity(page)).toBe(30);
  await page.evaluate(() => (window as any).__mv.store.redo());
  expect(await layerOpacity(page)).toBe(45);
  await page.keyboard.press("Escape");
  await page.keyboard.press("0");
  expect(await layerOpacity(page)).toBe(100);

  await page.keyboard.press("Escape");
  await page.keyboard.press("6");
  await page.keyboard.press("Escape");
  await page.keyboard.press("7");
  await page.keyboard.press("Escape");
  expect(await layerOpacity(page)).toBe(70);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerOpacity(page)).toBe(60);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerOpacity(page)).toBe(100);
});

test("number keys set the brush opacity with a paint tool", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));
  await page.keyboard.press("3");
  expect(await brushOpacity(page)).toBeCloseTo(0.3, 5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("4");
  await page.keyboard.press("5");
  expect(await brushOpacity(page)).toBeCloseTo(0.45, 5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("0");
  expect(await brushOpacity(page)).toBe(1);
  await page.keyboard.press("5");
  expect(await brushOpacity(page)).toBeCloseTo(0.05, 5);
});

test("an exact opacity sequence does not cross document-local layer ids", async ({ page }) => {
  await gotoApp(page);
  const ids = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "opacity-a");
    mv.store.setTool("move");
    const docA = mv.store.state.activeDocId;
    const layerA = mv.store.state.activeLayerId;
    mv.store.setLayerOpacity(layerA, 90);
    mv.store.setLayerOpacity(layerA, 100); // keep A as a real tab when B opens
    mv.store.newDocument(100, 100, "opacity-b");
    const docB = mv.store.state.activeDocId;
    const layerB = mv.store.state.activeLayerId;
    mv.store.activateDoc(docA);
    return { docA, docB, layerA, layerB };
  });
  expect(ids.docA).not.toBe(ids.docB);
  expect(ids.layerA).toBe(ids.layerB);

  await page.keyboard.press("4");
  await page.evaluate((docB) => (window as any).__mv.store.activateDoc(docB), ids.docB);
  await page.keyboard.press("5");
  expect(await layerOpacity(page)).toBe(50);
  await page.evaluate((docA) => (window as any).__mv.store.activateDoc(docA), ids.docA);
  expect(await layerOpacity(page)).toBe(40);
});
