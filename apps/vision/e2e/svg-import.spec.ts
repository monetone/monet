import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// End-to-end SVG import — Photoshop opens/rasterizes SVG; Monet could only
// export it. Drives window.__mv.openSvg through the live app: rasterize an SVG
// to a new document and read the composite back. Exercises the real browser
// rasterizer + engine open path.

/** Open SVG markup through the app; return the new doc's size + top-left pixel. */
async function openSvg(page: import("@playwright/test").Page, svg: string) {
  const bytes = Array.from(new TextEncoder().encode(svg));
  return await page.evaluate(async (b) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const before = mv.store.state.documents.length;
    await mv.openSvg(new Uint8Array(b), "art.svg");
    const w = E().width(), h = E().height();
    const png = E().export_png();
    const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
    const img: HTMLImageElement = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    const px = c.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    URL.revokeObjectURL(url);
    return { w, h, px: [px[0], px[1], px[2], px[3]], docs: mv.store.state.documents.length, added: mv.store.state.documents.length - before };
  }, bytes);
}

test("rasterizes an SVG with explicit size into a new document", async ({ page }) => {
  await gotoApp(page);
  const r = await openSvg(page, '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><rect width="100%" height="100%" fill="#ff0000"/></svg>');
  expect(r.docs).toBeGreaterThanOrEqual(1); // opened into a document (replaces the pristine boot doc)
  expect(r.w).toBe(40);
  expect(r.h).toBe(24);
  expect(r.px[0]).toBe(255);
  expect(r.px[1]).toBe(0);
  expect(r.px[2]).toBe(0);
  expect(r.px[3]).toBe(255);
});

test("uses the viewBox extent when width/height are absent", async ({ page }) => {
  await gotoApp(page);
  const r = await openSvg(page, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="100%" height="100%" fill="#00ff00"/></svg>');
  expect(r.w).toBe(30);
  expect(r.h).toBe(20);
  expect(r.px[1]).toBe(255); // green
  expect(r.px[0]).toBe(0);
  expect(r.px[2]).toBe(0);
});

test("an unreadable SVG surfaces gracefully without opening a document", async ({ page }) => {
  await gotoApp(page);
  page.on("dialog", (d) => d.dismiss());
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const before = mv.store.state.documents.length;
    await mv.openSvg(new Uint8Array([0, 1, 2, 3, 4, 5]), "broken.svg"); // not valid SVG/XML
    return { added: mv.store.state.documents.length - before };
  });
  expect(r.added).toBe(0);
});
