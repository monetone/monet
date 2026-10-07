import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gotoApp, newScene, composite } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));

// Gap 9 — advanced OpenType toggles for EDITABLE type. The editable-type raster
// path (src/text/raster.ts) is canvas 2D; the Phase-0 spike proved Chromium only
// applies CSS font-feature-settings from an ATTACHED canvas's computed style, so
// raster.ts now mounts its canvases on a shared hidden host when a feature is
// active. This suite verifies, with an OFL fixture font that has a visibly
// distinct `ss01` (open digits), that: toggling ss01 changes the composite;
// the per-layer checked-state tracks the active layer's spec; and the toggle
// round-trips through project save/load.
//
// Runs in the `chromium` project only (real font rendering); Playwright can't
// drive the native WKWebView, so the WKWebView half is verified manually.

const FONT_B64 = readFileSync(join(here, "..", "test-assets", "fixtures", "Inter-Regular.woff2")).toString("base64");
const FIXTURE_FONT = '"InterFixture"';

async function registerFixtureFont(page: Page) {
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const face = new FontFace("InterFixture", bytes.buffer);
    await face.load();
    (document as unknown as { fonts: FontFaceSet }).fonts.add(face);
    await (document as unknown as { fonts: FontFaceSet }).fonts.ready;
    await (document as unknown as { fonts: FontFaceSet }).fonts.load('40px "InterFixture"');
  }, FONT_B64);
}

test("toggling ss01 changes the composite with the fixture font", async ({ page }) => {
  await gotoApp(page);
  await registerFixtureFont(page);
  await newScene(page, 384, 120);

  const id = await page.evaluate((font) => {
    const mv = (window as any).__mv;
    const spec = mv.text.defaultSpec("agffistx 0123456789", {
      font, size: 36, color: [10, 10, 12, 255], ax: 8, ay: 8,
    });
    return mv.text.create(spec) as number;
  }, FIXTURE_FONT);

  const before = await composite(page);
  await page.evaluate(() => (window as any).__mv.text.toggleFeature("ss01"));
  const after = await composite(page);

  // The rendered digits change (ss01 = open digits) → the composite differs.
  expect(after.chk).not.toBe(before.chk);
  // …and it is genuinely the feature that toggled on the layer's spec.
  const feat = await page.evaluate((layerId) => (window as any).__mv.text.get(layerId).features?.ss01, id);
  expect(feat).toBe(true);
});

test("the OpenType checked-state tracks the active layer's spec", async ({ page }) => {
  await gotoApp(page);
  await registerFixtureFont(page);
  await newScene(page, 320, 120);

  // The menu checkmark for tag T is set iff the active layer's spec has that tag
  // enabled (App.tsx openTypeCheckedIds → buildPhotoshopMenus checkedIds; the
  // menu id for an advanced feature IS the tag, and legacy toggles map to otXXX).
  const featureOf = (layerId: number, tag: string) =>
    page.evaluate(({ layerId, tag }) => (window as any).__mv.text.get(layerId).features?.[tag] === true, { layerId, tag });
  const legacyOf = (layerId: number, key: string) =>
    page.evaluate(({ layerId, key }) => (window as any).__mv.text.get(layerId)[key] === true, { layerId, key });

  const { a, b } = await page.evaluate((font) => {
    const mv = (window as any).__mv;
    const mk = (t: string) => mv.text.create(mv.text.defaultSpec(t, { font, size: 32, color: [0, 0, 0, 255], ax: 8, ay: 8 })) as number;
    const a = mk("ag 0123");   // will get ss01 on
    mv.store.selectLayer(a); mv.text.toggleFeature("ss01");
    const b = mk("ag 0123");   // stays off (created after → now active)
    return { a, b };
  }, FIXTURE_FONT);

  // Distinct per-layer state.
  expect(await featureOf(a, "ss01")).toBe(true);
  expect(await featureOf(b, "ss01")).toBe(false);

  // The checked-state follows whichever layer is active.
  await page.evaluate((layerId) => (window as any).__mv.store.selectLayer(layerId), a);
  const activeA = await page.evaluate(() => (window as any).__mv.store.state.activeLayerId);
  expect(await featureOf(activeA, "ss01")).toBe(true);
  await page.evaluate((layerId) => (window as any).__mv.store.selectLayer(layerId), b);
  const activeB = await page.evaluate(() => (window as any).__mv.store.state.activeLayerId);
  expect(await featureOf(activeB, "ss01")).toBe(false);

  // Toggling off clears the check; a legacy toggle drives its own checkmark.
  await page.evaluate((layerId) => { const mv = (window as any).__mv; mv.store.selectLayer(layerId); mv.text.toggleFeature("ss01"); mv.text.toggleFeature("liga"); }, a);
  expect(await featureOf(a, "ss01")).toBe(false);
  expect(await legacyOf(a, "liga")).toBe(true);
});

test("an OpenType toggle round-trips through project save/load", async ({ page }) => {
  await gotoApp(page);
  await registerFixtureFont(page);
  await newScene(page, 320, 120);

  const result = await page.evaluate((font) => {
    const mv = (window as any).__mv;
    const id = mv.text.create(mv.text.defaultSpec("ag 0123", { font, size: 32, color: [0, 0, 0, 255], ax: 8, ay: 8 })) as number;
    mv.store.selectLayer(id);
    mv.text.toggleFeature("ss01");
    const before = mv.text.get(id).features?.ss01 === true;

    const saved = mv.store.saveProject();
    mv.store.openProject(saved, "opentype-roundtrip.mvision");

    const loaded = mv.store.state.layers.find((l: any) => l.kind === 2);
    const after = loaded ? mv.text.get(loaded.id).features?.ss01 === true : false;
    return { before, after, found: !!loaded };
  }, FIXTURE_FONT);

  expect(result.before).toBe(true);
  expect(result.found).toBe(true);
  expect(result.after).toBe(true);
});
