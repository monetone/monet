import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Artistic ▸ Paint Daubs ────────────────────────────────
// Adobe: Paint Daubs offers size 1..50 and Simple, Light Rough, Dark Rough,
// Wide Sharp, Wide Blurry, and Sparkle brush types for a painterly effect.
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

const red = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => ((((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255), [x, y] as const);

// Left half black, right half white (vertical boundary at x=w/2).
async function split(page: Page, w: number, h: number) {
  await gotoApp(page);
  await page.evaluate(([w, h]) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "paint-daubs");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
  }, [w, h] as const);
}

test("smooths a hard edge at low sharpness, and is undoable", async ({ page }) => {
  await split(page, 32, 32);
  expect(await red(page, 15, 16)).toBe(0); // dark side of the boundary
  await page.evaluate(() => (window as any).__mv.fil.paintDaubs(50, 0)); // softest dabs
  expect(await red(page, 15, 16)).toBeGreaterThan(40); // smoothed toward the average
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await red(page, 15, 16)).toBe(0); // undo restores the hard edge
});

test("higher Sharpness keeps the edge sharper", async ({ page }) => {
  await split(page, 32, 32);
  await page.evaluate(() => (window as any).__mv.fil.paintDaubs(50, 0)); // soft
  const soft = await red(page, 15, 16);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.paintDaubs(50, 40)); // crisp
  const crisp = await red(page, 15, 16);
  expect(crisp).toBeLessThan(soft); // more sharpness keeps the dark edge darker
});

test("a larger Brush Size smooths more", async ({ page }) => {
  await split(page, 32, 32);
  await page.evaluate(() => (window as any).__mv.fil.paintDaubs(5, 0));
  const small = await red(page, 15, 16);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.paintDaubs(50, 0));
  const large = await red(page, 15, 16);
  expect(large).toBeGreaterThan(small);
});

test("successive applies keep the canvas well-formed (soak)", async ({ page }) => {
  await split(page, 40, 30);
  const dims = () => page.evaluate(() => { const E = (window as any).__mv.engine.engine; return { w: E.width(), h: E.height() }; });
  for (const [bs, sh] of [[1, 40], [50, 0], [25, 20]] as const) {
    await page.evaluate(([bs, sh]) => (window as any).__mv.fil.paintDaubs(bs, sh), [bs, sh] as const);
    expect(await dims()).toEqual({ w: 40, h: 30 });
  }
});

test("the Paint Daubs dialog opens from the Filter menu", async ({ page }) => {
  await split(page, 32, 32);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Paint Daubs…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Paint Daubs…")).run());
  await expect(page.getByText("Sharpness")).toBeVisible();
  const brushType = page.getByRole("combobox", { name: "Brush Type" });
  await expect(brushType).toHaveText("Simple");
  await brushType.click();
  for (const name of ["Simple", "Light Rough", "Dark Rough", "Wide Sharp", "Wide Blurry", "Sparkle"]) {
    await expect(page.getByRole("option", { name })).toBeVisible();
  }
  await page.getByRole("option", { name: "Dark Rough" }).click();
  await page.getByRole("button", { name: "OK" }).click();
  expect(await red(page, 15, 16)).toBeGreaterThan(0);
});
