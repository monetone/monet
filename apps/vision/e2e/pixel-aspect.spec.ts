import { expect, test, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.resetPixelAspectPresets("replace");
  });
});

async function runExactCommand(page: Page, label: string) {
  await page.waitForFunction((exact) =>
    (window as any).__mv.commandPalette?.items?.some((item: any) => item.label === exact), label, { timeout: 5000 });
  await page.evaluate((exact) =>
    (window as any).__mv.commandPalette.items.find((item: any) => item.label === exact).run(), label);
}

test("custom pixel aspect ratios are named, persisted, selectable, and offered by New Document", async ({ page }) => {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 80, "custom ratio");
    mv.store.markActiveSaved();
  });

  await runExactCommand(page, "View ▸ Pixel Aspect Ratio ▸ Custom Pixel Aspect Ratio…");
  await page.getByLabel("Pixel aspect name").fill("Cinema Pixels");
  await page.getByRole("spinbutton", { name: "Pixel aspect ratio" }).fill("1.25");
  await page.getByRole("button", { name: "OK" }).click();

  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      ratio: mv.store.state.pixelAspect,
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
      preset: mv.store.state.pixelAspectPresets.find((p: any) => p.name === "Cinema Pixels"),
      persisted: JSON.parse(localStorage.getItem("mv.pixelAspectPresets") || "[]").some((p: any) => p.name === "Cinema Pixels"),
    };
  })).toEqual({ ratio: 1.25, dirty: true, preset: { name: "Cinema Pixels", ratio: 1.25, builtin: false }, persisted: true });

  await page.evaluate(() => (window as any).__mv.store.setPixelAspect(1));
  await runExactCommand(page, "View ▸ Pixel Aspect Ratio ▸ Cinema Pixels");
  expect(await page.evaluate(() => (window as any).__mv.store.state.pixelAspect)).toBe(1.25);

  await runExactCommand(page, "File ▸ New…");
  await page.locator("#mv-doc-pixel-aspect").click();
  await page.getByRole("option", { name: "Cinema Pixels" }).click();
  await page.getByRole("button", { name: "Create" }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.pixelAspect)).toBe(1.25);
});

test("pixel aspect ratio and correction are document-owned and survive project save/open", async ({ page }) => {
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(64, 48, "ratio A");
    const a = mv.store.state.activeDocId;
    mv.store.setPixelAspect(1.33);
    mv.store.togglePixelAspectCorrection();
    const saved = mv.store.saveProject();

    mv.store.newDocument(64, 48, "ratio B");
    const b = mv.store.state.activeDocId;
    const bState = [mv.store.state.pixelAspect, mv.store.state.pixelAspectCorrection];
    mv.store.activateDoc(a);
    const aState = [mv.store.state.pixelAspect, mv.store.state.pixelAspectCorrection];
    mv.store.activateDoc(b);
    const bAgain = [mv.store.state.pixelAspect, mv.store.state.pixelAspectCorrection];

    mv.store.openProject(saved, "ratio restored.mvision");
    const restored = [mv.store.state.pixelAspect, mv.store.state.pixelAspectCorrection];
    return { aState, bState, bAgain, restored };
  });
  expect(result).toEqual({
    aState: [1.33, false],
    bState: [1, true],
    bAgain: [1, true],
    restored: [1.33, false],
  });
});

test("Delete removes catalog entries and Reset supports Append or replacement", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.savePixelAspectPreset("Cinema Pixels", 1.25));
  await runExactCommand(page, "View ▸ Pixel Aspect Ratio ▸ Delete Pixel Aspect Ratio…");
  const dialog = page.getByRole("dialog");
  await dialog.locator("#mv-delete-pixel-aspect").click();
  await page.getByRole("option", { name: "Square" }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.pixelAspectPresets.some((p: any) => p.name === "Square"))).toBe(false);

  await runExactCommand(page, "View ▸ Pixel Aspect Ratio ▸ Reset Pixel Aspect Ratios…");
  await page.getByRole("button", { name: "Append" }).click();
  expect(await page.evaluate(() => {
    const names = (window as any).__mv.store.state.pixelAspectPresets.map((p: any) => p.name);
    return [names.includes("Square"), names.includes("Cinema Pixels")];
  })).toEqual([true, true]);

  await runExactCommand(page, "View ▸ Pixel Aspect Ratio ▸ Reset Pixel Aspect Ratios…");
  await page.getByRole("button", { name: "OK" }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.pixelAspectPresets.some((p: any) => p.name === "Cinema Pixels"))).toBe(false);
});
