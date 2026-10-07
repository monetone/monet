import { test, expect, type Page } from "@playwright/test";
import { gotoApp, tinyLinearDng } from "./helpers";

// ── Edit ▸ Preferences ▸ Cursors / Workspace / Camera Raw (#482) ─────
// Each pane edits store state that survives a reload and drives the subsystem
// it names: the canvas brush cursor, the dock/tab chrome, the raw-open path.

async function openPreferences(page: Page, pane: string) {
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: "Preferences", exact: true }).hover();
  await page.getByRole("menuitem", { name: `${pane}…`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Preferences", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function reload(page: Page) {
  await page.reload();
  await gotoApp(page);
}

/** Put the pointer over the document and read the brush cursor's diameter. */
async function brushCursorWidth(page: Page, size: number): Promise<{ width: number; zoom: number }> {
  await page.evaluate((size) => (window as any).__mv.store.setBrush({ size }), size);
  const box = (await page.locator(".mv-canvas-viewport").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 2);
  const cursor = page.getByTestId("mv-brush-cursor");
  await expect(cursor).toBeVisible();
  return {
    width: (await cursor.boundingBox())!.width,
    zoom: await page.evaluate(() => (window as any).__mv.store.state.zoom),
  };
}

test("Cursors ▸ Full Size Brush Tip survives a reload and rings brush size × zoom", async ({ page }) => {
  await gotoApp(page);
  const prefs = await openPreferences(page, "Cursors");
  const painting = prefs.getByRole("radiogroup", { name: "Painting Cursors" });
  await expect(painting.getByRole("radio", { name: "Normal Brush Tip" })).toHaveAttribute("aria-checked", "true");
  await painting.getByRole("radio", { name: "Full Size Brush Tip" }).click();
  await prefs.getByRole("button", { name: "OK", exact: true }).click();

  await reload(page);
  // A soft brush: Normal would ring only half of it, Full Size rings all of it.
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("brush");
    mv.store.setBrush({ hardness: 0 });
  });
  const small = await brushCursorWidth(page, 30);
  expect(small.width).toBeCloseTo(30 * small.zoom, 0);
  const large = await brushCursorWidth(page, 80);
  expect(large.width).toBeCloseTo(80 * large.zoom, 0);
  await page.evaluate(() => (window as any).__mv.store.setZoom(2, 0, 0));
  const zoomed = await brushCursorWidth(page, 80);
  expect(zoomed.zoom).toBe(2);
  expect(zoomed.width).toBeCloseTo(160, 0);

  // Normal Brush Tip, for contrast, rings the soft brush's 50% falloff.
  const again = await openPreferences(page, "Cursors");
  const radio = again.getByRole("radiogroup", { name: "Painting Cursors" });
  await expect(radio.getByRole("radio", { name: "Full Size Brush Tip" })).toHaveAttribute("aria-checked", "true");
  await radio.getByRole("radio", { name: "Normal Brush Tip" }).click();
  await again.getByRole("button", { name: "OK", exact: true }).click();
  expect((await brushCursorWidth(page, 80)).width).toBeCloseTo(80, 0);
});

test("Workspace ▸ Large Tabs and Auto-Collapse Iconic Panels survive a reload and change the chrome", async ({ page }) => {
  await gotoApp(page);
  const tab = page.locator(".monet-doctab").first();
  const tall = (await tab.boundingBox())!.height;
  const prefs = await openPreferences(page, "Workspace");
  await prefs.getByRole("checkbox", { name: "Large Tabs" }).click();
  await prefs.getByRole("checkbox", { name: "Auto-Collapse Iconic Panels" }).click();
  await prefs.getByRole("button", { name: "OK", exact: true }).click();

  await reload(page);
  await expect(page.locator("html")).toHaveAttribute("data-mv-small-tabs", "");
  expect((await tab.boundingBox())!.height).toBeLessThan(tall);
  // A sprung-out panel now stays out when the canvas is clicked.
  await page.evaluate(() => (window as any).__mv.store.setTool("hand"));
  await page.getByRole("button", { name: "Collapse right dock", exact: true }).click();
  await page.getByLabel("right panels", { exact: true }).getByRole("button", { name: "Layers", exact: true }).click();
  const layers = page.getByRole("dialog", { name: "Layers panel", exact: true });
  const flyout = (await layers.boundingBox())!;
  await page.mouse.click(flyout.x - 60, flyout.y + flyout.height / 2);
  await expect(layers).toBeVisible();

  const again = await openPreferences(page, "Workspace");
  await expect(again.getByRole("checkbox", { name: "Large Tabs" })).not.toBeChecked();
  await expect(again.getByRole("checkbox", { name: "Auto-Collapse Iconic Panels" })).not.toBeChecked();
  await expect(again.getByRole("checkbox", { name: "Auto-Show Hidden Panels" })).toBeChecked();
});

test("Workspace ▸ Auto-Show Hidden Panels brings Tab-hidden panels back at the window edge", async ({ page }) => {
  await gotoApp(page);
  const dock = page.getByRole("region", { name: "right dock", exact: true });
  await page.locator("body").press("Tab");
  await expect(dock).toBeHidden();
  const { width, height } = page.viewportSize()!;
  await page.mouse.move(width - 2, height / 2);
  await expect(dock).toBeVisible();
  await page.mouse.move(width / 2, height / 2);
  await expect(dock).toBeHidden();

  await page.evaluate(() => (window as any).__mv.store.setWorkspacePrefs({ autoShowHiddenPanels: false }));
  await page.mouse.move(width - 2, height / 2);
  await expect(dock).toBeHidden();
});

test("Camera Raw ▸ Show Camera Raw off opens a raw file straight into a document after a reload", async ({ page }) => {
  await gotoApp(page);
  const prefs = await openPreferences(page, "Camera Raw");
  await prefs.getByRole("checkbox", { name: "Show Camera Raw when opening raw files" }).click();
  await prefs.getByRole("button", { name: "OK", exact: true }).click();

  await reload(page);
  const opened = await page.evaluate(async (payload) => {
    const mv = (window as any).__mv;
    const id = mv.store.openRaw(new Uint8Array(payload), "straight.dng");
    const disposition = await mv.store.waitForCameraRawSession(id);
    return { disposition, dialog: mv.store.state.pendingDialog?.name ?? null, active: mv.store.state.documents.find((d: any) => d.id === mv.store.state.activeDocId)?.name };
  }, [...tinyLinearDng(3)]);
  expect(opened).toEqual({ disposition: "open", dialog: null, active: "straight.dng" });
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const again = await openPreferences(page, "Camera Raw");
  await expect(again.getByRole("checkbox", { name: "Show Camera Raw when opening raw files" })).not.toBeChecked();
});

test("Camera Raw ▸ Demosaic and Depth are the workspace's own menus, both ways, across a reload", async ({ page }) => {
  await gotoApp(page);
  const prefs = await openPreferences(page, "Camera Raw");
  await prefs.getByRole("combobox", { name: "Raw demosaic" }).click();
  await page.getByRole("option", { name: "Bilinear (fast)" }).click();
  await prefs.getByRole("combobox", { name: "Raw open depth" }).click();
  await page.getByRole("option", { name: "32 Bits/Channel (float)" }).click();
  await prefs.getByRole("button", { name: "OK", exact: true }).click();

  await reload(page);
  await page.evaluate((payload) => { (window as any).__mv.store.openRaw(new Uint8Array(payload), "prefs.dng"); }, [...tinyLinearDng(4)]);
  const workspace = page.getByRole("dialog");
  await expect(workspace.getByText("Camera Raw", { exact: true })).toBeVisible();
  const demosaic = workspace.getByRole("combobox", { name: "Demosaic" });
  await expect(demosaic).toContainText("Bilinear");
  await expect(workspace.getByRole("combobox", { name: "Open Depth" })).toContainText("32 Bits");
  // The workspace's menu writes the very pref the pane shows.
  await demosaic.click();
  await page.getByRole("option", { name: "Adaptive (PPG)" }).click();
  await expect(demosaic).toContainText("Adaptive");
  await workspace.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const again = await openPreferences(page, "Camera Raw");
  await expect(again.getByRole("combobox", { name: "Raw demosaic" })).toContainText("Adaptive (PPG)");
  await expect(again.getByRole("combobox", { name: "Raw open depth" })).toContainText("32 Bits/Channel (float)");
});

test("Window ▸ <panel> springs an iconified panel out of its collapsed dock (#479)", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Collapse right dock", exact: true }).click();
  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Layers", exact: true })
    .or(page.getByRole("menuitem", { name: "Layers", exact: true })).click();
  await expect(page.getByRole("dialog", { name: "Layers panel", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand right dock", exact: true })).toBeVisible();
  await expect(page.getByLabel("right panels", { exact: true }).getByRole("button", { name: "Layers", exact: true })).toBeVisible();
});

test("nothing reachable in Preferences says it has no options unless there is no subsystem", async ({ page }) => {
  await gotoApp(page);
  const prefs = await openPreferences(page, "Scratch Disks");
  const empty = ["Scratch Disks", "Plug-Ins", "Technology Previews", "Product Improvement"];
  const sections = await prefs.locator("div[style*='overflow-y'] > div").allTextContents();
  expect(sections).toHaveLength(20);
  for (const section of sections) {
    await prefs.getByText(section, { exact: true }).first().click();
    const note = prefs.getByText("No configurable options for this pane in this build.");
    if (empty.includes(section)) await expect(note).toBeVisible();
    else await expect(note).toHaveCount(0);
  }
});
