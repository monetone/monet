import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// Renaming layers in the Layers panel: double-click a row, or right-click ▸
// Rename Layer. Both swap that row's name for an inline <input> (.mv-layer-rename);
// Enter / blur commit, Escape cancels.

const FIELD = ".mv-layer-rename";

/** Add a fresh layer (goes on top, becomes active) and return its id + name. */
async function addLayer(page: Page): Promise<{ id: number; name: string }> {
  return page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.addLayer();
    mv.engine.commit();
    const id = mv.store.state.activeLayerId;
    return { id, name: mv.engine.engine.layer_name(id) };
  });
}

const nameOf = (page: Page, id: number) =>
  page.evaluate((lid) => (window as any).__mv.engine.engine.layer_name(lid), id);

const layerRow = (page: Page, id: number) => page.locator(`[role="option"][id="${id}"]`);

async function startInlineRename(page: Page, id: number) {
  const name = layerRow(page, id).locator(".name");
  await expect(name).toBeVisible();
  await name.dblclick();
  const field = page.locator(FIELD);
  await expect(field).toBeFocused();
  return field;
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
  await newScene(page);
});

test("double-clicking a layer row renames it", async ({ page }) => {
  const { id } = await addLayer(page);

  const field = await startInlineRename(page, id);
  await page.keyboard.type("Sky"); // fresh field selects all → replaces
  await page.keyboard.press("Enter");

  await expect(field).toHaveCount(0);
  expect(await nameOf(page, id)).toBe("Sky");
});

test("right-click ▸ Rename Layer renames it", async ({ page }) => {
  const { id } = await addLayer(page);

  const row = layerRow(page, id);
  await expect(row).toBeVisible();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename Layer" }).click();

  const field = page.locator(FIELD);
  await expect(field).toBeFocused();
  await page.keyboard.type("Ocean");
  await page.keyboard.press("Enter");

  await expect(field).toHaveCount(0);
  expect(await nameOf(page, id)).toBe("Ocean");
});

test("Escape cancels a rename, leaving the name unchanged", async ({ page }) => {
  const { id, name } = await addLayer(page);

  await startInlineRename(page, id);
  await page.keyboard.type("DiscardMe");
  await page.keyboard.press("Escape");

  await expect(page.locator(FIELD)).toHaveCount(0);
  expect(await nameOf(page, id)).toBe(name);
});

test("blurring (clicking away) commits the rename", async ({ page }) => {
  const { id } = await addLayer(page);

  await startInlineRename(page, id);
  await page.keyboard.type("Committed");
  await page.locator(FIELD).blur();

  await expect(page.locator(FIELD)).toHaveCount(0);
  expect(await nameOf(page, id)).toBe("Committed");
});

test("Enter that confirms an IME composition does not commit the rename", async ({ page }) => {
  const { id } = await addLayer(page);

  const field = await startInlineRename(page, id);
  await page.keyboard.type("Draft");

  // Enter fired while an IME candidate is composing must be ignored (it belongs
  // to the IME), so the editor stays open instead of committing early.
  await field.evaluate((el) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })),
  );
  await expect(field).toHaveCount(1);

  // A normal Enter (composition finished) commits.
  await page.keyboard.press("Enter");
  await expect(field).toHaveCount(0);
  expect(await nameOf(page, id)).toBe("Draft");
});

test("an empty name is rejected (keeps the previous name)", async ({ page }) => {
  const { id, name } = await addLayer(page);

  await startInlineRename(page, id);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete"); // clear the field
  await page.keyboard.press("Enter");

  await expect(page.locator(FIELD)).toHaveCount(0);
  expect(await nameOf(page, id)).toBe(name); // blank ignored
});
