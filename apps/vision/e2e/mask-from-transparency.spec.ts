import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Layer ▸ Layer Mask ▸ From Transparency ───────────────
// Adobe spec (helpx "Add layer masks"): creates a layer mask from the layer's
// transparency — the alpha becomes the mask and the layer is made opaque, so
// the composite is unchanged but the transparency is now an editable mask. The
// app had Add/Apply/Delete Layer Mask but not From Transparency.
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
const isBlack = (p: number[]) => p[0] < 30 && p[1] < 30 && p[2] < 30;
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

// white base + a top layer: red square [10,30)×[10,30), transparent elsewhere.
// Returns the top layer id.
async function setup(page: Page): Promise<number> {
  await gotoApp(page);
  return await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "mft");
    const E = mv.engine.engine; // capture AFTER newDocument
    const top = E.add_layer("top");
    E.select_rect(10, 10, 20, 20, 0); E.fill_selection(220, 20, 20, 255); E.select_none();
    mv.engine.commit();
    return top;
  });
}

// ── Integration: composite unchanged, mask created ─────────────────
test("from transparency creates a mask and keeps the composite", async ({ page }) => {
  const top = await setup(page);
  expect(isRed(await pixel(page, 20, 20))).toBe(true);
  expect(isWhite(await pixel(page, 5, 5))).toBe(true);
  await page.evaluate((id) => (window as any).__mv.store.maskFromTransparency(id), top);
  expect(await hasMask(page, top)).toBe(true);
  expect(isRed(await pixel(page, 20, 20))).toBe(true);   // composite unchanged…
  expect(isWhite(await pixel(page, 5, 5))).toBe(true);   // …base still shows through the mask
});

// ── Integration: the layer became opaque (alpha moved to the mask) ─
test("the layer is opaque after the transparency moves to the mask", async ({ page }) => {
  const top = await setup(page);
  await page.evaluate((id) => {
    const mv = (window as any).__mv;
    mv.store.maskFromTransparency(id);
    mv.store.deleteLayerMask(id); // drop the mask → the opaque layer shows everywhere
  }, top);
  expect(isBlack(await pixel(page, 5, 5))).toBe(true); // once-transparent area is now the layer's black pixels
});

// ── Mouse + menu: Layer ▸ Layer Mask From Transparency ─────────────
test("the Layer Mask From Transparency menu item creates the mask", async ({ page }) => {
  const top = await setup(page);
  await openMenu(page, "Layer");
  expect(await clickMenuItem(page, "Layer Mask From Transparency")).toBe(true);
  await page.waitForTimeout(120);
  expect(await hasMask(page, top)).toBe(true);
  expect(isRed(await pixel(page, 20, 20))).toBe(true);
  expect(isWhite(await pixel(page, 5, 5))).toBe(true);
});
