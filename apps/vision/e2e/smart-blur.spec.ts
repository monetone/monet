import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Blur ▸ Smart Blur ───────────────────────────
// Adobe spec (helpx "Blur filters"): Smart Blur "precisely blurs an image." You
// set a Radius, Threshold, and blur Quality, plus a Mode: Normal (whole selection), Edge Only
// (renders the edges of the colour transitions), or Overlay Edge (applies the
// edges in white over the blur).
//
//   https://helpx.adobe.com/photoshop/using/blur-gallery.html

async function lum(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24 & 255, { x, y });
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

// 40×40: left half black, right half white (one sharp edge at x=20).
async function splitDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "smart");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: Edge Only renders white edges on black ────────────
test("smart blur edge-only draws white edges on a black field", async ({ page }) => {
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.smartBlur(2, 30, 1)); // Edge Only
  expect(await lum(page, 19, 20)).toBe(255); // the boundary is a white edge
  expect(await lum(page, 5, 20)).toBe(0);    // flat areas go black
  expect(await lum(page, 35, 20)).toBe(0);
});

// ── Mouse + UI: the Filter ▸ Smart Blur… dialog (Edge Only) ─────────
test("the Filter ▸ Smart Blur… dialog Edge Only mode draws the edges", async ({ page }) => {
  await splitDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Smart Blur…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Low", { exact: true })).toBeVisible();
  await expect(page.getByText("Medium", { exact: true })).toBeVisible();
  await expect(page.getByText("High", { exact: true })).toBeVisible();
  await page.getByText("Edge Only", { exact: true }).click(); // pick the mode
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await lum(page, 19, 20)).toBe(255);
  expect(await lum(page, 5, 20)).toBe(0);
});
