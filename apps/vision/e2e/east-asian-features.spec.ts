import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

// #455 — Type ▸ Language Options ▸ East Asian Features toggles CJK composition
// (kinsoku line breaks, mojikumi, burasagari, tate-chu-yoko) on the active type
// layer and saves it on the layer's spec. Driven from the real menu bar. Only
// on/off differences are asserted, so whichever CJK fallback font the browser
// picks cannot make these flaky.

const LEAF = "type/language-options/langeastasian";
const JP = "吾輩は猫である。名前はまだ無い。「どこで生れたか」とんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。";

/** The native-menu mirror's East Asian Features leaf (the same tree the in-window bar renders). */
const leafEnabled = (page: Page) => page.evaluate((id) => {
  const find = (items: any[]): any => {
    for (const n of items) {
      if (n.id === id) return n;
      const hit = n.kind === "submenu" ? find(n.items) : undefined;
      if (hit) return hit;
    }
  };
  return find((window as any).__mv.macMenu.currentMenuTree())?.enabled;
}, LEAF);

const activeBounds = (page: Page) =>
  page.evaluate(() => Array.from((window as any).__mv.engine.engine.active_layer_bounds()) as number[]);
const eastAsianOf = (page: Page, id: number) =>
  page.evaluate((layerId) => (window as any).__mv.text.get(layerId).eastAsian, id);

async function openLanguageOptions(page: Page) {
  await page.getByRole("menuitem", { name: "Type", exact: true }).click();
  await page.getByRole("menuitem", { name: "Language Options", exact: true }).hover();
}

async function createType(page: Page, text: string, patch: Record<string, unknown>): Promise<number> {
  return page.evaluate(({ text, patch }) => {
    const mv = (window as any).__mv;
    return mv.text.create(mv.text.defaultSpec(text, { size: 20, color: [0, 0, 0, 255], ax: 8, ay: 8, ...patch })) as number;
  }, { text, patch });
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000); // cold swiftshader boot + real Canvas2D type layout
  await gotoApp(page);
  await newScene(page, 480, 320);
  await page.waitForFunction(() => (window as any).__mv?.macMenu?.currentMenuTree?.().length === 8);
});

test("greys out without a type layer, then re-wraps a CJK paragraph from the menu", async ({ page }) => {
  await expect.poll(() => leafEnabled(page), "a pixel layer is active").toBe(false);

  const id = await createType(page, JP, { kind: "paragraph", boxW: 160, boxH: 0 });
  await expect.poll(() => leafEnabled(page)).toBe(true);
  const before = await activeBounds(page);
  const beforeChk = (await composite(page)).chk;

  await openLanguageOptions(page);
  await page.getByRole("menuitem", { name: "East Asian Features", exact: true }).click();
  await expect.poll(() => eastAsianOf(page, id)).toBe(true);
  const on = await activeBounds(page);
  expect(on[3], "kinsoku breaks wrap the spaceless paragraph onto more lines").toBeGreaterThan(before[3]);
  expect((await composite(page)).chk).not.toBe(beforeChk);

  await openLanguageOptions(page);
  const item = page.getByRole("menuitemcheckbox", { name: "East Asian Features", exact: true });
  await expect(item).toHaveAttribute("aria-checked", "true");
  await item.click();
  await expect.poll(() => eastAsianOf(page, id)).toBeUndefined();
  expect(await activeBounds(page)).toEqual(before);
});

test("sets a vertical digit run across the column (tate-chu-yoko)", async ({ page }) => {
  const id = await createType(page, "令和12年", { vertical: true, size: 32, ax: 200 });
  await expect.poll(() => leafEnabled(page)).toBe(true);
  const before = await activeBounds(page);

  await page.evaluate((leaf) => (window as any).__mv.macMenu.dispatchMenuAction(leaf), LEAF);
  await expect.poll(() => eastAsianOf(page, id)).toBe(true);
  expect((await activeBounds(page))[3], "12 takes one slot instead of two").toBeLessThan(before[3]);
});

test("round-trips through project save and reopen", async ({ page }) => {
  const id = await createType(page, "日本語の組版。", { kind: "paragraph", boxW: 120, boxH: 0 });
  const loaded = await page.evaluate((layerId) => {
    const mv = (window as any).__mv;
    mv.store.selectLayer(layerId);
    mv.text.toggleEastAsian();
    const saved = mv.store.saveProject();
    mv.store.openProject(saved, "east-asian-roundtrip.mvision");
    const layer = mv.store.state.layers.find((l: any) => l.kind === 2);
    return layer ? mv.text.get(layer.id).eastAsian : "missing";
  }, id);
  expect(loaded).toBe(true);
});
