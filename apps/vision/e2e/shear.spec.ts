import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Distort ▸ Shear ─────────────────────────────
// Adobe spec (helpx "Distort filters"): Shear "distorts an image along a
// curve." Each row is displaced horizontally by the curve, and an Undefined
// Areas option fills the strip left behind (Wrap Around / Repeat Edge Pixels).
// We model the default 2-point curve as a linear top→bottom offset, so a
// vertical line becomes a slanted one.
//
//   https://helpx.adobe.com/photoshop/using/distort-filters.html

async function lineX(page: Page, y: number): Promise<number> {
  return await page.evaluate((y) => {
    const E = (window as any).__mv.engine.engine;
    let bx = 0, bl = 256;
    for (let x = 0; x < 40; x++) { const l = ((E.pick_color(x, y) >>> 0) >>> 24) & 255; if (l < bl) { bl = l; bx = x; } }
    return bx;
  }, y);
}
async function rgb(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}

async function openMenu(page: Page, top: string) {
  await page.getByText(top, { exact: true }).first().click();
  await page.waitForTimeout(150);
}
async function clickMenuItem(page: Page, label: string) {
  const ok = await page.evaluate(async (label) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const labelOf = (e: Element) => (((e.querySelector(".monet-menu-label") || {}) as HTMLElement).textContent || "").trim();
    const findLeaf = () => [...document.querySelectorAll(".monet-menu-item")]
      .find((e) => e.getAttribute("aria-haspopup") !== "menu" && labelOf(e) === label) as HTMLElement | undefined;
    const openSub = (e: Element) => {
      e.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      e.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
    };
    const seen = new Set<Element>();
    const visit = async (): Promise<boolean> => {
      const hit = findLeaf();
      if (hit) { hit.click(); return true; }
      for (const s of [...document.querySelectorAll('.monet-menu-item[aria-haspopup="menu"]')]) {
        if (seen.has(s)) continue;
        seen.add(s);
        openSub(s);
        await sleep(45);
        if (await visit()) return true;
      }
      return false;
    };
    return await visit();
  }, label);
  await page.waitForTimeout(120);
  return ok;
}

// white 40×40 with a 1px black vertical line at x=20.
async function vlineDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "shear");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_rect(20, 0, 1, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: a vertical line is slanted ────────────────────────
test("shear slants a vertical line, shifting the top and leaving the bottom", async ({ page }) => {
  await vlineDoc(page);
  await page.evaluate(() => (window as any).__mv.distort.shear(8, 0, false)); // +8 at top, 0 at bottom
  expect(await lineX(page, 0)).toBe(28);  // top row shifted right by 8
  expect(await lineX(page, 39)).toBe(20); // bottom row unmoved
  expect(await lineX(page, 0)).toBeGreaterThan(await lineX(page, 39)); // leans right at the top
});

// ── Integration: Undefined Areas — wrap vs repeat ──────────────────
test("shear wrap pulls in the opposite edge, repeat clones the near edge", async ({ page }) => {
  // black field with a red left edge and a green right edge.
  const setup = async () => {
    await gotoApp(page);
    await page.evaluate(() => {
      const mv = (window as any).__mv;
      mv.store.newDocument(40, 40, "shear2");
      const E = mv.engine.engine;
      E.select_rect(0, 0, 40, 40, 0); E.fill_selection(0, 0, 0, 255);
      E.select_rect(0, 0, 1, 40, 0); E.fill_selection(255, 0, 0, 255);
      E.select_rect(39, 0, 1, 40, 0); E.fill_selection(0, 255, 0, 255);
      E.select_none();
      mv.engine.commit();
    });
  };
  await setup();
  await page.evaluate(() => (window as any).__mv.distort.shear(8, 8, false)); // repeat edge
  expect(await rgb(page, 7, 5)).toEqual([255, 0, 0]); // strip repeats the left (red) edge
  await setup();
  await page.evaluate(() => (window as any).__mv.distort.shear(8, 8, true)); // wrap around
  expect(await rgb(page, 7, 5)).toEqual([0, 255, 0]); // strip wraps in the right (green) edge
});

// ── Mouse + UI: the Filter ▸ Distort ▸ Shear… dialog ───────────────
test("the Filter ▸ Distort ▸ Shear… dialog offsets slant the line", async ({ page }) => {
  await vlineDoc(page);
  await openMenu(page, "Filter");
  await page.getByText("Distort", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Shear…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Top Offset" }).fill("8");
  await page.getByRole("spinbutton", { name: "Bottom Offset" }).fill("0");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(200);
  expect(await lineX(page, 0)).toBe(28);
  expect(await lineX(page, 39)).toBe(20);
});
