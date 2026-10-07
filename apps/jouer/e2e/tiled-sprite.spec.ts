import { test, expect } from "@playwright/test";
import { gotoApp, makeSpritesheet, near, waitForNode, cspViolations } from "./helpers";

// Unity-parity SpriteRenderer Draw Mode "Tiled": a sprite/image repeats its
// texture across an explicit Tile Size, realised as a Phaser TileSprite. Specs
// load a real (data-URI) texture and read the live node via probe: a tiled node
// reports probe.tiled and takes the Tile Size, vs a simple node at native size.
// Under the `desktop` project the last test doubles as the CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a tiled image builds a live TileSprite at the Tile Size (not the native size)", async ({ page }) => {
  const sheet = await makeSpritesheet(page, 1, 24); // 24×24 texture
  const ids = await page.evaluate((sheet) => {
    const { cmd } = window.__mj;
    const assetId = cmd.addImageAsset("logo", sheet.src, "image", { width: sheet.width, height: sheet.height });
    const tiled = cmd.addObject("image", { assetId, x: 200, y: 200, patch: { drawMode: "tiled", width: 64, height: 64 } });
    const simple = cmd.addObject("image", { assetId, x: 200, y: 320 });
    return { tiled, simple };
  }, sheet);

  // Texture loads → reconcile → the tiled node becomes a real TileSprite (64×64).
  await page.waitForFunction((id) => window.__mj.probe(id)?.tiled === true, ids.tiled, { timeout: 12_000 });
  const tiledP = (await page.evaluate((id) => window.__mj.probe(id), ids.tiled))!;
  expect(tiledP.tiled).toBe(true);
  near(tiledP.width!, 64, 0.5); // fills the Tile Size, not the 24px texture

  // The simple image of the same texture stays at its native 24px and is not tiled.
  await page.waitForFunction((id) => { const p = window.__mj.probe(id); return !!p && p.width === 24; }, ids.simple, { timeout: 12_000 });
  expect((await page.evaluate((id) => window.__mj.probe(id), ids.simple))!.tiled).toBe(false);
});

test("drawMode round-trips through .jouer and exports this.add.tileSprite", async ({ page }) => {
  const sheet = await makeSpritesheet(page, 1, 16);
  const r = await page.evaluate((sheet) => {
    const { cmd, store, jouer, query } = window.__mj;
    const assetId = cmd.addImageAsset("logo", sheet.src, "image", { width: 16, height: 16 });
    const id = cmd.addObject("sprite", { assetId, patch: { drawMode: "tiled", width: 96, height: 48 } });
    const js = window.__mj.exporter.exportGameJs(store.getProject());
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    const o = query.findObject(scene, id);
    return {
      drawMode: o.drawMode, w: o.width, h: o.height,
      hasTile: js.includes("this.add.tileSprite("),
      noDisplaySize: !js.includes("setDisplaySize(96, 48)"),
    };
  }, sheet);
  expect(r).toEqual({ drawMode: "tiled", w: 96, h: 48, hasTile: true, noDisplaySize: true });
});

test("a tiled sprite with no texture falls back to the placeholder without crashing", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("sprite", { x: 120, y: 120, patch: { drawMode: "tiled", width: 64, height: 64 } }));
  await waitForNode(page, id);
  const p = await page.evaluate((id) => window.__mj.probe(id), id);
  expect(p).not.toBeNull();
  expect(p!.tiled).toBe(false); // placeholder, not a TileSprite
});

test("a simple image exports a plain this.add.image (no tileSprite)", async ({ page }) => {
  const sheet = await makeSpritesheet(page, 1, 16);
  const noTile = await page.evaluate((sheet) => {
    const { cmd, store } = window.__mj;
    const assetId = cmd.addImageAsset("logo", sheet.src, "image", { width: 16, height: 16 });
    cmd.addObject("image", { assetId });
    return !window.__mj.exporter.exportGameJs(store.getProject()).includes("tileSprite");
  }, sheet);
  expect(noTile).toBe(true);
});

test("a tiled sprite that also has a play-animation does not crash (no .play on a TileSprite)", async ({ page }) => {
  // A TileSprite has no Animation component; without the guard, the editor's
  // reconcile would call .play() on it and throw an uncaught TypeError each frame.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sheet = await makeSpritesheet(page, 4, 16);
  const id = await page.evaluate((sheet) => {
    const { cmd, store } = window.__mj;
    const assetId = cmd.addImageAsset("hero", sheet.src, "spritesheet", { width: sheet.width, height: sheet.height, frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
    const animId = cmd.addAnimation("walk", assetId, { frames: [0, 1, 2, 3], frameRate: 8, repeat: -1 });
    const animKey = store.getProject().animations.find((a: any) => a.id === animId).key;
    // A sprite that is BOTH tiled and carries a frame animation — the tiled node
    // is a TileSprite; the play call must be skipped.
    return cmd.addObject("sprite", { assetId, x: 200, y: 200, patch: { drawMode: "tiled", width: 64, height: 64, playAnimation: animKey } });
  }, sheet);
  await page.waitForFunction((id) => window.__mj.probe(id)?.tiled === true, id, { timeout: 12_000 });
  // Let several render frames elapse so a per-frame reconcile throw would surface.
  await page.waitForTimeout(300);
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  expect(p.tiled).toBe(true);
  expect(p.animPlaying).toBe(false); // a TileSprite cannot run a frame animation
  expect(errors).toEqual([]); // no uncaught .play TypeError
});

test("tiled sprite runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const sheet = await makeSpritesheet(page, 1, 16);
  const id = await page.evaluate((sheet) => {
    const { cmd } = window.__mj;
    const assetId = cmd.addImageAsset("logo", sheet.src, "image", { width: 16, height: 16 });
    return cmd.addObject("image", { assetId, x: 160, y: 160, patch: { drawMode: "tiled", width: 80, height: 48 } });
  }, sheet);
  await page.waitForFunction((id) => window.__mj.probe(id)?.tiled === true, id, { timeout: 12_000 });
  expect(await cspViolations(page)).toEqual([]);
});
