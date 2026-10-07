import { expect, test, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Window ▸ Arrange: live, editable views (#478) ──────────────────
// Photoshop's New Window for <doc> is a second live view of the document: paint
// in one window and the other updates dab by dab. Tile lays every open
// document out n-up, and each window is a full editing surface with its own
// zoom. Every sample below is a synchronous read, taken while the button is
// still held where the test says "during the drag".

const DOC = { w: 160, h: 120 };

/** A white document with the black hard Brush armed; returns its id. */
const whiteDoc = (page: Page, name: string) => page.evaluate(({ w, h, name }) => {
  const mv = (window as any).__mv;
  mv.store.newDocument(w, h, name);
  const E = mv.engine.engine;
  E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none();
  mv.engine.commit();
  mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 });
  mv.store.setTool("brush");
  mv.store.setBrush({ size: 14, hardness: 1, flow: 1, opacity: 1, spacing: 0.1 });
  mv.store.fit();
  return mv.store.state.activeDocId as number;
}, { ...DOC, name });

async function arrange(page: Page, item: string | RegExp) {
  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page.getByRole("menuitem", { name: "Arrange", exact: true }).hover();
  await page.getByRole("menuitem", { name: item, exact: typeof item === "string" }).click();
}

const paneCanvas = (id: number) => `[data-mv-pane="${id}"] canvas`;

/** RGB of a pane's own canvas at a document pixel. */
const paneRgb = (page: Page, id: number, x: number, y: number) => page.evaluate(({ sel, x, y }) => {
  const c = document.querySelector(sel) as HTMLCanvasElement;
  return Array.from(c.getContext("2d")!.getImageData(x, y, 1, 1).data.slice(0, 3));
}, { sel: paneCanvas(id), x, y });

/** Screen-space mapper for a document canvas element (unrotated view). */
async function mapper(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  return (x: number, y: number): [number, number] => [box.x + x * box.width / DOC.w, box.y + y * box.height / DOC.h];
}

const viewState = (page: Page, id: number) => page.evaluate((id) => {
  const s = (window as any).__mv.store.state;
  return { main: s.zoom as number, pane: s.paneViews[id]?.zoom as number | undefined };
}, id);

test("New Window shows a brush stroke in the second view while the brush is still down", async ({ page }) => {
  await gotoApp(page);
  const id = await whiteDoc(page, "arrange-live.psd");
  await arrange(page, /^New Window for arrange-live\.psd\*?$/); // `*` = unsaved

  // The second view is a real canvas at full document resolution.
  await page.waitForFunction(({ sel, w, h }) => {
    const c = document.querySelector(sel) as HTMLCanvasElement | null;
    return c?.width === w && c.height === h;
  }, { sel: paneCanvas(id), ...DOC });
  expect(await paneRgb(page, id, 60, 60)).toEqual([255, 255, 255]);

  const at = await mapper(page, ".mv-canvas-viewport:not([data-mv-pane]) canvas");
  await page.mouse.move(...at(20, 60));
  await page.mouse.down();
  await page.mouse.move(...at(100, 60), { steps: 8 });
  // Mid-drag: the dabs already sit in the second view.
  const during = await paneRgb(page, id, 60, 60);
  await page.mouse.up();
  expect(Math.max(...during)).toBeLessThan(40);
  // And the stroke landed in the document itself.
  const ink = await page.evaluate(() => ((window as any).__mv.engine.engine.pick_color(60, 60) >>> 24) & 255);
  expect(ink).toBeLessThan(40);

  // The pane's own zoom control, then Match Zoom pushes the canvas's zoom onto it.
  const zoomSlider = page.locator("#mv-secondview-zoom");
  const box = await zoomSlider.boundingBox();
  if (!box) throw new Error("second view zoom slider is not visible");
  const frac = (300 - 2) / (3200 - 2);
  await page.mouse.click(box.x + box.width * frac, box.y + box.height / 2);
  let zoomPct = Number(await zoomSlider.getAttribute("aria-valuenow"));
  for (let i = 0; i < 40 && zoomPct !== 300; i++) {
    await zoomSlider.press(zoomPct < 300 ? "ArrowRight" : "ArrowLeft");
    zoomPct = Number(await zoomSlider.getAttribute("aria-valuenow"));
  }
  await expect.poll(async () => (await viewState(page, id)).pane).toBe(3);
  expect((await viewState(page, id)).main).not.toBe(3);
  await arrange(page, "Match Zoom");
  await expect.poll(async () => { const v = await viewState(page, id); return v.pane! - v.main; }).toBeCloseTo(0, 6);

  // Consolidate All to Tabs puts the views away.
  await arrange(page, "Consolidate All to Tabs");
  await expect(page.locator("[data-mv-pane]")).toHaveCount(0);
});

test("a Tile pane is an editing surface: its own zoom, and a stroke there paints its document where it starts", async ({ page }) => {
  await gotoApp(page);
  const a = await whiteDoc(page, "tile-a.psd");
  const b = await whiteDoc(page, "tile-b.psd");
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeDocId)).toBe(b);
  await arrange(page, "Tile");
  // tile-a is a background document: its pane shows that document's own pixels.
  await page.waitForFunction(({ sel, w }) => (document.querySelector(sel) as HTMLCanvasElement | null)?.width === w, { sel: paneCanvas(a), w: DOC.w });
  await expect(page.locator("[data-mv-pane]")).toHaveCount(2);

  // Zoom: ctrl+wheel over the pane zooms that pane only.
  const before = await viewState(page, a);
  const paneBox = (await page.locator(`[data-mv-pane="${a}"]`).boundingBox())!;
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await viewState(page, a)).pane).toBeGreaterThan(before.pane!);
  expect((await viewState(page, a)).main).toBe(before.main);

  // Paint: a 1px Pencil drag across tile-a's pane activates tile-a and paints
  // it, starting on exactly the pixel under the pointer — activation must not
  // shift the pane mid-gesture. The pane sits at 100% so a pixel is a pixel;
  // aim at pixel centres.
  await page.evaluate((a) => {
    const mv = (window as any).__mv;
    mv.store.setZoom(1, 0, 0, a);
    mv.store.setTool("pencil");
    mv.store.setBrush({ size: 1 });
  }, a);
  await expect.poll(async () => (await page.locator(paneCanvas(a)).boundingBox())?.width).toBeCloseTo(DOC.w, 3);
  const at = await mapper(page, paneCanvas(a));
  await page.mouse.move(...at(20.5, 60.5));
  await page.mouse.down();
  await page.mouse.move(...at(80.5, 60.5), { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(({ b }) => {
    const mv = (window as any).__mv;
    const red = (x: number, y: number) => (mv.engine.engine.pick_color(x, y) >>> 24) & 255;
    const other: Uint8ClampedArray = mv.store.docPixels(b).data;
    let otherMin = 255;
    for (let i = 0; i < other.length; i++) if (i % 4 !== 3 && other[i] < otherMin) otherMin = other[i];
    return {
      active: mv.store.state.activeDocId as number,
      start: red(20, 60), beforeStart: red(19, 60), above: red(20, 59), mid: red(50, 60),
      otherMin,
    };
  }, { b });
  expect(after.active).toBe(a);
  expect(after).toMatchObject({ start: 0, mid: 0, beforeStart: 255, above: 255 });
  expect(after.otherMin).toBe(255); // tile-b untouched
  // The pane now mirrors the live canvas: the stroke is in it.
  expect(await paneRgb(page, a, 50, 60)).toEqual([0, 0, 0]);

  // Edits to the active document never recomposite a background tile or hand
  // a pane's canvas over again — only activation does.
  const churn = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const counts = { docPixels: 0, addMirror: 0 };
    const { docPixels } = mv.store, { addMirror } = mv.engine;
    mv.store.docPixels = (...args: unknown[]) => { counts.docPixels++; return docPixels.apply(mv.store, args); };
    mv.engine.addMirror = (...args: unknown[]) => { counts.addMirror++; return addMirror.apply(mv.engine, args); };
    try {
      for (let i = 0; i < 5; i++) {
        const E = mv.engine.engine;
        E.select_rect(i * 4, 0, 4, 4, 0); E.fill_selection(255, 0, 0, 255); E.select_none();
        mv.engine.commit();
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    } finally {
      delete mv.store.docPixels;
      delete mv.engine.addMirror;
    }
    return counts;
  });
  expect(churn).toEqual({ docPixels: 0, addMirror: 0 });
});

// ── Float in Window / Float All in Windows / Cascade in a browser (#477) ──
// On the desktop these pull documents out into OS windows (covered by
// scripts/native-webview-e2e.mjs). A browser tab has no windows to give them,
// so the three stay enabled and open the same live in-app views instead.
test("in a browser, the Float and Cascade entries fall back to the live in-app views", async ({ page }) => {
  await gotoApp(page);
  const a = await whiteDoc(page, "float-a.psd");
  const b = await whiteDoc(page, "float-b.psd");

  await arrange(page, "Float in Window");
  await expect(page.locator("[data-mv-secondview=single] [data-mv-pane]")).toHaveCount(1);
  await expect(page.locator(`[data-mv-pane="${b}"]`)).toHaveCount(1); // the active document
  await arrange(page, "Consolidate All to Tabs");
  await expect(page.locator("[data-mv-pane]")).toHaveCount(0);

  for (const item of ["Float All in Windows", "Cascade"]) {
    await arrange(page, item);
    await expect(page.locator("[data-mv-secondview=grid] [data-mv-pane]")).toHaveCount(2);
    await expect(page.locator(`[data-mv-pane="${a}"]`)).toHaveCount(1);
    await arrange(page, "Consolidate All to Tabs");
    await expect(page.locator("[data-mv-pane]")).toHaveCount(0);
  }
  // Nothing was floated: every document is still a tab.
  expect(await page.evaluate(() => (window as any).__mv.store.state.floatDocs)).toEqual([]);
});
