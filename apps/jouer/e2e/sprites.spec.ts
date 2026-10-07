import { test, expect } from "@playwright/test";
import { gotoApp, makeSpritesheet, near, waitForNode } from "./helpers";

// Assets + sprite-sheet frame animations, verified by the live Phaser node:
// the texture loads, the animation registers and plays, and its frame actually
// advances over time.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("an image asset loads onto a sprite (texture, not placeholder)", async ({ page }) => {
  const sheet = await makeSpritesheet(page, 1, 24);
  const id = await page.evaluate((sheet) => {
    const { cmd } = window.__mj;
    const assetId = cmd.addImageAsset("logo", sheet.src, "image", { width: sheet.width, height: sheet.height });
    return cmd.addObject("image", { assetId, x: 200, y: 200 });
  }, sheet);
  await waitForNode(page, id);
  // Wait for the async texture load → reconcile → real Image node (24×24).
  await page.waitForFunction((id) => { const p = window.__mj.probe(id); return !!p && p.width === 24; }, id, { timeout: 10_000 });
  near((await page.evaluate((id) => window.__mj.probe(id), id))!.width!, 24, 0.5);
});

test("a sprite-sheet animation registers, plays and advances frames live", async ({ page }) => {
  const sheet = await makeSpritesheet(page, 4, 16);
  const ids = await page.evaluate((sheet) => {
    const { cmd, store } = window.__mj;
    const assetId = cmd.addImageAsset("hero", sheet.src, "spritesheet", { width: sheet.width, height: sheet.height, frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
    const animId = cmd.addAnimation("walk", assetId, { frames: [0, 1, 2, 3], frameRate: 8, repeat: -1 });
    const animKey = store.getProject().animations.find((a: any) => a.id === animId).key;
    const sprite = cmd.addObject("sprite", { assetId, x: 200, y: 200, patch: { playAnimation: animKey } });
    return { assetId, animKey, sprite };
  }, sheet);

  // Texture loads → anim registers → sprite plays it.
  await page.waitForFunction((ids) => {
    const p = window.__mj.probe(ids.sprite);
    return !!p && p.anim === ids.animKey && p.animPlaying === true;
  }, ids, { timeout: 12_000 });

  // The frame index actually advances (the animation is running).
  const f0 = (await page.evaluate((ids) => window.__mj.probe(ids.sprite), ids))!.frame;
  await page.waitForFunction((args) => {
    const p = window.__mj.probe(args.sprite);
    return !!p && p.frame !== args.f0;
  }, { sprite: ids.sprite, f0 }, { timeout: 5000 });

  // And the loaded texture is the 16×16 frame, not the placeholder.
  near((await page.evaluate((ids) => window.__mj.probe(ids.sprite), ids))!.width!, 16, 0.5);
});

test("removing an asset detaches it from objects", async ({ page }) => {
  const sheet = await makeSpritesheet(page, 1, 16);
  const r = await page.evaluate((sheet) => {
    const { cmd, store } = window.__mj;
    const assetId = cmd.addImageAsset("tmp", sheet.src, "image", { width: 16, height: 16 });
    const sprite = cmd.addObject("image", { assetId });
    cmd.removeAsset(assetId);
    const o = store.getProject().scenes[0].objects.find((x: any) => x.id === sprite);
    return { assetGone: store.getProject().assets.length, assetId: o.assetId };
  }, sheet);
  expect(r.assetGone).toBe(0);
  expect(r.assetId).toBeNull();
});
