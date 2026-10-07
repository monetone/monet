import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Layer ▸ New ▸ Group… dialog ─────────────────────────
// Adobe: Layer ▸ New ▸ Group… opens a dialog (Name / Color / Mode / Opacity) before
// creating an empty group; the group's default blend is "Pass Through". Vision wired
// the dialog to the 'newgroup' menu id, pre-filling the next "Group N"; ⌘G + the
// panel grouping stay instant. Groups are layers with kind === 6.
//   https://helpx.adobe.com/photoshop/using/creating-layers-groups.html

async function openNewGroup(page: Page, doc = "ng") {
  await gotoApp(page);
  await page.evaluate((d) => (window as any).__mv.store.newDocument(100, 100, d), doc);
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("New ▸ Group…"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.includes("New ▸ Group…")).run();
  });
  await expect(page.locator("#mv-newgroup-name")).toBeVisible();
}

test("the New Group dialog pre-fills the next 'Group N' name", async ({ page }) => {
  await openNewGroup(page);
  await expect(page.locator("#mv-newgroup-name")).toHaveValue(/^Group \d+$/);
  // Pass Through is the default group blend mode.
  await expect(page.locator("#mv-newgroup-mode")).toHaveAttribute("data-value", "pass-through");
});

test("the New Group dialog creates a group with the chosen settings", async ({ page }) => {
  await openNewGroup(page, "ng2");
  const before = await page.evaluate(() => (window as any).__mv.store.state.layers.length);
  await page.locator("#mv-newgroup-name").fill("Sky Group");
  await chooseOption(page.locator("#mv-newgroup-mode"), "multiply");
  await chooseOption(page.locator("#mv-newgroup-color"), "blue");
  await page.locator("#mv-newgroup-opacity").fill("50");
  await page.locator("#mv-newgroup-opacity").press("Enter");
  await page.getByRole("button", { name: "OK" }).click();
  const info = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    const l = s.layers.find((x: any) => x.name === "Sky Group");
    return l ? { count: s.layers.length, kind: l.kind, blendMode: l.blendMode, opacity: l.opacity, label: s.layerColorLabels[l.id] } : null;
  });
  expect(info).not.toBeNull();
  expect(info!.count).toBe(before + 1);
  expect(info!.kind).toBe(6); // group
  expect(info!.blendMode).toBe("multiply");
  expect(info!.opacity).toBe(50);
  expect(info!.label).toBe("blue");
});
