import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Stylize ▸ Emboss ────────────────────────────
// PS Emboss has Angle (-360°..360°), Height (1..100px), and Amount
// (1%..500%). The engine stores Amount as a 0.01..5 multiplier.
//   https://helpx.adobe.com/photoshop/using/stylize-filters.html

const D = 24;

async function red(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255, { x, y });
}

// Vertical black|white edge at x = D/2.
async function splitDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "emboss");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, d / 2, d, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(d / 2, 0, d / 2, d, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
  }, D);
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

// ── Height widens the relief reach ─────────────────────────────────
test("Height widens the relief reach", async ({ page }) => {
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.emboss(0, 1.0, 1)); // angle 0, height 1
  expect(Math.abs((await red(page, 10, 12)) - 128)).toBeLessThanOrEqual(6); // 2px from edge → flat grey
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.emboss(0, 1.0, 3)); // height 3
  expect(await red(page, 10, 12)).toBeLessThan(40); // neighbour now lands on white → dark relief
});

// ── Emboss: flat regions go neutral grey, edges become relief ──────
test("emboss renders flat areas grey and edges as relief", async ({ page }) => {
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.emboss(0, 1.0, 1));
  expect(Math.abs((await red(page, 4, 12)) - 128)).toBeLessThanOrEqual(6); // deep black interior → grey
  expect(await red(page, 11, 12)).toBeLessThan(60); // black|white edge → dark relief
});

// ── Mouse + UI: the Emboss dialog exposes Photoshop's full ranges ──
test("the Filter ▸ Stylize ▸ Emboss… dialog exposes the documented ranges", async ({ page }) => {
  await splitDoc(page);
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Emboss…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Height", { exact: true }).first()).toBeVisible();
  const angle = page.locator(".monet-row").filter({ hasText: "Angle" }).first();
  await angle.getByRole("slider").press("Home");
  await expect(angle).toContainText("-360°");
  await angle.getByRole("slider").press("End");
  await expect(angle).toContainText("360°");
  const amount = page.locator(".monet-row").filter({ hasText: "Amount" }).first();
  await amount.getByRole("slider").press("Home");
  await expect(amount).toContainText("1%");
  await amount.getByRole("slider").press("End");
  await expect(amount).toContainText("500%");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
});
