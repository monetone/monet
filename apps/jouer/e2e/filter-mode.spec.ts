import { test, expect, type Page } from "@playwright/test";
import { gotoApp, makeSpritesheet, cspViolations } from "./helpers";

// Unity-parity Texture Filter Mode (Texture Import Settings → Filter Mode): a
// per-asset override of the global pixelArt default — "nearest" (Unity Point,
// crisp) / "linear" (Unity Bilinear, smooth). Maps to Phaser
// texture.setFilter(FilterMode.NEAREST | LINEAR), applied in each scene's create()
// for referenced image/spritesheet assets. Specs drive window.__mj + assert the
// exported code + the model. Under the `desktop` project the last test is the CSP smoke.

/** Add an image asset (optionally with a filterMode) + a sprite referencing it,
 *  and return the exported game JS plus the asset id. */
async function setup(page: Page, filterMode?: "nearest" | "linear") {
  const sheet = await makeSpritesheet(page, 1, 24);
  return page.evaluate(({ sheet, filterMode }) => {
    const { cmd, store, exporter } = window.__mj;
    const assetId = cmd.addImageAsset("logo", sheet.src, "image", { width: sheet.width, height: sheet.height });
    if (filterMode) cmd.updateAsset(assetId, { filterMode });
    cmd.addObject("image", { assetId, x: 100, y: 100 });
    return { js: exporter.exportGameJs(store.getProject()), assetId };
  }, { sheet, filterMode });
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("an asset with filterMode 'nearest' exports the NEAREST setFilter", async ({ page }) => {
  const { js } = await setup(page, "nearest");
  expect(js).toContain("this.textures.get('logo').setFilter(Phaser.Textures.FilterMode.NEAREST);");
});

test("an asset with filterMode 'linear' exports the LINEAR setFilter", async ({ page }) => {
  const { js } = await setup(page, "linear");
  expect(js).toContain("this.textures.get('logo').setFilter(Phaser.Textures.FilterMode.LINEAR);");
});

test("a default asset (no filterMode) emits no setFilter (inherits the global default)", async ({ page }) => {
  const { js } = await setup(page);
  expect(js).not.toContain("setFilter");
});

test("filterMode round-trips through .jouer", async ({ page }) => {
  const { assetId } = await setup(page, "nearest");
  const back = await page.evaluate((assetId) => {
    const { store, jouer } = window.__mj;
    const p = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    return p.assets.find((a: { id: string }) => a.id === assetId)?.filterMode;
  }, assetId);
  expect(back).toBe("nearest");
});

test("filter mode runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const { js } = await setup(page, "linear");
  expect(js).toContain("setFilter(Phaser.Textures.FilterMode.LINEAR);");
  expect(await cspViolations(page)).toEqual([]);
});
