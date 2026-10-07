import { test, expect, type Page } from "@playwright/test";
import { gotoApp, composite, layerCount } from "./helpers";

// Real ONNX models load on first use — give these generous time.
test.describe.configure({ mode: "serial" });

// A subject-on-background scene for segmentation models.
async function subjectScene(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(160, 120, "ml");
    E().select_all(); E().fill_selection(245, 245, 245, 255); E().select_none();
    E().select_ellipse(45, 30, 70, 60, 0); E().fill_selection(35, 45, 90, 255); E().select_none();
    mv.engine.commit();
  });
}

test("style transfer applies a neural style on a new layer", async ({ page }) => {
  test.setTimeout(180_000);
  await gotoApp(page);
  await subjectScene(page);
  const before = await composite(page);
  const lc = await layerCount(page);
  const ret = await page.evaluate(() => (window as any).__mv.ml.styleTransfer("candy"));
  const after = await composite(page);
  expect((ret as any).ok).toBe(true);
  expect(await layerCount(page)).toBe(lc + 1);
  expect(after.chk).not.toBe(before.chk);
});

test("super-resolution upscales the document 3×", async ({ page }) => {
  test.setTimeout(180_000);
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; mv.store.newDocument(64, 48, "sr"); E().select_all(); E().fill_selection(120, 80, 200, 255); E().select_none(); mv.engine.commit(); });
  const ret = await page.evaluate(() => (window as any).__mv.ml.superResolution());
  expect((ret as any).ok).toBe(true);
  const dims = await page.evaluate(() => { const E = () => (window as any).__mv.engine.engine; return { w: E().width(), h: E().height() }; });
  expect(dims.w).toBe(64 * 3);
  expect(dims.h).toBe(48 * 3);
});

test("select subject creates a saliency selection (U²-Net)", async ({ page }) => {
  test.setTimeout(180_000);
  await gotoApp(page);
  await subjectScene(page);
  const ret = await page.evaluate(() => (window as any).__mv.ml.selectSubject());
  const has = await page.evaluate(() => (window as any).__mv.engine.engine.has_selection());
  expect((ret as any).ok).toBe(true);
  expect((ret as any).coverage).toBeGreaterThan(0.01);
  expect((ret as any).coverage).toBeLessThan(0.99);
  expect(has).toBe(true);
});

test("remove background isolates the subject on a new layer", async ({ page }) => {
  test.setTimeout(180_000);
  await gotoApp(page);
  await subjectScene(page);
  const lc = await layerCount(page);
  const ret = await page.evaluate(() => (window as any).__mv.ml.removeBackground());
  expect((ret as any).ok).toBe(true);
  expect(await layerCount(page)).toBe(lc + 1);
});

test("missing optional MI-GAN fails clearly without mutating the document", async ({ page }) => {
  await page.route("**/models/migan.onnx", (route) => route.fulfill({ status: 404 }));
  await gotoApp(page);
  await subjectScene(page);
  const lc = await layerCount(page);
  const before = await composite(page);
  const error = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_rect(55, 45, 50, 40, 0); mv.engine.commit();
    try {
      await mv.ml.generativeFill();
      return "";
    } catch (e) {
      return String(e);
    }
  });
  expect(error).toContain("MI-GAN is not installed");
  expect(await layerCount(page)).toBe(lc);
  expect((await composite(page)).chk).toBe(before.chk);
});
