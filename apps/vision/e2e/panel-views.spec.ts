import { expect, test, type Page } from "@playwright/test";
import { composite, gotoApp, newScene } from "./helpers";

async function showPanel(page: Page, name: string) {
  await page.evaluate((id) => (window as any).__mv.store.getWorkspace().openPanel(id), name.toLowerCase());
  await expect(page.getByRole("button", { name: `${name} panel menu`, exact: true })).toBeVisible();
}

async function option(page: Page, panel: string, submenu: string, choice: string) {
  await page.getByRole("button", { name: `${panel} panel menu`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Panel Options", exact: true }).hover();
  if (submenu) await page.getByRole("menuitem", { name: submenu, exact: true }).hover();
  await page.getByRole("menuitemcheckbox", { name: choice, exact: true }).click();
}

test("panel flyouts change real thumbnail geometry and swatch view and persist on reload", async ({ page }) => {
  await gotoApp(page);
  await showPanel(page, "Layers");
  await option(page, "Layers", "Thumbnail Size", "Large");
  await expect(page.locator('[data-mv-layers-panel] .monet-cv-layer-thumb').first()).toHaveCSS("width", "64px");
  await expect(page.locator('[data-mv-layers-panel] .monet-layer').first()).toHaveCSS("height", "76px");
  await showPanel(page, "Channels");
  await option(page, "Channels", "Thumbnail Size", "Medium");
  await expect(page.locator('[data-mv-channel] img').first()).toHaveAttribute("width", "40");
  await showPanel(page, "Swatches");
  await option(page, "Swatches", "", "List");
  await expect(page.locator('[data-mv-swatch-view]')).toHaveAttribute("data-mv-swatch-view", "list");
  await expect(page.locator('[data-mv-swatch]').first()).toHaveText(/#/);
  await page.reload();
  await gotoApp(page);
  await showPanel(page, "Layers");
  await expect(page.locator('[data-mv-layers-panel] .monet-cv-layer-thumb').first()).toHaveCSS("width", "64px");
  await showPanel(page, "Swatches");
  await expect(page.locator('[data-mv-swatch-view]')).toHaveAttribute("data-mv-swatch-view", "list");
});

test("Actions playback and all six flyouts are reachable with real menus", async ({ page }) => {
  await gotoApp(page);
  for (const name of ["Layers", "Channels", "Color", "Swatches", "Histogram", "Actions"]) await showPanel(page, name);
  await page.getByRole("button", { name: "Actions panel menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Playback Options", exact: true }).hover();
  await page.getByRole("menuitemcheckbox", { name: /Step By Step/i }).click();
  expect(await page.evaluate(() => (window as any).__mv.actions.playbackMode())).toBe("stepByStep");
});

test("Step By Step from the Actions flyout pauses Play before each step, and Cancel withholds the step", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.actions.start(); mv.adj.invert(); mv.adj.posterize(4); mv.actions.stop();
  });
  await newScene(page);
  await page.evaluate(() => (window as any).__mv.adj.invert()); // not recording
  const invertOnly = await composite(page);
  await newScene(page);
  const before = await composite(page);

  await showPanel(page, "Actions");
  await page.getByRole("button", { name: "Actions panel menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Playback Options", exact: true }).hover();
  await page.getByRole("menuitemcheckbox", { name: /Step By Step/i }).click();

  const asked: string[] = [];
  let answers: boolean[] = [];
  page.on("dialog", (d) => { asked.push(d.message()); void (answers.shift() ? d.accept() : d.dismiss()); });
  const play = page.getByTitle("Replay recorded actions");

  answers = [false];
  await play.click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain("Invert");
  expect((await composite(page)).chk).toBe(before.chk);

  answers = [true, false];
  asked.length = 0;
  await play.click();
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toContain("Posterize");
  expect((await composite(page)).chk).toBe(invertOnly.chk);
});

test("collapsed docks show interactive flyouts and restore saved layouts", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Collapse right dock", exact: true }).click();
  const rail = page.getByLabel("right panels", { exact: true });
  await expect(rail).toBeVisible();
  await rail.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Layers panel", exact: true })).toBeVisible();
  // Portalled panel menus are inside the flyout's interaction boundary.
  await option(page, "Layers", "Thumbnail Size", "Large");
  await expect(page.getByRole("dialog", { name: "Layers panel", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Layers panel", exact: true })).toBeHidden();
  await expect(rail.getByRole("button", { name: "Layers", exact: true })).toBeFocused();
  const layout = await page.evaluate(() => (window as any).__mv.store.getWorkspace().getLayout());
  expect(layout.right.collapsed).toBe(true);
  await page.reload();
  await gotoApp(page);
  await expect(page.getByRole("button", { name: "Expand right dock", exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__mv.store.getWorkspace().reset());
  await expect(page.getByRole("button", { name: "Collapse right dock", exact: true })).toBeVisible();
  await page.evaluate((saved) => (window as any).__mv.store.getWorkspace().setLayout(saved), layout);
  await expect(page.getByRole("button", { name: "Expand right dock", exact: true })).toBeVisible();
});

async function workspaceMenu(page: Page, item: string) {
  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page.getByRole("menuitem", { name: "Workspace", exact: true }).hover();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

test("Reset Panels restores the active workspace's collapsed docks, Essentials stays expanded (#479)", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("hand"));
  const collapse = page.getByRole("button", { name: "Collapse right dock", exact: true });
  const expand = page.getByRole("button", { name: "Expand right dock", exact: true });
  // Double-clicking the dock header, beside its » button, collapses the side.
  await page.locator(".monet-dock--right > .monet-dock-header").dblclick({ position: { x: 8, y: 10 } });
  await expect(expand).toBeVisible();
  // Rail icons are buttons in the tab order: Tab from the header reaches the first one.
  const rail = page.getByLabel("right panels", { exact: true });
  await expand.focus();
  await page.keyboard.press("Tab");
  await expect(rail.getByRole("button", { name: "Color", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  const color = page.getByRole("dialog", { name: "Color panel", exact: true });
  await expect(color).toBeVisible();
  // The panel springs out over the canvas, left of the rail.
  const flyout = (await color.boundingBox())!;
  const dock = (await page.getByRole("region", { name: "right dock", exact: true }).boundingBox())!;
  expect(flyout.x + flyout.width).toBeLessThanOrEqual(dock.x + 1);
  // Another icon swaps the flyout; a click on the canvas folds it away.
  await rail.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(color).toBeHidden();
  const layers = page.getByRole("dialog", { name: "Layers panel", exact: true });
  await expect(layers).toBeVisible();
  await page.mouse.click(flyout.x - 60, flyout.y + flyout.height / 2);
  await expect(layers).toBeHidden();

  // A workspace saved collapsed becomes the active one, and Reset Panels restores it.
  page.once("dialog", (d) => void d.accept("Iconic"));
  await workspaceMenu(page, "Save Workspace…");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("mv.workspaces") ?? "")).toContain('"collapsed":true');
  await expand.click();
  await expect(collapse).toBeVisible();
  await workspaceMenu(page, "Reset Panels");
  await expect(expand).toBeVisible();

  // Still the active workspace after a reload.
  await expand.click();
  await page.reload();
  await gotoApp(page);
  await expect(collapse).toBeVisible();
  await workspaceMenu(page, "Reset Panels");
  await expect(expand).toBeVisible();

  // Essentials opens expanded, and resetting it gives expanded docks back.
  await workspaceMenu(page, "Essentials");
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(expand).toBeVisible();
  await workspaceMenu(page, "Reset Panels");
  await expect(collapse).toBeVisible();
});
