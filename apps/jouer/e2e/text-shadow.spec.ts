import { test, expect, type Page } from "@playwright/test";
import { gotoApp, waitForNode, cspViolations } from "./helpers";

// Unity-parity Text drop shadow (UI "Shadow" component → Effect Color + Effect
// Distance, plus a TMP-underlay softness/blur). A shadow renders only when it has
// a visible offset or blur; it maps to Phaser Text `shadow:{offsetX,offsetY,
// color,blur,fill}`. Specs assert the live node's shadow via probe + the model/
// export round-trip. Under the `desktop` project the last test is the CSP smoke.

/** Merge a partial style onto a text object's existing style. */
async function setStyle(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(({ id, patch }) => {
    const { cmd, query, store } = window.__mj;
    const o = query.findObject(query.activeScene(store.getProject()), id);
    cmd.updateObject(id, { style: { ...o.style, ...patch } });
  }, { id, patch });
}

const shadow = (page: Page, id: string) =>
  page.evaluate((id) => {
    const p = window.__mj.probe(id);
    return p && {
      color: p.shadowColor, x: p.shadowOffsetX, y: p.shadowOffsetY, blur: p.shadowBlur, fill: p.shadowFill,
    };
  }, id);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a fresh text object renders without a drop shadow", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("text", { x: 100, y: 100, patch: { text: "no shadow" } }));
  await waitForNode(page, id);
  // Default style has no offset/blur → the shadow fill is off.
  expect((await shadow(page, id))?.fill).toBe(false);
});

test("setting an offset turns the live drop shadow on", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("text", { x: 100, y: 100, patch: { text: "shadow" } }));
  await waitForNode(page, id);
  await setStyle(page, id, { shadowColor: "#ff8800", shadowOffsetX: 4, shadowOffsetY: -2, shadowBlur: 3 });
  await page.waitForFunction((id) => window.__mj.probe(id)?.shadowFill === true, id, { timeout: 5000 });
  expect(await shadow(page, id)).toEqual({ color: "#ff8800", x: 4, y: -2, blur: 3, fill: true });
});

test("a blur with no offset still produces a (glow) shadow", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("text", { x: 80, y: 80, patch: { text: "glow" } }));
  await waitForNode(page, id);
  await setStyle(page, id, { shadowBlur: 6 });
  await page.waitForFunction((id) => window.__mj.probe(id)?.shadowFill === true, id, { timeout: 5000 });
  const s = await shadow(page, id);
  expect(s?.fill).toBe(true);
  expect(s?.blur).toBe(6);
});

test("the shadow round-trips through .jouer and is emitted into the exported code", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("text", { patch: { text: "hi" } });
    const o0 = query.findObject(query.activeScene(store.getProject()), id);
    cmd.updateObject(id, { style: { ...o0.style, shadowColor: "#ff8800", shadowOffsetX: 4, shadowOffsetY: -2, shadowBlur: 3 } });
    const js = window.__mj.exporter.exportGameJs(store.getProject());
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    const o = query.findObject(scene, id);
    return {
      color: o.style.shadowColor, x: o.style.shadowOffsetX, y: o.style.shadowOffsetY, blur: o.style.shadowBlur,
      hasShadow: js.includes('"shadow":{"offsetX":4,"offsetY":-2,"color":"#ff8800","blur":3,"fill":true,"stroke":false}'),
    };
  });
  expect(r).toEqual({ color: "#ff8800", x: 4, y: -2, blur: 3, hasShadow: true });
});

test("a shadow-free text exports no shadow config", async ({ page }) => {
  const noShadow = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addObject("text", { patch: { text: "plain" } });
    return !window.__mj.exporter.exportGameJs(store.getProject()).includes('"shadow"');
  });
  expect(noShadow).toBe(true);
});

test("text drop shadow runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("text", { x: 80, y: 80, patch: { text: "smoke" } }));
  await waitForNode(page, id);
  await setStyle(page, id, { shadowColor: "#223344", shadowOffsetX: 3, shadowOffsetY: 3, shadowBlur: 2 });
  await page.waitForFunction((id) => window.__mj.probe(id)?.shadowFill === true, id, { timeout: 5000 });
  expect(await cspViolations(page)).toEqual([]);
});
