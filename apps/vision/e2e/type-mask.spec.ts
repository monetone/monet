import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// ── Photoshop Type Mask (Horizontal + Vertical) ───────────────────
// The Type Mask tools let you type, then commit the glyphs as a *selection*
// (marching ants in the shape of the text) instead of a type layer. Vision
// creates a temp type layer for editing, then on commit rasterizes it to an
// alpha mask → selection (engine select_from_alpha) and removes the layer.
// Joins the Type flyout group. https://helpx.adobe.com/photoshop/using/creating-type.html

async function canvasBox(page: Page) {
  const b = await page.locator("canvas").first().boundingBox();
  if (!b) throw new Error("no canvas");
  return b;
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
  await newScene(page);
});

async function maskFlow(page: Page, tool: string) {
  const before = await page.evaluate(() => (window as any).__mv.engine.engine.layer_count());
  await page.evaluate((t) => (window as any).__mv.store.setTool(t), tool);
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  // While editing, a temp type layer exists (kind 2).
  const mid = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return { count: mv.engine.engine.layer_count(), kind: mv.engine.engine.layer_kind(mv.store.state.activeLayerId) };
  });
  // Commit the mask edit → it becomes a selection and the temp layer is removed.
  await page.evaluate(() => (window as any).__mv.store.endTextEdit());
  const after = await page.evaluate(() => {
    const mv = (window as any).__mv; const E = mv.engine.engine;
    const sb = Array.from(E.selection_bounds()) as number[];
    return { count: E.layer_count(), hasSel: E.has_selection(), area: sb[2] * sb[3] };
  });
  return { before, mid, after };
}

test("Horizontal Type Mask commits to a selection, not a layer", async ({ page }) => {
  const r = await maskFlow(page, "horizontaltypemask");
  expect(r.mid.count).toBe(r.before + 1); // a temp type layer during editing
  expect(r.mid.kind).toBe(2);
  expect(r.after.hasSel).toBe(true);       // committed to a selection
  expect(r.after.area).toBeGreaterThan(0); // shaped like the glyphs
  expect(r.after.count).toBe(r.before);    // temp layer removed
});

test("Vertical Type Mask also commits to a selection", async ({ page }) => {
  const r = await maskFlow(page, "verticaltypemask");
  expect(r.after.hasSel).toBe(true);
  expect(r.after.count).toBe(r.before);
});

test("the Type Mask tools are reachable from the Type flyout group", async ({ page }) => {
  await page.locator('[data-tool-group="grp-type"]').click({ button: "right" });
  await page.locator('[data-flyout-tool="horizontaltypemask"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("horizontaltypemask");
});
