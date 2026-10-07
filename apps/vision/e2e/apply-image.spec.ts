import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Image ▸ Apply Image ──────────────────────────────────
// Adobe spec (helpx "Blend layers and channels with Apply Image"): blends one
// layer (the source) with the active layer (the target) using a blending mode
// and opacity, optionally inverting the source. The result replaces the target.
//
//   https://helpx.adobe.com/photoshop/using/blending-modes.html

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isBlue = (p: number[]) => p[2] > 250 && p[0] < 8 && p[1] < 8;
const isRed = (p: number[]) => p[0] > 250 && p[1] < 8 && p[2] < 8;

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

// a blue Background (the source) under an opaque red active layer (the target).
async function blueUnderRed(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "ai");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(0, 0, 255, 255); E.select_none(); // bg → blue (source)
    E.add_layer("Layer 1"); // target, active, on top
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(255, 0, 0, 255); E.select_none(); // red
    mv.engine.commit();
  });
}

// ── Integration: Normal full-opacity replaces the target with the source ──
test("apply image replaces the red target with the blue source", async ({ page }) => {
  await blueUnderRed(page);
  expect(isRed(await pixel(page, 20, 20))).toBe(true); // target before
  const src = await page.evaluate(() => { const E = (window as any).__mv.engine.engine; return E.layer_id_at(E.layer_count() - 1); }); // bottom = blue source
  await page.evaluate((src) => (window as any).__mv.store.applyImage(src, "normal", 100, false), src);
  expect(isBlue(await pixel(page, 20, 20))).toBe(true); // target replaced by the source
});

// ── Mouse + UI: the Image ▸ Apply Image… dialog ────────────────────
test("the Image ▸ Apply Image… dialog blends the source onto the target", async ({ page }) => {
  await blueUnderRed(page);
  await openMenu(page, "Image");
  expect(await clickMenuItem(page, "Apply Image…")).toBe(true);
  await page.waitForTimeout(200);
  // only one other layer (the blue Background) → it is the default source
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(isBlue(await pixel(page, 20, 20))).toBe(true);
});
