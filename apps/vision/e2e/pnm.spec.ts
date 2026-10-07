import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { gotoApp, newScene } from "./helpers";
import { encodePnm, decodePnm } from "@monet-ui/monet-imageio";

// End-to-end Netpbm (.pnm/.ppm/.pgm/.pbm) — a Photoshop-native Open/Save-As
// format. Import drives window.__mv.openPnm (TS decode → PNG → engine open);
// export drives window.__mv.exportPPM and captures the download, decoding back.

/** Open PNM bytes through the app; return the new doc size + top-left pixel. */
async function openPnm(page: import("@playwright/test").Page, bytes: number[]) {
  return await page.evaluate(async (b) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    await mv.openPnm(new Uint8Array(b), "img.ppm");
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
const b = (s: string) => Array.from(new TextEncoder().encode(s));

test("imports a binary P6 PPM", async ({ page }) => {
  await gotoApp(page);
  const W = 4, H = 3;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = (i * 9) & 255; rgba[i * 4 + 1] = 60; rgba[i * 4 + 2] = 200; rgba[i * 4 + 3] = 255; }
  const r = await openPnm(page, Array.from(encodePnm(rgba, W, H)));
  expect(r.w).toBe(W); expect(r.h).toBe(H);
  expect(r.px).toEqual([rgba[0], rgba[1], rgba[2], 255]);
});

test("imports an ASCII P3 PPM", async ({ page }) => {
  await gotoApp(page);
  const r = await openPnm(page, b("P3\n2 1\n255\n10 20 30  200 100 50\n"));
  expect(r.w).toBe(2); expect(r.h).toBe(1);
  expect(r.px).toEqual([10, 20, 30, 255]);
});

test("imports a P5 grayscale PGM", async ({ page }) => {
  await gotoApp(page);
  const bytes = [...b("P5\n2 1\n255\n"), 128, 64];
  const r = await openPnm(page, bytes);
  expect(r.px).toEqual([128, 128, 128, 255]);
});

test("exports the composite as a .ppm that decodes back to the same pixels", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 16, 16);
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_rect(0, 0, 16, 16, 0); E().fill_selection(0, 128, 255, 255); E().select_none();
    mv.engine.commit();
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate(() => (window as any).__mv.exportPPM("out.ppm")),
  ]);
  const dec = decodePnm(new Uint8Array(readFileSync(await download.path())))!;
  expect(dec.width).toBe(16);
  expect(dec.height).toBe(16);
  expect(Array.from(dec.data.slice(0, 4))).toEqual([0, 128, 255, 255]);
});

test("an unreadable PNM surfaces gracefully without opening a document", async ({ page }) => {
  await gotoApp(page);
  page.on("dialog", (d) => d.dismiss());
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const before = mv.store.state.documents.length;
    await mv.openPnm(new Uint8Array([0x42, 0x4d, 1, 2, 3]), "broken.ppm"); // "BM…" — not Netpbm
    return { added: mv.store.state.documents.length - before };
  });
  expect(r.added).toBe(0);
});
