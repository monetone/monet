import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Layer ▸ Matting ▸ Defringe ───────────────────────────
// Adobe spec (helpx "Remove fringe pixels"): Defringe "replaces the color of any
// edge pixels with the colors of nearby pixels containing pure colors (those
// without background color)", removing a halo left around a layer's edges.
// Controlled by Width.
//
//   https://helpx.adobe.com/photoshop/using/defringing-selections.html

async function rgb(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}
const isRed = (p: number[]) => p[0] > 200 && p[1] < 60 && p[2] < 60;
const isGreen = (p: number[]) => p[1] > 200 && p[0] < 60 && p[2] < 60;

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

// a red square on a transparent layer (white base hidden), with a green left
// edge — the contaminating fringe.
async function fringedSquare(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "defr");
    const E = mv.engine.engine; // capture AFTER newDocument
    const base = E.active_layer_id();
    E.add_layer("content");
    E.set_layer_visible(base, false); // hide the white base → real transparency
    E.select_rect(10, 10, 20, 20, 0); E.fill_selection(255, 0, 0, 255); // red square
    E.select_none();
    E.select_rect(10, 10, 1, 20, 0); E.fill_selection(0, 255, 0, 255); // green left edge
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: the fringe is replaced by the interior colour ─────
test("defringe replaces the green edge with the interior red", async ({ page }) => {
  await fringedSquare(page);
  expect(isGreen(await rgb(page, 10, 20))).toBe(true); // fringe before
  await page.evaluate(() => (window as any).__mv.store.defringe(1));
  expect(isRed(await rgb(page, 10, 20))).toBe(true);   // edge bled to red
  expect(isRed(await rgb(page, 20, 20))).toBe(true);   // interior unchanged
  expect((await rgb(page, 2, 2))[3]).toBe(0);          // outside stays transparent
});

// ── Mouse + UI: the Layer ▸ Defringe… dialog ───────────────────────
test("the Layer ▸ Defringe… dialog OK defringes the layer", async ({ page }) => {
  await fringedSquare(page);
  await openMenu(page, "Layer");
  expect(await clickMenuItem(page, "Defringe…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "OK", exact: true }).click(); // default Width 1
  await page.waitForTimeout(150);
  expect(isRed(await rgb(page, 10, 20))).toBe(true);
});
