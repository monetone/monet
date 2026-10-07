import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Window ▸ Clone Source (#427) ─────────────────────────
// Adobe spec (helpx "Retouch and repair photos" / Clone Source panel): the
// panel keeps five sources for the Clone Stamp and Healing Brush, a source can
// come from any open document, each carries its own W/H scale, angle and flips
// (Reset Transform restores them), and Show Overlay draws the source under the
// brush at the chosen opacity.
//
//   https://helpx.adobe.com/photoshop/using/retouching-repairing-images.html

const DOCW = 200;
const DOCH = 140;
// 5 vertical bands, 40px each: red·green·blue·yellow·magenta.
const BANDS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255]];
type DocMap = { cx: (d: number) => number; cy: (d: number) => number };

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}

const slotRadios = (page: Page) => page.getByRole("radiogroup", { name: "Clone sources", exact: true });

async function openPanel(page: Page) {
  await page.evaluate(() => (window as any).__mv.store.getWorkspace().openPanel("clonesource"));
  await expect(slotRadios(page)).toBeVisible();
}

// Fit the active document, wait until the canvas is drawn at that zoom, and
// map document pixels to the screen.
async function canvasMap(page: Page): Promise<DocMap> {
  await page.evaluate(() => (window as any).__mv.store.fit());
  const measure = () => page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    const r = (Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[])
      .map((c) => c.getBoundingClientRect())
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height, docW: s.doc.width, docH: s.doc.height, zoom: s.zoom };
  });
  await expect.poll(async () => {
    const b = await measure();
    return b.zoom > 1.5 && Math.abs(b.w - b.docW * b.zoom) < 1;
  }).toBe(true);
  const b = await measure();
  return { cx: (d) => b.x + d * b.w / b.docW, cy: (d) => b.y + d * b.h / b.docH };
}

// The panel open, then a fresh banded document with the Clone Stamp armed.
async function banded(page: Page): Promise<DocMap> {
  await gotoApp(page);
  await openPanel(page);
  await page.evaluate(({ w, h, bands }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "bands");
    const E = mv.engine.engine; // AFTER newDocument — it swaps the engine instance
    for (let i = 0; i < bands.length; i++) {
      E.select_rect(i * 40, 0, 40, h, 0);
      E.fill_selection(bands[i][0], bands[i][1], bands[i][2], 255);
    }
    E.select_none();
    mv.engine.commit();
    mv.store.setTool("clone");
    mv.store.setBrush({ size: 40 });
  }, { w: DOCW, h: DOCH, bands: BANDS });
  return canvasMap(page);
}

async function altClick(page: Page, m: DocMap, x: number, y: number) {
  await page.keyboard.down("Alt");
  await page.mouse.move(m.cx(x), m.cy(y));
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("Alt");
}

// A single clone dab at (x,y) — a clone stroke is painted on pointer-down.
async function dab(page: Page, m: DocMap, x: number, y: number) {
  await page.mouse.move(m.cx(x), m.cy(y));
  await page.mouse.down();
  await page.mouse.up();
}

const isRed = ([r, g, b]: number[]) => r > 200 && g < 80 && b < 80;
const isGreen = ([r, g, b]: number[]) => g > 200 && r < 80 && b < 80;
const isBlue = ([r, g, b]: number[]) => b > 200 && r < 80 && g < 80;
const transform = (page: Page) => page.evaluate(() => {
  const s = (window as any).__mv.store.state;
  return s.cloneSources[s.cloneSourceSlot].transform;
});

test("Window ▸ Clone Source opens the panel from a workspace saved before it existed", async ({ page }) => {
  await gotoApp(page);
  const layout = await page.evaluate(() => (window as any).__mv.store.getWorkspace().getLayout());
  expect(JSON.stringify(layout)).not.toContain("clonesource");
  await page.evaluate((saved) => localStorage.setItem("mv.workspaceLast", JSON.stringify(saved)), layout);
  await page.reload();
  await gotoApp(page);
  await expect(slotRadios(page)).toHaveCount(0);

  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page.getByRole("menuitem", { name: "Clone Source", exact: true }).click();
  await expect(slotRadios(page)).toBeVisible();
  await expect(slotRadios(page).getByRole("radio")).toHaveCount(5);
  for (const name of ["Source width (%)", "Source height (%)", "Source angle (°)", "Overlay opacity (%)"]) {
    await expect(page.getByRole("textbox", { name, exact: true })).toBeVisible();
  }
  for (const name of ["Flip Horizontal", "Flip Vertical", "Reset Transform"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("checkbox", { name: "Show Overlay", exact: true })).toBeVisible();

  // The slots are one radio group: arrow keys move the selection.
  await slotRadios(page).getByRole("radio", { name: "1", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(slotRadios(page).getByRole("radio", { name: "2", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.cloneSourceSlot)).toBe(1);
});

test("each slot keeps its own sampled point", async ({ page }) => {
  const m = await banded(page);
  await altClick(page, m, 20, 70); // slot 1 ← red
  await slotRadios(page).getByRole("radio", { name: "2", exact: true }).click();
  await altClick(page, m, 100, 70); // slot 2 ← blue
  await dab(page, m, 180, 70);
  expect(isBlue(await pixel(page, 180, 70))).toBe(true);

  await slotRadios(page).getByRole("radio", { name: "1", exact: true }).click();
  await dab(page, m, 140, 70);
  expect(isRed(await pixel(page, 140, 70))).toBe(true);
});

test("the slot's flip, scale and reset change what the brush samples, and bad input is refused", async ({ page }) => {
  const m = await banded(page);
  // Source x=75 (the Alt-click lands mid-pixel), 5px left of the green|blue
  // boundary at x=80. Aligned keeps the anchor at the first dab (180,70), so
  // dest x=186 is 6px right of it:
  //   identity → source 81 (blue) · flipped → ~69 (green) · W 200% → ~78 (green)
  await altClick(page, m, 75.5, 70);
  const flip = page.getByRole("button", { name: "Flip Horizontal", exact: true });
  await flip.click();
  await expect(flip).toHaveAttribute("aria-pressed", "true");
  await dab(page, m, 180, 70);
  expect(isGreen(await pixel(page, 186, 70))).toBe(true);

  await page.getByRole("button", { name: "Reset Transform", exact: true }).click();
  await expect(flip).toHaveAttribute("aria-pressed", "false");
  await dab(page, m, 180, 70);
  expect(isBlue(await pixel(page, 186, 70))).toBe(true);

  const width = page.getByRole("textbox", { name: "Source width (%)", exact: true });
  await width.fill("200");
  await width.press("Enter");
  await expect.poll(async () => (await transform(page)).w).toBe(200);
  await dab(page, m, 180, 70);
  expect(isGreen(await pixel(page, 186, 70))).toBe(true);

  // Out of range: an alert says what is allowed, and nothing changes.
  await width.fill("0");
  await width.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Width must be a number from 1% to 1000%." })).toBeVisible();
  expect((await transform(page)).w).toBe(200);
  await expect(width).toHaveValue("200");

  // Escape drops a typed edit without applying it, even when focus then leaves.
  await width.fill("350");
  await width.press("Escape");
  await expect(width).toHaveValue("200");
  await width.blur();
  expect((await transform(page)).w).toBe(200);
});

test("Show Overlay draws the source under the brush at the chosen opacity", async ({ page }) => {
  const m = await banded(page);
  await altClick(page, m, 100, 70); // blue
  const show = page.getByRole("checkbox", { name: "Show Overlay", exact: true });
  await show.click();
  await expect(show).toHaveAttribute("aria-checked", "true");
  const opacity = page.getByRole("textbox", { name: "Overlay opacity (%)", exact: true });
  await opacity.fill("50");
  await opacity.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.cloneOverlay.opacity)).toBe(50);

  const overlayAt = (x: number, y: number) => page.evaluate(({ x, y }) => {
    const cv = document.querySelector("[data-mv-clone-overlay]") as HTMLCanvasElement;
    return Array.from(cv.getContext("2d")!.getImageData(x, y, 1, 1).data);
  }, { x, y });
  await page.mouse.move(m.cx(176), m.cy(70));
  await page.mouse.move(m.cx(180), m.cy(70)); // hover only: over magenta, the overlay shows the blue source
  await expect(page.locator('[data-mv-clone-overlay="1"]')).toHaveCount(1);
  await expect.poll(async () => {
    const [r, g, b, a] = await overlayAt(180, 70);
    return b > 200 && r < 40 && g < 40 && a > 115 && a < 140;
  }).toBe(true);
  expect((await overlayAt(180, 100))[3], "clipped to the 40px brush").toBe(0);
  expect(isBlue(await pixel(page, 180, 70)), "the overlay is not paint").toBe(false);

  await show.click();
  await expect.poll(async () => (await overlayAt(180, 70))[3]).toBe(0);
});

test("a slot samples another open document for one stroke at a time, until that document closes", async ({ page }) => {
  await gotoApp(page);
  await openPanel(page);
  const solid = (name: string, rgb: number[]) => page.evaluate(({ name, rgb }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 80, name);
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(rgb[0], rgb[1], rgb[2], 255);
    E.select_none();
    mv.engine.commit();
    mv.store.setTool("clone");
    mv.store.setBrush({ size: 20 });
    return mv.store.state.activeDocId as number;
  }, { name, rgb });
  const activate = async (id: number) => {
    await page.evaluate((id) => (window as any).__mv.store.activateDoc(id), id);
    return canvasMap(page);
  };
  const a = await solid("A.psd", [255, 0, 0]);
  const b = await solid("B.psd", [0, 255, 0]);
  const readout = page.locator("[data-mv-clone-source-readout]");

  let m = await activate(a);
  await altClick(page, m, 60, 40); // slot 1 ← red, in A
  m = await activate(b);
  await expect(readout).toHaveText(/^A\.psd · /);
  await dab(page, m, 30, 40);
  expect(isRed(await pixel(page, 30, 40)), "B painted from A").toBe(true);

  // The next stroke from a B slot reads B again — A's pixels were for one stroke.
  await slotRadios(page).getByRole("radio", { name: "2", exact: true }).click();
  await altClick(page, m, 90, 40);
  await dab(page, m, 30, 40);
  expect(isGreen(await pixel(page, 30, 40))).toBe(true);

  await activate(a);
  expect(isRed(await pixel(page, 60, 40)), "the source document is untouched").toBe(true);
  await page.evaluate((id) => (window as any).__mv.store.closeDoc(id), a);
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.activeDocId)).toBe(b);
  m = await canvasMap(page);

  // Closing A empties its slot: a stroke there has nothing to sample (#485).
  await slotRadios(page).getByRole("radio", { name: "1", exact: true }).click();
  await expect(readout).toContainText("Empty");
  const depth = () => page.evaluate(() => (window as any).__mv.engine.engine.undo_depth());
  const before = await depth();
  await dab(page, m, 30, 40);
  expect(await depth()).toBe(before);
  expect(isGreen(await pixel(page, 30, 40))).toBe(true);
});
