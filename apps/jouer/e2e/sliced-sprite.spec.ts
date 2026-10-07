import { test, expect } from "@playwright/test";
import { gotoApp, makeSpritesheet, near, waitForNode, cspViolations } from "./helpers";

// Unity-parity SpriteRenderer Draw Mode "Sliced": a 9-slice that keeps the sprite
// border corners fixed while stretching edges/centre to the Size, realised as a
// Phaser NineSlice. Specs load a real texture and read the live node via probe: a
// sliced node reports probe.sliced and takes the Size, vs a simple node at native
// size. Under the `desktop` project the last test doubles as the CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a sliced image builds a live NineSlice at the Size (not the native size)", async ({ page }) => {
  const sheet = await makeSpritesheet(page, 1, 32); // 32×32 texture
  const ids = await page.evaluate((sheet) => {
    const { cmd } = window.__mj;
    const assetId = cmd.addImageAsset("panel", sheet.src, "image", { width: sheet.width, height: sheet.height });
    const sliced = cmd.addObject("image", { assetId, x: 200, y: 200, patch: { drawMode: "sliced", width: 80, height: 80, sliceLeft: 8, sliceRight: 8, sliceTop: 8, sliceBottom: 8 } });
    const simple = cmd.addObject("image", { assetId, x: 200, y: 320 });
    return { sliced, simple };
  }, sheet);

  // Texture loads → reconcile → the sliced node becomes a real NineSlice (80×80).
  await page.waitForFunction((id) => window.__mj.probe(id)?.sliced === true, ids.sliced, { timeout: 12_000 });
  const slicedP = (await page.evaluate((id) => window.__mj.probe(id), ids.sliced))!;
  expect(slicedP.sliced).toBe(true);
  expect(slicedP.tiled).toBe(false); // it's a NineSlice, not a TileSprite
  near(slicedP.width!, 80, 0.5); // fills the Size, not the 32px texture

  // The simple image of the same texture stays at native 32 and is not sliced.
  await page.waitForFunction((id) => { const p = window.__mj.probe(id); return !!p && p.width === 32; }, ids.simple, { timeout: 12_000 });
  expect((await page.evaluate((id) => window.__mj.probe(id), ids.simple))!.sliced).toBe(false);
});

test("drawMode + borders round-trip through .jouer and export this.add.nineslice", async ({ page }) => {
  const sheet = await makeSpritesheet(page, 1, 16);
  const r = await page.evaluate((sheet) => {
    const { cmd, store, jouer, query } = window.__mj;
    const assetId = cmd.addImageAsset("panel", sheet.src, "image", { width: 16, height: 16 });
    const id = cmd.addObject("image", { assetId, patch: { drawMode: "sliced", width: 96, height: 48, sliceLeft: 4, sliceRight: 4, sliceTop: 6, sliceBottom: 2 } });
    const js = window.__mj.exporter.exportGameJs(store.getProject());
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    const o = query.findObject(scene, id);
    return {
      drawMode: o.drawMode, w: o.width, h: o.height, l: o.sliceLeft, rt: o.sliceRight, tp: o.sliceTop, bt: o.sliceBottom,
      hasNine: js.includes("this.add.nineslice("),
      noDisplaySize: !js.includes("setDisplaySize(96, 48)"),
    };
  }, sheet);
  expect(r).toEqual({ drawMode: "sliced", w: 96, h: 48, l: 4, rt: 4, tp: 6, bt: 2, hasNine: true, noDisplaySize: true });
});

test("a sliced sprite that also has a play-animation does not crash (no .play on a NineSlice)", async ({ page }) => {
  // A NineSlice has no Animation component; without the guard the editor reconcile
  // would call .play() on it and throw an uncaught TypeError each frame.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sheet = await makeSpritesheet(page, 4, 16);
  const id = await page.evaluate((sheet) => {
    const { cmd, store } = window.__mj;
    const assetId = cmd.addImageAsset("hero", sheet.src, "spritesheet", { width: sheet.width, height: sheet.height, frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
    const animId = cmd.addAnimation("walk", assetId, { frames: [0, 1, 2, 3], frameRate: 8, repeat: -1 });
    const animKey = store.getProject().animations.find((a: any) => a.id === animId).key;
    return cmd.addObject("sprite", { assetId, x: 200, y: 200, patch: { drawMode: "sliced", width: 64, height: 64, sliceLeft: 4, sliceRight: 4, sliceTop: 4, sliceBottom: 4, playAnimation: animKey } });
  }, sheet);
  await page.waitForFunction((id) => window.__mj.probe(id)?.sliced === true, id, { timeout: 12_000 });
  await page.waitForTimeout(300); // let several reconcile frames elapse
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  expect(p.sliced).toBe(true);
  expect(p.animPlaying).toBe(false); // a NineSlice cannot run a frame animation
  expect(errors).toEqual([]); // no uncaught .play TypeError
});

test("a sliced sprite with no texture falls back to the placeholder without crashing", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("sprite", { x: 120, y: 120, patch: { drawMode: "sliced", width: 64, height: 64, sliceLeft: 8, sliceRight: 8, sliceTop: 8, sliceBottom: 8 } }));
  await waitForNode(page, id);
  const p = await page.evaluate((id) => window.__mj.probe(id), id);
  expect(p).not.toBeNull();
  expect(p!.sliced).toBe(false); // placeholder, not a NineSlice
});

test("a simple image exports a plain this.add.image (no nineslice)", async ({ page }) => {
  const sheet = await makeSpritesheet(page, 1, 16);
  const noNine = await page.evaluate((sheet) => {
    const { cmd, store } = window.__mj;
    const assetId = cmd.addImageAsset("panel", sheet.src, "image", { width: 16, height: 16 });
    cmd.addObject("image", { assetId });
    return !window.__mj.exporter.exportGameJs(store.getProject()).includes("nineslice");
  }, sheet);
  expect(noNine).toBe(true);
});

test("sliced sprite runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const sheet = await makeSpritesheet(page, 1, 32);
  const id = await page.evaluate((sheet) => {
    const { cmd } = window.__mj;
    const assetId = cmd.addImageAsset("panel", sheet.src, "image", { width: 32, height: 32 });
    return cmd.addObject("image", { assetId, x: 160, y: 160, patch: { drawMode: "sliced", width: 90, height: 60, sliceLeft: 8, sliceRight: 8, sliceTop: 8, sliceBottom: 8 } });
  }, sheet);
  await page.waitForFunction((id) => window.__mj.probe(id)?.sliced === true, id, { timeout: 12_000 });
  expect(await cspViolations(page)).toEqual([]);
});
