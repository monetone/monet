import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Info panel — selection dimensions ────────────────────
// Adobe: while a marquee is being drawn, the Info panel reports its live X/Y
// origin and W/H; after release those rows report the committed selection.
//   https://helpx.adobe.com/photoshop/using/information-panel-overview.html

const DOC = 200;
const sel = (page: Page, id: string) => page.locator(`[data-mv-sel="${id}"] .val`);

async function canvasMap(page: Page) {
  const box = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = canvases.map((canvas) => canvas.getBoundingClientRect())
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return {
    x: (value: number) => box.x + value * box.w / DOC,
    y: (value: number) => box.y + value * box.h / DOC,
  };
}

async function liveScene(page: Page, tool: "marquee" | "ellipse", name: string) {
  await gotoApp(page);
  await page.evaluate(({ tool, name }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 200, name);
    mv.store.setTool(tool);
    mv.store.setOptions({
      snapEnabled: false,
      selectionFeather: 0,
      selMode: 0,
      marqueeStyle: "normal",
    });
    mv.store.fit();
  }, { tool, name });
  await page.locator('[data-tab-id="info"]').click();
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1, null, { timeout: 5000 });
  return canvasMap(page);
}

async function selectAndShowInfo(page: Page, name: string) {
  await page.evaluate((docName) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 200, docName);
    mv.engine.engine.select_rect(10, 20, 40, 30, 0); // active partial-canvas marquee
    mv.engine.sync();
  }, name);
  await page.locator('[data-tab-id="info"]').click();
}

test("the Info panel reports the active selection's X/Y/W/H", async ({ page }) => {
  await gotoApp(page);
  await selectAndShowInfo(page, "selinfo");
  await expect(sel(page, "x")).toHaveText("10 px");
  await expect(sel(page, "y")).toHaveText("20 px");
  await expect(sel(page, "w")).toHaveText("40 px");
  await expect(sel(page, "h")).toHaveText("30 px");
});

test("the selection readout disappears when deselected", async ({ page }) => {
  await gotoApp(page);
  await selectAndShowInfo(page, "selinfo2");
  await expect(page.locator('[data-mv-sel="w"]')).toHaveCount(1);
  await page.evaluate(() => (window as any).__mv.store.deselect());
  await expect(page.locator('[data-mv-sel="w"]')).toHaveCount(0);
});

for (const tool of ["marquee", "ellipse"] as const) {
  test(`the Info panel reports live ${tool} geometry before release`, async ({ page }) => {
    const map = await liveScene(page, tool, `live-${tool}`);
    const before = await page.evaluate(() => {
      const mv = (window as any).__mv;
      return {
        undoDepth: mv.store.state.undoDepth,
        dirty: mv.store.docDirty(mv.store.state.activeDocId),
      };
    });

    await page.mouse.move(map.x(20), map.y(30));
    await page.mouse.down();
    await page.mouse.move(map.x(100), map.y(90), { steps: 4 });

    await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.selectionDragRect))
      .toEqual({ x: 20, y: 30, w: 80, h: 60 });
    await expect(sel(page, "x")).toHaveText("20 px");
    await expect(sel(page, "y")).toHaveText("30 px");
    await expect(sel(page, "w")).toHaveText("80 px");
    await expect(sel(page, "h")).toHaveText("60 px");
    expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(false);
    expect(await page.evaluate(() => {
      const mv = (window as any).__mv;
      return {
        undoDepth: mv.store.state.undoDepth,
        dirty: mv.store.docDirty(mv.store.state.activeDocId),
      };
    })).toEqual(before);

    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.selectionDragRect)).toBeNull();
    expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(true);
    await expect(sel(page, "w")).toHaveText("80 px");
    await expect(sel(page, "h")).toHaveText("60 px");
  });
}

test("pointer cancellation and Escape clear live marquee geometry without committing", async ({ page }) => {
  const map = await liveScene(page, "marquee", "live-cancel");
  const before = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      undoDepth: mv.store.state.undoDepth,
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
    };
  });

  await page.mouse.move(map.x(20), map.y(30));
  await page.mouse.down();
  await page.mouse.move(map.x(100), map.y(90));
  await expect(page.locator('[data-mv-preview="rect"]')).toHaveCount(1);
  await page.locator(".mv-canvas-viewport").evaluate((viewport) => {
    viewport.dispatchEvent(new PointerEvent("pointercancel", {
      bubbles: true,
      pointerId: 1,
      pointerType: "mouse",
    }));
  });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.selectionDragRect)).toBeNull();
  await expect(page.locator('[data-mv-preview="rect"]')).toHaveCount(0);
  await expect(page.locator('[data-mv-sel="w"]')).toHaveCount(0);

  await page.mouse.move(map.x(30), map.y(40));
  await page.mouse.down();
  await page.mouse.move(map.x(120), map.y(110));
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.selectionDragRect)).toBeNull();
  await expect(page.locator('[data-mv-preview="rect"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(false);
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      undoDepth: mv.store.state.undoDepth,
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
    };
  })).toEqual(before);
});

test("switching documents cancels a live marquee before the next pointer-up", async ({ page }) => {
  await liveScene(page, "marquee", "live-doc-a");
  const ids = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const a = mv.store.state.activeDocId;
    mv.store.addLayer(); // prevent the pristine-document replacement path
    mv.store.newDocument(200, 200, "live-doc-b");
    const b = mv.store.state.activeDocId;
    mv.store.activateDoc(a);
    return { a, b };
  });
  expect(ids.a).not.toBe(ids.b);
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeDocId)).toBe(ids.a);
  const map = await canvasMap(page);

  await page.mouse.move(map.x(20), map.y(30));
  await page.mouse.down();
  await page.mouse.move(map.x(100), map.y(90));
  await expect(sel(page, "w")).toHaveText("80 px");
  await page.evaluate((id) => (window as any).__mv.store.activateDoc(id), ids.b);
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.selectionDragRect)).toBeNull();
  await expect(page.locator('[data-mv-preview="rect"]')).toHaveCount(0);
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(false);

  await page.evaluate((id) => (window as any).__mv.store.activateDoc(id), ids.a);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(false);
});
