import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// ── Photoshop Vertical Type ───────────────────────────────────────
// The Vertical Type tool creates type laid out top-to-bottom (spec.vertical), as
// opposed to the Horizontal Type tool. Both share the on-canvas editor + Type
// toolbar; only the layout orientation differs. Joins the Type flyout group.
// https://helpx.adobe.com/photoshop/using/creating-type.html

async function canvasBox(page: Page) {
  const b = await page.locator("canvas").first().boundingBox();
  if (!b) throw new Error("no canvas");
  return b;
}

const activeSpec = (page: Page) =>
  page.evaluate(() => {
    const mv = (window as any).__mv;
    return mv.text.get(mv.store.state.activeLayerId);
  });

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
  await newScene(page);
});

test("the Vertical Type tool creates a vertical type layer", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.setTool("verticaltype"));
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const spec = await activeSpec(page);
  expect(spec.vertical).toBe(true); // laid out top-to-bottom
  const kind = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return mv.engine.engine.layer_kind(mv.store.state.activeLayerId);
  });
  expect(kind).toBe(2); // a real type layer
  // Vertical type is edited via the Type toolbar, not the (horizontal) on-canvas
  // overlay — TextEditOverlay deliberately renders no overlay for vertical specs.
  await expect(page.locator(".mv-text-edit")).toHaveCount(0);
});

test("the Horizontal Type tool still creates a horizontal layer (no regression)", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.setTool("text"));
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const spec = await activeSpec(page);
  expect(spec.vertical).toBe(false);
});

test("Vertical Type is reachable from the Type flyout group", async ({ page }) => {
  await page.locator('[data-tool-group="grp-type"]').click({ button: "right" });
  await page.locator('[data-flyout-tool="verticaltype"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("verticaltype");
});
