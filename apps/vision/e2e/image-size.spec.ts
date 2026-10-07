import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Image Size ▸ Constrain Proportions ───────────────────
// Adobe: the Image Size dialog has a chain/link (Constrain Proportions, on by
// default) that keeps the aspect ratio when editing Width or Height. Vision adds
// the link toggle + the pure aspect math in src/state/imageSizeLink.ts.
//   https://helpx.adobe.com/photoshop/using/image-size-resolution.html

const OW = 1000;
const OH = 500; // 2:1 aspect

/** Fresh 1000×500 doc, then open Image Size via the command palette. */
async function openImageSize(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "imgsize");
    mv.engine.commit();
  }, { w: OW, h: OH });
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.startsWith("Image ▸ Image Size"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.startsWith("Image ▸ Image Size")).run();
  });
  await expect(page.locator("#mv-imgsize-link")).toBeVisible();
}

/** Commit a value into a NumberField (fill then Enter). */
async function setField(page: Page, sel: string, v: number) {
  await page.locator(sel).fill(String(v));
  await page.locator(sel).press("Enter");
}
const dims = (page: Page): Promise<{ w: number; h: number }> =>
  page.evaluate(() => ({ w: (window as any).__mv.engine.engine.width(), h: (window as any).__mv.engine.engine.height() }));

test("the dialog shows the W/H fields and a Constrain-proportions toggle (on by default)", async ({ page }) => {
  await openImageSize(page);
  await expect(page.locator("#mv-imgsize-w")).toBeVisible();
  await expect(page.locator("#mv-imgsize-h")).toBeVisible();
  expect(await page.locator("#mv-imgsize-link").getAttribute("aria-checked")).toBe("true");
});

test("with the link on, a new Width scales Height proportionally", async ({ page }) => {
  await openImageSize(page);
  await setField(page, "#mv-imgsize-w", 600); // 2:1 → 300
  expect(await page.locator("#mv-imgsize-h").inputValue()).toBe("300");
});

test("with the link on, a new Height scales Width proportionally", async ({ page }) => {
  await openImageSize(page);
  await setField(page, "#mv-imgsize-h", 100); // 2:1 → 200
  expect(await page.locator("#mv-imgsize-w").inputValue()).toBe("200");
});

test("turning the link off lets Height change without altering Width, and Resize applies it", async ({ page }) => {
  await openImageSize(page);
  await page.locator("#mv-imgsize-link").click(); // unlink
  await setField(page, "#mv-imgsize-h", 123);
  expect(await page.locator("#mv-imgsize-w").inputValue()).toBe("1000"); // unchanged
  await page.getByRole("button", { name: "Resize" }).click();
  const d = await dims(page);
  expect(d.w).toBe(1000);
  expect(d.h).toBe(123);
});

test("Resize with the link on applies the proportional dimensions", async ({ page }) => {
  await openImageSize(page);
  await setField(page, "#mv-imgsize-w", 600); // → 300
  await page.getByRole("button", { name: "Resize" }).click();
  const d = await dims(page);
  expect(d.w).toBe(600);
  expect(d.h).toBe(300);
});
