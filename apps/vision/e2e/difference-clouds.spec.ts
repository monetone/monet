import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Filter ▸ Render ▸ Difference Clouds ──────────────────
// Adobe spec (helpx "Render filters"): like Clouds, but blends the generated
// cloud data with the EXISTING pixels using Difference — so the result depends
// on what's already on the layer (apply repeatedly to grow marble veins). The
// app had Clouds but not Difference Clouds.
//
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

// fill the active doc grey `v`, then render difference clouds; return a few
// luminances. A fresh doc has the same RNG seed, so the cloud is identical.
async function fillAndDiff(page: Page, v: number): Promise<number[]> {
  return await page.evaluate((v) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "dc");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 32, 32, 0); E.fill_selection(v, v, v, 255); E.select_none();
    mv.engine.commit();
    mv.fil.differenceClouds();
    return [[3, 3], [15, 9], [20, 25], [30, 30]].map(([x, y]) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
  }, v);
}

async function lumRange(page: Page): Promise<{ min: number; max: number }> {
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    let min = 255, max = 0;
    for (let y = 2; y < 32; y += 5) for (let x = 2; x < 32; x += 5) {
      const l = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
      if (l < min) min = l; if (l > max) max = l;
    }
    return { min, max };
  });
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

// ── Integration: the result depends on the existing content ────────
test("difference clouds blend with the layer (black + white results sum to 255)", async ({ page }) => {
  await gotoApp(page);
  const onBlack = await fillAndDiff(page, 0);   // |0 − cloud| = cloud
  const onWhite = await fillAndDiff(page, 255); // |255 − cloud| = 255 − cloud
  for (let i = 0; i < onBlack.length; i++) {
    expect(Math.abs(onBlack[i] + onWhite[i] - 255)).toBeLessThanOrEqual(3);
  }
});

// ── Integration: non-uniform texture ───────────────────────────────
test("difference clouds render a varied texture", async ({ page }) => {
  await gotoApp(page);
  await fillAndDiff(page, 0);
  const { min, max } = await lumRange(page);
  expect(max - min).toBeGreaterThan(30);
});

// ── Mouse + menu: Filter ▸ Render ▸ Difference Clouds ──────────────
test("the Filter ▸ Render ▸ Difference Clouds menu item renders it", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "dc2");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 32, 32, 0); E.fill_selection(0, 0, 0, 255); E.select_none();
    mv.engine.commit();
  });
  await openMenu(page, "Filter");
  await page.getByText("Render", { exact: true }).first().hover();
  await page.waitForTimeout(150);
  expect(await clickMenuItem(page, "Difference Clouds")).toBe(true);
  await page.waitForTimeout(200);
  const { min, max } = await lumRange(page);
  expect(max - min).toBeGreaterThan(30);
});
