import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Layer ▸ Layer Mask ▸ Hide All / Hide Selection ───────
// Adobe spec (helpx "Add layer masks"): Hide All adds a black mask that hides
// the whole layer; with an active selection, Hide Selection hides the selected
// area (black inside, white outside). The app had Reveal (Add Layer Mask) but
// no Hide.
//
//   https://helpx.adobe.com/photoshop/using/adding-layer-masks.html

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isRed = (p: number[]) => p[0] > 180 && p[2] < 90;
const isWhite = (p: number[]) => p[0] > 200 && p[1] > 200 && p[2] > 200;
const hasMask = (page: Page, id: number) => page.evaluate((id) => (window as any).__mv.engine.engine.layer_has_mask(id), id);

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

// white base + a fully-red top layer (active). Returns the top layer id.
async function redOverWhite(page: Page): Promise<number> {
  await gotoApp(page);
  return await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "hide");
    const E = mv.engine.engine; // capture AFTER newDocument
    const top = E.add_layer("red");
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(220, 20, 20, 255); E.select_none();
    mv.engine.commit();
    return top;
  });
}

// ── Integration: Hide All ──────────────────────────────────────────
test("hide all masks the whole layer (base shows through)", async ({ page }) => {
  const top = await redOverWhite(page);
  expect(isRed(await pixel(page, 20, 20))).toBe(true);
  await page.evaluate((id) => (window as any).__mv.store.addLayerMaskHidden(id), top);
  expect(await hasMask(page, top)).toBe(true);
  expect(isWhite(await pixel(page, 20, 20))).toBe(true); // red fully hidden
  expect(isWhite(await pixel(page, 5, 5))).toBe(true);
});

// ── Integration: Hide Selection ────────────────────────────────────
test("hide selection masks only the selected area", async ({ page }) => {
  const top = await redOverWhite(page);
  await page.evaluate((id) => {
    const mv = (window as any).__mv; const E = mv.engine.engine;
    E.select_rect(10, 10, 20, 20, 0); // centre
    mv.store.addLayerMaskHidden(id);
    E.select_none(); mv.engine.commit();
  }, top);
  expect(isWhite(await pixel(page, 20, 20))).toBe(true); // selected area hidden
  expect(isRed(await pixel(page, 5, 5))).toBe(true);     // outside still red
});

// ── Mouse + menu: Layer ▸ Hide Layer Mask ──────────────────────────
test("the Layer ▸ Hide Layer Mask menu item hides the layer", async ({ page }) => {
  const top = await redOverWhite(page);
  await openMenu(page, "Layer");
  expect(await clickMenuItem(page, "Hide Layer Mask")).toBe(true);
  await page.waitForTimeout(120);
  expect(await hasMask(page, top)).toBe(true);
  expect(isWhite(await pixel(page, 20, 20))).toBe(true);
});
