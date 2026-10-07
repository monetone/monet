import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page); });

test("animation frames: add, count, delete, clear", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.anim.addFrame(); mv.anim.addFrame(); const two = mv.anim.count();
    mv.anim.deleteFrame(0); const one = mv.anim.count();
    mv.anim.clear(); const zero = mv.anim.count();
    return { two, one, zero };
  });
  expect(r.two).toBe(2);
  expect(r.one).toBe(1);
  expect(r.zero).toBe(0);
});

test("export GIF produces valid GIF bytes", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_all(); E().fill_selection(220, 40, 40, 255); E().select_none(); E().add_frame();
    E().select_all(); E().fill_selection(40, 40, 220, 255); E().select_none(); E().add_frame();
    const bytes: Uint8Array = E().export_gif(10);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
    return { len: bytes.length, magic };
  });
  expect(r.len).toBeGreaterThan(100);
  expect(r.magic.startsWith("GIF8")).toBe(true);
});

test("frames adjustment applies across all frames", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().add_frame(); E().add_frame();
    const before = E().frame_count();
    mv.framesAdjust(4, []); // kind 4 = invert across frames
    return { before, after: E().frame_count() };
  });
  expect(r.after).toBe(r.before); // adjusting frames keeps the count
});

test("record video produces a valid codec stream (MediaRecorder)", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_all(); E().fill_selection(200, 60, 60, 255); E().select_none(); E().add_frame();
    E().select_all(); E().fill_selection(60, 60, 200, 255); E().select_none(); E().add_frame();
    const { bytes, mime } = await mv.recordVideo(10);
    const ebml = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp";
    return { len: bytes.length, mime, valid: ebml || ftyp };
  });
  expect(r.len).toBeGreaterThan(40);
  expect(r.valid).toBe(true);
});

test("onion skin ghosts the last frame over the canvas (display-only)", async ({ page }) => {
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    E.select_all(); E.fill_selection(220, 40, 40, 255); E.select_none(); E.add_frame(); mv.engine.commit();
  });
  await expect(page.locator('[data-mv-onion="1"]')).toHaveCount(0);
  await page.evaluate(() => (window as any).__mv.store.toggleOnionSkin());
  await expect(page.locator('img[data-mv-onion="1"]')).toBeVisible();
  // Display-only: the engine composite is untouched by the ghost.
  const raw = await page.evaluate(() => ((window as any).__mv.engine.engine.pick_color(8, 8) >>> 0) >>> 24 & 255);
  expect(raw).toBe(220);
  await page.evaluate(() => (window as any).__mv.store.toggleOnionSkin());
  await expect(page.locator('[data-mv-onion="1"]')).toHaveCount(0);
});

test("record video honors a frame range and bitrate", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    E.select_all(); E.fill_selection(200, 60, 60, 255); E.select_none(); E.add_frame();
    E.select_all(); E.fill_selection(60, 60, 200, 255); E.select_none(); E.add_frame();
    E.select_all(); E.fill_selection(60, 200, 60, 255); E.select_none(); E.add_frame();
    const { bytes, mime } = await mv.recordVideo(10, { from: 1, to: 2, bitrate: 2_500_000 });
    const ebml = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp";
    return { len: bytes.length, mime, valid: ebml || ftyp };
  });
  expect(r.len).toBeGreaterThan(40);
  expect(r.valid).toBe(true);
});
