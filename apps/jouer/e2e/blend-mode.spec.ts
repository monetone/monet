import { test, expect, type Page } from "@playwright/test";
import { gotoApp, waitForNode, cspViolations } from "./helpers";

// Unity-parity render Blend Mode (SpriteRenderer material blend, 2D subset).
// Maps to Phaser setBlendMode; the live editor renders it, so specs read the live
// node's numeric blendMode via probe (Phaser: NORMAL=0, ADD=1, MULTIPLY=2,
// SCREEN=3) + the model/export. Under the `desktop` project the last test is the
// CSP smoke.

const setBlend = (page: Page, id: string, mode: string) =>
  page.evaluate(({ id, mode }) => window.__mj.cmd.updateObject(id, { blendMode: mode }), { id, mode });

const waitBlend = (page: Page, id: string, value: number) =>
  page.waitForFunction(({ id, value }) => window.__mj.probe(id)?.blendMode === value, { id, value }, { timeout: 5000 });

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("each blend mode sets the live node's Phaser blend mode", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { x: 100, y: 100 }));
  await waitForNode(page, id);
  expect((await page.evaluate((id) => window.__mj.probe(id), id))!.blendMode).toBe(0); // default NORMAL

  await setBlend(page, id, "add");
  await waitBlend(page, id, 1);
  await setBlend(page, id, "multiply");
  await waitBlend(page, id, 2);
  await setBlend(page, id, "screen");
  await waitBlend(page, id, 3);
  await setBlend(page, id, "normal");
  await waitBlend(page, id, 0); // back to NORMAL
});

test("blendMode round-trips through .jouer and exports setBlendMode", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.updateObject(id, { blendMode: "add" });
    const js = window.__mj.exporter.exportGameJs(store.getProject());
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { mode: query.findObject(scene, id).blendMode, hasBlend: js.includes("setBlendMode('ADD')") };
  });
  expect(r).toEqual({ mode: "add", hasBlend: true });
});

test("a normal object exports no setBlendMode", async ({ page }) => {
  const noBlend = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addObject("rectangle", { x: 50, y: 50 }); // default blend
    return !window.__mj.exporter.exportGameJs(store.getProject()).includes("setBlendMode");
  });
  expect(noBlend).toBe(true);
});

test("blend mode runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { x: 80, y: 80 }));
  await waitForNode(page, id);
  await setBlend(page, id, "add");
  await waitBlend(page, id, 1);
  expect(await cspViolations(page)).toEqual([]);
});
