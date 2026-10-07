import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Noise ▸ Reduce Noise (Basic mode) ───────────
// Adobe's Basic mode exposes four controls: Strength, Preserve Details,
// Reduce Color Noise and Sharpen Details. Monet shipped only Strength +
// Reduce Color Noise; this adds the missing two:
//   • Preserve Details — blends the original high-frequency detail back
//     into the denoised result (0 = full smoothing, 100 = keep detail).
//   • Sharpen Details — an unsharp pass that restores edge contrast lost
//     to denoising.
//
//   https://helpx.adobe.com/photoshop/using/reducing-image-noise.html

const D = 32;

async function red(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255, { x, y });
}

// Variance of the red channel across one horizontal row — a measure of how
// much high-frequency stripe detail survives.
async function rowVariance(page: Page, y: number): Promise<number> {
  return await page.evaluate(({ y, d }) => {
    const E = (window as any).__mv.engine.engine;
    const vals: number[] = [];
    for (let x = 0; x < d; x++) vals.push((((E.pick_color(x, y) >>> 0) >>> 24) & 255));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  }, { y, d: D });
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

// Vertical 1px stripes 100/150 — a moderate-contrast high-frequency signal
// the bilateral denoise flattens and Preserve Details protects.
async function stripesDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "reduce-noise");
    const E = mv.engine.engine; // capture AFTER newDocument
    for (let x = 0; x < d; x++) {
      E.select_rect(x, 0, 1, d, 0);
      const v = x % 2 === 0 ? 100 : 150;
      E.fill_selection(v, v, v, 255);
    }
    E.select_none();
    mv.engine.commit();
  }, D);
}

// Left|right split: dark 100 (cols 0..15) | light 160 (cols 16..31) with a
// hard vertical seam at x = D/2.
async function splitDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "reduce-noise");
    const E = mv.engine.engine;
    E.select_rect(0, 0, d / 2, d, 0); E.fill_selection(100, 100, 100, 255);
    E.select_rect(d / 2, 0, d / 2, d, 0); E.fill_selection(160, 160, 160, 255);
    E.select_none();
    mv.engine.commit();
  }, D);
}

// ── Strength smooths high-frequency noise ──────────────────────────
test("Strength flattens high-frequency stripes", async ({ page }) => {
  await stripesDoc(page);
  const before = await rowVariance(page, 16);
  await page.evaluate(() => (window as any).__mv.fil.reduceNoise(1, 0, 0, 0));
  const after = await rowVariance(page, 16);
  expect(after).toBeLessThan(before); // denoise averages adjacent columns
});

// ── Preserve Details retains detail the denoise would erase ─────────
test("Preserve Details keeps more stripe detail than plain denoise", async ({ page }) => {
  await stripesDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.reduceNoise(1, 0, 0, 0));
  const plain = await rowVariance(page, 16);
  await stripesDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.reduceNoise(1, 0, 0.9, 0));
  const preserved = await rowVariance(page, 16);
  expect(preserved).toBeGreaterThan(plain); // preserve blends the original back
});

// ── Sharpen Details overshoots the edge ────────────────────────────
test("Sharpen Details increases edge contrast at the seam", async ({ page }) => {
  await splitDoc(page);
  await page.evaluate(() => (window as any).__mv.fil.reduceNoise(1, 0, 0, 1));
  // seam at x=16: first light column overshoots above 160, last dark column
  // undershoots below 100.
  expect(await red(page, 16, 16)).toBeGreaterThan(160);
  expect(await red(page, 15, 16)).toBeLessThan(100);
});

// ── Mouse + UI: the Filter ▸ Noise ▸ Reduce Noise… dialog ──────────
test("the Reduce Noise… dialog exposes Preserve Details + Sharpen Details", async ({ page }) => {
  await stripesDoc(page);
  await openMenu(page, "Filter");
  await page.getByText("Noise", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Reduce Noise…")).toBe(true);
  await page.waitForTimeout(200);
  await expect(page.getByText("Preserve Details", { exact: true })).toBeVisible(); // new control
  await expect(page.getByText("Sharpen Details", { exact: true })).toBeVisible();  // new control
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
});
