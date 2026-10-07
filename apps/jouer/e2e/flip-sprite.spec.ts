import { test, expect, type Page } from "@playwright/test";
import { gotoApp, makeSpritesheet, waitForNode, tick, near, cspViolations } from "./helpers";

// Unity-parity SpriteRenderer Flip X / Flip Y: mirror a sprite/image's texture
// render on an axis WITHOUT changing the transform (scale/position) — distinct
// from the scale-based Flip Horizontal/Vertical. Maps to Phaser setFlipX/setFlipY.
// Specs drive the live editor through `window.__mj` + the inspector DOM. Under the
// `desktop` project the last test doubles as the CSP smoke.

/** Add an image with a real (loaded) texture and return its id. */
async function makeImage(page: Page): Promise<string> {
  const sheet = await makeSpritesheet(page, 1, 24);
  const id = await page.evaluate((sheet) => {
    const { cmd } = window.__mj;
    const assetId = cmd.addImageAsset("logo", sheet.src, "image", { width: sheet.width, height: sheet.height });
    return cmd.addObject("image", { assetId, x: 200, y: 200 });
  }, sheet);
  await waitForNode(page, id);
  await page.waitForFunction((id) => { const p = window.__mj.probe(id); return !!p && p.width === 24; }, id, { timeout: 10_000 });
  return id;
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("flipX/flipY mirror the live node without changing the transform", async ({ page }) => {
  const id = await makeImage(page);
  let p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  expect(p.flipX).toBe(false);
  expect(p.flipY).toBe(false);
  const before = { scaleX: p.scaleX, scaleY: p.scaleY, x: p.x, y: p.y };

  await page.evaluate((id) => window.__mj.cmd.updateObject(id, { flipX: true }), id);
  await tick(page);
  p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  expect(p.flipX).toBe(true);
  // render-only: scale and position are untouched (unlike the scale-based flip)
  near(p.scaleX, before.scaleX, 0.001);
  near(p.scaleY, before.scaleY, 0.001);
  near(p.x, before.x);
  near(p.y, before.y);

  await page.evaluate((id) => window.__mj.cmd.updateObject(id, { flipY: true }), id);
  await tick(page);
  expect((await page.evaluate((id) => window.__mj.probe(id), id))!.flipY).toBe(true);
});

test("the inspector Flip X / Flip Y checkboxes toggle the model", async ({ page }) => {
  const id = await makeImage(page);
  await page.evaluate((id) => window.__mj.store.selectOne(id), id);
  const flipOf = (axis: "flipX" | "flipY") =>
    page.evaluate(({ id, axis }) => window.__mj.query.findObject(window.__mj.query.activeScene(window.__mj.store.getProject()), id)[axis], { id, axis });

  await page.getByText("Flip X", { exact: true }).click();
  expect(await flipOf("flipX")).toBe(true);
  await page.getByText("Flip Y", { exact: true }).click();
  expect(await flipOf("flipY")).toBe(true);
});

test("flip survives a .jouer round-trip and exports as setFlipX", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("image", { patch: { name: "F", flipX: true } });
    const js = window.__mj.exporter.exportGameJs(store.getProject());
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { flipX: query.findObject(scene, id).flipX, hasFlip: js.includes("setFlipX(true)") };
  });
  expect(r.flipX).toBe(true);
  expect(r.hasFlip).toBe(true);
});

test("flip is independent of the scale-based Flip Horizontal", async ({ page }) => {
  // SpriteRenderer flipX and transform flip are separate: flipX leaves scaleX > 0.
  const id = await makeImage(page);
  await page.evaluate((id) => window.__mj.cmd.updateObject(id, { flipX: true }), id);
  await tick(page);
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  expect(p.flipX).toBe(true);
  expect(p.scaleX).toBeGreaterThan(0); // render flip, not a negative-scale mirror
});

test("SpriteRenderer flip runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await makeImage(page);
  await page.evaluate((id) => window.__mj.cmd.updateObject(id, { flipX: true, flipY: true }), id);
  await tick(page);
  const p = (await page.evaluate((id) => window.__mj.probe(id), id))!;
  expect(p.flipX).toBe(true);
  expect(p.flipY).toBe(true);
  expect(await cspViolations(page)).toEqual([]);
});
