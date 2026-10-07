import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gotoApp, withMv } from "./helpers";

const pngDimensions = (bytes: Buffer): [number, number] => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
const gifDimensions = (bytes: Buffer): [number, number] => [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];

function jpegDimensions(bytes: Buffer): [number, number] {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = bytes.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    }
    offset += length;
  }
  throw new Error("JPEG dimensions not found");
}

async function runExportAs(page: Page) {
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items
    .some((item: any) => item.label === "File ▸ Export ▸ Export As…"));
  await page.evaluate(() => (window as any).__mv.commandPalette.items
    .find((item: any) => item.label === "File ▸ Export ▸ Export As…").run());
}

async function runLayerExportAs(page: Page) {
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items
    .some((item: any) => item.label === "Layer ▸ Export As…"));
  await page.evaluate(() => (window as any).__mv.commandPalette.items
    .find((item: any) => item.label === "Layer ▸ Export As…").run());
}

async function setupDocument(page: Page, format: "png" | "jpeg") {
  return withMv(page, `(mv, E) => {
    mv.store.newDocument(8, 4, "scale-suffix.psd");
    E = mv.engine.engine;
    E.select_all(); E.fill_selection(20, 120, 230, 255); E.select_none();
    mv.engine.commit();
    mv.store.setExportPrefs({ format: "${format}", quality: 41 });
    mv.store.markActiveSaved();
    return {
      active: E.active_layer_id(),
      selected: [...mv.store.state.selectedLayerIds],
      undoDepth: E.undo_depth(),
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
      composite: Array.from(E.export_png()),
    };
  }`);
}

async function currentState(page: Page) {
  return withMv(page, `(mv, E) => ({
    active: E.active_layer_id(),
    selected: [...mv.store.state.selectedLayerIds],
    undoDepth: E.undo_depth(),
    dirty: mv.store.docDirty(mv.store.state.activeDocId),
    composite: Array.from(E.export_png()),
  })`);
}

test.beforeEach(async ({ page }) => { await gotoApp(page); });

test("Export As writes ordered fractional PNG sizes and blocks duplicate filenames", async ({ page }) => {
  const before = await setupDocument(page, "png");
  await runExportAs(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Export the composite in one or more relative sizes.");
  await expect(dialog.locator("[data-mv-export-scale-row]")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Delete size 1" })).toBeDisabled();

  await dialog.getByRole("button", { name: "+ Add size" }).click();
  await expect(dialog.locator("[data-mv-export-scale-row]")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Delete size 2" }).click();
  await expect(dialog.locator("[data-mv-export-scale-row]")).toHaveCount(1);
  await dialog.getByRole("button", { name: "+ Add size" }).click();

  await dialog.getByRole("spinbutton", { name: "Scale 1" }).fill("1.25");
  await dialog.getByRole("spinbutton", { name: "Scale 1" }).press("Tab");
  await dialog.getByRole("textbox", { name: "Suffix 1" }).fill("@1.25x");
  await dialog.getByRole("textbox", { name: "Suffix 2" }).fill("@1.25x");
  await expect(dialog.getByRole("alert")).toContainText("Duplicate");
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Suffix 2" }).fill("@2x");

  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.map((download) => download.suggestedFilename())).toEqual([
    "scale-suffix@1.25x.png",
    "scale-suffix@2x.png",
  ]);
  const bytes = await Promise.all(downloads.map(async (download) => readFile((await download.path())!)));
  expect(pngDimensions(bytes[0])).toEqual([10, 5]);
  expect(pngDimensions(bytes[1])).toEqual([16, 8]);
  expect(await currentState(page)).toEqual(before);
});

test("Export As cancels cleanly and scales JPEG with the saved quality", async ({ page }) => {
  const before = await setupDocument(page, "jpeg");
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));

  await runExportAs(page);
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByText("JPEG", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(downloads).toHaveLength(0);

  await runExportAs(page);
  dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton", { name: "Scale 1" }).fill("1.25");
  await dialog.getByRole("spinbutton", { name: "Scale 1" }).press("Tab");
  await dialog.getByRole("textbox", { name: "Suffix 1" }).fill("@1.25x");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect.poll(() => downloads.length).toBe(1);

  expect(downloads[0].suggestedFilename()).toBe("scale-suffix@1.25x.jpg");
  const bytes = await readFile((await downloads[0].path())!);
  expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(jpegDimensions(bytes)).toEqual([10, 5]);
  expect(await currentState(page)).toEqual(before);
});

test("Export As writes ordered GIF scale rows", async ({ page }) => {
  const before = await setupDocument(page, "png");
  await runExportAs(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByText("GIF", { exact: true }).click();
  await dialog.getByRole("spinbutton", { name: "Scale 1" }).fill("1.25");
  await dialog.getByRole("spinbutton", { name: "Scale 1" }).press("Tab");
  await dialog.getByRole("textbox", { name: "Suffix 1" }).fill("@1.25x");
  await dialog.getByRole("button", { name: "+ Add size" }).click();
  await dialog.getByRole("textbox", { name: "Suffix 2" }).fill("@2x");

  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.map((download) => download.suggestedFilename())).toEqual([
    "scale-suffix@1.25x.gif",
    "scale-suffix@2x.gif",
  ]);
  const bytes = await Promise.all(downloads.map(async (download) => readFile((await download.path())!)));
  expect(bytes[0].subarray(0, 6).toString()).toMatch(/^GIF8[79]a$/);
  expect(gifDimensions(bytes[0])).toEqual([10, 5]);
  expect(gifDimensions(bytes[1])).toEqual([16, 8]);
  expect(await currentState(page)).toEqual(before);
});

test("Layer Export As scales each selected asset without changing dotted names or state", async ({ page }) => {
  const setup = await withMv<{
    state: unknown;
    targets: Array<{ name: string; oneX: number[]; dimensions: [number, number] }>;
  }>(page, `(mv, E) => {
    mv.store.newDocument(12, 12, "selected-assets.psd");
    E = mv.engine.engine;
    const artboard = E.new_artboard_rect(1, 2, 5, 4, "Board.v2");
    const loose = E.add_layer("Hero.v2");
    E.set_active_layer(loose);
    E.select_rect(8, 9, 2, 1, 0); E.fill_selection(20, 220, 80, 255); E.select_none();
    mv.engine.commit();
    mv.store.selectLayer(artboard);
    mv.store.toggleLayerInSelection(loose);
    mv.store.setExportPrefs({ format: "png", quality: 73 });
    mv.store.markActiveSaved();
    const selected = new Set(mv.store.state.selectedLayerIds);
    const targets = mv.store.state.layers.filter((layer) => selected.has(layer.id)).map((layer) => ({
      name: layer.name,
      oneX: Array.from(E.export_layer_png_trimmed(layer.id)),
      dimensions: Array.from(E.export_layer_trimmed_size(layer.id)),
    }));
    return {
      targets,
      state: {
        active: E.active_layer_id(),
        selected: [...mv.store.state.selectedLayerIds],
        visible: mv.store.state.layers.map((layer) => E.layer_visible(layer.id)),
        undoDepth: E.undo_depth(),
        dirty: mv.store.docDirty(mv.store.state.activeDocId),
        composite: Array.from(E.export_png()),
      },
    };
  }`);

  await runLayerExportAs(page);
  const dialog = page.getByRole("dialog", { name: "Export As" });
  await expect(dialog).toContainText("Export each selected layer, group, or artboard in one or more relative sizes.");
  await expect(dialog.getByText("GIF", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "+ Add size" }).click();
  await dialog.getByRole("spinbutton", { name: "Scale 2" }).fill("1.25");
  await dialog.getByRole("spinbutton", { name: "Scale 2" }).press("Tab");
  await dialog.getByRole("textbox", { name: "Suffix 2" }).fill("@1.25x");

  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect.poll(() => downloads.length).toBe(4);
  expect(downloads.map((download) => download.suggestedFilename())).toEqual(
    setup.targets.flatMap((target) => [
      `${target.name}.png`,
      `${target.name}@1.25x.png`,
    ]),
  );
  const bytes = await Promise.all(downloads.map(async (download) => readFile((await download.path())!)));
  for (const [index, target] of setup.targets.entries()) {
    const oneX = bytes[index * 2];
    const scaled = bytes[index * 2 + 1];
    expect(oneX.equals(Buffer.from(target.oneX))).toBe(true);
    expect(pngDimensions(oneX)).toEqual(target.dimensions);
    expect(pngDimensions(scaled)).toEqual([
      Math.max(1, Math.round(Math.fround(target.dimensions[0] * Math.fround(1.25)))),
      Math.max(1, Math.round(Math.fround(target.dimensions[1] * Math.fround(1.25)))),
    ]);
  }
  expect(await withMv(page, `(mv, E) => ({
    active: E.active_layer_id(),
    selected: [...mv.store.state.selectedLayerIds],
    visible: mv.store.state.layers.map((layer) => E.layer_visible(layer.id)),
    undoDepth: E.undo_depth(),
    dirty: mv.store.docDirty(mv.store.state.activeDocId),
    composite: Array.from(E.export_png()),
  })`)).toEqual(setup.state);
});
