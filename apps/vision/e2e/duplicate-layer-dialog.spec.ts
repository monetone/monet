import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Layer ▸ Duplicate Layer… dialog ──────────────────────
// Adobe: Layer ▸ Duplicate Layer… (and the panel right-click) opens a dialog with
// an "As" field pre-filled "<name> copy" (then "copy 2", …); the panel's duplicate
// button skips it. Vision wires the dialog to the 'dup' menu id, pre-filling the
// collision-avoiding default via the pure defaultDuplicateName helper.
//   https://helpx.adobe.com/photoshop/using/duplicating-layers.html

async function openDuplicate(page: Page) {
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("Duplicate Layer…"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.includes("Duplicate Layer…")).run();
  });
  await expect(page.locator("#mv-duplayer-name")).toBeVisible();
}

test("the Duplicate Layer dialog pre-fills '<name> copy' and creates it", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const s = (window as any).__mv.store;
    s.newDocument(100, 100, "dup");
    s.renameLayer(s.state.activeLayerId, "Sky");
  });
  const before = await page.evaluate(() => (window as any).__mv.store.state.layers.length);
  await openDuplicate(page);
  await expect(page.locator("#mv-duplayer-name")).toHaveValue("Sky copy");
  await page.getByRole("button", { name: "OK" }).click();
  const after = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return { count: s.layers.length, names: s.layers.map((l: any) => l.name) };
  });
  expect(after.count).toBe(before + 1);
  expect(after.names).toContain("Sky copy");
});

test("re-duplicating the same layer increments to '<name> copy 2'", async ({ page }) => {
  await gotoApp(page);
  // Set up a doc that already holds "Sky" + "Sky copy", with "Sky" active.
  await page.evaluate(() => {
    const s = (window as any).__mv.store;
    s.newDocument(100, 100, "dup");
    const id = s.state.activeLayerId;
    s.renameLayer(id, "Sky");
    const before = new Set(s.state.layers.map((l: any) => l.id));
    s.duplicateLayer(id);
    const made = s.state.layers.find((l: any) => !before.has(l.id));
    if (made) s.renameLayer(made.id, "Sky copy");
    s.selectLayer(id); // re-select the original so the next default is "Sky copy 2"
  });
  const before = await page.evaluate(() => (window as any).__mv.store.state.layers.length);
  await openDuplicate(page);
  await expect(page.locator("#mv-duplayer-name")).toHaveValue("Sky copy 2");
  await page.getByRole("button", { name: "OK" }).click();
  const after = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return { count: s.layers.length, names: s.layers.map((l: any) => l.name) };
  });
  expect(after.count).toBe(before + 1);
  expect(after.names).toContain("Sky copy 2");
});
