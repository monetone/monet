import { test, expect } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity "Save/Load Selection" (Edit ▸ Selection): named selection sets in
// slots 1–9 let you stash the current selection and restore it later. They are
// editor-session state (not in the .jouer document) and restore filtered to the
// objects that still exist. Specs drive `window.__mj`; under the `desktop`
// project (shipped bundle + Tauri CSP) the last test doubles as the CSP smoke.

const sel = (page: import("@playwright/test").Page) =>
  page.evaluate(() => [...window.__mj.store.state.selection].sort());

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("saves the current selection and restores it after it changes", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 50, y: 50 });
    const b = cmd.addObject("ellipse", { x: 150, y: 50 });
    store.select([a, b]);
    cmd.saveSelectionSet("1");
    store.clearSelection();
    return [a, b].sort();
  });
  expect(await sel(page)).toEqual([]);
  await page.evaluate(() => window.__mj.cmd.loadSelectionSet("1"));
  expect(await sel(page)).toEqual(ids);
});

test("load drops objects that no longer exist", async ({ page }) => {
  const a = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 50, y: 50 });
    const b = cmd.addObject("rectangle", { x: 150, y: 50 });
    store.select([a, b]);
    cmd.saveSelectionSet("2");
    store.selectOne(b);
    cmd.deleteSelection(); // remove b
    cmd.loadSelectionSet("2");
    return a;
  });
  expect(await sel(page)).toEqual([a]);
});

test("keeps slots independent", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle");
    const b = cmd.addObject("rectangle");
    const c = cmd.addObject("rectangle");
    store.select([a]); cmd.saveSelectionSet("1");
    store.select([b, c]); cmd.saveSelectionSet("2");
    return { a, bc: [b, c].sort() };
  });
  await page.evaluate(() => window.__mj.cmd.loadSelectionSet("1"));
  expect(await sel(page)).toEqual([r.a]);
  await page.evaluate(() => window.__mj.cmd.loadSelectionSet("2"));
  expect(await sel(page)).toEqual(r.bc);
});

test("loading a never-saved slot is a no-op", async ({ page }) => {
  const a = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle");
    store.selectOne(a);
    cmd.loadSelectionSet("8"); // never saved
    return a;
  });
  expect(await sel(page)).toEqual([a]);
});

test("exposes saved slots in the snapshot for the menu", async ({ page }) => {
  const sets = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle");
    const b = cmd.addObject("rectangle");
    store.select([a, b]);
    cmd.saveSelectionSet("3");
    return window.__mj.store.state.selectionSets;
  });
  expect(sets["3"]).toHaveLength(2);
  expect(sets["4"]).toBeUndefined();
});

test("keyboard: Cmd/Ctrl+Alt+N saves, Cmd/Ctrl+Shift+N loads", async ({ page }) => {
  const a = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 80, y: 80 });
    store.selectOne(a);
    return a;
  });
  // focus a non-input element so the global shortcut handler runs
  await page.locator(".mj-stage canvas").click({ position: { x: 5, y: 5 } });
  await page.evaluate((id) => window.__mj.store.selectOne(id), a);
  await page.keyboard.press("Control+Alt+Digit1"); // save slot 1
  await page.evaluate(() => window.__mj.store.clearSelection());
  expect(await sel(page)).toEqual([]);
  await page.keyboard.press("Control+Shift+Digit1"); // load slot 1
  expect(await sel(page)).toEqual([a]);
});

test("save + load run under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle");
    store.selectOne(a);
    cmd.saveSelectionSet("9");
    store.clearSelection();
    cmd.loadSelectionSet("9");
  });
  expect(await cspViolations(page)).toEqual([]);
});
