import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop New Document ▸ Background Contents ───────────────────
// Adobe: the New Document dialog has a Background Contents menu (White / Background
// Color / Transparent). Vision adds the dropdown; the resolver lives in
// src/state/bgContents.ts and the store fills/clears the new doc's base layer.
//   https://helpx.adobe.com/photoshop/using/create-documents.html

/** Open the New Document dialog via the command palette (File ▸ New). */
async function openNewDialog(page: Page) {
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp && cp.items && cp.items.some((i: any) => i.label.startsWith("File ▸ New"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.startsWith("File ▸ New")).run();
  });
  await expect(page.locator("#mv-doc-bg")).toBeVisible();
}

/** RGBA pick at the centre of the active document. pick_color packs 0xRRGGBBAA. */
const pickCenter = (page: Page): Promise<{ r: number; g: number; b: number; a: number }> =>
  page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const v = E.pick_color(Math.floor(E.width() / 2), Math.floor(E.height() / 2)) >>> 0;
    return { r: (v >>> 24) & 255, g: (v >>> 16) & 255, b: (v >>> 8) & 255, a: v & 255 };
  });

test("the New dialog shows a Background Contents dropdown defaulting to White", async ({ page }) => {
  await gotoApp(page);
  await openNewDialog(page);
  await expect(page.locator("#mv-doc-bg")).toContainText("White");
});

test("Transparent makes the new document's base layer transparent", async ({ page }) => {
  await gotoApp(page);
  await openNewDialog(page);
  await page.locator("#mv-doc-bg").click();
  await page.getByRole("option", { name: "Transparent" }).click();
  await page.getByRole("button", { name: "Create" }).click();
  expect((await pickCenter(page)).a).toBe(0);
});

test("White makes an opaque white base layer", async ({ page }) => {
  await gotoApp(page);
  await openNewDialog(page);
  await page.getByRole("button", { name: "Create" }).click(); // default White
  const c = await pickCenter(page);
  expect(c.a).toBe(255);
  expect(c.r).toBeGreaterThan(250);
  expect(c.g).toBeGreaterThan(250);
  expect(c.b).toBeGreaterThan(250);
});

test("Background Color fills the base layer with the background swatch", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setBackground({ h: 0, s: 1, v: 1, a: 1 })); // red
  await openNewDialog(page);
  await page.locator("#mv-doc-bg").click();
  await page.getByRole("option", { name: "Background Color" }).click();
  await page.getByRole("button", { name: "Create" }).click();
  const c = await pickCenter(page);
  expect(c.a).toBe(255);
  expect(c.r).toBeGreaterThan(200);
  expect(c.g).toBeLessThan(60);
  expect(c.b).toBeLessThan(60);
});
