import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Layer ▸ New ▸ Layer… dialog ──────────────────────────
// Adobe: ⇧⌘N opens a New Layer dialog (Name / Color / Mode / Opacity) before
// creating the layer; the panel's + button skips it. Vision wires the dialog to
// the 'nl' menu id, pre-filling the next 'Layer N' via the pure newLayer helpers.
//   https://helpx.adobe.com/photoshop/using/creating-layers-groups.html

async function openNewLayer(page: Page, doc = "nl") {
  await gotoApp(page);
  await page.evaluate((d) => (window as any).__mv.store.newDocument(100, 100, d), doc);
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("New ▸ Layer…"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.includes("New ▸ Layer…")).run();
  });
  await expect(page.locator("#mv-newlayer-name")).toBeVisible();
}

test("the New Layer dialog pre-fills the next 'Layer N' name", async ({ page }) => {
  await openNewLayer(page);
  await expect(page.locator("#mv-newlayer-name")).toHaveValue(/^Layer \d+$/);
});

test("the New Layer dialog creates a layer with the chosen settings", async ({ page }) => {
  await openNewLayer(page);
  const before = await page.evaluate(() => (window as any).__mv.store.state.layers.length);
  await page.locator("#mv-newlayer-name").fill("Sky");
  await chooseOption(page.locator("#mv-newlayer-mode"), "multiply");
  await chooseOption(page.locator("#mv-newlayer-color"), "red");
  await page.locator("#mv-newlayer-opacity").fill("50");
  await page.locator("#mv-newlayer-opacity").press("Enter");
  await page.getByRole("button", { name: "OK" }).click();
  const info = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    const id = s.activeLayerId;
    const l = s.layers.find((x: any) => x.id === id);
    return { count: s.layers.length, name: l.name, blendMode: l.blendMode, opacity: l.opacity, label: s.layerColorLabels[id] };
  });
  expect(info.count).toBe(before + 1);
  expect(info.name).toBe("Sky");
  expect(info.blendMode).toBe("multiply");
  expect(info.opacity).toBe(50);
  expect(info.label).toBe("red");
});
