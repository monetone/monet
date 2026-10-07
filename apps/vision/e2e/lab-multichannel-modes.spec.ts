import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// Image > Mode > Lab Color / Multichannel baseline:
// Vision currently models these as document mode metadata that drives channels,
// status/readouts, undo, and persistence. Pixel buffers remain RGBA internally.

async function runCommand(page: Page, label: string) {
  await page.waitForFunction((needle) => {
    const items = (window as any).__mv.commandPalette?.items ?? [];
    return items.some((i: any) => i.label.includes(needle));
  }, label, { timeout: 5000 });
  await page.evaluate((needle) => {
    const items = (window as any).__mv.commandPalette.items;
    items.find((i: any) => i.label.includes(needle)).run();
  }, label);
}

async function freshDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(24, 24, "mode-baseline"));
}

const modePair = (page: Page) =>
  page.evaluate(() => {
    const mv = (window as any).__mv;
    return { store: mv.store.state.mode, engine: mv.engine.engine.doc_mode() };
  });

async function expectMode(page: Page, expected: number) {
  await expect.poll(() => modePair(page)).toEqual({ store: expected, engine: expected });
}

test("Image Mode Lab Color updates document state, channels, status, and undo", async ({ page }) => {
  await freshDoc(page);
  await runCommand(page, "Lab Color");
  await expectMode(page, 3);

  await page.locator('[data-tab-id="channels"]').click();
  await expect(page.locator("[data-mv-channels-panel]")).toContainText("Lab Color");
  await expect(page.locator("[data-mv-channels-panel]")).toContainText("Composite Lab");
  await expect(page.locator("[data-mv-channels-panel]")).toContainText("Lightness");
  await expect(page.locator("[data-mv-channels-panel]")).toContainText("a");
  await expect(page.locator("[data-mv-channels-panel]")).toContainText("b");

  await chooseOption(page.locator("#mv-status-info"), "profile");
  await expect(page.locator("[data-mv-status]")).toHaveText("Lab Color / 8-bit / No mode-specific profile");

  await page.evaluate(() => (window as any).__mv.store.undo());
  await expectMode(page, 0);
});

test("Image Mode Multichannel updates document state and channel labels", async ({ page }) => {
  await freshDoc(page);
  await runCommand(page, "Multichannel");
  await expectMode(page, 4);

  await page.locator('[data-tab-id="channels"]').click();
  await expect(page.locator("[data-mv-channels-panel]")).toContainText("Multichannel");
  await expect(page.locator("[data-mv-channels-panel]")).toContainText("Multichannel Composite");
  await expect(page.locator("[data-mv-channels-panel]")).toContainText("Cyan");
  await expect(page.locator("[data-mv-channels-panel]")).toContainText("Magenta");
  await expect(page.locator("[data-mv-channels-panel]")).toContainText("Yellow");
  await expect(page.locator("[data-mv-channels-panel]")).toContainText("Black");

  await chooseOption(page.locator("#mv-status-info"), "profile");
  await expect(page.locator("[data-mv-status]")).toHaveText("Multichannel / 8-bit / No mode-specific profile");
});

test("Conditional Mode Change includes Lab and Multichannel modes", async ({ page }) => {
  await freshDoc(page);
  await runCommand(page, "Lab Color");
  await expectMode(page, 3);

  await runCommand(page, "Conditional Mode Change");
  await expect(page.getByText("Conditional Mode Change", { exact: true })).toBeVisible();
  await expect(page.locator("#mv-conditional-source-3")).toBeChecked();
  await expect(page.locator("#mv-conditional-source-4")).toBeChecked();
  await page.locator("#mv-conditional-mode").click();
  await expect(page.getByRole("option", { name: "Lab Color" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Multichannel" })).toBeVisible();

  await page.getByRole("option", { name: "Multichannel" }).click();
  await page.getByRole("button", { name: "OK" }).click();
  await expectMode(page, 4);
});
