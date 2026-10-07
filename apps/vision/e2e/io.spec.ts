import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite, layerCount } from "./helpers";

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page, 200, 150); });

test("export PNG / JPEG / PSD / CMYK-PSD produce valid magic bytes", async ({ page }) => {
  const r = await page.evaluate(() => {
    const E = () => (window as any).__mv.engine.engine;
    const png = E().export_png();
    const jpg = E().export_jpeg(90);
    const psd = E().export_psd();
    const cmyk = E().export_psd_cmyk();
    const s = (b: Uint8Array, n: number) => Array.from(b.slice(0, n));
    return {
      png: s(png, 8), jpg: s(jpg, 3), psd: String.fromCharCode(...s(psd, 4)), cmyk: String.fromCharCode(...s(cmyk, 4)),
      sizes: { png: png.length, jpg: jpg.length, psd: psd.length, cmyk: cmyk.length },
    };
  });
  expect(r.png.slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]); // ‰PNG
  expect(r.jpg).toEqual([0xff, 0xd8, 0xff]); // JPEG SOI
  expect(r.psd).toBe("8BPS");
  expect(r.cmyk).toBe("8BPS");
  expect(r.sizes.png).toBeGreaterThan(100);
});

test("save / open project round-trips losslessly", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const exportChk = () => { const b = E().export_png(); let c = 0; for (let i = 0; i < b.length; i++) c = (c + b[i] * (i % 7 + 1)) % 1000003; return c; };
    const origChk = exportChk(); const origCount = E().layer_count(), w = E().width(), h = E().height();
    const saved = mv.store.saveProject();
    // mutate the document
    mv.store.addLayer(); E().select_all(); E().fill_selection(0, 0, 0, 255); E().select_none(); mv.engine.commit();
    // reopen the saved project
    mv.store.openProject(saved, "roundtrip.mvision");
    return { origCount, count: E().layer_count(), w: E().width(), h: E().height(), origW: w, origH: h, match: exportChk() === origChk };
  });
  expect(r.count).toBe(r.origCount);
  expect(r.w).toBe(r.origW);
  expect(r.h).toBe(r.origH);
  expect(r.match).toBe(true);
});

test("PSD export re-imports with preserved dimensions", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const w = E().width(), h = E().height();
    const psd = E().export_psd();
    mv.store.openPsd(psd, "roundtrip.psd");
    return { w, h, nw: E().width(), nh: E().height(), layers: E().layer_count() };
  });
  expect(r.nw).toBe(r.w);
  expect(r.nh).toBe(r.h);
  expect(r.layers).toBeGreaterThanOrEqual(1);
});

test("grayscale conversion equalizes channels", async ({ page }) => {
  const r = await page.evaluate(() => {
    const E = () => (window as any).__mv.engine.engine;
    E().convert_grayscale();
    (window as any).__mv.engine.commit();
    const packed = E().pick_color(100, 75) >>> 0;
    const rr = (packed >>> 24) & 255, gg = (packed >>> 16) & 255, bb = (packed >>> 8) & 255;
    return { rr, gg, bb };
  });
  expect(Math.abs(r.rr - r.gg)).toBeLessThanOrEqual(2);
  expect(Math.abs(r.gg - r.bb)).toBeLessThanOrEqual(2);
});

test("16-bit depth flag and CMYK readout", async ({ page }) => {
  const r = await page.evaluate(() => {
    const E = () => (window as any).__mv.engine.engine;
    E().set_depth(16);
    const cmyk = E().pick_cmyk(100, 75);
    return { depth: E().doc_depth(), cmykLen: cmyk.length };
  });
  expect(r.depth).toBe(16);
  expect(r.cmykLen).toBe(4);
});
