import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop View ▸ Screen Mode (F cycles) ────────────────────────
// Adobe: F cycles Standard → Full Screen With Menu Bar → Full Screen → Standard
// (Shift+F reverses). Full Screen hides the chrome, leaving the canvas. Vision
// drives a screenMode store machine (pure nextScreenMode) → data-mv-screen-mode on
// the root, and app CSS hides the monet chrome in Full Screen.
//   https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html

const html = (page: Page) => page.locator("html");
const dock = (page: Page) => page.locator(".monet-dock").first();
const viewport = (page: Page) => page.locator(".mv-canvas-viewport");
const frame = (page: Page) => page.locator(".monet-titlebar, .monet-documentbar, .monet-tabstrip-win").first();
const toolbarLanes = (page: Page) => page.locator(".monet-tb-lanes").first();
const statusBar = (page: Page) => page.locator(".monet-statusbar").first();
const split = (page: Page) => page.locator(".monet-split").first();
const taskBar = (page: Page) => page.locator(".mv-taskbar");

async function scene(page: Page, name: string) {
  await gotoApp(page);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.toolItems?.some((item: any) => item.id === "tool-screen-mode"));
  await page.evaluate((n) => (window as any).__mv.store.newDocument(100, 100, n), name);
}

test("F cycles the screen modes and Full Screen hides the chrome", async ({ page }) => {
  await scene(page, "screen");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "standard");
  await expect(dock(page)).toBeVisible();
  await expect(frame(page)).toBeVisible();
  await expect(toolbarLanes(page)).toBeVisible();
  await expect(statusBar(page)).toBeVisible();
  await expect(split(page)).toBeVisible();
  await expect(taskBar(page)).toBeVisible();
  await expect(viewport(page)).toHaveCSS("background-image", /repeating-conic-gradient/);

  await page.keyboard.down("f");
  await page.keyboard.down("f");
  await page.keyboard.up("f");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "fullMenu");
  await expect(dock(page)).toBeVisible(); // menu-bar mode keeps the panels
  await expect(viewport(page)).toHaveCSS("background-color", "rgb(128, 128, 128)");
  await expect(viewport(page)).toHaveCSS("background-image", "none");

  await page.keyboard.press("f");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "full");
  await expect(dock(page)).toBeHidden(); // full screen hides the panels
  await expect(frame(page)).toBeHidden();
  await expect(toolbarLanes(page)).toBeHidden();
  await expect(statusBar(page)).toBeHidden();
  await expect(split(page)).toBeHidden();
  await expect(taskBar(page)).toBeHidden();
  await expect(viewport(page)).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(viewport(page)).toHaveCSS("background-image", "none");

  await page.keyboard.press("f");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "standard");
  await expect(dock(page)).toBeVisible();
  await expect(frame(page)).toBeVisible();
  await expect(toolbarLanes(page)).toBeVisible();
  await expect(statusBar(page)).toBeVisible();
  await expect(split(page)).toBeVisible();
  await expect(taskBar(page)).toBeVisible();
  await expect(viewport(page)).toHaveCSS("background-image", /repeating-conic-gradient/);
});

test("Shift+F cycles the screen modes backward", async ({ page }) => {
  await scene(page, "screen2");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "standard");
  await page.keyboard.press("Shift+F");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "full");
  await page.keyboard.press("Shift+F");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "fullMenu");
});

test("Escape exits either fullscreen mode", async ({ page }) => {
  await scene(page, "screen-escape");
  await page.keyboard.press("f");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "fullMenu");
  await page.keyboard.press("Escape");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "standard");

  await page.keyboard.press("Shift+F");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "full");
  await page.keyboard.press("Escape");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "standard");
});

test("an open dialog consumes Escape before Screen Mode", async ({ page }) => {
  await scene(page, "screen-dialog");
  await page.keyboard.press("f");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "fullMenu");

  await page.keyboard.press("Alt+Shift+ControlOrMeta+KeyK");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "fullMenu");

  await page.keyboard.press("Escape");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "standard");
});

test("an in-progress Polygonal Lasso consumes Escape before Screen Mode", async ({ page }) => {
  await scene(page, "screen-polylasso");
  await page.keyboard.press("f");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "fullMenu");
  await page.evaluate(() => {
    (window as any).__mv.store.setTool("polylasso");
    (window as any).__mv.store.fit();
  });
  const box = await page.evaluate(() => {
    const rect = [...document.querySelectorAll("canvas")]
      .map((canvas) => canvas.getBoundingClientRect())
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.3);
  await expect(page.locator("[data-mv-polylasso]")).toHaveAttribute("data-mv-polylasso", "2");

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-mv-polylasso]")).toHaveCount(0);
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "fullMenu");

  await page.keyboard.press("Escape");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "standard");
});

test("an external fullscreen exit synchronizes Screen Mode", async ({ page }) => {
  await scene(page, "screen-native-exit");
  await page.evaluate(() => {
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: () => Promise.resolve(),
    });
    (window as any).__mv.store.setScreenMode("full");
  });
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "full");

  await page.evaluate(() => document.dispatchEvent(new Event("fullscreenchange")));
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "standard");
});

test("a late fullscreen entry is exited after returning to Standard", async ({ page }) => {
  await scene(page, "screen-late-entry");
  const reconciled = await page.evaluate(async () => {
    const root = document.documentElement;
    let fullscreenElement: Element | null = null;
    let resolveRequest = () => {};
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(root, "requestFullscreen", {
      configurable: true,
      value: () => new Promise<void>((resolve) => { resolveRequest = resolve; }),
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      },
    });
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    (window as any).__mv.store.setScreenMode("full");
    await frame();
    (window as any).__mv.store.setScreenMode("standard");
    await frame();
    fullscreenElement = root;
    document.dispatchEvent(new Event("fullscreenchange"));
    resolveRequest();
    await frame();
    return fullscreenElement === null;
  });

  expect(reconciled).toBe(true);
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "standard");
});

test("a delayed fullscreen exit from Standard does not reset a newly entered Full Screen mode", async ({ page }) => {
  await scene(page, "screen-delayed-exit");
  const reconciled = await page.evaluate(async () => {
    const root = document.documentElement;
    let fullscreenElement: Element | null = null;
    let finishExit = () => {};
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(root, "requestFullscreen", {
      configurable: true,
      value: () => {
        fullscreenElement = root;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: () => new Promise<void>((resolve) => {
        finishExit = () => {
          fullscreenElement = null;
          document.dispatchEvent(new Event("fullscreenchange"));
          resolve();
        };
      }),
    });
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    (window as any).__mv.store.setScreenMode("fullMenu");
    await frame();
    (window as any).__mv.store.setScreenMode("standard");
    await frame();
    (window as any).__mv.store.setScreenMode("full");
    await frame();
    finishExit();
    await frame();
    return fullscreenElement === root;
  });

  expect(reconciled).toBe(true);
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "full");
});

test("an idle Liquify tool does not consume Screen Mode Escape", async ({ page }) => {
  await scene(page, "screen-idle-liquify");
  await page.evaluate(() => (window as any).__mv.store.setTool("liquify"));
  await page.keyboard.press("Shift+F");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "full");

  await page.keyboard.press("Escape");
  await expect(html(page)).toHaveAttribute("data-mv-screen-mode", "standard");
});
