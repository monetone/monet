import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity inline SCENE rename: double-clicking a scene row in the Scenes list
// turns the label into an in-place text field (Enter/blur commits via renameScene —
// one undo step, Escape cancels), replacing the old window.prompt. Reuses the same
// RenameInput as the hierarchy object rename. Under `desktop` the last test is CSP smoke.

const sceneId = (page: Page) => page.evaluate(() => window.__mj.store.getProject().scenes[0].id);
const nameOf = (page: Page, id: string) =>
  page.evaluate((id) => window.__mj.store.getProject().scenes.find((s: any) => s.id === id)!.name, id);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("double-click a scene row, type + Enter renames it (one undo step)", async ({ page }) => {
  const id = await sceneId(page);
  const original = await nameOf(page, id);
  await page.locator(`[data-scene-id="${id}"]`).dblclick();
  const input = page.getByTestId("scene-rename");
  await expect(input).toBeVisible();
  await input.fill("Level One");
  await input.press("Enter");
  await expect(page.getByTestId("scene-rename")).toHaveCount(0);
  expect(await nameOf(page, id)).toBe("Level One");
  // a single undo reverts the rename
  await page.evaluate(() => window.__mj.cmd.undo());
  expect(await nameOf(page, id)).toBe(original);
});

test("blur commits the scene rename (single commit path)", async ({ page }) => {
  const id = await sceneId(page);
  await page.locator(`[data-scene-id="${id}"]`).dblclick();
  await page.getByTestId("scene-rename").fill("ByBlur");
  await page.getByTestId("scene-rename").blur();
  await expect(page.getByTestId("scene-rename")).toHaveCount(0);
  expect(await nameOf(page, id)).toBe("ByBlur");
});

test("Escape cancels the scene rename with no change", async ({ page }) => {
  const id = await sceneId(page);
  const original = await nameOf(page, id);
  await page.locator(`[data-scene-id="${id}"]`).dblclick();
  const input = page.getByTestId("scene-rename");
  await input.fill("ShouldNotStick");
  await input.press("Escape");
  await expect(page.getByTestId("scene-rename")).toHaveCount(0);
  expect(await nameOf(page, id)).toBe(original);
});

test("the object hierarchy rename still works (shared RenameInput)", async ({ page }) => {
  const oid = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { patch: { name: "Obj" } }));
  await page.locator(`[data-obj-id="${oid}"]`).dblclick();
  const input = page.getByTestId("row-rename");
  await expect(input).toBeVisible();
  await input.fill("Renamed Obj");
  await input.press("Enter");
  expect(await page.evaluate((id) => {
    const { store, query } = window.__mj;
    return query.findObject(query.activeScene(store.getProject()), id).name;
  }, oid)).toBe("Renamed Obj");
});

test("scene inline rename runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await sceneId(page);
  await page.locator(`[data-scene-id="${id}"]`).dblclick();
  await page.getByTestId("scene-rename").fill("CSP");
  await page.getByTestId("scene-rename").press("Enter");
  expect(await nameOf(page, id)).toBe("CSP");
  expect(await cspViolations(page)).toEqual([]);
});
