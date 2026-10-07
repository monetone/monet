import { expect, test, type Page } from "@playwright/test";
import { chooseOption, gotoApp, newScene } from "./helpers";

const dialogTitle = "Keyboard Shortcuts and Menus";

async function resetShortcuts(page: Page) {
  await page.evaluate(() => {
    const store = (window as any).__mv.store;
    store.setKeyboardShortcuts({});
    store.setUseShiftKeyForToolSwitch(true);
    store.setSpringLoadedToolPreferences({ springLoadedToolShortcuts: true, springLoadedToolDelayMs: 200 });
  });
  await page.waitForFunction(() => {
    const palette = (window as any).__mv.commandPalette;
    return palette?.items?.some((item: any) => item.id === "keyboardshortcuts")
      && palette?.toolItems?.some((item: any) => item.id === "tool-b")
      && palette?.toolItems?.some((item: any) => item.id === "tool-q")
      && palette?.toolItems?.some((item: any) => item.id === "tool-screen-mode")
      && palette?.toolItems?.some((item: any) => item.id === "tool-brush-hardness-increase")
      && palette?.toolItems?.some((item: any) => item.id === "tool-brush-preset-previous")
      && palette?.toolItems?.some((item: any) => item.id === "tool-brush-preset-next")
      && palette?.toolItems?.some((item: any) => item.id === "tool-brush-preset-first")
      && palette?.toolItems?.some((item: any) => item.id === "tool-brush-preset-last");
  });
}

async function openShortcutDialog(page: Page) {
  await page.keyboard.press("Alt+Shift+ControlOrMeta+KeyK");
  await expect(page.getByText(dialogTitle, { exact: true })).toBeVisible();
}

async function cancelNamedDialog(page: Page, title: string) {
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await expect(page.getByText(title, { exact: true })).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await resetShortcuts(page);
  await newScene(page);
});

test("application-menu shortcuts rebind live, defer to inputs, persist, and reset", async ({ page }) => {
  test.setTimeout(120_000);
  await openShortcutDialog(page);
  const levels = page.locator('[data-mv-shortcut-command="lv"]');
  await levels.focus();
  await page.keyboard.press("Alt+ControlOrMeta+KeyL");
  await expect(levels).toHaveValue("⌥⌘L");
  await page.getByRole("button", { name: "OK" }).click();

  await page.keyboard.press("ControlOrMeta+KeyL");
  await expect(page.getByText("Levels", { exact: true })).toBeHidden();
  await page.keyboard.press("Alt+ControlOrMeta+KeyL");
  await cancelNamedDialog(page, "Levels");

  // The global dispatcher keeps Photoshop's text-field safety boundary.
  await page.locator("#mv-status-zoom").focus();
  await page.keyboard.press("Alt+ControlOrMeta+KeyL");
  await expect(page.getByText("Levels", { exact: true })).toBeHidden();
  await page.locator("canvas").first().focus();

  expect(await page.evaluate(() => {
    const item = (window as any).__mv.commandPalette.items.find((entry: any) => entry.id === "lv");
    return { chord: item.chord, saved: JSON.parse(localStorage.getItem("mv.keyboardShortcuts") || "{}") };
  })).toEqual({ chord: "Mod+Alt+KeyL", saved: { lv: "Mod+Alt+KeyL" } });

  await page.reload();
  await gotoApp(page);
  await newScene(page);
  await page.keyboard.press("Alt+ControlOrMeta+KeyL");
  await cancelNamedDialog(page, "Levels");

  await openShortcutDialog(page);
  await page.locator("[data-mv-shortcut-reset]").click();
  await page.getByRole("button", { name: "OK" }).click();
  expect(await page.evaluate(() => localStorage.getItem("mv.keyboardShortcuts"))).toBeNull();
  await page.keyboard.press("ControlOrMeta+KeyL");
  await cancelNamedDialog(page, "Levels");
});

test("a conflicting assignment names the owner and transfers the chord only after acceptance", async ({ page }) => {
  await openShortcutDialog(page);
  const curves = page.locator('[data-mv-shortcut-command="cv"]');
  await curves.focus();
  await page.keyboard.press("ControlOrMeta+KeyL");

  const conflict = page.locator("[data-mv-shortcut-conflict]");
  await expect(conflict).toContainText("Image ▸ Adjustments ▸ Levels…");
  await expect(curves).toHaveValue("⌘M");
  await conflict.getByRole("button", { name: "Accept and Replace" }).click();
  await expect(curves).toHaveValue("⌘L");
  await expect(page.locator('[data-mv-shortcut-command="lv"]')).toHaveValue("");
  await page.getByRole("button", { name: "OK" }).click();

  await page.keyboard.press("ControlOrMeta+KeyL");
  await cancelNamedDialog(page, "Curves");
  await page.keyboard.press("ControlOrMeta+KeyM");
  await expect(page.getByText("Curves", { exact: true })).toBeHidden();
});

test("shifted application chords transfer ownership with Tools letters in both directions", async ({ page }) => {
  test.setTimeout(120_000);
  const root = page.locator("html");
  const currentMode = () => page.evaluate(() => (window as any).__mv.store.state.screenMode);
  await openShortcutDialog(page);
  const levels = page.locator('[data-mv-shortcut-command="lv"]');
  const conflict = page.locator("[data-mv-shortcut-conflict]");
  await levels.focus();
  // Confirm focus has settled before dispatching the key: on a cold first render
  // the shortcut list can re-render right after focus(), and a key pressed before
  // focus lands is swallowed by the document instead of the field's capture.
  await expect(levels).toBeFocused();
  await page.keyboard.press("Shift+f");
  await expect(conflict).toContainText("Toggle Screen Modes");
  await conflict.getByRole("button", { name: "Cancel" }).click();
  await expect(levels).toHaveValue("⌘L");

  await levels.focus();
  await expect(levels).toBeFocused();
  await page.keyboard.press("Shift+f");
  await conflict.getByRole("button", { name: "Accept and Replace" }).click();
  await expect(levels).toHaveValue("⇧F");
  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  const screenMode = page.locator('[data-mv-shortcut-command="tool-screen-mode"]');
  await expect(screenMode).toHaveValue("");
  await page.getByRole("button", { name: "OK" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mv.keyboardShortcuts") || "{}"))).toEqual({
    lv: "Shift+KeyF",
    "tool-screen-mode": null,
  });
  await page.keyboard.press("f");
  expect(await currentMode()).toBe("standard");
  await page.keyboard.press("Shift+f");
  await cancelNamedDialog(page, "Levels");

  await page.reload();
  await gotoApp(page);
  await newScene(page);
  await page.waitForFunction(() => {
    const palette = (window as any).__mv.commandPalette;
    return palette?.items?.find((item: any) => item.id === "lv")?.chord === "Shift+KeyF"
      && palette?.toolItems?.find((item: any) => item.id === "tool-screen-mode")?.chord === null;
  });
  await page.keyboard.press("Shift+f");
  await cancelNamedDialog(page, "Levels");

  await openShortcutDialog(page);
  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  await screenMode.focus();
  await expect(screenMode).toBeFocused();
  await page.keyboard.press("f");
  await expect(conflict).toContainText("Image ▸ Adjustments ▸ Levels…");
  await conflict.getByRole("button", { name: "Accept and Replace" }).click();
  await expect(screenMode).toHaveValue("F");
  await chooseOption(page.locator("[data-mv-shortcut-category]"), "application");
  await expect(levels).toHaveValue("");
  await page.getByRole("button", { name: "OK" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mv.keyboardShortcuts") || "{}"))).toEqual({ lv: null });
  await page.keyboard.press("Shift+f");
  await expect(root).toHaveAttribute("data-mv-screen-mode", "full");
  await expect(page.getByText("Levels", { exact: true })).toBeHidden();
  await page.evaluate(() => (window as any).__mv.store.setScreenMode("standard"));
  await expect(root).toHaveAttribute("data-mv-screen-mode", "standard");

  await page.reload();
  await gotoApp(page);
  await newScene(page);
  await page.waitForFunction(() => {
    const palette = (window as any).__mv.commandPalette;
    return palette?.items?.find((item: any) => item.id === "lv")?.chord === null
      && palette?.toolItems?.find((item: any) => item.id === "tool-screen-mode")?.chord === "KeyF";
  });
  await page.keyboard.press("Shift+f");
  await expect(root).toHaveAttribute("data-mv-screen-mode", "full");
  await expect(page.getByText("Levels", { exact: true })).toBeHidden();
  await page.evaluate(() => (window as any).__mv.store.setScreenMode("standard"));
  await expect(root).toHaveAttribute("data-mv-screen-mode", "standard");
});

test("tool-group shortcuts rebind, Shift-cycle, persist, and reset", async ({ page }) => {
  await page.keyboard.press("g");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("gradient");
  await page.keyboard.press("Shift+KeyG");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("bucket");
  await page.keyboard.press("a");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("pathselect");
  await page.keyboard.press("r");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("rotateview");

  await openShortcutDialog(page);
  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  const brush = page.locator('[data-mv-shortcut-command="tool-b"]');
  await expect(brush).toHaveValue("B");
  await brush.focus();
  await page.keyboard.press("n");
  await expect(brush).toHaveValue("N");
  await page.getByRole("button", { name: "OK" }).click();

  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await page.keyboard.press("b");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("move");
  await page.keyboard.press("n");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("brush");
  await page.keyboard.press("Shift+n");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("pencil");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mv.keyboardShortcuts") || "{}"))).toEqual({ "tool-b": "KeyN" });

  await page.reload();
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await page.keyboard.press("n");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("brush");

  await openShortcutDialog(page);
  await page.locator("[data-mv-shortcut-reset]").click();
  await page.getByRole("button", { name: "OK" }).click();
  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await page.keyboard.press("b");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("brush");
});

test("D/X/Q action shortcuts rebind, conflict, persist, and defer to inputs", async ({ page }) => {
  test.setTimeout(120_000);
  await openShortcutDialog(page);
  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  const defaults = page.locator('[data-mv-shortcut-command="tool-d"]');
  const swap = page.locator('[data-mv-shortcut-command="tool-x"]');
  const quickMask = page.locator('[data-mv-shortcut-command="tool-q"]');
  await expect(defaults).toHaveValue("D");
  await expect(swap).toHaveValue("X");
  await expect(quickMask).toHaveValue("Q");

  await defaults.focus();
  await page.keyboard.press("n");
  await quickMask.focus();
  await page.keyboard.press("n");
  const conflict = page.locator("[data-mv-shortcut-conflict]");
  await expect(conflict).toContainText("Default Foreground/Background Colors");
  await conflict.getByRole("button", { name: "Cancel" }).click();
  await expect(quickMask).toHaveValue("Q");

  await swap.focus();
  await page.keyboard.press("d");
  await quickMask.focus();
  await page.keyboard.press("x");
  await expect(defaults).toHaveValue("N");
  await expect(swap).toHaveValue("D");
  await expect(quickMask).toHaveValue("X");
  await page.getByRole("button", { name: "OK" }).click();

  const RED = { h: 0, s: 1, v: 1, a: 1 };
  const BLUE = { h: 240, s: 1, v: 1, a: 1 };
  const BLACK = { h: 0, s: 0, v: 0, a: 1 };
  const WHITE = { h: 0, s: 0, v: 1, a: 1 };
  const colors = () => page.evaluate(() => {
    const state = (window as any).__mv.store.state;
    return { fg: state.fg, bg: state.bg, quickMask: state.quickMask };
  });
  const setColors = () => page.evaluate(({ red, blue }) => {
    const store = (window as any).__mv.store;
    store.setForeground(red);
    store.setBackground(blue);
  }, { red: RED, blue: BLUE });

  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mv.keyboardShortcuts") || "{}"))).toEqual({
    "tool-d": "KeyN", "tool-x": "KeyD", "tool-q": "KeyX",
  });
  await setColors();
  await page.keyboard.press("q");
  expect(await colors()).toEqual({ fg: RED, bg: BLUE, quickMask: false });
  await page.keyboard.press("d");
  expect(await colors()).toEqual({ fg: BLUE, bg: RED, quickMask: false });
  await page.keyboard.press("x");
  expect(await colors()).toEqual({ fg: BLUE, bg: RED, quickMask: true });
  await page.keyboard.press("x");
  await page.keyboard.press("n");
  expect(await colors()).toEqual({ fg: BLACK, bg: WHITE, quickMask: false });

  await setColors();
  await page.locator("#mv-status-zoom").focus();
  await page.keyboard.press("n");
  await page.keyboard.press("d");
  await page.keyboard.press("x");
  expect(await colors()).toEqual({ fg: RED, bg: BLUE, quickMask: false });

  await page.reload();
  await gotoApp(page);
  await newScene(page);
  expect(await page.evaluate(() => Object.fromEntries(
    (window as any).__mv.commandPalette.toolItems
      .filter((item: any) => ["tool-d", "tool-x", "tool-q"].includes(item.id))
      .map((item: any) => [item.id, item.chord]),
  ))).toEqual({ "tool-d": "KeyN", "tool-x": "KeyD", "tool-q": "KeyX" });
  await setColors();
  await page.keyboard.press("q");
  expect(await colors()).toEqual({ fg: RED, bg: BLUE, quickMask: false });
  await page.keyboard.press("n");
  expect(await colors()).toEqual({ fg: BLACK, bg: WHITE, quickMask: false });
});

test("Screen Mode shortcut rebinds, reverses with Shift, persists, deletes, and resets", async ({ page }) => {
  await openShortcutDialog(page);
  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  const screenMode = page.locator('[data-mv-shortcut-command="tool-screen-mode"]');
  await expect(screenMode).toHaveValue("F");
  await screenMode.focus();
  await page.keyboard.press("n");
  await expect(screenMode).toHaveValue("N");
  await page.getByRole("button", { name: "OK" }).click();

  const root = page.locator("html");
  const currentMode = () => page.evaluate(() => (window as any).__mv.store.state.screenMode);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mv.keyboardShortcuts") || "{}"))).toEqual({
    "tool-screen-mode": "KeyN",
  });
  await page.keyboard.press("f");
  expect(await currentMode()).toBe("standard");
  await page.keyboard.press("n");
  await expect(root).toHaveAttribute("data-mv-screen-mode", "fullMenu");
  await page.keyboard.press("Shift+n");
  await expect(root).toHaveAttribute("data-mv-screen-mode", "standard");

  await page.locator("#mv-status-zoom").focus();
  await page.keyboard.press("n");
  expect(await currentMode()).toBe("standard");
  await page.keyboard.press("Shift+n");
  expect(await currentMode()).toBe("standard");

  await page.reload();
  await gotoApp(page);
  await newScene(page);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.toolItems?.some(
    (item: any) => item.id === "tool-screen-mode" && item.chord === "KeyN",
  ));
  await page.keyboard.press("n");
  await expect(root).toHaveAttribute("data-mv-screen-mode", "fullMenu");

  await openShortcutDialog(page);
  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  await screenMode.focus();
  await page.getByRole("button", { name: "Delete Shortcut" }).click();
  await expect(screenMode).toHaveValue("");
  await page.getByRole("button", { name: "OK" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mv.keyboardShortcuts") || "{}"))).toEqual({
    "tool-screen-mode": null,
  });
  await page.evaluate(() => (window as any).__mv.store.setScreenMode("standard"));
  await expect(root).toHaveAttribute("data-mv-screen-mode", "standard");
  await page.keyboard.press("n");
  expect(await currentMode()).toBe("standard");
  await page.keyboard.press("f");
  expect(await currentMode()).toBe("standard");

  await openShortcutDialog(page);
  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  await page.locator("[data-mv-shortcut-reset]").click();
  await page.getByRole("button", { name: "OK" }).click();
  expect(await page.evaluate(() => localStorage.getItem("mv.keyboardShortcuts"))).toBeNull();
  await page.keyboard.press("n");
  expect(await currentMode()).toBe("standard");
  await page.keyboard.press("f");
  await expect(root).toHaveAttribute("data-mv-screen-mode", "fullMenu");
  await page.evaluate(() => (window as any).__mv.store.setScreenMode("standard"));
  await expect(page.locator("html")).toHaveAttribute("data-mv-screen-mode", "standard");
});

test("the four brush preset commands rebind independently, persist, delete, reset, and guard inputs", async ({ page }) => {
  test.setTimeout(120_000);
  await openShortcutDialog(page);
  const levels = page.locator('[data-mv-shortcut-command="lv"]');
  await levels.focus();
  await page.keyboard.press("Shift+Period");
  const conflict = page.locator("[data-mv-shortcut-conflict]");
  await expect(conflict).toContainText("Select Last Brush Preset");
  await conflict.getByRole("button", { name: "Cancel" }).click();

  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  const previous = page.locator('[data-mv-shortcut-command="tool-brush-preset-previous"]');
  const next = page.locator('[data-mv-shortcut-command="tool-brush-preset-next"]');
  const first = page.locator('[data-mv-shortcut-command="tool-brush-preset-first"]');
  const last = page.locator('[data-mv-shortcut-command="tool-brush-preset-last"]');
  await expect(previous).toHaveValue(",");
  await expect(next).toHaveValue(".");
  await expect(first).toHaveValue("⇧,");
  await expect(last).toHaveValue("⇧.");
  await first.focus();
  await page.keyboard.press("n");
  await expect(first).toHaveValue("N");
  await page.getByRole("button", { name: "OK" }).click();

  const active = () => page.evaluate(() => (window as any).__mv.store.state.activeBrushPreset);
  await page.keyboard.press("Shift+Comma");
  expect(await active()).toBe(-1);
  await page.keyboard.press("Period");
  expect(await active()).toBe(0);
  await page.keyboard.press("Shift+Period");
  expect(await active()).toBe(5);
  await page.keyboard.press("n");
  expect(await active()).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mv.keyboardShortcuts") || "{}"))).toEqual({
    "tool-brush-preset-first": "KeyN",
  });

  await page.evaluate(() => (window as any).__mv.store.applyBrushPreset(5));
  await page.locator("#mv-status-zoom").focus();
  await page.keyboard.press("n");
  await page.keyboard.press("Shift+Period");
  expect(await active()).toBe(5);

  await page.reload();
  await gotoApp(page);
  await newScene(page);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.toolItems?.some(
    (item: any) => item.id === "tool-brush-preset-first" && item.chord === "KeyN",
  ));
  await page.keyboard.press("Shift+Period");
  expect(await active()).toBe(5);
  await page.keyboard.press("n");
  expect(await active()).toBe(0);

  await openShortcutDialog(page);
  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  await first.focus();
  await page.getByRole("button", { name: "Delete Shortcut" }).click();
  await expect(first).toHaveValue("");
  await expect(last).toHaveValue("⇧.");
  await page.getByRole("button", { name: "OK" }).click();
  await page.evaluate(() => (window as any).__mv.store.applyBrushPreset(5));
  await page.keyboard.press("n");
  await page.keyboard.press("Shift+Comma");
  expect(await active()).toBe(5);
  await page.keyboard.press("Comma");
  expect(await active()).toBe(4);
  await page.keyboard.press("Shift+Period");
  expect(await active()).toBe(5);

  await openShortcutDialog(page);
  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  await page.locator("[data-mv-shortcut-reset]").click();
  await page.getByRole("button", { name: "OK" }).click();
  expect(await page.evaluate(() => localStorage.getItem("mv.keyboardShortcuts"))).toBeNull();
  await page.keyboard.press("n");
  expect(await active()).toBe(5);
  await page.keyboard.press("Shift+Comma");
  expect(await active()).toBe(0);
  await page.keyboard.press("Period");
  expect(await active()).toBe(1);
});

test("brush action shortcuts rebind, repeat, persist, and share conflicts across categories", async ({ page }) => {
  test.setTimeout(120_000);
  await openShortcutDialog(page);
  const levels = page.locator('[data-mv-shortcut-command="lv"]');
  await levels.focus();
  await page.keyboard.press("Shift+BracketRight");
  const conflict = page.locator("[data-mv-shortcut-conflict]");
  await expect(conflict).toContainText("Increase Brush Hardness");
  await conflict.getByRole("button", { name: "Accept and Replace" }).click();
  await expect(levels).toHaveValue("⇧]");

  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  const sizeDown = page.locator('[data-mv-shortcut-command="tool-brush-size-decrease"]');
  const sizeUp = page.locator('[data-mv-shortcut-command="tool-brush-size-increase"]');
  const hardnessDown = page.locator('[data-mv-shortcut-command="tool-brush-hardness-decrease"]');
  const hardnessUp = page.locator('[data-mv-shortcut-command="tool-brush-hardness-increase"]');
  await expect(hardnessUp).toHaveValue("");
  await page.locator("[data-mv-shortcut-reset]").click();
  await expect(sizeDown).toHaveValue("[");
  await expect(sizeUp).toHaveValue("]");
  await expect(hardnessDown).toHaveValue("⇧[");
  await expect(hardnessUp).toHaveValue("⇧]");

  await page.getByRole("button", { name: "OK" }).click();
  const brush = () => page.evaluate(() => {
    const value = (window as any).__mv.store.state.brush;
    return { size: value.size, hardness: value.hardness };
  });
  const resetBrush = () => page.evaluate(() => (window as any).__mv.store.setBrush({ size: 50, hardness: 0.5 }));
  await page.evaluate(() => (window as any).__mv.store.setKeyboardShortcuts({
    "tool-brush-size-decrease": null,
    "tool-brush-size-increase": null,
    "tool-brush-hardness-decrease": null,
    "tool-brush-hardness-increase": null,
  }));
  await resetBrush();
  await page.keyboard.press("BracketLeft");
  await page.keyboard.press("BracketRight");
  await page.keyboard.press("Shift+BracketLeft");
  await page.keyboard.press("Shift+BracketRight");
  expect(await brush()).toEqual({ size: 50, hardness: 0.5 });

  await openShortcutDialog(page);
  await chooseOption(page.locator("[data-mv-shortcut-category]"), "tools");
  await page.locator("[data-mv-shortcut-reset]").click();

  await sizeUp.focus();
  await page.keyboard.press("BracketLeft");
  await expect(conflict).toContainText("Decrease Brush Size");
  await conflict.getByRole("button", { name: "Cancel" }).click();
  await sizeUp.focus();
  await page.keyboard.press("n");
  await hardnessUp.focus();
  await page.keyboard.press("BracketRight");
  await expect(sizeUp).toHaveValue("N");
  await expect(hardnessUp).toHaveValue("]");
  await page.getByRole("button", { name: "OK" }).click();

  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mv.keyboardShortcuts") || "{}"))).toEqual({
    "tool-brush-size-increase": "KeyN",
    "tool-brush-hardness-increase": "BracketRight",
  });
  await resetBrush();
  await page.keyboard.press("Shift+BracketRight");
  expect(await brush()).toEqual({ size: 50, hardness: 0.5 });
  await page.keyboard.down("BracketRight");
  await page.keyboard.down("BracketRight");
  await page.keyboard.up("BracketRight");
  expect(await brush()).toEqual({ size: 50, hardness: 1 });
  await page.keyboard.down("n");
  await page.keyboard.down("n");
  await page.keyboard.up("n");
  expect(await brush()).toEqual({ size: 54, hardness: 1 });
  await page.keyboard.down("Shift");
  await page.keyboard.down("BracketLeft");
  await page.keyboard.down("BracketLeft");
  await page.keyboard.up("BracketLeft");
  await page.keyboard.up("Shift");
  expect(await brush()).toEqual({ size: 54, hardness: 0.5 });
  await page.keyboard.down("BracketLeft");
  await page.keyboard.down("BracketLeft");
  await page.keyboard.up("BracketLeft");
  expect(await brush()).toEqual({ size: 50, hardness: 0.5 });

  await page.locator("#mv-status-zoom").focus();
  await page.keyboard.press("n");
  await page.keyboard.press("BracketRight");
  await page.keyboard.press("Shift+BracketLeft");
  expect(await brush()).toEqual({ size: 50, hardness: 0.5 });

  await page.reload();
  await gotoApp(page);
  await newScene(page);
  expect(await page.evaluate(() => Object.fromEntries(
    (window as any).__mv.commandPalette.toolItems
      .filter((item: any) => ["tool-brush-size-increase", "tool-brush-hardness-increase"].includes(item.id))
      .map((item: any) => [item.id, item.chord]),
  ))).toEqual({
    "tool-brush-size-increase": "KeyN",
    "tool-brush-hardness-increase": "BracketRight",
  });
  await resetBrush();
  await page.keyboard.press("Shift+BracketRight");
  await page.keyboard.press("n");
  await page.keyboard.press("BracketRight");
  expect(await brush()).toEqual({ size: 52, hardness: 0.75 });
});

test("General preference cycles flyouts on repeated bare shortcuts and persists", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(page.getByText("Preferences", { exact: true })).toBeVisible();
  const preference = page.getByRole("checkbox", { name: "Use Shift Key for Tool Switch" });
  await expect(preference).toBeChecked();
  await preference.uncheck();
  await page.getByRole("button", { name: "OK" }).click();

  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await page.keyboard.press("b");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("brush");
  await page.keyboard.press("b");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("pencil");
  expect(await page.evaluate(() => localStorage.getItem("mv.useShiftKeyForToolSwitch"))).toBe("false");

  await page.reload();
  await gotoApp(page);
  await newScene(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await page.keyboard.press("b");
  await page.keyboard.press("b");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("pencil");

  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(preference).not.toBeChecked();
  await preference.check();
  await page.getByRole("button", { name: "OK" }).click();
  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await page.keyboard.press("b");
  await page.keyboard.press("b");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("brush");
  await page.keyboard.press("Shift+KeyB");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("pencil");
  expect(await page.evaluate(() => localStorage.getItem("mv.useShiftKeyForToolSwitch"))).toBeNull();
});

test("spring-loaded shortcuts distinguish taps from holds and persist Tools preferences", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));
  await page.keyboard.press("v");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("move");

  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));
  await page.keyboard.down("v");
  await page.waitForFunction(() => (window as any).__mv.store.state.tool === "move");
  await page.keyboard.up("v");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("brush");

  await page.keyboard.down("v");
  await page.waitForFunction(() => (window as any).__mv.store.state.tool === "move");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("brush");
  await page.keyboard.up("v");

  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByText("Tools", { exact: true }).click();
  const enabled = page.getByRole("checkbox", { name: "Spring-loaded Tool Shortcuts" });
  const delay = page.getByRole("slider", { name: "Spring-loaded shortcut timing" });
  await expect(enabled).toBeChecked();
  await expect(delay).toHaveValue("200");
  await delay.fill("500");
  await page.getByRole("button", { name: "OK" }).click();

  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));
  await page.keyboard.down("v");
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("brush");
  await page.waitForFunction(() => (window as any).__mv.store.state.tool === "move");
  await page.keyboard.up("v");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("brush");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mv.springLoadedTools") || "null"))).toEqual({ enabled: true, delayMs: 500 });

  await page.reload();
  await gotoApp(page);
  expect(await page.evaluate(() => {
    const state = (window as any).__mv.store.state;
    return { enabled: state.springLoadedToolShortcuts, delayMs: state.springLoadedToolDelayMs };
  })).toEqual({ enabled: true, delayMs: 500 });

  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByText("Tools", { exact: true }).click();
  await enabled.uncheck();
  await page.getByRole("button", { name: "OK" }).click();
  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));
  await page.keyboard.down("v");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("move");
  await page.waitForTimeout(550);
  await page.keyboard.up("v");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("move");

  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByText("Tools", { exact: true }).click();
  await enabled.check();
  await delay.fill("200");
  await page.getByRole("button", { name: "OK" }).click();
  expect(await page.evaluate(() => localStorage.getItem("mv.springLoadedTools"))).toBeNull();
});
