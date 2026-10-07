import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { gotoApp, newScene } from "./helpers";
import { encodePcx, decodePcx } from "@monet-ui/monet-imageio";

// End-to-end ZSoft PCX (.pcx) — a Photoshop-native Open/Save-As format. Import
// drives window.__mv.openPcx (TS decode → PNG → engine open); export drives
// window.__mv.exportPCX and captures the download, decoding it back.

/** Open PCX bytes through the app; return the new doc size + top-left pixel. */
async function openPcx(page: import("@playwright/test").Page, bytes: number[]) {
  return await page.evaluate(async (b) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    await mv.openPcx(new Uint8Array(b), "art.pcx");
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

test("imports a 24-bit RLE PCX", async ({ page }) => {
  await gotoApp(page);
  const W = 6, H = 4;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = (i * 9) & 255; rgba[i * 4 + 1] = 90; rgba[i * 4 + 2] = 210; rgba[i * 4 + 3] = 255; }
  const r = await openPcx(page, Array.from(encodePcx(rgba, W, H)));
  expect(r.w).toBe(W); expect(r.h).toBe(H);
  expect(r.px).toEqual([rgba[0], rgba[1], rgba[2], 255]);
});

test("imports an 8-bit indexed PCX with a trailing VGA palette", async ({ page }) => {
  await gotoApp(page);
  // 2×1, 1 plane, uncompressed indices [0,1]; palette idx0 = orange, idx1 = teal.
  const header = new Array(128).fill(0);
  header[0] = 0x0a; header[1] = 5; header[2] = 0; header[3] = 8; // manuf, v5, raw, 8bpp
  header[8] = 1; header[10] = 0; header[65] = 1; header[66] = 2; // Xmax=1(w2), Ymax=0(h1), 1 plane, bpl 2
  const pal = new Array(768).fill(0);
  pal[0] = 255; pal[1] = 128; pal[2] = 0;   // idx0 = (255,128,0)
  pal[3] = 0; pal[4] = 128; pal[5] = 128;   // idx1 = (0,128,128)
  const bytes = [...header, 0, 1, 0x0c, ...pal];
  const r = await openPcx(page, bytes);
  expect(r.w).toBe(2); expect(r.h).toBe(1);
  expect(r.px).toEqual([255, 128, 0, 255]);
});

test("exports the composite as a .pcx that decodes back to the same pixels", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 16, 16);
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_rect(0, 0, 16, 16, 0); E().fill_selection(20, 200, 120, 255); E().select_none();
    mv.engine.commit();
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate(() => (window as any).__mv.exportPCX("out.pcx")),
  ]);
  const dec = decodePcx(new Uint8Array(readFileSync(await download.path())))!;
  expect(dec.width).toBe(16);
  expect(dec.height).toBe(16);
  expect(Array.from(dec.data.slice(0, 4))).toEqual([20, 200, 120, 255]);
});

test("an unreadable PCX surfaces gracefully without opening a document", async ({ page }) => {
  await gotoApp(page);
  page.on("dialog", (d) => d.dismiss());
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const before = mv.store.state.documents.length;
    await mv.openPcx(new Uint8Array([0x42, 0x4d, 1, 2, 3]), "broken.pcx"); // wrong manufacturer byte
    return { added: mv.store.state.documents.length - before };
  });
  expect(r.added).toBe(0);
});
