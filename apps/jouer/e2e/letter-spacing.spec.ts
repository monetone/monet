import { test, expect, type Page } from "@playwright/test";
import { gotoApp, waitForNode, cspViolations } from "./helpers";

// Unity-parity Text "Character Spacing" (TMP letter spacing): extra px between
// glyphs, may be negative. Maps to Phaser Text letterSpacing — it changes the
// rendered width, so specs assert the live node's width (relative, robust to font
// metrics) + the model/export. Under the `desktop` project the last test is the
// CSP smoke.

const widthOf = (page: Page, id: string) => page.evaluate((id) => window.__mj.probe(id)?.width ?? 0, id);

/** Merge a partial style onto a text object's existing style. */
async function setStyle(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(({ id, patch }) => {
    const { cmd, query, store } = window.__mj;
    const o = query.findObject(query.activeScene(store.getProject()), id);
    cmd.updateObject(id, { style: { ...o.style, ...patch } });
  }, { id, patch });
}

const addText = (page: Page) =>
  page.evaluate(() => window.__mj.cmd.addObject("text", { x: 100, y: 100, patch: { text: "AAAAA" } }));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a positive letter spacing widens the text", async ({ page }) => {
  const id = await addText(page);
  await waitForNode(page, id);
  const w0 = await widthOf(page, id);
  await setStyle(page, id, { letterSpacing: 20 });
  await page.waitForFunction(({ id, w0 }) => (window.__mj.probe(id)?.width ?? 0) > w0, { id, w0 }, { timeout: 5000 });
});

test("a negative letter spacing narrows the text", async ({ page }) => {
  const id = await addText(page);
  await waitForNode(page, id);
  const w0 = await widthOf(page, id);
  await setStyle(page, id, { letterSpacing: -4 });
  await page.waitForFunction(({ id, w0 }) => (window.__mj.probe(id)?.width ?? 0) < w0, { id, w0 }, { timeout: 5000 });
});

test("letterSpacing round-trips through .jouer and appears in the exported style", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("text", { patch: { text: "hi" } });
    const o0 = query.findObject(query.activeScene(store.getProject()), id);
    cmd.updateObject(id, { style: { ...o0.style, letterSpacing: 12 } });
    const js = window.__mj.exporter.exportGameJs(store.getProject());
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { ls: query.findObject(scene, id).style.letterSpacing, hasLs: js.includes('"letterSpacing":12') };
  });
  expect(r).toEqual({ ls: 12, hasLs: true });
});

test("letter spacing runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await addText(page);
  await waitForNode(page, id);
  await setStyle(page, id, { letterSpacing: 8 });
  await page.waitForFunction(({ id }) => (window.__mj.probe(id)?.width ?? 0) > 0, { id }, { timeout: 5000 });
  expect(await cspViolations(page)).toEqual([]);
});
