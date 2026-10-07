import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Hierarchy inline rename (F2 / double-click): double-clicking a row
// (or F2 on the single selection) turns the label into an in-place text field;
// Enter or blur commits via renameObject (one undo step), Escape cancels. Specs
// drive the real DOM rows + window.__mj. Under `desktop` the last test is the CSP smoke.

const nameOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { store, query } = window.__mj;
    return query.findObject(query.activeScene(store.getProject()), id).name;
  }, id);

const addRect = (page: Page): Promise<string> =>
  page.evaluate(() => window.__mj.cmd.addObject("rectangle", { patch: { name: "Original" } }));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("double-click a row, type + Enter renames the object (one undo step)", async ({ page }) => {
  const id = await addRect(page);
  await page.locator(`[data-obj-id="${id}"]`).dblclick();
  const input = page.getByTestId("row-rename");
  await expect(input).toBeVisible();
  await input.fill("Renamed");
  await input.press("Enter");
  await expect(page.getByTestId("row-rename")).toHaveCount(0); // exits rename mode
  expect(await nameOf(page, id)).toBe("Renamed");
  // a single undo reverts the rename (one undoable step)
  await page.evaluate(() => window.__mj.cmd.undo());
  expect(await nameOf(page, id)).toBe("Original");
});

test("blur commits the rename (single commit path)", async ({ page }) => {
  const id = await addRect(page);
  await page.locator(`[data-obj-id="${id}"]`).dblclick();
  await page.getByTestId("row-rename").fill("ByBlur");
  await page.getByTestId("row-rename").blur();
  await expect(page.getByTestId("row-rename")).toHaveCount(0);
  expect(await nameOf(page, id)).toBe("ByBlur");
});

test("Escape cancels with no rename", async ({ page }) => {
  const id = await addRect(page);
  await page.locator(`[data-obj-id="${id}"]`).dblclick();
  const input = page.getByTestId("row-rename");
  await input.fill("ShouldNotStick");
  await input.press("Escape");
  await expect(page.getByTestId("row-rename")).toHaveCount(0);
  expect(await nameOf(page, id)).toBe("Original");
});

test("an empty/blank name does not rename", async ({ page }) => {
  const id = await addRect(page);
  await page.locator(`[data-obj-id="${id}"]`).dblclick();
  const input = page.getByTestId("row-rename");
  await input.fill("   ");
  await input.press("Enter");
  expect(await nameOf(page, id)).toBe("Original");
});

test("F2 on the single selection opens the rename input", async ({ page }) => {
  const id = await addRect(page);
  await page.locator(`[data-obj-id="${id}"]`).click(); // select the row
  await page.keyboard.press("F2");
  await expect(page.getByTestId("row-rename")).toBeVisible();
});

test("inline rename runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await addRect(page);
  await page.locator(`[data-obj-id="${id}"]`).dblclick();
  await page.getByTestId("row-rename").fill("CSP");
  await page.getByTestId("row-rename").press("Enter");
  expect(await nameOf(page, id)).toBe("CSP");
  expect(await cspViolations(page)).toEqual([]);
});
