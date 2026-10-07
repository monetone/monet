import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gotoApp, newScene } from "./helpers";

// #461: File ▸ Export ▸ TIFF on a layered document raises TIFF Options. With
// Save layers the TIFF carries Photoshop's ImageSourceData tag (37724) and
// File ▸ Open restores the same layers, masks, blend modes and opacity;
// unchecked, the flat composite. A one-layer document never asks, and a
// damaged layer payload opens flat with a notice.

const SIGNATURE = Buffer.from("Adobe Photoshop Document Data Block\0", "latin1");
const MULTIPLY = 3;

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await page.waitForFunction(() => (window as any).__mv?.macMenu?.currentMenuTree?.().length > 0);
});

async function layeredScene(page: Page) {
  await newScene(page, 64, 48);
  await page.evaluate((multiply) => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    const id = E.add_layer("Multiply 50%");
    E.select_rect(8, 8, 40, 24, 0);
    E.fill_selection(40, 160, 220, 255);
    E.select_rect(0, 0, 24, 48, 0);
    E.add_layer_mask(id);
    E.select_none();
    E.set_layer_blend(id, multiply);
    E.set_layer_opacity(id, 0.5);
    mv.engine.commit();
  }, MULTIPLY);
}

/** The active document's stack, top first, and two composite samples: one where
 *  the mask reveals the Multiply fill and one where it hides it. */
async function stack(page: Page) {
  return page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const layers = [];
    for (let i = 0; i < E.layer_count(); i++) {
      const id = E.layer_id_at(i);
      layers.push({
        name: E.layer_name(id),
        blend: E.layer_blend(id),
        opacity: Math.round(E.layer_opacity(id) * 255),
        visible: E.layer_visible(id),
        mask: E.layer_has_mask(id),
      });
    }
    return { layers, depth: E.doc_depth(), revealed: E.pick_color(12, 12) >>> 0, hidden: E.pick_color(36, 12) >>> 0 };
  });
}

/** File ▸ Export ▸ TIFF through the real menu dispatch (not awaited in-page). */
async function fireExportTiff(page: Page) {
  const id = await page.evaluate(() => {
    const out: { id: string; text: string }[] = [];
    const walk = (n: any) => {
      if (n.kind === "submenu") n.items.forEach(walk);
      else if (n.kind === "item") out.push({ id: n.id, text: n.text });
    };
    (window as any).__mv.macMenu.currentMenuTree().forEach(walk);
    return out.find((i) => /^Export TIFF/.test(i.text))?.id;
  });
  expect(id).toBeTruthy();
  await page.evaluate((mid) => { (window as any).__mv.macMenu.dispatchMenuAction(mid); }, id);
}

async function exportThroughDialog(page: Page, keepLayers: boolean) {
  await fireExportTiff(page);
  const dialog = page.getByRole("dialog", { name: "TIFF Options" });
  await expect(dialog).toBeVisible();
  const box = dialog.getByRole("checkbox", { name: "Save layers" });
  await expect(box).toBeChecked();
  if (!keepLayers) {
    await box.click();
    await expect(box).not.toBeChecked();
  }
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "OK" }).click(),
  ]);
  await expect(dialog).toBeHidden();
  return readFileSync(await download.path());
}

/** File ▸ Open the bytes as a new tab and wait for it to become active. */
async function reopen(page: Page, bytes: Buffer, name: string) {
  const count = await page.evaluate(({ arr, name }) => {
    const mv = (window as any).__mv;
    const before = mv.store.state.documents.length;
    void mv.openImageFiles([new File([new Uint8Array(arr)], name, { type: "image/tiff" })]);
    return before;
  }, { arr: Array.from(bytes), name });
  await page.waitForFunction(
    ({ count, name }) => {
      const mv = (window as any).__mv;
      return mv.store.state.documents.length === count + 1 && mv.store.activeName() === name;
    },
    { count, name },
  );
}

test("Export ▸ TIFF with Save layers reopens with the same layers", async ({ page }) => {
  await layeredScene(page);
  const before = await stack(page);
  expect(before.layers).toHaveLength(2);

  const bytes = await exportThroughDialog(page, true);
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("MM\0*");
  expect(bytes.indexOf(SIGNATURE)).toBeGreaterThan(0);

  await reopen(page, bytes, "layered.tif");
  const after = await stack(page);
  expect(after.layers).toEqual(before.layers);
  expect(after.layers[0]).toMatchObject({ blend: MULTIPLY, opacity: 128, mask: true });
  expect(after.depth).toBe(before.depth);
  expect(after.revealed).toBe(before.revealed);
  expect(after.hidden).toBe(before.hidden);
});

test("Escape closes TIFF Options without writing or changing the document", async ({ page }) => {
  await layeredScene(page);
  const before = await stack(page);
  let downloads = 0;
  page.on("download", () => { downloads++; });

  await fireExportTiff(page);
  const dialog = page.getByRole("dialog", { name: "TIFF Options" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  expect(await stack(page)).toEqual(before);
  expect(downloads).toBe(0);
});

test("unchecking Save layers writes a flat TIFF that opens as one layer", async ({ page }) => {
  await layeredScene(page);
  const bytes = await exportThroughDialog(page, false);
  expect(bytes.indexOf(SIGNATURE)).toBe(-1);

  await reopen(page, bytes, "flat.tif");
  const after = await stack(page);
  expect(after.layers.map((l) => l.name)).toEqual(["Background"]);
});

test("a TIFF whose layers cannot be read opens flat and says so", async ({ page }) => {
  await layeredScene(page);
  const bytes = await exportThroughDialog(page, true);
  // The Layr block's length, pushed past the end of the tag.
  bytes.writeUInt32BE(0xffffffff, bytes.indexOf(SIGNATURE) + SIGNATURE.length + 8);

  await reopen(page, bytes, "damaged.tif");
  const after = await stack(page);
  expect(after.layers.map((l) => l.name)).toEqual(["Background"]);
  await expect(page.locator(".monet-toast--warn")).toContainText(/could not be read/i);
});

test("a TIFF saved in IBM PC byte order opens with its layers", async ({ page }) => {
  // Photoshop writes little-endian (MIB8) ImageSourceData into an II TIFF; this
  // fixture is a Vision save rewritten that way by psdtags (see the engine test
  // little_endian_layered_tiff_opens_like_the_big_endian_file).
  const bytes = readFileSync(new URL("../../../packages/engine/src/raster/testdata/layered-le-8.tif", import.meta.url));
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("II*\0");
  expect(bytes.subarray(bytes.indexOf(SIGNATURE) + SIGNATURE.length).subarray(0, 4).toString("latin1")).toBe("MIB8");

  await layeredScene(page); // an edited document, so the open lands in a new tab
  await reopen(page, bytes, "ibm-pc.tif");
  const after = await stack(page);
  expect(after.layers.map((l) => l.name)).toEqual(["Group", "Hidden", "Multiply", "Background"]);
  expect(after.layers[2]).toMatchObject({ blend: MULTIPLY, opacity: 128, mask: true });
  expect(after.layers[1].visible).toBe(false);
  await expect(page.locator(".monet-toast--warn")).toHaveCount(0);
});

test("a one-layer document exports TIFF without asking", async ({ page }) => {
  await newScene(page, 64, 48);
  const [download] = await Promise.all([page.waitForEvent("download"), fireExportTiff(page)]);
  const bytes = readFileSync(await download.path());
  expect(bytes.indexOf(SIGNATURE)).toBe(-1);
  await expect(page.getByRole("dialog", { name: "TIFF Options" })).toHaveCount(0);
});
