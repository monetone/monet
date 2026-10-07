import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end AVIF *import*. Photoshop opens AVIF; Monet Vision previously only
// exported it (the Rust `image` decoder can't handle AVIF in wasm). This drives
// the real open path: a committed AVIF fixture is read in Node and its bytes
// injected into `openAvif`, which decodes via the @jsquash WASM codec and opens
// a document. Mirrors the fixture-injection pattern in format-import.spec.ts.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => Array.from(readFileSync(join(here, "..", "test-assets", "fixtures", name)));

test("opens an AVIF file into a new document (real @jsquash decode)", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
  const avif = fixture("tiny.avif"); // 64×48
  const ret = await page.evaluate(async (bytes) => {
    const mv = (window as any).__mv;
    const E = () => mv.engine.engine;
    await mv.openAvif(new Uint8Array(bytes), "tiny.avif");
    return { w: E().width(), h: E().height(), layers: E().layer_count() };
  }, avif);
  expect(ret.w).toBe(64);
  expect(ret.h).toBe(48);
  expect(ret.layers).toBeGreaterThanOrEqual(1);

  const opened = await composite(page);
  expect(opened.w).toBe(64);
  expect(opened.h).toBe(48);
  // Decoded, not a blank/transparent canvas.
  expect(opened.mean).toBeGreaterThan(1);
  expect(opened.mean).toBeLessThan(254);
});

test("surfaces a decode error for corrupt AVIF bytes without opening a document", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await newScene(page, 32, 32);
  const before = await page.evaluate(() => (window as any).__mv.engine.engine.width());
  const after = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    (window as any).alert = () => {}; // swallow the graceful failure alert
    await mv.openAvif(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), "broken.avif");
    return mv.engine.engine.width();
  });
  // A bad file surfaces an error and does not open a new document tab.
  expect(after).toBe(before);
});
