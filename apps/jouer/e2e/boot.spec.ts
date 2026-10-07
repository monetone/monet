import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// The app boots a live Phaser editor with the default project and no errors.

test("boots a live Phaser editor with a default scene and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));

  await gotoApp(page);

  await expect(page.locator(".mj-stage canvas")).toBeVisible();
  const info = await page.evaluate(() => {
    const p = window.__mj.store.getProject();
    return { scenes: p.scenes.length, schema: p.schema, fps: p.fps };
  });
  expect(info.scenes).toBe(1);
  expect(info.schema).toBe("monet-jouer/v1");
  expect(info.fps).toBe(60);
  expect(errors).toEqual([]);
});
