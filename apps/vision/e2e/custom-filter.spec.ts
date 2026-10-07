import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Other ▸ Custom ──────────────────────────────
// Adobe spec (helpx "Other filters"): Custom designs your own convolution —
// a 5×5 matrix of weights, a Scale (divides the weighted sum), and an Offset
// (added to the result). Output = offset + Σ(weight·neighbour) / scale. The
// app had Offset/Maximum/Minimum/High Pass but no Custom.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

const ident = () => { const k = Array(25).fill(0); k[12] = 1; return k; };

async function lum(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24 & 255, { x, y });
}
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
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

async function grayDoc(page: Page, v: number) {
  await gotoApp(page);
  await page.evaluate(({ v }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(60, 60, "custom");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, 60, 60, 0); E.fill_selection(v, v, v, 255); E.select_none();
    mv.engine.commit();
  }, { v });
}

// ── Integration: identity is a no-op ───────────────────────────────
test("an identity kernel leaves the image unchanged", async ({ page }) => {
  await grayDoc(page, 123);
  await page.evaluate((k) => (window as any).__mv.fil.custom(k, 1, 0), ident());
  expect(await lum(page, 30, 30)).toBe(123);
});

// ── Integration: a shift kernel translates the image ───────────────
test("a shift kernel moves the image", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "customs");
    const E = mv.engine.engine;
    E.select_rect(10, 10, 5, 5, 0); E.fill_selection(220, 20, 20, 255); E.select_none(); // red [10,15)
    mv.engine.commit();
  });
  // k[10]=1 → reads src(x−2,y): shift right by 2
  const k = Array(25).fill(0); k[10] = 1;
  await page.evaluate((k) => (window as any).__mv.fil.custom(k, 1, 0), k);
  const red = (p: number[]) => p[0] > 180 && p[2] < 90;
  expect(red(await pixel(page, 14, 12))).toBe(true);  // red moved to ≈[12,17)
  expect(red(await pixel(page, 11, 12))).toBe(false);  // old left column vacated
});

// ── Mouse + UI: the Custom… dialog Offset field ────────────────────
test("setting Offset in the Custom… dialog brightens the image", async ({ page }) => {
  await grayDoc(page, 100);
  await openMenu(page, "Filter");
  await page.getByText("Other", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Custom…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Offset" }).fill("60");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await lum(page, 30, 30)).toBe(160); // 100 + offset 60, identity kernel
});

// ── Mouse + UI: the Scale field divides ────────────────────────────
test("setting Scale in the Custom… dialog halves the brightness", async ({ page }) => {
  await grayDoc(page, 200);
  await openMenu(page, "Filter");
  await page.getByText("Other", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Custom…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Scale" }).fill("2");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await lum(page, 30, 30)).toBe(100); // 200 / scale 2 (identity centre 1)
});
