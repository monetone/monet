import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

// ── Photoshop Filter ▸ Filter Gallery ──────────────────────────────
// Adobe: the Filter Gallery "lets you apply filters cumulatively, and apply
// individual filters more than once. You can also rearrange filters and change
// the settings of each filter" — a live preview, a thumbnail/category picker,
// and a stacked, reorderable effect list. Vision composes the visible stack in
// order and commits it as ONE undoable history step.
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html
//
// Driven through window.__mv + the real dialog DOM (data-mv-gallery-* hooks).

async function openGallery(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Filter Gallery…")),
    null, { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Filter Gallery…")).run());
  await expect(page.locator("[data-mv-gallery-stack]")).toBeVisible();
}
const undoDepth = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as any).__mv.engine.engine.undo_depth());

test("a 2-filter stack composes differently from each single filter", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const before = await composite(page);

  await openGallery(page);

  // Add the first filter (Cutout) — the live preview applies it on the canvas.
  await page.click('[data-mv-gallery-add="cutout"]');
  await page.waitForTimeout(250);
  const single1 = await composite(page);
  expect(single1.chk).not.toBe(before.chk); // one filter changed the image

  // Add a second filter (Poster Edges) on top — now two effects compose.
  await page.click('[data-mv-gallery-add="posterEdges"]');
  await page.waitForTimeout(250);
  const composed = await composite(page);
  await expect(page.locator("[data-mv-gallery-effect]")).toHaveCount(2);
  expect(composed.chk).not.toBe(single1.chk); // the 2nd filter changed the result
  expect(composed.chk).not.toBe(before.chk);

  // Toggle the first effect's eye OFF → only Poster Edges contributes, so the
  // result changes and differs from the Cutout-only result too.
  await page.click('[data-mv-gallery-eye="0"]');
  await page.waitForTimeout(250);
  const single2 = await composite(page);
  expect(single2.chk).not.toBe(composed.chk); // toggling one off changed the result
  expect(single2.chk).not.toBe(single1.chk);
});

test("OK composes the stack as ONE undoable history step", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const before = await composite(page);
  const baseDepth = await undoDepth(page);

  await openGallery(page);
  await page.click('[data-mv-gallery-add="cutout"]');
  await page.waitForTimeout(150);
  await page.click('[data-mv-gallery-add="posterEdges"]');
  await page.waitForTimeout(250);
  const composed = await composite(page);

  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(200);

  const applied = await composite(page);
  expect(applied.chk).toBe(composed.chk); // OK leaves the composed stack applied
  expect(applied.chk).not.toBe(before.chk);

  // Exactly one new history entry for the whole 2-filter stack, labeled.
  expect(await undoDepth(page) - baseDepth).toBe(1);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.undo_label())).toBe("Filter Gallery");

  // A single Undo restores the pre-gallery image.
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.waitForTimeout(100);
  const undone = await composite(page);
  expect(undone.chk).toBe(before.chk);
});

test("Cancel leaves the image untouched", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const before = await composite(page);

  await openGallery(page);
  await page.click('[data-mv-gallery-add="cutout"]');
  await page.waitForTimeout(250);
  const previewed = await composite(page);
  expect(previewed.chk).not.toBe(before.chk); // the preview is live

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForTimeout(150);
  const after = await composite(page);
  expect(after.chk).toBe(before.chk); // Cancel reverts the preview
});

test("Paint Daubs exposes its named brush types in the Filter Gallery", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await openGallery(page);

  await page.click('[data-mv-gallery-add="paintDaubs"]');
  const brushType = page.getByRole("combobox", { name: "Brush Type" });
  await expect(brushType).toHaveText("Simple");
  await brushType.click();
  for (const name of ["Simple", "Light Rough", "Dark Rough", "Wide Sharp", "Wide Blurry", "Sparkle"]) {
    await expect(page.getByRole("option", { name })).toBeVisible();
  }
  await page.getByRole("option", { name: "Sparkle" }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.undo_label())).toBe("Filter Gallery");
});

test("existing Artistic filters are available through the Filter Gallery", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await openGallery(page);

  for (const id of ["coloredPencil", "fresco", "paletteKnife", "roughPastels", "smudgeStick", "sponge", "underpainting"]) {
    await expect(page.locator(`[data-mv-gallery-add="${id}"]`)).toBeVisible();
  }
  await page.click('[data-mv-gallery-add="underpainting"]');
  await page.getByRole("combobox", { name: "Texture" }).click();
  await page.getByRole("option", { name: "Brick" }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.undo_label())).toBe("Filter Gallery");
});
