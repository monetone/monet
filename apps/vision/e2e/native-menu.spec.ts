import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── native macOS system menu bar (1:1 Photoshop shell) ─────────
// Vision uses the native macOS frame and only draws an in-window menu on
// Windows, so native/macMenu.ts mirrors a faithful Photoshop menu
// (ui/psMenuData.ts → buildPhotoshopMenus) into the system NSMenu: commands Monet
// implements are wired; the rest are disabled placeholders so the bar matches
// Photoshop item-for-item. The real NSMenu isn't drivable by Playwright, but the
// tree builder + id→action dispatch (where the structure + wiring live) run in
// the browser and are verified here via window.__mv.macMenu (exposed in dev).

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  // Wait until the menu sync effect has populated the tree (post first render).
  await page.waitForFunction(() => (window as any).__mv?.macMenu?.currentMenuTree?.().length === 8);
});

/** Flatten the native menu tree to leaf items with their full path-id + state. */
const leaves = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const out: { id: string; text: string; enabled: boolean }[] = [];
    const walk = (n: any) => {
      if (n.kind === "submenu") n.items.forEach(walk);
      else if (n.kind === "item") out.push({ id: n.id, text: n.text, enabled: n.enabled });
    };
    (window as any).__mv.macMenu.currentMenuTree().forEach(walk);
    return out;
  });

test("top-level menus match Photoshop's bar (Adjustments folded into Image; no 3D — retired like Photoshop)", async ({ page }) => {
  const ids = await page.evaluate(() =>
    (window as any).__mv.macMenu.currentMenuTree().map((m: any) => m.id));
  expect(ids).toEqual(["file", "edit", "image", "layer", "type", "select", "filter", "view"]);
  // The standalone "Adjustments" top-level menu is gone (Photoshop has none).
  expect(ids).not.toContain("adjust");
  // 3D was retired by Photoshop (~2024); Monet mirrors the current bar.
  expect(ids).not.toContain("threed");
  // "Window" is not a top-level mirror: syncMacMenu synthesizes the OS Window
  // submenu and folds the app's own Window commands in below it, so the bar
  // carries exactly one Window menu (#497).
  expect(ids).not.toContain("window");
});

test("File carries the document commands; Photoshop placeholders are present too", async ({ page }) => {
  const tree = await page.evaluate(() => (window as any).__mv.macMenu.currentMenuTree());
  const file = tree.find((m: any) => m.id === "file");
  expect(file.text).toBe("File");
  // top-level File item labels (not nested)
  const topItems = file.items.filter((i: any) => i.kind === "item").map((i: any) => i.text);
  expect(topItems).toEqual(expect.arrayContaining(["New…", "Open…", "Document Browser…", "Save", "Save As…", "Close"]));
  // Photoshop submenus exist (Export groups the Monet exports)
  const subs = file.items.filter((i: any) => i.kind === "submenu").map((i: any) => i.text);
  expect(subs).toEqual(expect.arrayContaining(["Export", "Scripts", "Import"]));
  // Create Droplet is a live Automate command.
  const all = await leaves(page);
  const droplet = all.find((i) => i.id === "file/automate/createdroplet" && i.text === "Create Droplet…");
  expect(droplet).toBeTruthy();
  expect(droplet!.enabled).toBe(true);
});

test("Image ▸ Adjustments and Image ▸ Mode keep Photoshop's nesting + path ids", async ({ page }) => {
  const tree = await page.evaluate(() => (window as any).__mv.macMenu.currentMenuTree());
  const image = tree.find((m: any) => m.id === "image");
  const mode = image.items.find((i: any) => i.kind === "submenu" && i.text === "Mode");
  const adj = image.items.find((i: any) => i.kind === "submenu" && i.text === "Adjustments");
  expect(mode && adj).toBeTruthy();
  const d8 = mode.items.find((i: any) => i.text === "8 Bits/Channel");
  expect(d8.id).toBe("image/mode/d8"); // full path id used by native dispatch
  const levels = adj.items.find((i: any) => i.text === "Levels…");
  expect(levels.id).toBe("image/adjustments/lv");
});

test("every ENABLED leaf has a wired action; disabled placeholders have none", async ({ page }) => {
  const all = await leaves(page);
  const actionIds: string[] = await page.evaluate(() => (window as any).__mv.macMenu.currentActionIds());
  const enabled = all.filter((i) => i.enabled);
  const disabled = all.filter((i) => !i.enabled);
  // a faithful shell has far more total items than wired commands
  expect(all.length).toBeGreaterThan(400);
  expect(enabled.length).toBeGreaterThan(400);
  expect(new Set(actionIds).size).toBe(actionIds.length);
  // The app's Window commands are folded into the OS Window submenu instead of
  // a top-level mirror, so they are registered without a leaf in this tree (#497).
  const windowIds = actionIds.filter((id) => id.startsWith("window/"));
  expect(windowIds.length).toBeGreaterThan(0);
  expect(enabled.length + windowIds.length).toBe(actionIds.length);
  // every enabled leaf resolves to a registered action
  const unwired = enabled.filter((i) => !actionIds.includes(i.id));
  expect(unwired).toEqual([]);
  // disabled placeholders are NOT registered (no dead actions)
  const leakedDisabled = disabled.filter((i) => actionIds.includes(i.id));
  expect(leakedDisabled).toEqual([]);
});

test("dispatching a menu id runs the matching live action", async ({ page }) => {
  // Find enabled leaves by label and dispatch their real path-ids.
  const all = await leaves(page);
  const newLayer = all.find((i) => i.id === "layer/new/nl" && i.text === "Layer…" && i.enabled);
  const hundred = all.find((i) => i.id === "view/actual" && i.text === "100%" && i.enabled);
  // East Asian Features is wired now (#455); Indic Features is still unwired.
  const disabledPlaceholder = all.find((i) => i.id === "type/language-options/langindic" && !i.enabled);
  expect(newLayer && hundred && disabledPlaceholder).toBeTruthy();

  const before = await page.evaluate(() => (window as any).__mv.engine.engine.layer_count());
  await page.evaluate((id) => (window as any).__mv.macMenu.dispatchMenuAction(id), newLayer!.id);
  await expect(page.locator("#mv-newlayer-name")).toBeVisible();
  await page.getByRole("button", { name: "OK" }).click();
  const after = await page.evaluate(() => (window as any).__mv.engine.engine.layer_count());
  expect(after).toBe(before + 1);

  await page.evaluate(() => (window as any).__mv.store.setZoom(3));
  await page.evaluate((id) => (window as any).__mv.macMenu.dispatchMenuAction(id), hundred!.id);
  expect(await page.evaluate(() => (window as any).__mv.store.state.zoom)).toBe(1);

  // A genuinely disabled placeholder + unknown id are safe no-ops (don't throw).
  await page.evaluate((id) => (window as any).__mv.macMenu.dispatchMenuAction(id), disabledPlaceholder!.id);
  await page.evaluate(() => (window as any).__mv.macMenu.dispatchMenuAction("nope/nope"));
});
