import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop "Copy Color's Hex Code" / "Copy Color as HTML" ───────
// Right-clicking either Color panel swatch copies that colour to the
// clipboard as `rrggbb` (hex code) or `color="#rrggbb"` (HTML). Pure formatting
// lives in src/state/colorFormat.ts; app.copySwatchColor writes the clipboard.
//   https://helpx.adobe.com/photoshop/using/web-graphics.html

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

const setRedFg = (page: Page) =>
  page.evaluate(() => (window as any).__mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 })); // → rgb(255,0,0)

const copyViaMenu = async (page: Page, label: string, swatch: "fg" | "bg" = "fg") => {
  // The background chip is painted last, so its top-left corner owns the
  // overlap; the foreground click stays in its exposed top-left corner.
  const edge = swatch === "fg" ? 4 : 1;
  await page.locator(`[data-mv-${swatch}swatch]`).click({ button: "right", position: { x: edge, y: edge } });
  await page.getByText(label, { exact: true }).click();
};

test("the foreground swatch context menu offers both Copy Color commands", async ({ page }) => {
  await gotoApp(page);
  await page.locator("[data-mv-fgswatch]").click({ button: "right", position: { x: 4, y: 4 } });
  await expect(page.getByText("Copy Color's Hex Code", { exact: true })).toBeVisible();
  await expect(page.getByText("Copy Color as HTML", { exact: true })).toBeVisible();
});

test("Copy Color's Hex Code copies rrggbb (no #)", async ({ page }) => {
  await gotoApp(page);
  await setRedFg(page);
  await copyViaMenu(page, "Copy Color's Hex Code");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("ff0000");
});

test("Copy Color as HTML copies the color attribute", async ({ page }) => {
  await gotoApp(page);
  await setRedFg(page);
  await copyViaMenu(page, "Copy Color as HTML");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('color="#ff0000"');
});

test("the background swatch copies its own color in both formats", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const { store } = (window as any).__mv;
    store.setForeground({ h: 0, s: 1, v: 1, a: 1 });
    store.setBackground({ h: 240, s: 1, v: 1, a: 1 });
  });
  await copyViaMenu(page, "Copy Color's Hex Code", "bg");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("0000ff");
  await copyViaMenu(page, "Copy Color as HTML", "bg");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('color="#0000ff"');
});
