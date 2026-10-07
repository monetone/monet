import { test, expect } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// End-to-end 3D LUT (.cube) import — the inverse of File ▸ Export ▸ Color Lookup
// Tables. Drives window.__mv.applyColorLutCube through the live app + real wasm
// engine: paint a known colour, apply a LUT, read the graded composite back.

/** A size-2 .cube whose corner (ri,gi,bi) outputs f(ri,gi,bi). */
function cube2(f: (r: number, g: number, b: number) => [number, number, number]): string {
  let s = 'TITLE "e2e"\nLUT_3D_SIZE 2\n';
  for (let bi = 0; bi < 2; bi++) for (let gi = 0; gi < 2; gi++) for (let ri = 0; ri < 2; ri++) {
    const [r, g, b] = f(ri, gi, bi);
    s += `${r} ${g} ${b}\n`;
  }
  return s;
}
const INVERT = cube2((r, g, b) => [1 - r, 1 - g, 1 - b]);
const IDENTITY = cube2((r, g, b) => [r, g, b]);

/** Fill the whole canvas a solid colour, then read the composite's top-left pixel. */
async function fillAndApply(page: import("@playwright/test").Page, fill: [number, number, number], cube: string | null) {
  return await page.evaluate(async ({ fill, cube }) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_rect(0, 0, 32, 32, 0); E().fill_selection(fill[0], fill[1], fill[2], 255); E().select_none();
    mv.engine.commit();
    const layersBefore = mv.store.state.layers.length;
    const ok = cube === null ? false : await mv.applyColorLutCube(cube);
    // Read the top-left composite pixel via a PNG round-trip.
    const png = E().export_png();
    const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
    const img: HTMLImageElement = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    const px = c.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    URL.revokeObjectURL(url);
    return { ok, px: [px[0], px[1], px[2], px[3]], added: mv.store.state.layers.length - layersBefore };
  }, { fill, cube });
}

test("applies an invert LUT to the composite", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 32, 32);
  const r = await fillAndApply(page, [255, 0, 0], INVERT); // red → cyan
  expect(r.ok).toBe(true);
  expect(r.added).toBe(1); // baked onto a new layer
  expect(r.px[0]).toBe(0);
  expect(r.px[1]).toBe(255);
  expect(r.px[2]).toBe(255);
  expect(r.px[3]).toBe(255); // alpha preserved
});

test("an identity LUT leaves the pixels unchanged", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 32, 32);
  const r = await fillAndApply(page, [40, 128, 200], IDENTITY);
  expect(r.ok).toBe(true);
  expect(r.px[0]).toBe(40);
  expect(r.px[1]).toBe(128);
  expect(r.px[2]).toBe(200);
});

test("rejects a non-LUT file without changing the document", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 32, 32);
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const before = mv.store.state.layers.length;
    const ok = await mv.applyColorLutCube("this is not a cube LUT\n1 2\n");
    return { ok, added: mv.store.state.layers.length - before };
  });
  expect(r.ok).toBe(false);
  expect(r.added).toBe(0);
});
