import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { gotoApp, newScene } from "./helpers";
import { encodeTga, decodeTga } from "@monet-ui/monet-imageio";

// End-to-end Truevision TGA (.tga) — a Photoshop-native Open/Save-As format.
// Import drives window.__mv.openTga (TS decode → PNG → engine open); export
// drives window.__mv.exportTGA and captures the download, decoding it back.

/** Open TGA bytes through the app; return the new doc size + top-left pixel. */
async function openTga(page: import("@playwright/test").Page, bytes: number[]) {
  return await page.evaluate(async (b) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    await mv.openTga(new Uint8Array(b), "tex.tga");
    const w = E().width(), h = E().height();
    const png = E().export_png();
    const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
    const img: HTMLImageElement = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    const px = c.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    URL.revokeObjectURL(url);
    return { w, h, px: [px[0], px[1], px[2], px[3]] };
  }, bytes);
}

// A fully-opaque 8×6 test image (so the composite equals the imported pixels).
const W = 8, H = 6;
const RGBA = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { RGBA[i * 4] = (i * 7) & 255; RGBA[i * 4 + 1] = (i * 13) & 255; RGBA[i * 4 + 2] = (i * 3) & 255; RGBA[i * 4 + 3] = 255; }

test("imports an uncompressed TGA into a document", async ({ page }) => {
  await gotoApp(page);
  const r = await openTga(page, Array.from(encodeTga(RGBA, W, H)));
  expect(r.w).toBe(W); expect(r.h).toBe(H);
  expect(r.px).toEqual([RGBA[0], RGBA[1], RGBA[2], 255]);
});

test("imports an RLE-compressed TGA into a document", async ({ page }) => {
  await gotoApp(page);
  const r = await openTga(page, Array.from(encodeTga(RGBA, W, H, { rle: true })));
  expect(r.w).toBe(W); expect(r.h).toBe(H);
  expect(r.px).toEqual([RGBA[0], RGBA[1], RGBA[2], 255]);
});

test("exports the composite as a .tga that decodes back to the same pixels", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 16, 16);
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_rect(0, 0, 16, 16, 0); E().fill_selection(255, 0, 0, 255); E().select_none();
    mv.engine.commit();
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate(() => (window as any).__mv.exportTGA("out.tga")),
  ]);
  const tgaBytes = readFileSync(await download.path());
  const dec = decodeTga(new Uint8Array(tgaBytes))!;
  expect(dec.width).toBe(16);
  expect(dec.height).toBe(16);
  expect(Array.from(dec.data.slice(0, 4))).toEqual([255, 0, 0, 255]); // solid red
});

test("an unreadable TGA surfaces gracefully without opening a document", async ({ page }) => {
  await gotoApp(page);
  page.on("dialog", (d) => d.dismiss());
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const before = mv.store.state.documents.length;
    await mv.openTga(new Uint8Array([1, 0, 32, 0, 0]), "broken.tga"); // truncated header → decodeTga returns null
    return { added: mv.store.state.documents.length - before };
  });
  expect(r.added).toBe(0);
});
