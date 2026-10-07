import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Brushes panel (Window ▸ Brushes) ────────────────────
// Adobe: the Brushes panel is a library of brush presets — click one to make it the
// active brush; add the current brush as a preset; delete presets. Vision adds a
// Brushes dock tab mirroring Swatches: a preset = a BrushState settings snapshot
// (the procedural round brush has no tip bitmap), applied via store.setBrush.
//   https://helpx.adobe.com/photoshop/using/brush-presets.html

const brush = (page: Page) => page.evaluate(() => (window as any).__mv.store.state.brush);

async function openBrushes(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(64, 64, "brushes"));
  await page.locator('[data-tab-id="brushes"]').click();
  await expect(page.locator("[data-mv-brushes]")).toBeVisible();
}

test("clicking a preset makes it the active brush", async ({ page }) => {
  await openBrushes(page);
  // Default brush is size 24 / hardness 0.8; Hard Round is size 20 / hardness 1.
  await page.locator('[data-mv-brush-preset="Hard Round"]').click();
  const b = await brush(page);
  expect(b.size).toBe(20);
  expect(b.hardness).toBe(1);
  await expect(page.locator('[data-mv-brush-preset="Hard Round"]')).toHaveAttribute("aria-pressed", "true");
});

test("comma and period navigate presets while Shift jumps to the ends", async ({ page }) => {
  await openBrushes(page);
  const active = () => page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return { index: s.activeBrushPreset, name: s.brushPresets[s.activeBrushPreset]?.name, size: s.brush.size };
  });

  await page.keyboard.press("Period");
  expect(await active()).toEqual({ index: 0, name: "Soft Round", size: 30 });
  await page.keyboard.press("Period");
  expect(await active()).toEqual({ index: 1, name: "Hard Round", size: 20 });

  // Editing settings keeps the preset selection, so navigation remains relative.
  await page.evaluate(() => (window as any).__mv.store.setBrush({ size: 77 }));
  await page.keyboard.press("Comma");
  expect(await active()).toEqual({ index: 0, name: "Soft Round", size: 30 });

  await page.keyboard.press("Shift+Period");
  expect(await active()).toEqual({ index: 5, name: "Chalk", size: 24 });
  await page.keyboard.press("Period");
  expect(await active()).toEqual({ index: 5, name: "Chalk", size: 24 });
  await expect(page.locator('[data-mv-brush-preset="Chalk"]')).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Shift+Comma");
  expect(await active()).toEqual({ index: 0, name: "Soft Round", size: 30 });
  await page.keyboard.press("Comma");
  expect(await active()).toEqual({ index: 0, name: "Soft Round", size: 30 });
});

test("search filters brush presets by name without changing their library identity", async ({ page }) => {
  await openBrushes(page);
  const search = page.getByRole("searchbox", { name: "Search brush presets" });

  await search.fill("  HARD  ");
  await expect(page.locator("[data-mv-brush-preset]")).toHaveCount(2);
  await expect(page.locator("[data-mv-brush-preset]").first()).toHaveAttribute("data-mv-brush-preset", "Hard Round");
  await expect(page.locator("[data-mv-brush-preset]").last()).toHaveAttribute("data-mv-brush-preset", "Pencil Hard");
  await expect(page.locator('[data-mv-brush-preset="Soft Round"]')).toHaveCount(0);
  await expect(page.locator('[data-mv-brush-preset="Chalk"]')).toHaveCount(0);

  await page.locator('[data-mv-brush-preset="Pencil Hard"]').click();
  expect(await page.evaluate(() => {
    const state = (window as any).__mv.store.state;
    return { index: state.activeBrushPreset, size: state.brush.size };
  })).toEqual({ index: 4, size: 4 });

  await search.fill("no such preset");
  await expect(page.getByText("No matching brush presets")).toBeVisible();
  await search.fill("");
  await expect(page.locator("[data-mv-brush-preset]")).toHaveCount(6);
});

test("+ Add captures the current brush and Alt-click removes a preset", async ({ page }) => {
  await openBrushes(page);
  const before = await page.evaluate(() => (window as any).__mv.store.state.brushPresets.length);
  // Apply a known preset, then save the current brush as a new preset.
  await page.locator('[data-mv-brush-preset="Pencil Hard"]').click();
  await page.locator("[data-mv-brush-add]").click();
  const added = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return { count: s.brushPresets.length, last: s.brushPresets[s.brushPresets.length - 1] };
  });
  expect(added.count).toBe(before + 1);
  expect(added.last.name).toBe("Brush 1");
  expect(added.last.brush.size).toBe(4); // captured the Pencil Hard size
  // Alt-click a preset to remove it.
  await page.locator('[data-mv-brush-preset="Soft Round"]').click({ modifiers: ["Alt"] });
  const after = await page.evaluate(() => (window as any).__mv.store.state.brushPresets.length);
  expect(after).toBe(before); // +1 added, -1 removed
});
