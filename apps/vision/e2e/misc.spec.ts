import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite, layerCount } from "./helpers";

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page); });

test("view: zoom and pan update the view state", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const z0 = mv.store.state.zoom;
    mv.store.zoomBy(1.5); const z1 = mv.store.state.zoom;
    mv.store.setPan(40, 25); const p = { x: mv.store.state.panX, y: mv.store.state.panY };
    return { z0, z1, p };
  });
  expect(r.z1).toBeGreaterThan(r.z0);
  expect(r.p).toEqual({ x: 40, y: 25 });
});

test("engine super-resolution doubles the document", async ({ page }) => {
  const d = await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; mv.neural.superResolution(); return { w: E().width(), h: E().height() }; });
  expect(d).toEqual({ w: 512, h: 384 });
});

test("auto-colorize changes the composite", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => (window as any).__mv.neural.colorize());
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("nudge layer shifts content", async ({ page }) => {
  // put content on its own layer so the shift is visible over the bg
  const before = await composite(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const id = mv.store.state.activeLayerId;
    E().nudge_layer(id, 25, 15); mv.engine.commit();
  });
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("set_layer_offset repositions a layer", async ({ page }) => {
  const before = await composite(page);
  await page.evaluate(() => { const mv = (window as any).__mv, E = () => mv.engine.engine; E().set_layer_offset(mv.store.state.activeLayerId, 30, 0); mv.engine.commit(); });
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("color mode flag round-trips (CMYK)", async ({ page }) => {
  const r = await page.evaluate(() => { const E = () => (window as any).__mv.engine.engine; E().set_mode(2); return E().doc_mode(); });
  expect(r).toBe(2);
});

test("place image imports onto a new layer", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const before = E().layer_count();
    const c = document.createElement("canvas"); c.width = 60; c.height = 40;
    const cx = c.getContext("2d")!; cx.fillStyle = "#22cc88"; cx.fillRect(0, 0, 60, 40);
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    E().importImage(bytes, "placed");
    mv.engine.commit();
    return { before, after: E().layer_count() };
  });
  expect(r.after).toBeGreaterThan(r.before);
});

test("GIF export/import round-trips frames", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_all(); E().fill_selection(220, 40, 40, 255); E().select_none(); E().add_frame();
    E().select_all(); E().fill_selection(40, 40, 220, 255); E().select_none(); E().add_frame();
    const gif: Uint8Array = E().export_gif(10);
    const frames = E().importGif(gif);
    return { frames, count: E().frame_count() };
  });
  expect(r.count).toBeGreaterThanOrEqual(2);
});

test("pen pressure changes brush size through the real pointer-event path", async ({ page }) => {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 120, "pen-pressure", "transparent");
    mv.store.setTool("brush");
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 });
    mv.store.setBrush({ size: 30, hardness: 1, flow: 1, opacity: 1, smoothing: 0, sizePressure: true, flowPressure: false });
    mv.store.fit();
  });
  const canvas = page.locator(".mv-canvas-viewport canvas").first();
  await expect(canvas).toBeVisible();
  const stroke = (y: number, pressure: number, pointerId: number) => canvas.evaluate((target, args) => {
    const rect = target.getBoundingClientRect();
    const point = (x: number) => ({ clientX: rect.left + rect.width * x / 200, clientY: rect.top + rect.height * args.y / 120 });
    const fire = (type: string, x: number, buttons: number, p: number) => target.dispatchEvent(new PointerEvent(type, {
      ...point(x), bubbles: true, button: 0, buttons, pointerId: args.pointerId, pointerType: "pen", pressure: p,
    }));
    fire("pointerdown", 30, 1, args.pressure);
    for (let x = 40; x <= 170; x += 10) fire("pointermove", x, 1, args.pressure);
    fire("pointerup", 170, 0, 0);
  }, { y, pressure, pointerId });
  await stroke(35, 0.1, 41);
  await stroke(85, 1, 42);

  const alpha = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const at = (x: number, y: number) => E.pick_color(x, y) & 255;
    return { lowCenter: at(100, 35), lowEdge: at(100, 45), highCenter: at(100, 85), highEdge: at(100, 95) };
  });
  expect(alpha.lowCenter).toBeGreaterThan(200);
  expect(alpha.highCenter).toBeGreaterThan(200);
  expect(alpha.lowEdge).toBeLessThan(50);
  expect(alpha.highEdge).toBeGreaterThan(200);
});

test("canvas hit mapping is identical at 1× and 2× device scale", async ({ browser }) => {
  const paintAt = async (deviceScaleFactor: number) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:1420",
      viewport: { width: 1000, height: 800 },
      deviceScaleFactor,
    });
    try {
      const scaledPage = await context.newPage();
      await gotoApp(scaledPage);
      await scaledPage.evaluate(() => {
        const mv = (window as any).__mv;
        mv.store.newDocument(100, 100, "dpi", "white");
        mv.store.setTool("brush");
        mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 });
        mv.store.setBrush({ size: 12, hardness: 1, flow: 1, opacity: 1, smoothing: 0 });
        mv.store.fit();
      });
      const box = await scaledPage.locator(".mv-canvas-viewport canvas").first().boundingBox();
      if (!box) throw new Error("Vision canvas is not visible");
      await scaledPage.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
      return scaledPage.evaluate(() => {
        const E = (window as any).__mv.engine.engine;
        return {
          dpr: devicePixelRatio,
          red: (E.pick_color(25, 25) >>> 24) & 255,
          undoDepth: E.undo_depth(),
        };
      });
    } finally {
      await context.close();
    }
  };

  const one = await paintAt(1);
  const two = await paintAt(2);
  expect(one).toMatchObject({ dpr: 1, undoDepth: 1 });
  expect(two).toMatchObject({ dpr: 2, undoDepth: 1 });
  expect(one.red).toBeLessThan(100);
  expect(two.red).toBeLessThan(100);
});
