import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop select previous/next layer (Alt+[ / Alt+]) ───────────
// Adobe: Alt+] selects the next layer up the stack, Alt+[ the next down; the
// selection clamps at the ends, and Alt+Shift+[ / ] jump to the bottom / top.
// Vision wires these to store.selectAdjacentLayer via the pure layerNav helper.
//   https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html

const activeId = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__mv.store.state.activeLayerId);

async function releaseShortcutModifiers(page: Page) {
  for (const key of ["Alt", "Shift", "Meta", "Control"]) {
    await page.keyboard.up(key).catch(() => undefined);
  }
}

// Three layers; ids[0] is the top row, ids[2] the bottom. Returns the id list.
async function threeLayers(page: Page): Promise<number[]> {
  await gotoApp(page);
  return page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "nav");
    mv.store.addLayer();
    mv.store.addLayer();
    return mv.store.state.layers.map((l: any) => l.id);
  });
}

const select = (page: Page, id: number) => page.evaluate((i) => (window as any).__mv.store.selectLayer(i), id);

test("Alt+] / Alt+[ step the active layer up and down", async ({ page }) => {
  const ids = await threeLayers(page);
  await select(page, ids[1]);
  await releaseShortcutModifiers(page);
  await page.keyboard.press("Alt+BracketRight"); // up → top neighbour
  expect(await activeId(page)).toBe(ids[0]);
  await select(page, ids[1]);
  await releaseShortcutModifiers(page);
  await page.keyboard.press("Alt+BracketLeft"); // down → bottom neighbour
  expect(await activeId(page)).toBe(ids[2]);
});

test("the selection clamps at the top and Alt+Shift jumps to the ends", async ({ page }) => {
  const ids = await threeLayers(page);
  await select(page, ids[0]);
  await releaseShortcutModifiers(page);
  await page.keyboard.press("Alt+BracketRight"); // already at top → stays
  expect(await activeId(page)).toBe(ids[0]);
  await releaseShortcutModifiers(page);
  await page.keyboard.press("Alt+Shift+BracketLeft"); // jump to bottom
  expect(await activeId(page)).toBe(ids[2]);
});
