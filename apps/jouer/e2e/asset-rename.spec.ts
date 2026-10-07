import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity asset inline rename (Project-window double-click/F2): double-clicking
// an asset row in the Assets panel turns its name into an in-place field (Enter/blur
// commits via updateAsset, Escape cancels), reusing the same shared RenameInput as the
// hierarchy object + scene rows. Under `desktop` the last test is the CSP smoke.

const nameOf = (page: Page, id: string) =>
  page.evaluate((id) => window.__mj.store.getProject().assets.find((a: any) => a.id === id).name, id);

async function seedAsset(page: Page): Promise<string> {
  return page.evaluate(() => {
    window.__mj.cmd.addAsset({ id: "clip1", kind: "image", name: "Sprite", src: "data:image/png;base64,iVBORw0KGgo=", width: 16, height: 16 });
    return "clip1";
  });
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("double-click an asset row, type + Enter renames it", async ({ page }) => {
  const id = await seedAsset(page);
  await page.locator(`[data-asset-id="${id}"]`).dblclick();
  const input = page.getByTestId("asset-rename");
  await expect(input).toBeVisible();
  await input.fill("Hero Sheet");
  await input.press("Enter");
  await expect(page.getByTestId("asset-rename")).toHaveCount(0);
  expect(await nameOf(page, id)).toBe("Hero Sheet");
});

test("blur commits the asset rename (single commit path)", async ({ page }) => {
  const id = await seedAsset(page);
  await page.locator(`[data-asset-id="${id}"]`).dblclick();
  await page.getByTestId("asset-rename").fill("ByBlur");
  await page.getByTestId("asset-rename").blur();
  await expect(page.getByTestId("asset-rename")).toHaveCount(0);
  expect(await nameOf(page, id)).toBe("ByBlur");
});

test("Escape cancels the asset rename with no change", async ({ page }) => {
  const id = await seedAsset(page);
  const original = await nameOf(page, id);
  await page.locator(`[data-asset-id="${id}"]`).dblclick();
  const input = page.getByTestId("asset-rename");
  await input.fill("ShouldNotStick");
  await input.press("Escape");
  await expect(page.getByTestId("asset-rename")).toHaveCount(0);
  expect(await nameOf(page, id)).toBe(original);
});

test("the hierarchy object rename still works (shared RenameInput)", async ({ page }) => {
  const oid = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { patch: { name: "Obj" } }));
  await page.locator(`[data-obj-id="${oid}"]`).dblclick();
  await page.getByTestId("row-rename").fill("Renamed Obj");
  await page.getByTestId("row-rename").press("Enter");
  expect(await page.evaluate((id) => {
    const { store, query } = window.__mj;
    return query.findObject(query.activeScene(store.getProject()), id).name;
  }, oid)).toBe("Renamed Obj");
});

test("asset inline rename runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await seedAsset(page);
  await page.locator(`[data-asset-id="${id}"]`).dblclick();
  await page.getByTestId("asset-rename").fill("CSP");
  await page.getByTestId("asset-rename").press("Enter");
  expect(await nameOf(page, id)).toBe("CSP");
  expect(await cspViolations(page)).toEqual([]);
});
