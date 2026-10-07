import { test, expect, type Page } from "@playwright/test";
import { readPsd, writePsd } from "ag-psd";
import { gotoApp } from "./helpers";

// ── Edit Contents opens an imported Smart Object's embedded PSB (#460) ──────
// ag-psd authors a PSD whose Smart Object embeds an 80×40 PSB holding a white
// background, the red shape layer "Logo" and the type layer "Tagline", placed
// unscaled at (40, 40). Edit Contents must open that PSB with its own layers,
// and an edit must come back into the parent (through its smart filter) and
// out again in the file the parent saves. ag-psd reads that file, which proves
// the bytes are well formed, not that Photoshop accepts them.

const ID = "20953ddb-9391-11ec-b4f1-c15674f50bc4";
const IW = 80;
const IH = 40;
const W = 160;
const H = 120;
const OX = 40;
const OY = 40;
const RED = { r: 220, g: 40, b: 30 };
const inShape = (x: number, y: number) => x >= 5 && x < 35 && y >= 5 && y < 20;
const inTagline = (x: number, y: number) => x >= 5 && x < 45 && y >= 26 && y < 36;

function plane(w: number, h: number, fn: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}

/** The embedded document's composite at one of its pixels. */
function innerPixel(x: number, y: number): number[] {
  if (inShape(x, y)) return [RED.r, RED.g, RED.b, 255];
  if (inTagline(x, y)) return [20, 20, 20, 255];
  return [255, 255, 255, 255];
}

function innerPsb(): Uint8Array {
  return new Uint8Array(writePsd({
    width: IW, height: IH,
    imageData: plane(IW, IH, innerPixel),
    children: [
      { name: "Background", left: 0, top: 0, right: IW, bottom: IH, imageData: plane(IW, IH, () => [255, 255, 255, 255]) },
      {
        name: "Logo", left: 0, top: 0, right: IW, bottom: IH,
        imageData: plane(IW, IH, (x, y) => (inShape(x, y) ? [RED.r, RED.g, RED.b, 255] : [0, 0, 0, 0])),
        vectorMask: {
          paths: [{
            open: false, operation: "combine", fillRule: "non-zero",
            knots: [[5, 5], [35, 5], [35, 20], [5, 20]].map(([x, y]) => ({ linked: false, points: [x, y, x, y, x, y] })),
          }],
        },
        vectorFill: { type: "color", color: RED },
      },
      {
        name: "Tagline", left: 0, top: 0, right: IW, bottom: IH,
        imageData: plane(IW, IH, (x, y) => (inTagline(x, y) ? [20, 20, 20, 255] : [0, 0, 0, 0])),
        text: {
          text: "Hello", transform: [1, 0, 0, 1, 5, 34],
          style: { font: { name: "ArialMT" }, fontSize: 10, fillColor: { r: 20, g: 20, b: 20 } },
        },
      },
    ],
  }, { psb: true }));
}

function parentPsd(): number[] {
  const placed = (x: number, y: number) => x >= OX && x < OX + IW && y >= OY && y < OY + IH;
  const parent = (x: number, y: number) => (placed(x, y) ? innerPixel(x - OX, y - OY) : [255, 255, 255, 255]);
  return Array.from(new Uint8Array(writePsd({
    width: W, height: H,
    imageData: plane(W, H, parent),
    linkedFiles: [{ id: ID, name: "Logo.psb", data: innerPsb() }],
    children: [
      { name: "Background", left: 0, top: 0, right: W, bottom: H, imageData: plane(W, H, () => [255, 255, 255, 255]) },
      {
        name: "Logo", left: 0, top: 0, right: W, bottom: H,
        imageData: plane(W, H, (x, y) => (placed(x, y) ? innerPixel(x - OX, y - OY) : [0, 0, 0, 0])),
        placedLayer: {
          id: ID, placed: ID, type: "raster", width: IW, height: IH,
          transform: [OX, OY, OX + IW, OY, OX + IW, OY + IH, OX, OY + IH],
        },
      },
    ],
  })));
}

async function runExactCommand(page: Page, label: string) {
  await page.waitForFunction((exact) => {
    const items = (window as any).__mv.commandPalette?.items ?? [];
    return items.some((i: any) => i.label === exact);
  }, label, { timeout: 5000 });
  await page.evaluate((exact) => {
    const items = (window as any).__mv.commandPalette.items;
    items.find((i: any) => i.label === exact).run();
  }, label);
}

/** Open PSD bytes the way File ▸ Open does; the Smart Object is on top. */
async function openParent(page: Page, bytes: number[]) {
  return await page.evaluate((bytes) => {
    const mv = (window as any).__mv;
    mv.store.openFormat(new Uint8Array(bytes), "logo-parent.psd");
    const E = mv.engine.engine;
    const id = mv.store.state.activeLayerId;
    return { id, docId: mv.store.state.activeDocId, kind: E.layer_kind(id) };
  }, bytes);
}

/** Edit Contents from the menu, then the new tab's name and layers. */
async function editContents(page: Page) {
  await runExactCommand(page, "Layer ▸ Smart Objects ▸ Edit Contents");
  return await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    const layers = mv.store.state.layers.map((l: { id: number; name: string }) => ({ id: l.id, name: l.name, kind: E.layer_kind(l.id) }));
    return { docId: mv.store.state.activeDocId, name: mv.store.activeName(), w: E.width(), h: E.height(), layers };
  });
}

/** Widen the nested "Logo" shape from x 35 to x 45 by dragging its right-hand anchors. */
async function widenShape(page: Page, id: number) {
  await page.evaluate((id) => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.vector_move_anchor(id, "psd-shape-1", 1, 45, 5);
    E.vector_move_anchor(id, "psd-shape-1", 2, 45, 20);
    mv.engine.commit();
  }, id);
}

const rgbAt = (page: Page, x: number, y: number) => page.evaluate(({ x, y }) => {
  const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
  return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
}, { x, y });

test("Edit Contents opens an imported Smart Object's embedded PSB with its own layers", async ({ page }) => {
  await gotoApp(page);
  const parent = await openParent(page, parentPsd());
  expect(parent.kind).toBe(7);
  // A smart filter on the parent: the edited contents must come back through it.
  await page.evaluate(() => (window as any).__mv.fil.gaussian(2));
  expect(await page.evaluate((id) => (window as any).__mv.engine.engine.smart_filter_count(id), parent.id)).toBe(1);
  expect(await rgbAt(page, OX + 42, OY + 12)).toEqual([255, 255, 255]);

  const nested = await editContents(page);
  expect(nested.docId).not.toBe(parent.docId);
  expect(nested.name).toContain("smart-contents");
  expect([nested.w, nested.h]).toEqual([IW, IH]);
  expect(nested.layers.map((l: { name: string; kind: number }) => [l.name, l.kind]).sort()).toEqual([
    ["Background", 0], ["Logo", 3], ["Tagline", 2],
  ]);
  // The Layers panel lists the nested stack, top first, the type layer as one.
  const rows = page.locator("[data-mv-layers-panel]").getByRole("listbox", { name: "Layers" }).getByRole("option");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Tagline");
  await expect(rows.nth(0).getByRole("img", { name: "Text layer" })).toBeVisible();
  await expect(rows.nth(1)).toContainText("Logo");
  await expect(rows.nth(2)).toContainText("Background");

  // Edit the shape and the type, then send the document back.
  const shape = nested.layers.find((l: { kind: number }) => l.kind === 3).id;
  const type = nested.layers.find((l: { kind: number }) => l.kind === 2).id;
  await widenShape(page, shape);
  await page.evaluate((id) => {
    const mv = (window as any).__mv;
    mv.text.apply(id, mv.text.setText(mv.text.get(id), "Hello world"));
  }, type);
  await runExactCommand(page, "Layer ▸ Smart Objects ▸ Update Edited Contents");

  const back = await page.evaluate((id) => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    return { docId: mv.store.state.activeDocId, kind: E.layer_kind(id), filters: E.smart_filter_count(id) };
  }, parent.id);
  expect(back).toEqual({ docId: parent.docId, kind: 7, filters: 1 });
  // The wider shape now covers inner x 42, and the blur carries it just past
  // its new edge at 45, where an unfiltered render would be pure white.
  const inside = await rgbAt(page, OX + 42, OY + 12);
  expect(inside[0]).toBeGreaterThan(200);
  expect(inside[1]).toBeLessThan(90);
  const edge = await rgbAt(page, OX + 45, OY + 12);
  expect(edge[1]).toBeGreaterThan(40);
  expect(edge[1]).toBeLessThan(250);

  // Reopening the contents shows both edits.
  const again = await editContents(page);
  const reopened = await page.evaluate(({ shape, type }) => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    return { anchor: E.vector_nearest_anchor(shape, 45, 5, 1) !== "", text: mv.text.fullText(mv.text.get(type)) };
  }, {
    shape: again.layers.find((l: { kind: number }) => l.kind === 3).id,
    type: again.layers.find((l: { kind: number }) => l.kind === 2).id,
  });
  expect(reopened).toEqual({ anchor: true, text: "Hello world" });
});

test("an edited embedded document saves back into the PSD and reopens nested", async ({ page }) => {
  await gotoApp(page);
  const parent = await openParent(page, parentPsd());
  const nested = await editContents(page);
  await widenShape(page, nested.layers.find((l: { kind: number }) => l.kind === 3).id);
  await runExactCommand(page, "Layer ▸ Smart Objects ▸ Update Edited Contents");
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeDocId)).toBe(parent.docId);
  expect(await rgbAt(page, OX + 42, OY + 12)).toEqual([RED.r, RED.g, RED.b]);

  // An independent reader finds the edited document under the same record.
  const saved = await page.evaluate(() => Array.from((window as any).__mv.exportPSDBytes() as Uint8Array));
  const psd = readPsd(new Uint8Array(saved).buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  const logo = psd.children!.find((layer) => layer.name === "Logo")!;
  expect(logo.placedLayer?.id).toBe(ID);
  expect(logo.placedLayer?.transform).toEqual([OX, OY, OX + IW, OY, OX + IW, OY + IH, OX, OY + IH]);
  expect(psd.linkedFiles?.map((file) => file.id)).toEqual([ID]);
  const embedded = readPsd(psd.linkedFiles![0].data!.slice().buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  expect([embedded.width, embedded.height]).toEqual([IW, IH]);
  const knots = embedded.children!.find((layer) => layer.name === "Logo")!.vectorMask!.paths[0].knots;
  expect(knots.map((knot) => knot.points.slice(2, 4).map(Math.round))).toEqual([[5, 5], [45, 5], [45, 20], [5, 20]]);

  // Vision reopens the saved file with the Smart Object still nested.
  const reopened = await openParent(page, saved);
  expect(reopened.kind).toBe(7);
  expect(await rgbAt(page, OX + 42, OY + 12)).toEqual([RED.r, RED.g, RED.b]);
  const contents = await editContents(page);
  expect(contents.layers).toHaveLength(3);
  const widened = await page.evaluate((id) => (window as any).__mv.engine.engine.vector_nearest_anchor(id, 45, 5, 1) !== "",
    contents.layers.find((l: { kind: number }) => l.kind === 3).id);
  expect(widened).toBe(true);
});

test("Place Embedded of a PSB keeps its layers for Edit Contents", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => (window as any).__mv.store.newDocument(w, h, "place psb", "transparent"), { w: W, h: H });
  const chooser = page.waitForEvent("filechooser");
  await runExactCommand(page, "File ▸ Place Embedded…");
  await (await chooser).setFiles({ name: "Logo.psb", mimeType: "application/octet-stream", buffer: Buffer.from(innerPsb()) });
  await expect.poll(() => page.evaluate(() => {
    const mv = (window as any).__mv;
    return mv.engine.engine.layer_kind(mv.store.state.activeLayerId);
  })).toBe(7);
  // Unscaled and centred, as an image places.
  expect(await rgbAt(page, OX + 10, OY + 10)).toEqual([RED.r, RED.g, RED.b]);
  const nested = await editContents(page);
  expect([nested.w, nested.h]).toEqual([IW, IH]);
  expect(nested.layers.map((l: { name: string }) => l.name).sort()).toEqual(["Background", "Logo", "Tagline"]);
});
