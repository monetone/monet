import { test, expect, type Locator, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── #434: core adjustments and filters run natively in 32-bit documents ──
// A real Radiance HDR image round-tripped through PSD keeps 32-bit float
// authority. Image ▸ Adjustments ▸ Levels/Curves/Exposure/Hue-Saturation and
// Filter ▸ Blur/Sharpen must apply from the menu as one history step without
// clamping samples above 1.0, Cancel must leave the samples untouched, and
// operations outside the float subset refuse with a toast naming them that
// offers Convert to 16-bit only when converting is the fix.
// Samples are read back exactly from the native float composite (not a
// tone-mapped or 8-bit preview). Pixel layout: [r,g,b,a] × 3.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  const opened = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const header = new TextEncoder().encode("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 3\n");
    const hdr = new Uint8Array(header.length + 12);
    hdr.set(header);
    // Flat RGBE scanline: RGB = (4,2,1), (16,8,4), (4,2,1).
    hdr.set([128, 64, 32, 131, 128, 64, 32, 133, 128, 64, 32, 131], header.length);
    const source = mv.engine.buildImage(hdr);
    const psd = source.export_psd();
    source.free();
    mv.store.openFormat(psd, "hdr434.psd");
    return { depth: mv.engine.engine.doc_depth(), hdr: mv.engine.engine.has_hdr_samples() };
  });
  expect(opened).toEqual({ depth: 32, hdr: true });
});

const px = (page: Page): Promise<number[]> =>
  page.evaluate(() => Array.from((window as any).__mv.engine.engine.export_composite_rgba32() as Float32Array));
const undoDepth = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__mv.engine.engine.undo_depth());

async function run(page: Page, label: string) {
  await page.waitForFunction((l) => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label === l), label, { timeout: 5000 });
  await page.evaluate((l) => (window as any).__mv.commandPalette.items.find((i: any) => i.label === l).run(), label);
}

async function inDialog(page: Page, label: string, edit: (dialog: Locator) => Promise<void>) {
  await run(page, label);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await edit(dialog);
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toHaveCount(0);
}

/** Runs one menu apply and checks it landed as a single history step with no edit error. */
async function applied(page: Page, apply: () => Promise<void>) {
  const before = await px(page);
  const depth = await undoDepth(page);
  await apply();
  await expect.poll(() => undoDepth(page)).toBe(depth + 1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const after = await px(page);
  expect(before[4]).toBeGreaterThan(1); // the fixture really is HDR
  expect(after[3]).toBe(before[3]);
  return { before, after };
}

test("Levels maps HDR input without clamping", async ({ page }) => {
  const { before, after } = await applied(page, () => inDialog(page, "Image ▸ Adjustments ▸ Levels…", async (d) => {
    await d.getByRole("slider", { name: "Input white", exact: true }).press("Home"); // input white 1/255
  }));
  expect(after[0]).toBeGreaterThan(before[0] * 100);
  expect(after[4]).toBeGreaterThan(before[4] * 100);
});

test("a lifted Curves keeps highlights above 1.0", async ({ page }) => {
  const { before, after } = await applied(page, () => inDialog(page, "Image ▸ Adjustments ▸ Curves…", async (d) => {
    const box = await d.locator('[aria-label="Tone curve"]').boundingBox();
    if (!box) throw new Error("curve editor not found");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.18, { steps: 12 });
    await page.mouse.up();
  }));
  // The lift flattens the curve's top 8-bit step; HDR samples follow its tangent instead of stopping at 1.0.
  expect(after[4]).toBeLessThan(before[4]);
  expect(after[4]).toBeGreaterThan(2);
});

test("Exposure scales scene-linear HDR samples", async ({ page }) => {
  const { before, after } = await applied(page, () => inDialog(page, "Image ▸ Adjustments ▸ Exposure…", async (d) => {
    await d.getByRole("slider", { name: "Exposure", exact: true }).press("End"); // +3 stops
  }));
  for (const i of [0, 1, 2, 4, 5, 6]) expect(after[i] / before[i]).toBeCloseTo(8, 3);
});

test("Hue/Saturation rotates HDR colour without clipping", async ({ page }) => {
  const { after } = await applied(page, () => inDialog(page, "Image ▸ Adjustments ▸ Hue/Saturation…", async (d) => {
    await d.getByRole("slider", { name: "Hue", exact: true }).press("End"); // +180°
  }));
  expect(after[6]).toBeGreaterThan(after[4]); // red-dominant turns blue-dominant
  expect(after[6]).toBeGreaterThan(1);
});

test("Blur averages HDR neighbours", async ({ page }) => {
  const { before, after } = await applied(page, () => run(page, "Filter ▸ Blur ▸ Blur"));
  expect(after[4]).toBeLessThan(before[4]);
  expect(after[4]).toBeGreaterThan(before[0]);
  expect(after[0]).toBeGreaterThan(before[0]);
});

test("Sharpen pushes an HDR peak further above 1.0", async ({ page }) => {
  const { before, after } = await applied(page, () => run(page, "Filter ▸ Sharpen ▸ Sharpen"));
  expect(after[4]).toBeGreaterThan(before[4]);
});

test("Cancel leaves the float samples and history untouched", async ({ page }) => {
  const before = await px(page);
  const depth = await undoDepth(page);
  await run(page, "Image ▸ Adjustments ▸ Exposure…");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("slider", { name: "Exposure", exact: true }).press("End");
  await expect.poll(() => px(page)).not.toEqual(before); // the live preview reached the float samples
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await px(page)).toEqual(before);
  expect(await undoDepth(page)).toBe(depth);
});

test("refusals name the operation; only float refusals offer Convert to 16-bit", async ({ page }) => {
  const alert = page.getByRole("alert");
  const convert = page.getByRole("button", { name: "Convert to 16-bit" });
  const before = await px(page);
  const depth = await undoDepth(page);

  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.adjust_invert();
    return mv.engine.commit();
  })).toBe(false);
  await expect(alert).toContainText("Invert is not 32-bit-float safe");
  await expect(convert).toBeVisible();
  await alert.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(alert).toHaveCount(0);

  // Liquify reports at the dab and leaves no latched error behind.
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.liquifyDab(1, 0, 0, 0);
    return mv.engine.engine.last_edit_error();
  })).toBe("");
  await expect(alert).toContainText("Liquify is not 32-bit-float safe");
  await expect(convert).toBeVisible();
  await alert.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(alert).toHaveCount(0);
  expect(await px(page)).toEqual(before);
  expect(await undoDepth(page)).toBe(depth);

  // The next supported edit is not blamed for either refusal.
  await run(page, "Filter ▸ Blur ▸ Blur");
  await expect.poll(() => undoDepth(page)).toBe(depth + 1);
  await expect(alert).toHaveCount(0);

  // Converting cannot unlock a layer, so a lock refusal offers no conversion.
  await page.evaluate(() => {
    const e = (window as any).__mv.engine.engine;
    e.set_layer_locked(e.active_layer_id(), true);
  });
  const locked = await undoDepth(page); // Lock Layer is its own history step
  await run(page, "Filter ▸ Blur ▸ Blur");
  await expect(alert).toContainText("locked");
  await expect(convert).toHaveCount(0);
  expect(await undoDepth(page)).toBe(locked);
});
