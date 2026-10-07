import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

const levels = (page: Page) => page.locator('[data-mv-shortcut-command="lv"]');
const sets = (page: Page) => page.getByRole("combobox", { name: "Shortcut set", exact: true });
const saved = (page: Page) => page.evaluate(() => ({
  sets: localStorage.getItem("mv.keyboardShortcutSets"), shortcuts: localStorage.getItem("mv.keyboardShortcuts"),
}));
async function open(page: Page) {
  await page.keyboard.press("Alt+Shift+ControlOrMeta+KeyK");
  await expect(page.getByText("Keyboard Shortcuts and Menus", { exact: true })).toBeVisible();
}
async function saveAs(page: Page, name: string) {
  await page.getByRole("button", { name: "Save Set As…", exact: true }).click();
  await page.getByRole("textbox", { name: "New shortcut set name" }).fill(name);
  await page.getByRole("button", { name: "Create Set", exact: true }).click();
}
async function importFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import Set…", exact: true }).click();
  await (await chooser).setFiles(file);
}

test.beforeEach(async ({ page }) => { await gotoApp(page); });

test("named sets save, switch, overwrite, and delete with Cancel discarding pending changes", async ({ page }) => {
  await open(page);
  await expect(sets(page)).toHaveAttribute("data-value", "set:");
  await expect(page.getByRole("button", { name: "Delete Set", exact: true })).toBeDisabled();
  await levels(page).focus();
  await page.keyboard.press("Alt+ControlOrMeta+KeyL");
  await saveAs(page, "Retouch");
  await expect(sets(page)).toHaveAttribute("data-value", "set:Retouch");
  expect(await saved(page)).toEqual({ sets: null, shortcuts: null });
  await page.getByRole("button", { name: "OK", exact: true }).click();
  const original = await saved(page);

  await open(page);
  await chooseOption(sets(page), "set:");
  await expect(levels(page)).toHaveValue("⌘L");
  await chooseOption(sets(page), "set:Retouch");
  await expect(levels(page)).toHaveValue("⌥⌘L");
  await levels(page).focus();
  await page.keyboard.press("Alt+Shift+ControlOrMeta+KeyL");
  await expect(page.getByRole("button", { name: "Save Set", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Accept and Replace", exact: true }).click();
  await page.getByRole("button", { name: "Save Set", exact: true }).click();
  await saveAs(page, "Other");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await saved(page)).toEqual(original);

  await open(page);
  await expect(sets(page)).toHaveAttribute("data-value", "set:Retouch");
  await expect(levels(page)).toHaveValue("⌥⌘L");
  await levels(page).focus();
  await page.keyboard.press("Alt+Shift+ControlOrMeta+KeyL");
  await page.getByRole("button", { name: "Accept and Replace", exact: true }).click();
  await page.getByRole("button", { name: "Save Set", exact: true }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.reload();
  await gotoApp(page);
  await open(page);
  await expect(sets(page)).toHaveAttribute("data-value", "set:Retouch");
  await expect(levels(page)).toHaveValue("⌥⇧⌘L");
  await page.getByRole("button", { name: "Delete Set", exact: true }).click();
  await expect(sets(page)).toHaveAttribute("data-value", "set:");
  await expect(levels(page)).toHaveValue("⌘L");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await open(page);
  await expect(sets(page)).toHaveAttribute("data-value", "set:Retouch");
  await page.getByRole("button", { name: "Delete Set", exact: true }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await saved(page)).toEqual({ sets: '{"version":1,"sets":[],"selected":""}', shortcuts: null });
});

test("exported shortcuts round trip through disk into a fresh profile and dispatch after reload", async ({ page, browser, baseURL }, testInfo) => {
  await open(page);
  await levels(page).focus();
  await page.keyboard.press("Alt+ControlOrMeta+KeyL");
  await saveAs(page, "Retouch");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Set…", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Retouch.monetkeys");
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    format: "monet-shortcut-set", version: 1, name: "Retouch", shortcuts: { lv: "Mod+Alt+KeyL" },
  });
  const profile = await browser.newContext({ baseURL });
  try {
    const other = await profile.newPage();
    await gotoApp(other);
    expect(await saved(other)).toEqual({ sets: null, shortcuts: null });
    await open(other);
    await importFile(other, path);
    await expect(sets(other)).toHaveAttribute("data-value", "set:Retouch");
    await expect(levels(other)).toHaveValue("⌥⌘L");
    expect(await saved(other)).toEqual({ sets: null, shortcuts: null });
    // Re-importing the same name must preserve the existing set.
    await importFile(other, path);
    await expect(sets(other)).toHaveAttribute("data-value", "set:Retouch 2");
    await other.getByRole("button", { name: "OK", exact: true }).click();
    await other.reload();
    await gotoApp(other);
    await other.keyboard.press("Alt+ControlOrMeta+KeyL");
    await expect(other.getByText("Levels", { exact: true })).toBeVisible();
    await other.getByRole("button", { name: "Cancel", exact: true }).click();
    await open(other);
    await expect(sets(other)).toHaveAttribute("data-value", "set:Retouch 2");
    await expect(levels(other)).toHaveValue("⌥⌘L");
    await sets(other).click();
    await expect(other.locator(".monet-listbox [role=option]")).toHaveText(["Monet Defaults", "Retouch", "Retouch 2"]);
  } finally { await profile.close(); }
});

test("invalid imports, file-picker cancellation, naming errors, and an unreadable set library preserve preferences and workspace shortcuts", async ({ page }) => {
  // Listen before anything can alert: Playwright's silent auto-dismiss would hide a missing report.
  const nativeAlerts: string[] = [];
  page.on("dialog", (d) => { nativeAlerts.push(d.message()); void d.dismiss(); });
  await page.evaluate(() => (window as any).__mv.store.setKeyboardShortcuts({ lv: "Mod+Alt+KeyL" }));
  const original = await saved(page);
  await open(page);
  await expect(sets(page)).toHaveAttribute("data-value", "custom");
  await expect(levels(page)).toHaveValue("⌥⌘L");
  for (const buffer of [Buffer.from("{"), Buffer.from(JSON.stringify({
    format: "monet-shortcut-set", version: 1, name: "Broken", shortcuts: { lv: "Mod+KeyM" },
  }))]) {
    await importFile(page, { name: "broken.monetkeys", mimeType: "application/json", buffer });
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(levels(page)).toHaveValue("⌥⌘L");
    await expect(sets(page)).toHaveAttribute("data-value", "custom");
    expect(await saved(page)).toEqual(original);
  }
  // An oversize file is refused before it is read, with the real limit in the message.
  await importFile(page, { name: "big.monetkeys", mimeType: "application/json", buffer: Buffer.alloc(256 * 1024 + 1, 32) });
  await expect.poll(() => nativeAlerts).toEqual([expect.stringContaining("256 KiB")]);
  await expect(page.getByRole("button", { name: "Import Set…", exact: true })).toBeEnabled();
  await expect(levels(page)).toHaveValue("⌥⌘L");
  await expect(sets(page)).toHaveAttribute("data-value", "custom");
  expect(await saved(page)).toEqual(original);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import Set…", exact: true }).click();
  await chooser;
  await page.locator('input[type="file"][accept=".monetkeys"]').evaluate((input) => input.dispatchEvent(new Event("cancel")));
  await expect(page.getByRole("button", { name: "Import Set…", exact: true })).toBeEnabled();
  await expect(levels(page)).toHaveValue("⌥⌘L");
  // Escape in the naming row closes only that row, not the dialog with its staged edits.
  await page.getByRole("button", { name: "Save Set As…", exact: true }).click();
  await page.getByRole("textbox", { name: "New shortcut set name" }).press("Escape");
  await expect(page.getByRole("textbox", { name: "New shortcut set name" })).toBeHidden();
  await expect(page.getByText("Keyboard Shortcuts and Menus", { exact: true })).toBeVisible();
  await expect(levels(page)).toHaveValue("⌥⌘L");
  await saveAs(page, "Monet Defaults");
  await expect(page.getByRole("alert")).toContainText("cannot be overwritten");
  await page.getByRole("textbox", { name: "New shortcut set name" }).fill("Workspace Copy");
  await page.getByRole("button", { name: "Create Set", exact: true }).click();
  await saveAs(page, "Workspace Copy");
  await expect(page.getByRole("alert")).toContainText("already exists");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await saved(page)).toEqual(original);

  // The library is read when the dialog mounts: an unreadable one is reported and never overwritten.
  await page.evaluate(() => localStorage.setItem("mv.keyboardShortcutSets", "{"));
  await open(page);
  await expect(page.getByRole("alert")).toContainText("unreadable");
  await page.locator("[data-mv-shortcut-reset]").click();
  await chooseOption(sets(page), "set:");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByText("Keyboard Shortcuts and Menus", { exact: true })).toBeHidden();
  expect((await saved(page)).sets).toBe("{");
  expect(nativeAlerts).toHaveLength(1);
});

test("chords captured by a saved workspace still apply after switching to a named set", async ({ page }) => {
  await open(page);
  await levels(page).focus();
  await page.keyboard.press("Alt+ControlOrMeta+KeyL");
  await saveAs(page, "Retouch");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByText("Keyboard Shortcuts and Menus", { exact: true })).toBeHidden();

  page.once("dialog", (d) => void d.accept("Chords"));
  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page.getByRole("menuitem", { name: "Workspace", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Save Workspace…", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("mv.workspaces") ?? "")).toContain("Chords");

  await open(page);
  await chooseOption(sets(page), "set:");
  await expect(levels(page)).toHaveValue("⌘L");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect.poll(async () => (await saved(page)).shortcuts).toBeNull();
  const library = (await saved(page)).sets;

  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page.getByRole("menuitem", { name: "Workspace", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Chords", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Chords", exact: true })).toBeHidden();
  await expect.poll(async () => (await saved(page)).shortcuts).not.toBeNull();
  await page.keyboard.press("Alt+ControlOrMeta+KeyL");
  await expect(page.getByText("Levels", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await saved(page)).sets).toBe(library);
});
