import { test, expect } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";
import { buildAct, parseAct } from "@monet-ui/monet-imageio";
import { buildAse } from "@monet-ui/monet-imageio";
import { buildAco } from "@monet-ui/monet-imageio";

// End-to-end Adobe Color Table (.act) — the indexed-colour / PNG-8 palette
// format. Import is driven through the live app's format-sniffing entry point
// (window.__mv.importSwatchesFromBytes, which detects .act by its exact
// 768/772-byte length); export reads the real wasm colour table via
// window.__mv.colorTableToAct.

const imported = ["#101112", "#202122", "#8899aa", "#ff8800"];

test("imports colours from an .act file into the swatch library", async ({ page }) => {
  await gotoApp(page);
  const bytes = Array.from(buildAct(imported));

  const r = await page.evaluate((b) => {
    const mv = (window as any).__mv;
    const before = mv.store.state.swatches.length;
    const added = mv.importSwatchesFromBytes(new Uint8Array(b));
    return { before, added, swatches: mv.store.state.swatches as string[] };
  }, bytes);

  expect(r.added).toBe(imported.length);
  expect(r.swatches.length).toBe(r.before + imported.length);
  for (const hex of imported) expect(r.swatches).toContain(hex);
});

test("the same entry point still auto-detects .ase and .aco", async ({ page }) => {
  await gotoApp(page);
  const aseColours = ["#aa0011", "#bb0022"];
  const acoColours = ["#00cc33", "#00dd44"];
  const r = await page.evaluate(([aseB, acoB]) => {
    const mv = (window as any).__mv;
    const ase = mv.importSwatchesFromBytes(new Uint8Array(aseB));
    const aco = mv.importSwatchesFromBytes(new Uint8Array(acoB));
    return { ase, aco, swatches: mv.store.state.swatches as string[] };
  }, [Array.from(buildAse(aseColours)), Array.from(buildAco(acoColours))]);

  expect(r.ase).toBe(aseColours.length);
  expect(r.aco).toBe(acoColours.length);
  for (const hex of [...aseColours, ...acoColours]) expect(r.swatches).toContain(hex);
});

test("de-duplicates a re-imported .act (adds nothing the second time)", async ({ page }) => {
  await gotoApp(page);
  const bytes = Array.from(buildAct(imported));
  const r = await page.evaluate((b) => {
    const mv = (window as any).__mv;
    const first = mv.importSwatchesFromBytes(new Uint8Array(b));
    const second = mv.importSwatchesFromBytes(new Uint8Array(b));
    return { first, second };
  }, bytes);
  expect(r.first).toBe(imported.length);
  expect(r.second).toBe(0);
});

test("exports the live composite's colour table as a valid .act", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 32, 32);
  // Paint the whole canvas a known colour so the colour table is deterministic.
  const bytes = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_rect(0, 0, 32, 32, 0); E().fill_selection(255, 136, 0, 255); E().select_none();
    mv.engine.commit();
    return Array.from(mv.colorTableToAct() as Uint8Array);
  });

  // 1 distinct colour → 772-byte table with count=1, round-trips to that colour.
  expect(bytes.length).toBe(772);
  const colours = parseAct(new Uint8Array(bytes));
  expect(colours).toContain("#ff8800");
});
