import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Blur ▸ Surface Blur ─────────────────────────
// Adobe spec (helpx / Photopea): an edge-preserving blur — it averages pixels
// within the Radius but only includes neighbours whose tone is within the
// Threshold of the centre, so similar-toned areas smooth while edges (and
// high-contrast features) stay sharp. The app had Gaussian/Box/Motion blur
// but no Surface Blur.
//
//   https://blog.photopea.com/surface-blur-and-median.html

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

async function fillDoc(page: Page, build: string) {
  await gotoApp(page);
  await page.evaluate((build) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "sfb");
    const E = mv.engine.engine; // capture AFTER newDocument
    // eslint-disable-next-line no-new-func
    new Function("E", build)(E);
    mv.engine.commit();
  }, build);
}

const fillRect = "const f=(x,y,w,h,v)=>{E.select_rect(x,y,w,h,0);E.fill_selection(v,v,v,255);E.select_none();};";

// ── Integration: a hard edge stays sharp ───────────────────────────
test("surface blur keeps a hard edge crisp", async ({ page }) => {
  await fillDoc(page, fillRect + "f(0,0,20,40,0); f(20,0,20,40,255);"); // black|white
  await page.evaluate(() => (window as any).__mv.fil.surfaceBlur(3, 30));
  expect(await lum(page, 19, 20)).toBeLessThan(8);    // dark side stays black
  expect(await lum(page, 20, 20)).toBeGreaterThan(247); // light side stays white
});

// ── Integration: smooths low-contrast, keeps high-contrast ─────────
test("surface blur smooths a low-contrast bump but keeps a high-contrast speck", async ({ page }) => {
  await fillDoc(page, fillRect + "f(0,0,40,40,100); f(10,20,1,1,110); f(30,20,1,1,255);");
  await page.evaluate(() => (window as any).__mv.fil.surfaceBlur(3, 30));
  expect(await lum(page, 10, 20)).toBeLessThan(105);     // 110 bump smoothed toward 100
  expect(await lum(page, 30, 20)).toBeGreaterThan(247);  // 255 speck preserved (excluded by threshold)
});

// ── Mouse + UI: the Surface Blur… dialog ───────────────────────────
test("the Filter ▸ Blur ▸ Surface Blur… dialog OK smooths the bump", async ({ page }) => {
  await fillDoc(page, fillRect + "f(0,0,40,40,100); f(20,20,1,1,110);");
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Surface Blur…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Threshold", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(200);
  expect(await lum(page, 20, 20)).toBeLessThan(105); // default radius 5 / threshold 15 smooths it
});
