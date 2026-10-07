import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Image ▸ Adjustments ▸ Replace Color ──────────────────
// Adobe spec (helpx "Replace the color of objects"): builds a soft mask of
// pixels near a sampled colour (Fuzziness), then shifts their Hue/Saturation/
// Lightness — recolouring just that colour while leaving the rest. The app had
// Hue/Saturation but no Replace Color.
//
//   https://helpx.adobe.com/photoshop/using/replacing-object-colors.html

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isGreen = (p: number[]) => p[1] > 200 && p[0] < 60 && p[2] < 60;
const isBlue = (p: number[]) => p[2] > 200 && p[0] < 60 && p[1] < 60;

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

// red left / blue right, with the foreground set to red (the replace target).
async function redBlue(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "rc");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(255, 0, 0, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(0, 0, 255, 255);
    E.select_none();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red target
    mv.engine.commit();
  });
}

// ── Integration: recolours the target, leaves the rest ─────────────
test("replace color shifts the red to green and leaves blue alone", async ({ page }) => {
  await redBlue(page);
  await page.evaluate(() => (window as any).__mv.store.replaceColor(120, 120, 0, 0)); // fuzz 120, hue +120
  expect(isGreen(await pixel(page, 5, 20))).toBe(true);  // red → green
  expect(isBlue(await pixel(page, 35, 20))).toBe(true);  // blue untouched
});

// ── Mouse + UI: the Replace Color… dialog ──────────────────────────
test("the Replace Color… dialog Fuzziness/Hue fields recolour the red", async ({ page }) => {
  await redBlue(page);
  await openMenu(page, "Image");
  expect(await clickMenuItem(page, "Replace Color…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Fuzziness" }).fill("120");
  await page.getByRole("spinbutton", { name: "Hue" }).fill("120");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(isGreen(await pixel(page, 5, 20))).toBe(true);
  expect(isBlue(await pixel(page, 35, 20))).toBe(true);
});
