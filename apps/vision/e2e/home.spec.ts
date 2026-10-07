import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("cold launch and last close show Home; New restores the workspace", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const home = page.locator("[data-mv-home-screen]");
  await expect(home).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__mv?.store);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine)).toBeNull();
  for (const key of ["ControlOrMeta+z", "ControlOrMeta+s", "Delete", "b", "5", "Space"]) await page.keyboard.press(key);
  await expect(home).toBeVisible();
  await page.locator("[data-mv-home-new]").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator("#mv-doc-width").fill("64");
  await page.locator("#mv-doc-height").fill("48");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(home).toHaveCount(0);
  await expect(page.locator(".mv-canvas-viewport")).toBeVisible();
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.closeDoc(mv.store.state.activeDocId);
  });
  await expect(home).toBeVisible();
  expect(errors).toEqual([]);
});

test("Home Open opens a picked file from a cold launch", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const home = page.locator("[data-mv-home-screen]");
  await expect(home).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.locator("[data-mv-home-open]").click();
  await (await chooser).setFiles({ name: "opened.png", mimeType: "image/png", buffer: readFileSync(new URL("../src-tauri/fixtures/px.png", import.meta.url)) });
  await expect(home).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.documents.map((d: any) => d.name))).toEqual(["opened.png"]);
  expect(errors).toEqual([]);
});
