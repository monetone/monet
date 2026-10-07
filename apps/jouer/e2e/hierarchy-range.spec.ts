import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Hierarchy multi-select: click selects (and anchors), Shift+click
// selects the contiguous range to the anchor in display order, Cmd/Ctrl+click
// toggles a single row. Specs drive the real hierarchy rows with modifier clicks.
// Under the `desktop` project the last test doubles as the CSP smoke.

const sel = (page: Page) => page.evaluate(() => [...window.__mj.store.state.selection].sort());
const clickRow = (page: Page, id: string, modifiers?: ("Shift" | "ControlOrMeta")[]) =>
  page.locator(`[data-obj-id="${id}"] .mj-item-name`).click(modifiers ? { modifiers } : undefined);

/** Add four rectangles A..D; display order (depth desc) is top→bottom: D,C,B,A. */
async function seed(page: Page) {
  return page.evaluate(() => {
    const { cmd } = window.__mj;
    return {
      a: cmd.addObject("rectangle", { patch: { name: "A" } }),
      b: cmd.addObject("rectangle", { patch: { name: "B" } }),
      c: cmd.addObject("rectangle", { patch: { name: "C" } }),
      d: cmd.addObject("rectangle", { patch: { name: "D" } }),
    } as Record<string, string>;
  });
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("Shift+click selects the contiguous range from the anchor", async ({ page }) => {
  const ids = await seed(page);
  await clickRow(page, ids.d); // anchor = D (top row)
  await clickRow(page, ids.b, ["Shift"]); // range D→B in display order = D,C,B
  expect(await sel(page)).toEqual([ids.b, ids.c, ids.d].sort());
});

test("Cmd/Ctrl+click toggles a single row in and out", async ({ page }) => {
  const ids = await seed(page);
  await clickRow(page, ids.a);
  expect(await sel(page)).toEqual([ids.a]);
  await clickRow(page, ids.c, ["ControlOrMeta"]);
  expect(await sel(page)).toEqual([ids.a, ids.c].sort());
  await clickRow(page, ids.c, ["ControlOrMeta"]); // toggle off
  expect(await sel(page)).toEqual([ids.a]);
});

test("a plain click resets to a single selection (and re-anchors)", async ({ page }) => {
  const ids = await seed(page);
  await clickRow(page, ids.d);
  await clickRow(page, ids.a, ["Shift"]); // whole range
  expect(await sel(page)).toHaveLength(4);
  await clickRow(page, ids.b); // plain → single
  expect(await sel(page)).toEqual([ids.b]);
  // the plain click re-anchored at B: shift to D selects B,C,D
  await clickRow(page, ids.d, ["Shift"]);
  expect(await sel(page)).toEqual([ids.b, ids.c, ids.d].sort());
});

test("the range follows the Alphabetical sort order when active", async ({ page }) => {
  const ids = await seed(page);
  await page.getByTestId("hierarchy-sort").click(); // Transform → Alphabetical (A,B,C,D)
  await clickRow(page, ids.a); // anchor A (now top)
  await clickRow(page, ids.c, ["Shift"]); // A→C alphabetically = A,B,C
  expect(await sel(page)).toEqual([ids.a, ids.b, ids.c].sort());
});

test("Shift+click after the anchor was deleted degrades to a single selection", async ({ page }) => {
  const ids = await seed(page);
  await clickRow(page, ids.d); // anchor = D
  await page.evaluate((id) => { window.__mj.store.selectOne(id); window.__mj.cmd.deleteSelection(); }, ids.d);
  await clickRow(page, ids.b, ["Shift"]); // anchor gone → just B
  expect(await sel(page)).toEqual([ids.b]);
});

test("hierarchy range-select runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const ids = await seed(page);
  await clickRow(page, ids.d);
  await clickRow(page, ids.a, ["Shift"]);
  expect(await sel(page)).toHaveLength(4);
  expect(await cspViolations(page)).toEqual([]);
});
