import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite, layerCount } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("new document sets dimensions and a non-trivial composite", async ({ page }) => {
  await newScene(page, 300, 200);
  const dims = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return { w: mv.engine.engine.width(), h: mv.engine.engine.height(), docW: mv.store.state.doc.width };
  });
  expect(dims.w).toBe(300);
  expect(dims.h).toBe(200);
  expect(dims.docW).toBe(300);
  const sig = await composite(page);
  expect(sig.w).toBe(300);
  // structured scene -> non-uniform content
  expect(sig.mean).toBeGreaterThan(5);
  expect(sig.mean).toBeLessThan(250);
});

test("undo and redo restore composite state", async ({ page }) => {
  await newScene(page);
  const before = await composite(page);
  await page.evaluate(() => (window as any).__mv.adj.invert());
  const inverted = await composite(page);
  expect(inverted.chk).not.toBe(before.chk);

  await page.evaluate(() => (window as any).__mv.store.undo());
  const undone = await composite(page);
  expect(undone.chk).toBe(before.chk);

  await page.evaluate(() => (window as any).__mv.store.redo());
  const redone = await composite(page);
  expect(redone.chk).toBe(inverted.chk);
});

test("open image from PNG bytes loads at its dimensions", async ({ page }) => {
  const dims = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    // synthesize a 120x90 PNG
    const c = document.createElement("canvas"); c.width = 120; c.height = 90;
    const cx = c.getContext("2d")!;
    cx.fillStyle = "#3050a0"; cx.fillRect(0, 0, 120, 90);
    cx.fillStyle = "#e0c040"; cx.fillRect(20, 20, 60, 40);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    mv.store.openImage(bytes, "opened.png");
    return { w: mv.engine.engine.width(), h: mv.engine.engine.height() };
  });
  expect(dims.w).toBe(120);
  expect(dims.h).toBe(90);
});

test("layer count starts at 1 for a new document", async ({ page }) => {
  await newScene(page);
  expect(await layerCount(page)).toBe(1);
});
