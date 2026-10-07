import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// End-to-end PDF import — Photoshop opens/rasterizes PDF; Monet could only
// export it (see state/pdf.ts). Drives window.__mv.openPdf through the live app:
// rasterize a page to a new document and read the composite back. Exercises the
// real pdf.js rasterizer (bundled worker, under CSP) + the engine open path.
// Mirrors svg-import.spec.ts.

/** Build a minimal, byte-exact multi-page PDF: each page is a solid-filled
 *  rectangle of its MediaBox size + color. No compression, correct xref. */
function pdfBytes(pages: { w: number; h: number; rgb: [number, number, number] }[]): number[] {
  const parts: number[] = [];
  const enc = (s: string) => { for (let i = 0; i < s.length; i++) parts.push(s.charCodeAt(i) & 0xff); };
  const offsets: number[] = [];
  const startObj = (n: number) => { offsets[n] = parts.length; };
  enc("%PDF-1.4\n");
  enc("%\xff\xff\xff\xff\n"); // binary marker
  startObj(1); enc("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const pageNums = pages.map((_, i) => 4 + i * 2);
  startObj(2); enc(`2 0 obj\n<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);
  pages.forEach((pg, i) => {
    const contentN = 3 + i * 2, pageN = 4 + i * 2;
    const [r, g, b] = pg.rgb;
    const content = `${r} ${g} ${b} rg 0 0 ${pg.w} ${pg.h} re f`;
    startObj(contentN);
    enc(`${contentN} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    startObj(pageN);
    enc(`${pageN} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pg.w} ${pg.h}] /Contents ${contentN} 0 R /Resources << >> >>\nendobj\n`);
  });
  const total = 2 + pages.length * 2;
  const xrefStart = parts.length;
  enc(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= total; n++) enc(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  enc(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return parts;
}

/** Active doc size + top-left composite pixel. */
async function docInfo(page: Page) {
  return await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const w = E().width(), h = E().height();
    const png = E().export_png();
    const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
    const img: HTMLImageElement = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    const px = c.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    URL.revokeObjectURL(url);
    return { w, h, px: [px[0], px[1], px[2], px[3]], docs: mv.store.state.documents.length };
  });
}

async function waitForDoc(page: Page, w: number, h: number, timeout = 20_000) {
  await page.waitForFunction(({ w, h }) => {
    const e = (window as any).__mv.engine.engine;
    return e.width() === w && e.height() === h;
  }, { w, h }, { timeout });
}

// MediaBox 100×60 pts → 200×120 px at the default 2× (144 DPI) render.
test("rasterizes a single-page PDF to the expected pixel size, skipping the picker", async ({ page }) => {
  await gotoApp(page);
  const bytes = pdfBytes([{ w: 100, h: 60, rgb: [1, 0, 0] }]);
  await page.evaluate((b) => (window as any).__mv.openPdf(new Uint8Array(b), "one.pdf"), bytes);
  await waitForDoc(page, 200, 120);
  await expect(page.getByRole("spinbutton", { name: "PDF page" })).toHaveCount(0); // single page ⇒ no picker
  const r = await docInfo(page);
  expect(r.w).toBe(200);
  expect(r.h).toBe(120);
  expect(r.px[0]).toBeGreaterThan(200); // red fill
  expect(r.px[1]).toBeLessThan(60);
  expect(r.px[2]).toBeLessThan(60);
});

test("a multi-page PDF shows the page picker; opening page 2 differs from page 1", async ({ page }) => {
  test.slow();
  await gotoApp(page);
  const bytes = pdfBytes([
    { w: 100, h: 60, rgb: [1, 0, 0] },   // page 1: red, 200×120
    { w: 80, h: 100, rgb: [0, 0, 1] },   // page 2: blue, 160×200
  ]);
  // openPdf resolves once it raises the picker (it does not await the render).
  await page.evaluate((b) => (window as any).__mv.openPdf(new Uint8Array(b), "multi.pdf"), bytes);
  const spin = page.getByRole("spinbutton", { name: "PDF page" });
  await expect(spin).toBeVisible();

  // Pick page 2 through the picker and open it.
  await spin.fill("2");
  await spin.press("Enter");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await waitForDoc(page, 160, 200, 60_000);
  const p2 = await docInfo(page);
  expect(p2.w).toBe(160);
  expect(p2.h).toBe(200);
  expect(p2.px[2]).toBeGreaterThan(200); // blue fill
  expect(p2.px[0]).toBeLessThan(60);

  // Page 1 rasterizes to a different size + color — proves the picker selected page 2.
  await page.evaluate((b) => (window as any).__mv.openPdfPage(new Uint8Array(b), "multi.pdf", undefined, 0), bytes);
  await waitForDoc(page, 200, 120, 60_000);
  const p1 = await docInfo(page);
  expect(p1.px[0]).toBeGreaterThan(200); // red fill
  expect([p1.w, p1.h]).not.toEqual([p2.w, p2.h]);
});

test("corrupt / non-PDF bytes are a clean no-op (no crash, no document, no picker)", async ({ page }) => {
  await gotoApp(page);
  page.on("dialog", (d) => d.dismiss());
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const before = mv.store.state.documents.length;
    await mv.openPdf(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), "broken.pdf"); // not a PDF
    return { added: mv.store.state.documents.length - before };
  });
  expect(r.added).toBe(0);
  await expect(page.getByRole("spinbutton", { name: "PDF page" })).toHaveCount(0);
});
