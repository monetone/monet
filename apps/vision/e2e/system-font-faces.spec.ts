import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// #453: a family's same-weight subfamilies (Helvetica Neue Bold vs Condensed
// Bold, Avenir Book vs Roman) and a variable face's axes, driven through the
// real type UI on WebKit — the engine behind Tauri's macOS webview — with the
// installed macOS fonts rather than a synthetic fixture. The browser build never
// runs the Tauri font scan, so each test feeds the pieces that scan uses: the
// engine's own face inspection, engine registration for outlines,
// provisionCssFontFaces for the canvas, and setFontFaces for the type UI.
// Needs /System/Library/Fonts, so only the webkit project (run on macOS) selects it.

test.beforeEach(async ({ page }) => {
  await page.route("**/__system-fonts/*", (route) => route.fulfill({
    path: `/System/Library/Fonts/${new URL(route.request().url()).pathname.split("/").pop()}`,
  }));
  await gotoApp(page);
});

/** Inspect a system font with the engine, register `registerPs` for outlines,
 *  provision every face's CSS alias and publish the faces to the type UI. */
async function loadFaces(page: Page, file: string, registerPs: string[]) {
  await page.evaluate(async ({ file, registerPs }) => {
    const mv = (window as any).__mv;
    const e = mv.engine.e;
    const bytes = new Uint8Array(await (await fetch(`/__system-fonts/${file}`)).arrayBuffer());
    const faces = JSON.parse(e.inspectVectorFontFaces(bytes)).map((face: any) =>
      ({ ...face, axes: mv.fonts.readVariationAxes(bytes, face.faceIndex) }));
    e.beginVectorFontBatch();
    try {
      for (const face of faces) {
        if (registerPs.includes(face.postscriptName)) e.registerVectorFontFace(face.family, bytes, face.faceIndex, face.weight, face.italic);
      }
    } finally {
      e.endVectorFontBatch();
    }
    await mv.fonts.provisionCssFontFaces(faces);
    if (mv.fonts.setFontFaces(faces)) mv.store.bump();
  }, { file, registerPs });
}

/** A fresh document with one type layer in `font`, the Character panel docked. */
const createType = (page: Page, font: string) => page.evaluate((stack) => {
  const mv = (window as any).__mv;
  mv.store.newDocument(640, 200, "faces");
  mv.store.getWorkspace().openPanel("character");
  return mv.text.create(mv.text.defaultSpec("HHHHHH", { font: stack, size: 72, ax: 16, ay: 40 })) as number;
}, font);

const layerSpec = (page: Page, id: number) => page.evaluate((layer) => (window as any).__mv.text.get(layer), id);

/** Rasterize a spec exactly as text.apply does: its ink width and a checksum. */
const ink = (page: Page, spec: unknown) => page.evaluate((s) => {
  const r = (window as any).__mv.text.rasterizeSpec(s);
  let minX = Infinity, maxX = -Infinity, chk = 0;
  for (let i = 0; i < r.w * r.h; i++) {
    const a = r.data[i * 4 + 3];
    if (!a) continue;
    const x = i % r.w;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    chk = (chk + (i + 1) * a) % 2147483647;
  }
  return { width: maxX >= minX ? maxX - minX + 1 : 0, chk };
}, spec);

async function pick(page: Page, combo: Locator, list: string, label: string) {
  await combo.click();
  await page.getByRole("listbox", { name: list, exact: true }).getByRole("option", { name: label, exact: true }).click();
  await expect(combo).toHaveText(label);
}

test("Helvetica Neue Condensed Bold stays picked and renders condensed on canvas, after reopen and in outlines", async ({ page }) => {
  await loadFaces(page, "HelveticaNeue.ttc", ["HelveticaNeue-Bold", "HelveticaNeue-CondensedBold"]);
  const id = await createType(page, '"Helvetica Neue", Helvetica, Arial, sans-serif');
  const panelStyle = page.locator("[data-mv-character-panel]").getByRole("combobox", { name: "Font style", exact: true });
  const barStyle = page.locator(".mv-tt-style").getByRole("combobox", { name: "Font style", exact: true });

  // Both 700-weight faces are separate options.
  await panelStyle.click();
  const options = page.getByRole("listbox", { name: "Font style", exact: true });
  await expect(options.getByRole("option", { name: "Bold", exact: true })).toBeVisible();
  await expect(options.getByRole("option", { name: "Condensed Bold", exact: true })).toBeVisible();
  await options.getByRole("option", { name: "Bold", exact: true }).click();
  await expect(panelStyle).toHaveText("Bold");
  const bold = await layerSpec(page, id);
  expect(bold.runs[0]).toMatchObject({ face: "HelveticaNeue-Bold", weight: 700 });
  const wBold = (await ink(page, bold)).width;
  expect(wBold).toBeGreaterThan(100);

  // Condensed Bold sticks (no snap-back to Bold) and draws narrower.
  await pick(page, panelStyle, "Font style", "Condensed Bold");
  const condensed = await layerSpec(page, id);
  expect(condensed.runs[0]).toMatchObject({ face: "HelveticaNeue-CondensedBold", weight: 700 });
  const wCond = (await ink(page, condensed)).width;
  expect(wCond).toBeLessThan(0.85 * wBold);

  // The provisioned alias resolves on its own, without the PostScript-name fallback.
  const alias = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const width = (face: string) => { ctx.font = `700 72px "Monet face:${face}", monospace`; return ctx.measureText("HHHHHH").width; };
    return { bold: width("HelveticaNeue-Bold"), condensed: width("HelveticaNeue-CondensedBold") };
  });
  expect(alias.condensed).toBeLessThan(0.85 * alias.bold);

  // Escape out of the open list leaves the layer and the label alone.
  const before = await page.evaluate((layer) => (window as any).__mv.engine.e.layer_text_spec(layer), id);
  await panelStyle.press("ArrowDown");
  await expect(panelStyle).toHaveAttribute("aria-expanded", "true");
  await panelStyle.press("ArrowDown");
  await panelStyle.press("Escape");
  await expect(panelStyle).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate((layer) => (window as any).__mv.engine.e.layer_text_spec(layer), id)).toBe(before);
  await expect(panelStyle).toHaveText("Condensed Bold");

  // A real save and reopen keeps the face. openProject restores stored pixels,
  // so the reloaded spec is re-rasterized to prove it still draws condensed.
  const reopened = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.openProject(mv.saveProjectBytes(), "faces.mvision");
    const e = mv.engine.e;
    let layer = 0;
    for (let i = 0; i < e.layer_count(); i++) if (e.layer_kind(e.layer_id_at(i)) === 2) layer = e.layer_id_at(i);
    mv.store.selectLayer(layer);
    return { layer, spec: e.layer_text_spec(layer) as string };
  });
  expect(reopened.spec).toBe(before);
  expect((await ink(page, JSON.parse(reopened.spec))).width).toBe(wCond);
  await expect(panelStyle).toHaveText("Condensed Bold");

  // The options bar offers the same identity.
  await pick(page, barStyle, "Font style", "Bold");
  expect((await layerSpec(page, reopened.layer)).runs[0].face).toBe("HelveticaNeue-Bold");
  await pick(page, barStyle, "Font style", "Condensed Bold");
  expect((await layerSpec(page, reopened.layer)).runs[0].face).toBe("HelveticaNeue-CondensedBold");
  await expect(panelStyle).toHaveText("Condensed Bold");

  // Type ▸ Create Work Path outlines the registered condensed face, not Bold.
  await page.getByRole("menuitem", { name: "Type", exact: true }).click();
  await page.getByRole("menuitem", { name: "Create Work Path", exact: true }).click();
  const outline = await page.evaluate((layer) => {
    const e = (window as any).__mv.engine.e;
    const xs = [...(e.export_layer_svg(layer) as string).matchAll(/ d="([^"]*)"/g)]
      .flatMap((d) => [...d[1].matchAll(/(-?[\d.]+),-?[\d.]+/g)].map((m) => Number(m[1])));
    return { error: e.last_edit_error(), width: xs.length ? Math.max(...xs) - Math.min(...xs) : 0 };
  }, reopened.layer);
  expect(outline.error).toBe("");
  expect(Math.abs(outline.width - wCond)).toBeLessThan(0.05 * wCond);
  expect(outline.width).toBeLessThan(0.85 * wBold);
});

test("Avenir Book and Roman are distinct picks that render differently", async ({ page }) => {
  await loadFaces(page, "Avenir.ttc", []);
  const id = await createType(page, 'Avenir, "Avenir Next", sans-serif');
  const panelStyle = page.locator("[data-mv-character-panel]").getByRole("combobox", { name: "Font style", exact: true });
  const barStyle = page.locator(".mv-tt-style").getByRole("combobox", { name: "Font style", exact: true });

  const checksums: number[] = [];
  for (const [label, face] of [["Book", "Avenir-Book"], ["Roman", "Avenir-Roman"]]) {
    await pick(page, panelStyle, "Font style", label);
    await expect(barStyle).toHaveText(label);
    const spec = await layerSpec(page, id);
    expect(spec.runs[0]).toMatchObject({ face, weight: 400 });
    checksums.push((await ink(page, spec)).chk);
  }
  expect(checksums[0]).not.toBe(checksums[1]);
});

test("a variable face's Width axis shows on both surfaces and changes the render", async ({ page }) => {
  // SFNS's names are hidden from local(), so the fixture family loads its bytes.
  await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const buffer = await (await fetch("/__system-fonts/SFNS.ttf")).arrayBuffer();
    const font = new FontFace("SF Fixture", buffer, { weight: "1 1000" });
    await font.load();
    document.fonts.add(font);
    const axes = mv.fonts.readVariationAxes(new Uint8Array(buffer), 0);
    if (mv.fonts.setFontFaces([{ family: "SF Fixture", faceIndex: 0, weight: 400, italic: false, axes }])) mv.store.bump();
  });
  const id = await createType(page, '"SF Fixture", sans-serif');
  const panel = page.locator("[data-mv-character-panel]");
  const barWidth = page.getByRole("slider", { name: "Font Width", exact: true });
  const panelWidth = panel.getByRole("slider", { name: "Width", exact: true });
  await expect(barWidth).toBeVisible();
  await expect(page.getByRole("slider", { name: "Font Weight", exact: true })).toBeVisible();
  await expect(panelWidth).toBeVisible();

  await barWidth.press("Home");
  await expect(panelWidth).toHaveAttribute("aria-valuenow", "30");
  const narrow = await layerSpec(page, id);
  expect(narrow.runs[0].axes).toMatchObject({ wdth: 30 });
  await barWidth.press("End");
  await expect(panelWidth).toHaveAttribute("aria-valuenow", "150");
  const wide = await layerSpec(page, id);
  expect(wide.runs[0].axes).toMatchObject({ wdth: 150 });
  expect((await ink(page, wide)).width).toBeGreaterThan(1.2 * (await ink(page, narrow)).width);

  // A static family has no axes to offer.
  await pick(page, page.locator(".mv-tt-font").getByRole("combobox", { name: "Font", exact: true }), "Font", "Georgia");
  await expect(barWidth).toHaveCount(0);
  await expect(panelWidth).toHaveCount(0);
});
