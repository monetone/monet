import { test, expect, type Page } from "@playwright/test";
import { gotoApp, waitForNode, cspViolations } from "./helpers";

// Unity-parity Text layout: word-wrap width (Unity "Horizontal Overflow: Wrap")
// and Line Spacing. wrapWidth>0 breaks long text into multiple lines (taller
// node); lineSpacing adds vertical gap between lines. Maps to Phaser Text
// wordWrap:{width} + lineSpacing. Specs assert the live node's height (relative,
// so they're robust to exact font metrics) + the model/export. Under the
// `desktop` project the last test doubles as the CSP smoke.

const heightOf = (page: Page, id: string) => page.evaluate((id) => window.__mj.probe(id)?.height ?? 0, id);

/** Merge a partial style onto a text object's existing style. */
async function setStyle(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(({ id, patch }) => {
    const { cmd, query, store } = window.__mj;
    const o = query.findObject(query.activeScene(store.getProject()), id);
    cmd.updateObject(id, { style: { ...o.style, ...patch } });
  }, { id, patch });
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("wrapping a long text renders it taller (more lines)", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("text", { x: 100, y: 100, patch: { text: "wrap wrap wrap wrap wrap wrap wrap wrap" } }));
  await waitForNode(page, id);
  const h1 = await heightOf(page, id); // unwrapped → single line
  await setStyle(page, id, { wrapWidth: 50 });
  await page.waitForFunction(({ id, h1 }) => (window.__mj.probe(id)?.height ?? 0) > h1, { id, h1 }, { timeout: 5000 });
});

test("increasing line spacing makes a multi-line text taller", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("text", { x: 100, y: 100, patch: { text: "line one\nline two\nline three" } }));
  await waitForNode(page, id);
  const h1 = await heightOf(page, id); // lineSpacing 0
  await setStyle(page, id, { lineSpacing: 40 });
  await page.waitForFunction(({ id, h1 }) => (window.__mj.probe(id)?.height ?? 0) > h1, { id, h1 }, { timeout: 5000 });
});

test("wrapWidth/lineSpacing round-trip through .jouer and export wordWrap", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("text", { patch: { text: "hi" } });
    const o0 = query.findObject(query.activeScene(store.getProject()), id);
    cmd.updateObject(id, { style: { ...o0.style, wrapWidth: 80, lineSpacing: 10 } });
    const js = window.__mj.exporter.exportGameJs(store.getProject());
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    const o = query.findObject(scene, id);
    return { w: o.style.wrapWidth, ls: o.style.lineSpacing, hasWrap: js.includes('"wordWrap":{"width":80,"useAdvancedWrap":true}') };
  });
  expect(r).toEqual({ w: 80, ls: 10, hasWrap: true });
});

test("text layout runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("text", { x: 80, y: 80, patch: { text: "smoke smoke smoke smoke" } }));
  await waitForNode(page, id);
  await setStyle(page, id, { wrapWidth: 40, lineSpacing: 6 });
  await page.waitForFunction((id) => (window.__mj.probe(id)?.height ?? 0) > 0, id, { timeout: 5000 });
  expect(await cspViolations(page)).toEqual([]);
});
