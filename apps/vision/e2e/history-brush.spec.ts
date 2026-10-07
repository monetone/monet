import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop History Brush (brush mode 12) + Edit ▸ Fill ▸ History ─────
// The History Brush is the Clone Stamp with a fixed source + zero offset: it
// repaints from a frozen snapshot (the History panel "Set Source") at the SAME
// pixel, so a full-opacity stroke reverts the painted region to that snapshot
// while the rest of the (later-modified) layer is untouched. Tools/source are
// armed via the store (exercising pushBrush's mode mapping, setHistorySource, and
// fillContents) and painted via the engine FFI at fixed doc coords for determinism.
// https://helpx.adobe.com/photoshop/using/erasing-parts-images.html

async function rgba(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}

// A green doc captured as the History source, then repainted solid red.
async function greenSourceRedNow(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(80, 60, "history");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(0, 200, 0, 255); E.select_none(); // green source state
    mv.engine.commit();
    mv.store.setHistorySource(); // History panel "Set Source" → freeze the green field
    E.select_all(); E.fill_selection(220, 0, 0, 255); E.select_none(); // modify: now red
    mv.engine.commit();
  });
}

test("the History Brush reverts a painted region to the source (rest stays modified)", async ({ page }) => {
  await gotoApp(page);
  await greenSourceRedNow(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black fg (ignored by mode 12)
    mv.store.setTool("historybrush");
    mv.store.setBrush({ size: 16, hardness: 1, flow: 1, opacity: 1 });
    const E = mv.engine.engine;
    E.stroke_begin();
    for (let x = 10; x <= 30; x += 2) E.stroke_to(x, 30, 1);
    E.stroke_end();
    E.composite();
  });
  const reverted = await rgba(page, 20, 30); // inside the stroke
  expect(reverted[1]).toBeGreaterThan(180); // green source restored
  expect(reverted[0]).toBeLessThan(40);
  const untouched = await rgba(page, 70, 30); // far from the stroke
  expect(untouched[0]).toBeGreaterThan(180); // still the modified red
  expect(untouched[1]).toBeLessThan(40);
});

test("Edit ▸ Fill ▸ History fills the selection from the source", async ({ page }) => {
  await gotoApp(page);
  await greenSourceRedNow(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(20, 15, 30, 30, 0); // a sub-region
    mv.store.fillContents("history", 1, "normal"); // routes to engine.fill_history
    E.select_none();
    E.composite();
  });
  const inside = await rgba(page, 35, 30);
  expect(inside[1]).toBeGreaterThan(180); // filled from the green source
  expect(inside[0]).toBeLessThan(40);
  const outside = await rgba(page, 5, 5);
  expect(outside[0]).toBeGreaterThan(180); // outside the selection stays red
});

test("Undo restores the canvas after a History Brush stroke", async ({ page }) => {
  await gotoApp(page);
  await greenSourceRedNow(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("historybrush");
    mv.store.setBrush({ size: 16, hardness: 1, flow: 1, opacity: 1 });
    const E = mv.engine.engine;
    E.stroke_begin();
    for (let x = 10; x <= 30; x += 2) E.stroke_to(x, 30, 1);
    E.stroke_end();
    E.composite();
  });
  expect((await rgba(page, 20, 30))[1]).toBeGreaterThan(180); // the stroke landed (green)
  await page.evaluate(() => { (window as any).__mv.store.undo(); (window as any).__mv.engine.engine.composite(); });
  const back = await rgba(page, 20, 30);
  expect(back[0]).toBeGreaterThan(180); // back to the red field
  expect(back[1]).toBeLessThan(40);
});

test("the History Brush is reachable from its flyout group and via the Y key", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(40, 40, "g"));
  // It is its own toolbar slot (grp-history).
  const grp = page.locator('[data-tool-group="grp-history"]');
  await grp.waitFor();
  await grp.click({ button: "right" });
  await page.locator('[data-flyout-tool="historybrush"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("historybrush");
  // The free "Y" key selects it (Cmd/Ctrl+Y stays Redo).
  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await page.keyboard.press("y");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("historybrush");
});

test("the History panel Set Source button captures the current state", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(60, 40, "setsrc");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(10, 20, 240, 255); E.select_none(); // a blue state
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="history"]').click();
  await page.locator("#mv-history-set-source").click();
  // Then modify, and history-brush it back to the just-set blue source.
  const back = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(240, 240, 10, 255); E.select_none(); // yellow now
    mv.engine.commit();
    mv.store.setTool("historybrush");
    mv.store.setBrush({ size: 16, hardness: 1, flow: 1, opacity: 1 });
    E.stroke_begin();
    for (let x = 10; x <= 40; x += 2) E.stroke_to(x, 20, 1);
    E.stroke_end();
    E.composite();
    const c = E.pick_color(25, 20) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  });
  expect(back[2]).toBeGreaterThan(180); // reverted to the blue source set via the button
  expect(back[0]).toBeLessThan(60);
});
