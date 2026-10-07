import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

async function openMenu(page: Page, top: string) {
  await page.getByText(top, { exact: true }).first().click();
  await page.waitForTimeout(150);
}
// Fire a menu item's click handler on its leaf element (the custom hover
// menu doesn't reliably forward synthetic pointer clicks to flyout items).
async function clickMenuItem(page: Page, label: string) {
  const ok = await page.evaluate(async (label) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const labelOf = (e: Element) => (((e.querySelector(".monet-menu-label") || {}) as HTMLElement).textContent || "").trim();
    const findLeaf = () => [...document.querySelectorAll(".monet-menu-item")]
      .find((e) => e.getAttribute("aria-haspopup") !== "menu" && labelOf(e) === label) as HTMLElement | undefined;
    const openSub = (e: Element) => {
      e.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      e.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
    };
    const seen = new Set<Element>();
    const visit = async (): Promise<boolean> => {
      const hit = findLeaf();
      if (hit) { hit.click(); return true; }
      for (const s of [...document.querySelectorAll('.monet-menu-item[aria-haspopup="menu"]')]) {
        if (seen.has(s)) continue;
        seen.add(s);
        openSub(s);
        await sleep(45);
        if (await visit()) return true;
      }
      return false;
    };
    return await visit();
  }, label);
  await page.waitForTimeout(120);
  return ok;
}

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page); });

test("app shell renders menus, a canvas and the tool rail", async ({ page }) => {
  for (const m of ["File", "Edit", "Image", "Layer", "Select", "Adjustments", "Filter", "View"]) {
    await expect(page.getByText(m, { exact: true }).first()).toBeVisible();
  }
  await expect(page.locator("canvas").first()).toBeVisible();
  const buttons = await page.locator("button").count();
  expect(buttons).toBeGreaterThan(10);
});

test("keyboard shortcuts switch the active tool", async ({ page }) => {
  const tool = async () => page.evaluate(() => (window as any).__mv.store.state.tool);
  await page.keyboard.press("b"); expect(await tool()).toBe("brush");
  await page.keyboard.press("m"); expect(await tool()).toBe("marquee");
  await page.keyboard.press("t"); expect(await tool()).toBe("text");
  await page.keyboard.press("i"); expect(await tool()).toBe("dropper");
});

test("⌘L opens Levels through the shared keyboard→menu command path", async ({ page }) => {
  // The ⌘L shortcut dispatches the same menuActions.lv handler as the menu item,
  // so the two can't drift (review H4/AH2).
  await page.keyboard.press("ControlOrMeta+l");
  await expect(page.getByText("Levels", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await expect(page.getByText("Levels", { exact: true })).toBeHidden();
});

test("Adjustments menu opens the Brightness/Contrast dialog", async ({ page }) => {
  await openMenu(page, "Image");
  expect(await clickMenuItem(page, "Brightness/Contrast…")).toBe(true);
  await expect(page.getByText("Brightness / Contrast", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await expect(page.getByText("Brightness / Contrast", { exact: true })).toBeHidden();
});

test("Filter menu opens the Gaussian Blur dialog", async ({ page }) => {
  await openMenu(page, "Filter");
  expect(await clickMenuItem(page, "Gaussian Blur…")).toBe(true);
  await expect(page.getByText("Gaussian Blur", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).first().click();
});

test("Neural Filters (AI) dialog opens with model controls", async ({ page }) => {
  await openMenu(page, "Filter");
  await page.getByText("Neural Filters", { exact: true }).first().hover();
  await page.waitForTimeout(300);
  expect(await clickMenuItem(page, "AI Neural Filters (ONNX)…")).toBe(true);
  await expect(page.getByText("Style Transfer", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "candy", exact: true })).toBeVisible();
  // close gracefully (the dialog backdrop can intercept a direct click mid-animation)
  await page.keyboard.press("Escape");
});
