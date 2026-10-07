import { expect, test, type JSHandle, type Locator, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// #481: Edit ▸ Toolbar… opens Customize Toolbar. Its edits drive the live rail and
// the Extra Tools "…" footer in both orientations, persist on OK and with a saved
// workspace, and are discarded by Cancel/Escape. Bad data is reported, not applied.

type Config = { version: 1; slots: Array<string[] | "div">; extra: string[] };
const TOOL_DRAG_TYPE = "application/x-monet-toolbar-tool";

/** Click through the live menu bar: top-level, hovered submenus, then the item. */
async function menu(page: Page, ...path: string[]) {
  const last = path.pop()!;
  await page.getByRole("menuitem", { name: path[0], exact: true }).click();
  for (const item of path.slice(1)) await page.getByRole("menuitem", { name: item, exact: true }).hover();
  await page.getByRole("menuitem", { name: last, exact: true }).click();
}

async function customize(page: Page) {
  await menu(page, "Edit", "Toolbar…");
  const dialog = page.getByRole("dialog", { name: "Customize Toolbar", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

const config = (page: Page): Promise<Config> => page.evaluate(() => (window as any).__mv.store.state.toolbarConfiguration);
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("mv.toolbarConfiguration"));
const extraButton = (page: Page) => page.getByRole("button", { name: "Extra Tools", exact: true });
const extraMenu = (page: Page) => page.getByRole("menu", { name: "Extra Tools", exact: true });
const row = (dialog: Locator, id: string) => dialog.locator(`[data-mv-config-tool="${id}"]`);
const extraGroup = (dialog: Locator) => dialog.getByRole("group", { name: "Extra Tools", exact: true });
const button = (dialog: Locator, name: string) => dialog.getByRole("button", { name, exact: true });
const slotWith = (c: Config, id: string) => c.slots.find((slot) => slot !== "div" && slot.includes(id));
const slotIndex = (c: Config, id: string) => c.slots.findIndex((slot) => slot !== "div" && slot.includes(id));

/** Fire a drag event in the page; true when a handler accepted it (preventDefault). */
const fire = (target: Locator, type: string, transfer: JSHandle<DataTransfer>) =>
  target.evaluate((element, [type, dataTransfer]) => {
    const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, [type, transfer] as const);

/** Drag a dialog row (or a raw tool id, as a foreign drag would carry) onto a target.
 *  The dragover must be accepted, or a real browser would never deliver the drop. */
async function drag(page: Page, target: Locator, source: Locator | { id: string }) {
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  if ("id" in source) await transfer.evaluate((dt, [type, id]) => dt.setData(type, id), [TOOL_DRAG_TYPE, source.id] as const);
  else await fire(source, "dragstart", transfer);
  expect(await fire(target, "dragover", transfer)).toBe(true);
  await fire(target, "drop", transfer);
  await transfer.dispose();
}

/** Apply a workspace from Window ▸ Workspace. The toolbar is parked on top first, and
 *  every apply that gets past the tool arrangement returns it to the left edge. */
async function applyWorkspace(page: Page, name: string) {
  await page.evaluate(() => (window as any).__mv.store.getWorkspace().setToolbarLayout({ top: [["tools"], ["options"]] }));
  await expect(page.locator('[data-tb-side="top"] [data-tool-group="grp-marquee"]')).toBeVisible();
  await menu(page, "Window", "Workspace", name);
  await expect(page.locator('[data-tb-side="left"] [data-tool-group="grp-marquee"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000); // cold swiftshader boot plus many menu round trips
  await gotoApp(page);
  await expect(page.locator('[data-tool-group="grp-marquee"]')).toBeVisible();
});

test("toolbar edits reach the rail live in both orientations; Cancel and Escape discard; Restore Defaults", async ({ page }) => {
  const factory = await config(page);
  expect(await stored(page)).toBeNull();

  for (const dismiss of ["Cancel", "Escape"]) {
    const dialog = await customize(page);
    await row(dialog, "zoom").click();
    await button(dialog, "Move to Extra Tools").click();
    await expect(row(extraGroup(dialog), "zoom")).toBeVisible();
    if (dismiss === "Cancel") await button(dialog, "Cancel").click();
    else await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-tool="zoom"]')).toBeVisible();
    await expect(extraButton(page)).toHaveCount(0);
    expect(await config(page)).toEqual(factory);
    expect(await stored(page)).toBeNull();
  }

  const dialog = await customize(page);
  const step = async (tool: string, action: string) => {
    await row(dialog, tool).click();
    await button(dialog, action).click();
  };
  await step("zoom", "Move to Extra Tools");
  await step("pencil", "Ungroup Tool");
  await step("colorreplace", "Move Tool Down");
  await step("adjustmentbrush", "Move Tool Up");
  await step("pencil", "Move Slot Down");
  await step("frame", "Move Slot Up");
  await row(dialog, "rotateview").click();
  await chooseOption(dialog.getByRole("combobox", { name: "Destination tool group", exact: true }), "Move");
  await button(dialog, "Group Tool").click();

  await drag(page, dialog.locator('[data-mv-toolbar-insert="0"]'), row(dialog, "ruler"));
  await drag(page, extraGroup(dialog), row(dialog, "count"));
  await drag(page, row(dialog, "dodge"), row(dialog, "sponge"));
  await button(dialog, "OK").click();
  await expect(dialog).toBeHidden();

  const c = await config(page);
  expect(c.slots[0]).toEqual(["ruler"]);
  expect(c.slots[1]).toEqual(["move", "rotateview"]);
  expect(c.extra).toEqual(["zoom", "count"]);
  expect(slotWith(c, "pencil")).toEqual(["pencil"]);
  expect(slotWith(c, "brush")).toEqual(["brush", "mixerbrush", "adjustmentbrush", "colorreplace"]);
  expect(slotWith(c, "dodge")).toEqual(["sponge", "dodge", "burn"]);
  expect(slotIndex(c, "frame")).toBeLessThan(slotIndex(c, "crop"));
  expect(slotIndex(c, "pencil")).toBeGreaterThan(slotIndex(c, "clone"));
  expect(JSON.parse((await stored(page))!)).toEqual(c);

  // Vertical rail.
  await expect(page.locator('[data-tb-side="left"] .monet-tool').first()).toHaveAttribute("data-tool", "ruler");
  await expect(page.locator('[data-tool-group="custom-move"]')).toHaveAttribute("data-tool", "move");
  await expect(page.locator('[data-tool="pencil"]')).toHaveAttribute("data-orient", "v");
  await expect(page.locator('[data-tool="zoom"]')).toHaveCount(0);
  await expect(extraButton(page)).toHaveAttribute("data-orient", "v");

  // The "…" footer opens from the keyboard like a tool group and roves its items.
  await extraButton(page).focus();
  await page.keyboard.press("ArrowDown");
  const items = extraMenu(page).getByRole("menuitemradio");
  await expect(items).toHaveText(["Zoom (Z)", "Count (I)"]);
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(extraMenu(page)).toBeHidden();

  await extraButton(page).click();
  await extraMenu(page).getByRole("menuitemradio", { name: "Zoom (Z)", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("zoom");
  await expect(extraButton(page)).toHaveAttribute("aria-pressed", "true");

  // Horizontal rail.
  await page.evaluate(() => (window as any).__mv.store.getWorkspace().setToolbarLayout({ top: [["tools"], ["options"]] }));
  await expect(page.locator('[data-tb-side="top"] [data-tool="pencil"]')).toHaveAttribute("data-orient", "h");
  await expect(extraButton(page)).toHaveAttribute("data-orient", "h");
  await expect(page.locator('[data-tool="zoom"]')).toHaveCount(0);
  await extraButton(page).click();
  await expect(extraMenu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(extraMenu(page)).toBeHidden();

  const restore = await customize(page);
  await button(restore, "Restore Defaults").click();
  await button(restore, "OK").click();
  await expect(restore).toBeHidden();
  expect(await config(page)).toEqual(factory);
  expect(JSON.parse((await stored(page))!)).toEqual(factory);
  await expect(extraButton(page)).toHaveCount(0);
  await expect(page.locator('[data-tool-group="grp-hand"]')).toHaveAttribute("data-orient", "h");
  await expect(page.locator('[data-tool="zoom"]')).toBeVisible();
});

test("a saved workspace carries the rail across reloads, built-in and pre-#481 workspaces keep it", async ({ page }) => {
  const dialog = await customize(page);
  await row(dialog, "zoom").click();
  await button(dialog, "Move to Extra Tools").click();
  await button(dialog, "OK").click();
  await expect(dialog).toBeHidden();
  const custom = await config(page);

  page.once("dialog", (prompt) => prompt.accept("Custom Rail"));
  await menu(page, "Window", "Workspace", "Save Workspace…");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mv.workspaces") ?? "[]")
    .find((w: { name: string }) => w.name === "Custom Rail")?.toolConfiguration)).toEqual(custom);
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem("mv.workspaces")!);
    list.push({ name: "Before 481", layout: list.find((w: { name: string }) => w.name === "Custom Rail").layout });
    localStorage.setItem("mv.workspaces", JSON.stringify(list));
  });

  await page.reload();
  await gotoApp(page);
  expect(await config(page)).toEqual(custom);
  await expect(page.locator('[data-tool="zoom"]')).toHaveCount(0);
  await expect(extraButton(page)).toBeVisible();

  await applyWorkspace(page, "Essentials");
  expect(await config(page)).toEqual(custom);
  await applyWorkspace(page, "Before 481");
  expect(await config(page)).toEqual(custom);
  expect(JSON.parse((await stored(page))!)).toEqual(custom);

  const restore = await customize(page);
  await button(restore, "Restore Defaults").click();
  await button(restore, "OK").click();
  await expect(restore).toBeHidden();
  await expect(extraButton(page)).toHaveCount(0);
  await expect(page.locator('[data-tool="zoom"]')).toBeVisible();

  await applyWorkspace(page, "Custom Rail");
  expect(await config(page)).toEqual(custom);
  expect(JSON.parse((await stored(page))!)).toEqual(custom);
  await expect(extraButton(page)).toBeVisible();
  await expect(page.locator('[data-tool="zoom"]')).toHaveCount(0);
});

test("corrupt toolbar data and foreign drops report actionable errors and change nothing", async ({ page }) => {
  const seedLayout = await page.evaluate(() => (window as any).__mv.store.getWorkspace().getLayout());
  await page.evaluate((layout) => {
    localStorage.setItem("mv.toolbarConfiguration", "{");
    localStorage.setItem("mv.workspaces", JSON.stringify([{
      name: "Broken",
      layout: { ...layout, right: { ...layout.right, size: (layout.right?.size ?? 440) + 120 } },
      toolConfiguration: { version: 2, slots: [], extra: [] },
    }]));
  }, seedLayout);
  await page.reload();
  await gotoApp(page);
  await expect(page.locator('[data-tool-group="grp-marquee"]')).toBeVisible();

  const dialog = await customize(page);
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("Restore Defaults");
  await drag(page, extraGroup(dialog), { id: "retired" });
  await expect(alert).toContainText("Choose an existing tool");
  await button(dialog, "Cancel").click();
  await expect(dialog).toBeHidden();
  expect(await stored(page)).toBe("{");

  const layout = await page.evaluate(() => (window as any).__mv.store.getWorkspace().getLayout());
  await menu(page, "Window", "Workspace", "Broken");
  await expect(page.getByText(/Unsupported toolbar configuration/)).toBeVisible();
  expect(await stored(page)).toBe("{");
  expect(await page.evaluate(() => (window as any).__mv.store.getWorkspace().getLayout())).toEqual(layout);
  await expect(page.locator('[data-tool-group="grp-marquee"]')).toBeVisible();
});
