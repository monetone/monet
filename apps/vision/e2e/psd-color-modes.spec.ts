import { test, expect, type Page } from "@playwright/test";
import { readPsd } from "ag-psd";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gotoApp, newScene } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));

// ── Save As ▸ Photoshop keeps the document's colour mode (#459) ──────────
// bytesForExt("psd") is the byte source File ▸ Save As writes for a .psd
// target. The header must carry the mode (1 Grayscale, 7 Multichannel,
// 8 Duotone, 9 Lab) and its channel count, a Duotone its inks in the colour
// mode data, and File ▸ Open must land back in the same mode. ag-psd reads the
// Grayscale file, which proves those bytes are well formed, not that
// Photoshop accepts them.

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

const savePsd = (page: Page) =>
  page.evaluate(async () => Array.from((await (window as any).__mv.bytesForExt("psd")).bytes as Uint8Array));

/** (channels, depth, mode) from a Photoshop header. */
const header = (bytes: number[]) => {
  const at = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  return { channels: at(12), depth: at(22), mode: at(24) };
};

const colorModeDataLength = (bytes: number[]) =>
  ((bytes[26] << 24) | (bytes[27] << 16) | (bytes[28] << 8) | bytes[29]) >>> 0;

const colorModeData = (bytes: number[]) => bytes.slice(30, 30 + colorModeDataLength(bytes));

/** The active document's layer names, top first. */
const layerNames = (page: Page) =>
  page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return [...Array(E.layer_count()).keys()].map((i) => E.layer_name(E.layer_id_at(i)));
  });

/** Image ▸ Mode ▸ Grayscale through the real menu dispatch. */
async function modeGrayscale(page: Page) {
  await page.waitForFunction(() => (window as any).__mv?.macMenu?.currentMenuTree?.().length > 0);
  const id = await page.evaluate(() => {
    const ids: string[] = [];
    const walk = (n: any) => {
      if (n.kind === "submenu") n.items.forEach(walk);
      else if (n.kind === "item") ids.push(n.id);
    };
    (window as any).__mv.macMenu.currentMenuTree().forEach(walk);
    return ids.find((id) => id.endsWith("/mode/mgray"));
  });
  expect(id).toBeTruthy();
  await page.evaluate((mid) => (window as any).__mv.macMenu.dispatchMenuAction(mid), id);
}

/** File ▸ Open the bytes; the reopened document's mode, layers and inks. */
const reopen = (page: Page, bytes: number[], name: string) =>
  page.evaluate(({ bytes, name }) => {
    const mv = (window as any).__mv;
    mv.store.openFormat(new Uint8Array(bytes), name);
    const E = mv.engine.engine;
    const layers: string[] = [];
    for (let i = 0; i < E.layer_count(); i++) layers.push(E.layer_name(E.layer_id_at(i)));
    const duotone = mv.store.state.duotone;
    return {
      mode: mv.store.state.mode,
      engineMode: E.doc_mode(),
      layers,
      inks: duotone ? duotone.inks.map((ink: any) => ink.name) : null,
      inkLayerIsLive: duotone ? E.layer_name(duotone.layerId) === "Duotone" : false,
      activeIsInk: duotone ? E.active_layer_id() === duotone.layerId : false,
      canUndo: E.can_undo(),
    };
  }, { bytes, name });

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a Duotone document saves as Photoshop Duotone and reopens with its inks in Duotone Options", async ({ page }) => {
  await newScene(page, 48, 32);
  await runCommand(page, "Duotone");
  const dialog = page.getByRole("dialog", { name: "Duotone Options" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Ink 2 name").fill("PMS 7527 Warm");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.duotone?.inks.map((i: any) => i.name)))
    .toEqual(["Black", "PMS 7527 Warm"]);

  const bytes = await savePsd(page);
  expect(header(bytes)).toEqual({ channels: 2, depth: 8, mode: 8 }); // the gray plate + merged alpha
  expect(colorModeDataLength(bytes)).toBe(524); // the ink specification
  expect((bytes[32] << 8) | bytes[33]).toBe(2); // two inks

  const opened = await reopen(page, bytes, "duo.psd");
  expect(opened).toMatchObject({
    mode: 1, engineMode: 1, inks: ["Black", "PMS 7527 Warm"], inkLayerIsLive: true, activeIsInk: false, canUndo: false,
  });
  expect(opened.layers.filter((name) => name === "Duotone")).toHaveLength(1);

  await runCommand(page, "Duotone");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Duotone" })).toBeChecked();
  await expect(dialog.getByLabel("Ink 1 name")).toHaveValue("Black");
  await expect(dialog.getByLabel("Ink 2 name")).toHaveValue("PMS 7527 Warm");
  await expect(dialog.getByLabel("Ink 2 color")).toHaveValue("#b07a2d");
  await expect(dialog.getByRole("combobox", { name: "Duotone preset" })).toHaveText("Custom");
});

test("Grayscale, Lab and Multichannel documents save in their own Photoshop mode and reopen there", async ({ page }) => {
  for (const [label, target, code, channels] of [
    ["Grayscale", 1, 1, 2],
    ["Lab", 3, 9, 4],
    ["Multichannel", 4, 7, 4],
  ] as const) {
    await newScene(page, 40, 24);
    await page.evaluate((target) => {
      const store = (window as any).__mv.store;
      if (target === 1) store.convertGrayscale();
      else store.setColorMode(target);
    }, target);
    const bytes = await savePsd(page);
    expect(header(bytes), label).toEqual({ channels, depth: 8, mode: code });
    if (target === 1) {
      const psd = readPsd(new Uint8Array(bytes).buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
      expect(psd.colorMode).toBe(1);
      expect(psd.children?.length).toBe(1);
    }
    const opened = await reopen(page, bytes, `${label}.psd`);
    expect(opened, label).toMatchObject({ mode: target, engineMode: target, canUndo: false });
  }
});

const INKS = [
  { name: "Black", color: [0, 0, 0], curve: [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100] },
  { name: "PMS 7527", color: [176, 122, 45], curve: [0, 2, 5, 12, 20, 30, 40, 50, 60, 70, 80, 85, 90] },
];

/** The ink names a Duotone file's colour mode data carries. */
const inkNames = (bytes: number[]) => {
  const count = (bytes[32] << 8) | bytes[33];
  return [...Array(count).keys()].map((i) => {
    const at = 30 + 44 + i * 64;
    return String.fromCharCode(...bytes.slice(at + 1, at + 1 + bytes[at]));
  });
};

const makeDuotone = (page: Page) =>
  page.evaluate((inks) => (window as any).__mv.store.convertDuotone(inks), INKS);

test("the inks stay with their document: another file opened after it and an Undo both save as Grayscale", async ({ page }) => {
  // A two-layer Grayscale Photoshop file to open while a Duotone is active.
  await newScene(page, 40, 24);
  const gray = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    mv.store.convertGrayscale();
    mv.engine.engine.add_layer("Top");
    mv.engine.commit();
    return Array.from((await mv.bytesForExt("psd")).bytes as Uint8Array);
  });
  expect(header(gray).mode).toBe(1);

  await newScene(page, 40, 24);
  await makeDuotone(page);
  expect(header(await savePsd(page)).mode).toBe(8);
  const opened = await reopen(page, gray, "gray.psd");
  expect(opened).toMatchObject({ mode: 1, inks: null });
  const resaved = await savePsd(page);
  expect(header(resaved).mode).toBe(1);
  expect(colorModeDataLength(resaved)).toBe(0);
  const psd = readPsd(new Uint8Array(resaved).buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  expect(psd.children?.map((layer) => layer.name)).toEqual(["Background", "Top"]);

  // Undo takes the ink layer away; the record left behind must not decide the file.
  await newScene(page, 40, 24);
  await makeDuotone(page);
  await page.evaluate(() => (window as any).__mv.store.undo());
  const undone = await savePsd(page);
  expect(header(undone)).toEqual({ channels: 2, depth: 8, mode: 1 });
  expect(colorModeDataLength(undone)).toBe(0);
});

test("a Duotone saved as .mvision reopens with its inks and still saves as a Photoshop Duotone", async ({ page }) => {
  await newScene(page, 40, 24);
  await makeDuotone(page);
  const project = await page.evaluate(async () =>
    Array.from((await (window as any).__mv.bytesForExt("mvision")).bytes as Uint8Array));
  await page.evaluate((bytes) => (window as any).__mv.store.openProject(new Uint8Array(bytes), "duo.mvision"), project);
  const reopened = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const duotone = mv.store.state.duotone;
    return { names: duotone?.inks.map((ink: any) => ink.name), layer: duotone && mv.engine.engine.layer_name(duotone.layerId) };
  });
  expect(reopened).toEqual({ names: ["Black", "PMS 7527"], layer: "Duotone" });
  // Image ▸ Duplicate carries them too.
  await page.evaluate(() => (window as any).__mv.store.duplicateDocument());
  expect(inkNames(await savePsd(page))).toEqual(["Black", "PMS 7527"]);
  const bytes = await savePsd(page);
  expect(header(bytes).mode).toBe(8);
  expect(inkNames(bytes)).toEqual(["Black", "PMS 7527"]);

  // A project saved before the inks were recorded names the fix rather than
  // failing on the ink layer's LUT.
  const message = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    mv.store.setDuotoneRecord(null);
    try {
      await mv.bytesForExt("psd");
      return "saved";
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(message).toContain("Image ▸ Mode ▸ Duotone");
});

test("Image ▸ Mode ▸ Grayscale on a Duotone discards the inks in one undoable step", async ({ page }) => {
  await newScene(page, 40, 24);
  await makeDuotone(page);
  expect(await layerNames(page)).toContain("Duotone");

  await modeGrayscale(page);
  await expect.poll(() => layerNames(page)).toEqual(["Background"]);
  const gray = await savePsd(page); // no "inks were not saved" refusal
  expect(header(gray)).toEqual({ channels: 2, depth: 8, mode: 1 });
  expect(colorModeDataLength(gray)).toBe(0);

  // One Undo brings the ink layer back, and with it the Duotone.
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerNames(page)).toEqual(["Duotone", "Background"]);
  const duotone = await savePsd(page);
  expect(header(duotone).mode).toBe(8);
  expect(inkNames(duotone)).toEqual(["Black", "PMS 7527"]);
  await page.evaluate(() => (window as any).__mv.store.redo());
  expect(header(await savePsd(page)).mode).toBe(1);
});

test("an unedited Photoshop Duotone re-saves its ink specification byte for byte", async ({ page }) => {
  // psd-tools' 4x4_8bit_duotone.psd (see test-assets/fixtures/psd-tools-MIT.txt):
  // a CMYK and a colour-book ink, curves with points only at 0, 50 and 100%.
  const original = Array.from(readFileSync(join(here, "..", "test-assets", "fixtures", "psd-tools-4x4_8bit_duotone.psd")));
  const opened = await reopen(page, original, "4x4_8bit_duotone.psd");
  expect(opened.inks).toEqual(["Black", "PANTONE 327 CVC"]);
  const resaved = await savePsd(page);
  expect(header(resaved).mode).toBe(8);
  expect(colorModeData(resaved)).toEqual(colorModeData(original));
});
