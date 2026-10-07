import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Edit ▸ Fade (⇧⌘F) ────────────────────────────────────
// Adobe spec (helpx "Fade the effect of a filter/adjustment"): immediately
// after a filter, painting or adjustment, Edit ▸ Fade blends the result back
// toward the pre-op state at an Opacity and blend Mode. The app had no Fade.
//
//   https://helpx.adobe.com/photoshop/using/applying-filters.html

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

// gray-100 doc, then Invert (→155), so the pre-op state is 100.
async function invertedGray(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "fade");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 20, 20, 0); E.fill_selection(100, 100, 100, 255); E.select_none();
    mv.engine.commit();
    mv.adj.invert(); // 100 → 155
  });
}

// ── Integration: fade 50% is halfway back ──────────────────────────
test("fade 50% blends halfway between the original and the result", async ({ page }) => {
  await invertedGray(page);
  expect(await lum(page, 10, 10)).toBe(155);
  await page.evaluate(() => (window as any).__mv.store.fadeLast(0.5, "normal"));
  const v = await lum(page, 10, 10);
  expect(v).toBeGreaterThanOrEqual(127); expect(v).toBeLessThanOrEqual(129); // ≈ 128
});

// ── Integration: fade 0% restores the original ─────────────────────
test("fade 0% restores the pre-op state", async ({ page }) => {
  await invertedGray(page);
  await page.evaluate(() => (window as any).__mv.store.fadeLast(0, "normal"));
  expect(await lum(page, 10, 10)).toBe(100);
});

// ── Mouse + UI: the Fade… dialog Opacity field ─────────────────────
test("the Edit ▸ Fade… dialog with 50% opacity fades the result", async ({ page }) => {
  await invertedGray(page);
  await openMenu(page, "Edit");
  expect(await clickMenuItem(page, "Fade…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Opacity" }).fill("50");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  const v = await lum(page, 10, 10);
  expect(v).toBeGreaterThanOrEqual(127); expect(v).toBeLessThanOrEqual(129);
});

// ── Keyboard: ⇧⌘F opens Fade ───────────────────────────────────────
test("⇧⌘F opens the Fade dialog", async ({ page }) => {
  await invertedGray(page);
  await page.keyboard.press("Meta+Shift+KeyF");
  await expect(page.getByText("Fade", { exact: true })).toBeVisible();
});
