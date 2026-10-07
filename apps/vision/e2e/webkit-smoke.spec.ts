import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("workspace chrome cannot be text-selected, while fields remain editable", async ({ page }) => {
  // The browser harness does not receive Tauri's native-shell marker.
  await page.evaluate(() => document.documentElement.setAttribute("data-monet-tauri", ""));
  const status = page.locator("[data-mv-status]");
  const box = await status.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + 1, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 1, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();

  expect(await page.evaluate(() => getSelection()?.toString())).toBe("");
  expect(await page.locator("#mv-status-zoom").evaluate((el) => {
    const style = getComputedStyle(el);
    return style.getPropertyValue("-webkit-user-select") || style.userSelect;
  })).toBe("text");
});

test("panel splitters track a rapid pointer drag without snapping back", async ({ page }) => {
  const splitter = page.getByRole("separator", { name: "Resize panels" }).first();
  const start = await splitter.boundingBox();
  expect(start).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2 + 100, { steps: 10 });
  await page.mouse.up();

  const moved = await splitter.boundingBox();
  expect(Math.abs(moved!.y - start!.y - 100)).toBeLessThan(2);
  await page.waitForTimeout(200);
  expect(Math.abs((await splitter.boundingBox())!.y - moved!.y)).toBeLessThan(1);
});

test("the engine edits and reopens the same document", async ({ page }) => {
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const checksum = () => {
      const pixels = mv.engine.outputCopy() as Uint8ClampedArray;
      let value = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        value = (Math.imul(value, 33) + pixels[i] + pixels[i + 1] * 3 + pixels[i + 2] * 7 + pixels[i + 3] * 11) >>> 0;
      }
      return value;
    };

    mv.store.newDocument(48, 36, "webkit-smoke", "transparent");
    const engine = mv.engine.engine;
    engine.fill_selection(37, 91, 173, 255);
    mv.engine.commit();
    const edited = checksum();
    const bytes = mv.saveProjectBytes();
    mv.store.openProject(bytes, "webkit-smoke-reopened.mvision");
    return {
      edited,
      reopened: checksum(),
      width: mv.engine.engine.width(),
      height: mv.engine.engine.height(),
      layers: mv.engine.engine.layer_count(),
    };
  });

  expect(result).toMatchObject({ width: 48, height: 36, layers: 1 });
  expect(result.reopened).toBe(result.edited);
});

test("menus and dialogs expose keyboard, focus, and ARIA contracts", async ({ page }) => {
  const menubar = page.getByRole("menubar", { name: "Application menu" });
  await expect(menubar).toBeVisible();
  const aria = await menubar.ariaSnapshot();
  expect(aria).toContain('menuitem "File"');
  expect(aria).toContain('menuitem "Edit"');

  const file = page.getByRole("menuitem", { name: "File", exact: true });
  const edit = page.getByRole("menuitem", { name: "Edit", exact: true });
  await file.focus();
  await page.keyboard.press("ArrowRight");
  await expect(edit).toBeFocused();
  await page.keyboard.press("Enter");
  const editMenu = page.getByRole("menu", { name: "Edit", exact: true });
  await expect(editMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editMenu).toBeHidden();
  await expect(edit).toBeFocused();

  await page.keyboard.press("ControlOrMeta+KeyF");
  const dialog = page.getByRole("dialog", { name: "Search" });
  const search = page.getByRole("textbox", { name: "Search commands" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(search).toBeFocused();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  const first = page.getByRole("button", { name: "Close dialog" });
  const last = page.getByRole("button", { name: "Close", exact: true });
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();

  await search.focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
});
