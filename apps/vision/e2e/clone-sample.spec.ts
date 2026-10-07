import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Clone Stamp / Healing Brush ▸ Sample source ─────────
// Adobe: the clone/heal options bar has a Sample dropdown (Current Layer / Current &
// Below / All Layers) picking which layers the source is taken from. Vision was
// hardwired to the full composite (All Layers); now a #mv-clone-sample dropdown sets
// the engine clone_sample mode. (The per-mode pixel sampling is covered by a Rust
// test — capture_clone_src picks active-layer / composite-below / full composite.)
//   https://helpx.adobe.com/photoshop/using/retouching-repairing-images.html

async function cloneTool(page: Page, tool: "clone" | "heal" = "clone") {
  await gotoApp(page);
  await page.evaluate((t) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "clone");
    mv.store.setTool(t);
  }, tool);
  await expect(page.locator("#mv-clone-sample")).toBeVisible();
}

test("the clone Sample dropdown offers the three modes and updates the store", async ({ page }) => {
  await cloneTool(page, "clone");
  await page.locator("#mv-clone-sample").click();
  await expect(page.locator(".monet-listbox [role=option]"))
    .toHaveText(["Current Layer", "Current & Below", "All Layers"]);
  await page.keyboard.press("Escape");
  await chooseOption(page.locator("#mv-clone-sample"), "Current Layer");
  expect(await page.evaluate(() => (window as any).__mv.store.state.cloneSample)).toBe(0);
  await chooseOption(page.locator("#mv-clone-sample"), "Current & Below");
  expect(await page.evaluate(() => (window as any).__mv.store.state.cloneSample)).toBe(1);
  await chooseOption(page.locator("#mv-clone-sample"), "All Layers");
  expect(await page.evaluate(() => (window as any).__mv.store.state.cloneSample)).toBe(2);
});

test("the Healing Brush also exposes the Sample dropdown", async ({ page }) => {
  await cloneTool(page, "heal");
  await expect(page.locator("#mv-clone-sample")).toBeVisible();
});
