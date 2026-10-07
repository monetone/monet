import { test, expect, type Page } from "@playwright/test";
import { readPsd } from "ag-psd";
import { readVersionAndDescriptor } from "ag-psd/dist/descriptor.js";
import { createReader, readPattern } from "ag-psd/dist/psdReader.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gotoApp, withMv } from "./helpers";

const placeFixture = fileURLToPath(new URL("../src-tauri/fixtures/px.png", import.meta.url));

const pngDimensions = (bytes: Buffer): [number, number] => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];

test.beforeEach(async ({ page }) => { await gotoApp(page); });

async function runCommand(page: Page, contains: string) {
  await page.waitForFunction((needle) => {
    const items = (window as any).__mv.commandPalette?.items ?? [];
    return items.some((i: any) => i.label.includes(needle));
  }, contains, { timeout: 5000 });
  await page.evaluate((needle) => {
    const items = (window as any).__mv.commandPalette.items;
    items.find((i: any) => i.label.includes(needle)).run();
  }, contains);
}

async function runExactCommand(page: Page, label: string) {
  await page.waitForFunction((exact) => {
    const items = (window as any).__mv.commandPalette?.items ?? [];
    return items.some((i: any) => i.label === exact);
  }, label, { timeout: 5000 });
  await page.evaluate((exact) => {
    const items = (window as any).__mv.commandPalette.items;
    items.find((i: any) => i.label === exact).run();
  }, label);
}

test("local remove cleanup filters reduce distractions and reflections", async ({ page }) => {
  const result = await withMv<{
    speckBefore: number; speckAfter: number; reflectionBefore: number; reflectionAfter: number; reflectionRed: number; reflectionGreen: number;
  }>(page, `(mv, E) => {
    const lum = (x, y) => {
      const p = E.pick_color(x, y) >>> 0;
      const r = (p >>> 24) & 255, g = (p >>> 16) & 255, b = (p >>> 8) & 255;
      return Math.round((r * 54 + g * 183 + b * 19) / 256);
    };
    mv.store.newDocument(48, 32, "cleanup");
    E = mv.engine.engine;
    E.set_active_layer(E.add_layer("cleanup pixels"));
    E.select_rect(0, 0, 48, 32, 0); E.fill_selection(100, 100, 100, 255);
    E.select_rect(12, 12, 1, 1, 0); E.fill_selection(255, 255, 255, 255); E.select_none(); mv.engine.commit();
    const speckBefore = lum(12, 12);
    mv.removeDistractions(1);
    const speckAfter = lum(12, 12);
    mv.store.newDocument(48, 32, "reflection");
    E = mv.engine.engine;
    E.set_active_layer(E.add_layer("reflection pixels"));
    E.select_rect(0, 0, 48, 32, 0); E.fill_selection(120, 24, 24, 255);
    E.select_rect(22, 0, 3, 32, 0); E.fill_selection(235, 235, 235, 255); E.select_none(); mv.engine.commit();
    const reflectionBefore = lum(23, 16);
    mv.removeReflections(1);
    const p = E.pick_color(23, 16) >>> 0;
    return { speckBefore, speckAfter, reflectionBefore, reflectionAfter: lum(23, 16), reflectionRed: (p >>> 24) & 255, reflectionGreen: (p >>> 16) & 255 };
  }`);
  expect(result.speckBefore).toBe(255);
  expect(result.speckAfter).toBeLessThan(175);
  expect(result.reflectionAfter).toBeLessThan(result.reflectionBefore - 30);
  expect(result.reflectionRed).toBeGreaterThan(result.reflectionGreen + 20);
});

test("actions can be saved, searched, favorited, and replayed", async ({ page }) => {
  const result = await withMv<{ id: number; count: number; filtered: number; favorite: boolean; changed: boolean }>(page, `(mv, E) => {
    mv.store.newDocument(32, 32, "actions");
    E = mv.engine.engine;
    E.set_active_layer(E.add_layer("action pixels"));
    E.select_rect(0, 0, 32, 32, 0); E.fill_selection(20, 80, 160, 255); E.select_none(); mv.engine.commit();
    mv.actions.start();
    mv.adj.invert();
    mv.adj.posterize(4);
    mv.actions.stop();
    const id = mv.actions.save("Retouch Web Export");
    mv.actions.toggleFavorite(id);
    const filtered = mv.actions.filter("web", true);
    mv.store.newDocument(32, 32, "actions replay");
    E = mv.engine.engine;
    E.set_active_layer(E.add_layer("action pixels"));
    E.select_rect(0, 0, 32, 32, 0); E.fill_selection(20, 80, 160, 255); E.select_none(); mv.engine.commit();
    const before = E.pick_color(5, 5);
    mv.actions.playNamed(id);
    return { id, count: mv.actions.list().length, filtered: filtered.length, favorite: filtered[0]?.favorite, changed: E.pick_color(5, 5) !== before };
  }`);
  expect(result.id).toBeGreaterThan(0);
  expect(result.count).toBeGreaterThanOrEqual(1);
  expect(result.filtered).toBe(1);
  expect(result.favorite).toBe(true);
  expect(result.changed).toBe(true);
});

test("layer cleanup deletes empty layers and auto-names the stack", async ({ page }) => {
  const result = await withMv<{ before: number; after: number; deleted: number; renamed: number; names: string[] }>(page, `(mv, E) => {
    mv.store.newDocument(24, 24, "layers");
    E = mv.engine.engine;
    const blank = E.add_layer("Layer 1");
    E.set_active_layer(blank);
    E.select_rect(0, 0, 24, 24, 0); E.clear_selection(); E.select_none();
    const painted = E.add_layer("Layer 2");
    E.set_active_layer(painted);
    E.select_rect(0, 0, 8, 8, 0); E.fill_selection(10, 180, 90, 255); E.select_none(); mv.engine.commit();
    const before = E.layer_count();
    const summary = mv.store.cleanupLayers({ deleteEmpty: true, autoName: true, onlyGeneric: false });
    const names = mv.store.state.layers.map((l) => l.name);
    return { before, after: E.layer_count(), deleted: summary.deleted, renamed: summary.renamed, names };
  }`);
  expect(result.after).toBeLessThan(result.before);
  expect(result.deleted).toBeGreaterThan(0);
  expect(result.renamed).toBeGreaterThan(0);
  expect(result.names.some((n) => n.startsWith("Pixel Layer"))).toBe(true);
});

test("Select Sky automatically selects the connected sky region", async ({ page }) => {
  await withMv(page, `(mv, E) => {
    mv.store.newDocument(40, 30, "select sky");
    E = mv.engine.engine;
    E.select_rect(0, 0, 40, 16, 0); E.fill_selection(86, 162, 236, 255);
    E.select_rect(0, 16, 40, 14, 0); E.fill_selection(42, 126, 68, 255);
    E.select_none(); mv.engine.commit();
  }`);

  await runCommand(page, "Select ▸ Sky");

  expect(await withMv(page, `(mv, E) => {
    const mask = E.get_selection_mask();
    return { active: E.has_selection(), sky: mask[4 * 40 + 20], land: mask[24 * 40 + 20] };
  }`)).toEqual({ active: true, sky: 255, land: 0 });
});

test("Check Spelling uses the native dictionary and can apply edits across visible unlocked type layers", async ({ page }) => {
  const ids = await withMv<{ first: number; active: number }>(page, `(mv) => {
    mv.store.newDocument(180, 100, "spelling");
    const first = mv.text.create(mv.text.defaultSpec("First misspeled sentence", { ax: 12, ay: 32 }));
    const active = mv.text.create(mv.text.defaultSpec("Second misspeled sentence", { ax: 12, ay: 68 }));
    return { first, active };
  }`);

  await runCommand(page, "Edit ▸ Check Spelling");
  const activeEditor = page.locator(`[data-mv-spell-layer="${ids.active}"]`);
  await expect(activeEditor).toHaveAttribute("spellcheck", "true");
  await page.getByRole("checkbox", { name: "Check All Layers" }).click();
  await expect(page.locator("[data-mv-spell-layer]")).toHaveCount(2);
  await page.locator(`[data-mv-spell-layer="${ids.first}"]`).fill("First corrected sentence");
  await page.locator(`[data-mv-spell-layer="${ids.active}"]`).fill("Second corrected sentence");
  await page.getByRole("button", { name: "Apply" }).click();

  expect(await withMv(page, `(mv) => [mv.text.fullText(mv.text.get(${ids.first})), mv.text.fullText(mv.text.get(${ids.active}))]`))
    .toEqual(["First corrected sentence", "Second corrected sentence"]);
});

test("proof setup exposes OCIO/HDR modes and Save for Web commits a web export", async ({ page }) => {
  await runCommand(page, "Proof Setup ▸ Custom");
  await page.getByText("Customize Proof Condition").waitFor({ state: "visible" });
  await page.locator("#mv-proof-mode").click();
  await page.getByRole("option", { name: "OCIO ACEScg" }).click();
  await page.getByRole("checkbox", { name: "Simulate Paper Color" }).click();
  const blackInk = page.getByRole("checkbox", { name: "Simulate Black Ink" });
  await expect(blackInk).toBeChecked();
  await expect(blackInk).toBeDisabled();
  await page.getByRole("button", { name: "OK" }).click();
  expect(await withMv(page, `(mv) => ({
    mode: mv.store.state.proofMode,
    paper: mv.store.state.proofSimulatePaperColor,
    blackInk: mv.store.state.proofSimulateBlackInk,
  })`)).toEqual({ mode: "acescg", paper: true, blackInk: true });

  await runCommand(page, "Save for Web");
  await expect(page.getByText("Save for Web")).toBeVisible();
  await page.getByText("JPEG", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.jpg$/);
});

test("Proof Setup exposes Internet Standard and Monitor RGB presets", async ({ page }) => {
  await runCommand(page, "Proof Setup ▸ Internet Standard RGB (sRGB)");
  expect(await withMv(page, `(mv) => [mv.store.state.proofMode, mv.store.state.proofOn]`)).toEqual(["srgb", true]);
  await runCommand(page, "Proof Setup ▸ Monitor RGB");
  expect(await withMv(page, `(mv) => [mv.store.state.proofMode, mv.store.state.proofOn]`)).toEqual(["monitor", true]);
});

test("fill Layer Content Options previews, cancels, commits, undoes, and rasterizes", async ({ page }) => {
  await withMv(page, `(mv) => mv.store.newDocument(24, 24, "editable fill")`);
  await runCommand(page, "New Fill Layer ▸ Solid Color");

  let dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Fill color hex").fill("#ff0000");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();

  const fillState = () => withMv<{
    kind: number; subtype: number; params: number[]; mask: boolean; rgb: number[];
  }>(page, `(mv, E) => {
    const id = mv.store.state.activeLayerId;
    const p = E.pick_color(8, 8) >>> 0;
    return {
      kind: E.layer_kind(id), subtype: E.layer_adj_kind(id),
      params: Array.from(E.layer_adj_params(id)), mask: E.layer_has_mask(id),
      rgb: [(p >>> 24) & 255, (p >>> 16) & 255, (p >>> 8) & 255],
    };
  }`);
  expect(await fillState()).toMatchObject({ kind: 4, subtype: 0, mask: true, rgb: [255, 0, 0] });

  await runCommand(page, "Layer ▸ Layer Content Options");
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Fill color hex")).toHaveValue("#ff0000");
  await dialog.getByLabel("Fill color hex").fill("#00ff00");
  expect((await fillState()).rgb).toEqual([0, 255, 0]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await fillState()).rgb).toEqual([255, 0, 0]);

  await runCommand(page, "Layer ▸ Layer Content Options");
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Fill color hex").fill("#0000ff");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  expect((await fillState()).rgb).toEqual([0, 0, 255]);
  await withMv(page, `(mv) => mv.store.undo()`);
  expect((await fillState()).rgb).toEqual([255, 0, 0]);
  await withMv(page, `(mv) => mv.store.redo()`);
  expect((await fillState()).rgb).toEqual([0, 0, 255]);

  await runExactCommand(page, "Layer ▸ Rasterize ▸ Fill Content");
  const raster = await fillState();
  expect(raster).toMatchObject({ kind: 0, mask: true, rgb: [0, 0, 255] });
  expect(raster.params).toEqual([]);
});

test("Rasterize Shape preserves pixels and drops the editable vector scene", async ({ page }) => {
  const before = await withMv<number>(page, `(mv, E) => {
    mv.store.newDocument(24, 24, "editable shape");
    E = mv.engine.engine;
    const scene = JSON.stringify({
      layers: [{ visible: true, items: [{
        type: "rect", id: "shape", transform: { a: 1, b: 0, c: 0, d: 1, e: 4, f: 4 },
        width: 12, height: 12, fill: { type: "solid", color: { r: 220, g: 30, b: 40, a: 1 } },
      }] }],
    });
    const id = E.add_vector_layer(scene, "Shape");
    mv.engine.afterDocChange();
    return E.pick_color(8, 8);
  }`);

  await runExactCommand(page, "Layer ▸ Rasterize ▸ Shape");
  expect(await withMv(page, `(mv, E) => ({
    kind: E.layer_kind(mv.store.state.activeLayerId),
    scene: E.vector_scene_json(mv.store.state.activeLayerId),
    pixel: E.pick_color(8, 8),
  })`)).toEqual({ kind: 0, scene: "", pixel: before });

  await withMv(page, `(mv) => mv.store.undo()`);
  expect(await withMv(page, `(mv, E) => ({
    kind: E.layer_kind(mv.store.state.activeLayerId),
    scene: E.vector_scene_json(mv.store.state.activeLayerId),
    pixel: E.pick_color(8, 8),
  })`)).toMatchObject({ kind: 3, pixel: before });
  expect(await withMv<string>(page, `(mv, E) => E.vector_scene_json(mv.store.state.activeLayerId)`)).toContain("shape");

  await withMv(page, `(mv) => { mv.store.newDocument(8, 8, "pixel"); mv.store.markActiveSaved(); }`);
  const cleanDepth = await withMv<number>(page, `(mv, E) => E.undo_depth()`);
  await runExactCommand(page, "Layer ▸ Rasterize ▸ Shape");
  expect(await withMv(page, `(mv, E) => ({ dirty: mv.store.docDirty(mv.store.state.activeDocId), depth: E.undo_depth() })`))
    .toEqual({ dirty: false, depth: cleanDepth });
});

test("Place Embedded and Place Linked create centred Smart Objects with one-step undo", async ({ page }) => {
  const before = await withMv<{ layers: number; depth: number }>(page, `(mv, E) => {
    mv.store.newDocument(128, 96, "place smart objects", "transparent");
    E = mv.engine.engine;
    mv.store.markActiveSaved();
    return { layers: E.layer_count(), depth: E.undo_depth() };
  }`);

  let chooserPromise = page.waitForEvent("filechooser");
  await runExactCommand(page, "File ▸ Place Embedded…");
  let chooser = await chooserPromise;
  await chooser.setFiles(placeFixture);
  await expect.poll(() => withMv(page, `(mv, E) => E.layer_count()`)).toBe(before.layers + 1);

  const embedded = await withMv<{
    id: number; kind: number; bounds: number[]; depth: number; label: string; linked: unknown; rgb: number[];
  }>(page, `(mv, E) => {
    const id = mv.store.state.activeLayerId;
    const p = E.pick_color(64, 48) >>> 0;
    return {
      id, kind: E.layer_kind(id), bounds: Array.from(E.active_layer_bounds()),
      depth: E.undo_depth(), label: E.undo_label(), linked: mv.smart.linkedInfo(id),
      rgb: [(p >>> 24) & 255, (p >>> 16) & 255, (p >>> 8) & 255],
    };
  }`);
  expect(embedded).toMatchObject({ kind: 7, bounds: [32, 16, 64, 64], depth: before.depth + 1, label: "Place", linked: null, rgb: [128, 128, 0] });

  await withMv(page, `(mv) => mv.store.undo()`);
  expect(await withMv(page, `(mv, E) => E.layer_count()`)).toBe(before.layers);
  await withMv(page, `(mv) => mv.store.redo()`);
  expect(await withMv(page, `(mv, E) => [E.layer_count(), E.layer_kind(${embedded.id})]`)).toEqual([before.layers + 1, 7]);

  const linkedDepth = await withMv<number>(page, `(mv, E) => E.undo_depth()`);
  chooserPromise = page.waitForEvent("filechooser");
  await runExactCommand(page, "File ▸ Place Linked…");
  chooser = await chooserPromise;
  await chooser.setFiles(placeFixture);
  await expect.poll(() => withMv(page, `(mv) => mv.smart.linkedObjects().length`)).toBe(1);

  const linked = await withMv<{
    id: number; kind: number; bounds: number[]; layers: number; depth: number; info: { name: string; path?: string } | null;
  }>(page, `(mv, E) => {
    const id = mv.store.state.activeLayerId;
    return {
      id, kind: E.layer_kind(id), bounds: Array.from(E.active_layer_bounds()),
      layers: E.layer_count(), depth: E.undo_depth(), info: mv.smart.linkedInfo(id),
    };
  }`);
  expect(linked).toMatchObject({ kind: 7, bounds: [32, 16, 64, 64], layers: before.layers + 2, depth: linkedDepth + 1, info: { name: "px.png" } });
  expect(linked.info?.path).toBeUndefined();

  await withMv(page, `(mv) => mv.store.undo()`);
  expect(await withMv(page, `(mv) => mv.smart.linkedInfo(${linked.id})`)).toBeNull();
  await withMv(page, `(mv) => mv.store.redo()`);
  expect(await withMv(page, `(mv) => mv.smart.linkedInfo(${linked.id})?.name`)).toBe("px.png");

  expect(await withMv(page, `(mv, E) => {
    const saved = mv.store.saveProject();
    mv.store.openProject(saved, "placed-roundtrip.mvision");
    E = mv.engine.engine;
    const id = mv.store.state.activeLayerId;
    return { kind: E.layer_kind(id), bounds: Array.from(E.active_layer_bounds()), info: mv.smart.linkedInfo(id) };
  }`)).toMatchObject({ kind: 7, bounds: [32, 16, 64, 64], info: { name: "px.png", missing: false } });
});

test("adjustment Layer Content Options reopens existing settings as one undo step", async ({ page }) => {
  await withMv(page, `(mv) => {
    mv.store.newDocument(24, 24, "editable adjustment");
    mv.store.addAdjustmentLayer(0, new Float32Array([0.25, 0.5]), "Brightness/Contrast");
  }`);
  const params = () => withMv<number[]>(page, `(mv, E) => Array.from(E.layer_adj_params(mv.store.state.activeLayerId))`);

  await runCommand(page, "Layer ▸ Layer Content Options");
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("slider").first().press("End");
  expect((await params())[0]).toBeCloseTo(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await params()).toEqual([0.25, 0.5]);

  await runCommand(page, "Layer ▸ Layer Content Options");
  dialog = page.getByRole("dialog");
  const brightness = dialog.getByRole("slider", { name: "Brightness" });
  await expect.poll(async () => {
    await brightness.press("Home");
    return (await params())[0];
  }).toBeCloseTo(-1);
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  expect((await params())[0]).toBeCloseTo(-1);
  await withMv(page, `(mv) => mv.store.undo()`);
  expect(await params()).toEqual([0.25, 0.5]);
});

test("gradient and pattern fill dialogs create editable masked content", async ({ page }) => {
  await withMv(page, `(mv) => mv.store.newDocument(24, 24, "fill types")`);
  await runCommand(page, "New Fill Layer ▸ Gradient");
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "B→W", exact: true }).click();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  expect(await withMv(page, `(mv, E) => {
    const id = mv.store.state.activeLayerId;
    return [E.layer_kind(id), E.layer_adj_kind(id), E.layer_has_mask(id), E.layer_adj_params(id).length];
  }`)).toEqual([4, 1, true, 10]);

  await withMv(page, `(mv, E) => {
    const id = E.add_layer("pattern source");
    E.set_active_layer(id);
    E.select_rect(0, 0, 1, 1, 0); E.fill_selection(255, 0, 0, 255);
    E.select_rect(1, 0, 1, 1, 0); E.fill_selection(0, 0, 255, 255);
    E.select_rect(0, 0, 2, 1, 0); E.define_pattern(); E.select_none();
    mv.engine.commit();
  }`);
  await runCommand(page, "New Fill Layer ▸ Pattern");
  dialog = page.getByRole("dialog");
  await dialog.getByRole("slider").press("End");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  const patternParams = () => withMv<number[]>(page, `(mv, E) => Array.from(E.layer_adj_params(mv.store.state.activeLayerId))`);
  expect(await withMv(page, `(mv, E) => {
    const id = mv.store.state.activeLayerId;
    return [E.layer_kind(id), E.layer_adj_kind(id), E.layer_has_mask(id)];
  }`)).toEqual([4, 2, true]);
  expect((await patternParams())[2]).toBeCloseTo(1000);

  await runCommand(page, "Layer ▸ Layer Content Options");
  dialog = page.getByRole("dialog");
  await dialog.getByRole("slider").press("Home");
  expect((await patternParams())[2]).toBeCloseTo(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await patternParams())[2]).toBeCloseTo(1000);
});

test("gradient and pattern fill layers export to PSD as live fill layers", async ({ page }) => {
  await withMv(page, `(mv) => mv.store.newDocument(24, 24, "fill export")`);
  await runCommand(page, "New Fill Layer ▸ Gradient");
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "B→W", exact: true }).click();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  const stops = await withMv<number[]>(page, `(mv, E) => Array.from(E.layer_adj_params(mv.store.state.activeLayerId))`);

  await withMv(page, `(mv, E) => {
    const id = E.add_layer("pattern source");
    E.set_active_layer(id);
    E.select_rect(0, 0, 1, 1, 0); E.fill_selection(255, 0, 0, 255);
    E.select_rect(1, 0, 1, 1, 0); E.fill_selection(0, 0, 255, 255);
    E.select_rect(0, 0, 2, 1, 0); E.define_pattern(); E.select_none();
    mv.engine.commit();
  }`);
  await runCommand(page, "New Fill Layer ▸ Pattern");
  dialog = page.getByRole("dialog");
  await dialog.getByRole("slider").press("End");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();

  const [download] = await Promise.all([page.waitForEvent("download"), runCommand(page, "Export PSD…")]);
  const file = await readFile(await download.path());
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const psd = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  const fill = (name: string) => psd.children!.find((layer) => layer.name === name)!.vectorFill as any;
  // A raw tagged block, read with ag-psd's own reader.
  const block = (key: string) => {
    const at = file.indexOf(`8BIM${key}`);
    expect(at, key).toBeGreaterThan(0);
    return createReader(buffer, at + 12, file.readUInt32BE(at + 8));
  };

  const gradient = fill("Gradient Fill");
  expect(gradient).toMatchObject({ type: "solid", style: "linear", angle: -90 });
  expect(gradient.colorStops).toHaveLength(stops.length / 5);
  gradient.colorStops.forEach((stop: any, i: number) => {
    const [location, r, g, b, a] = stops.slice(i * 5, i * 5 + 5);
    expect(stop.location).toBeCloseTo(location, 3);
    expect(stop.color.r / 255).toBeCloseTo(r, 3);
    expect(stop.color.g / 255).toBeCloseTo(g, 3);
    expect(stop.color.b / 255).toBeCloseTo(b, 3);
    expect(gradient.opacityStops[i].location).toBeCloseTo(location, 3);
    expect(gradient.opacityStops[i].opacity).toBeCloseTo(a, 3);
  });

  const pattern = fill("Pattern Fill");
  expect(pattern.type).toBe("pattern");
  expect(readVersionAndDescriptor(block("PtFl"))["Scl "]).toEqual({ units: "Percent", value: 1000 });
  const record = readPattern(block("Patt"));
  expect(record.id).toBe(pattern.id);
  expect(record.bounds).toEqual({ x: 0, y: 0, w: 2, h: 1 });
  expect(Array.from(record.data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);

  // Reopened, the fill is a raster layer that keeps its PtFl, so saving again
  // has to carry the pattern record it names, samples and all.
  const again = Buffer.from(await page.evaluate(async (bytes) => {
    const mv = (window as any).__mv;
    mv.store.openFormat(new Uint8Array(bytes), "fill export.psd");
    return Array.from((await mv.bytesForExt("psd")).bytes as Uint8Array);
  }, Array.from(file)));
  const againBuffer = again.buffer.slice(again.byteOffset, again.byteOffset + again.byteLength);
  const reopened = readPsd(againBuffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  const kept = reopened.children!.find((layer) => layer.name === "Pattern Fill")!.vectorFill as any;
  const at = again.indexOf("8BIMPatt");
  expect(at).toBeGreaterThan(0);
  const saved = readPattern(createReader(againBuffer, at + 12, again.readUInt32BE(at + 8)));
  expect(kept.id).toBe(pattern.id);
  expect(saved.id).toBe(pattern.id);
  expect(Array.from(saved.data)).toEqual(Array.from(record.data));
});

test("File and Layer exports keep separate pixel scopes and restore state", async ({ page }) => {
  const setup = await withMv<{
    composite: number[]; layer: number[]; state: unknown;
  }>(page, `(mv, E) => {
    mv.store.newDocument(8, 8, "export-scopes.psd");
    E = mv.engine.engine;
    E.select_all(); E.fill_selection(220, 20, 20, 255); E.select_none();
    const base = E.add_layer("clip base");
    E.set_active_layer(base);
    E.select_rect(1, 1, 4, 4, 0); E.fill_selection(20, 20, 220, 255); E.select_none();
    const top = E.add_layer("Hero / icon");
    E.set_active_layer(top);
    E.select_rect(2, 2, 2, 2, 0); E.fill_selection(20, 220, 20, 255); E.select_none();
    E.set_layer_clipping(top, true);
    E.set_layer_blend_clipped_group(base, true);
    const hidden = E.add_layer("hidden sentinel");
    E.set_layer_visible(hidden, false);
    mv.engine.commit();
    mv.store.selectLayer(top);
    mv.store.setExportPrefs({ format: "png", quality: 73 });
    mv.store.markActiveSaved();
    const snapshot = () => ({
      active: E.active_layer_id(),
      selected: [...mv.store.state.selectedLayerIds],
      visible: mv.store.state.layers.map((layer) => E.layer_visible(layer.id)),
      undoDepth: E.undo_depth(),
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
      composite: Array.from(E.export_png()),
    });
    return { composite: Array.from(E.export_png()), layer: Array.from(E.export_layer_png_trimmed(top)), state: snapshot() };
  }`);

  const expectClean = async () => {
    expect(await withMv<boolean>(page, `(mv) => !mv.store.docDirty(mv.store.state.activeDocId)`)).toBe(true);
  };

  const download = async (label: string) => {
    const pending = page.waitForEvent("download");
    await runExactCommand(page, label);
    const result = await pending;
    return { result, bytes: await readFile((await result.path())!) };
  };
  const filePending = page.waitForEvent("download");
  await runExactCommand(page, "File ▸ Export ▸ Export As…");
  await page.getByRole("dialog").getByRole("button", { name: "Export", exact: true }).click();
  const fileResult = await filePending;
  const file = { result: fileResult, bytes: await readFile((await fileResult.path())!) };
  await expectClean();
  const layerPending = page.waitForEvent("download");
  await runExactCommand(page, "Layer ▸ Export As…");
  await page.getByRole("dialog").getByRole("button", { name: "Export", exact: true }).click();
  const layerResult = await layerPending;
  const layer = { result: layerResult, bytes: await readFile((await layerResult.path())!) };
  await expectClean();
  const quick = await download("Layer ▸ Quick Export as PNG");
  await expectClean();

  expect(file.result.suggestedFilename()).toBe("export-scopes.png");
  expect(layer.result.suggestedFilename()).toBe("Hero_icon.png");
  expect(quick.result.suggestedFilename()).toBe("Hero_icon.png");
  expect(pngDimensions(file.bytes)).toEqual([8, 8]);
  expect(pngDimensions(layer.bytes)).toEqual([2, 2]);
  expect(pngDimensions(quick.bytes)).toEqual([2, 2]);
  expect(file.bytes.equals(Buffer.from(setup.composite))).toBe(true);
  expect(layer.bytes.equals(Buffer.from(setup.layer))).toBe(true);
  expect(quick.bytes.equals(Buffer.from(setup.layer))).toBe(true);
  expect(layer.bytes.equals(file.bytes)).toBe(false);
  expect(await withMv(page, `(mv, E) => ({
    active: E.active_layer_id(),
    selected: [...mv.store.state.selectedLayerIds],
    visible: mv.store.state.layers.map((layer) => E.layer_visible(layer.id)),
    undoDepth: E.undo_depth(),
    dirty: mv.store.docDirty(mv.store.state.activeDocId),
    composite: Array.from(E.export_png()),
  })`)).toEqual(setup.state);
});

test("Layer Export As honors JPEG preferences for every selected layer and group", async ({ page }) => {
  const setup = await withMv<{
    group: number[]; loose: number[]; groupAt90: number[]; state: unknown;
  }>(page, `(mv, E) => {
    mv.store.newDocument(8, 8, "selected-layer-jpeg.psd");
    E = mv.engine.engine;
    E.select_all(); E.fill_selection(30, 30, 30, 255); E.select_none();
    const child = E.add_layer("group child");
    E.set_active_layer(child);
    E.select_rect(1, 1, 3, 3, 0); E.fill_selection(20, 220, 20, 255); E.select_none();
    const group = E.create_group("Badge Group");
    const loose = E.add_layer("Loose / mark");
    E.set_active_layer(loose);
    E.select_rect(4, 4, 3, 3, 0); E.fill_selection(20, 20, 220, 255); E.select_none();
    mv.engine.commit();
    mv.store.selectLayer(group);
    mv.store.toggleLayerInSelection(loose);
    mv.store.setExportPrefs({ format: "jpeg", quality: 41 });
    mv.store.markActiveSaved();
    const snapshot = () => ({
      active: E.active_layer_id(),
      selected: [...mv.store.state.selectedLayerIds],
      visible: mv.store.state.layers.map((layer) => E.layer_visible(layer.id)),
      undoDepth: E.undo_depth(),
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
      composite: Array.from(E.export_png()),
    });
    const state = snapshot();
    return {
      group: Array.from(E.export_layer_jpeg_trimmed(group, 41)),
      loose: Array.from(E.export_layer_jpeg_trimmed(loose, 41)),
      groupAt90: Array.from(E.export_layer_jpeg_trimmed(group, 90)),
      state,
    };
  }`);

  const groupPending = page.waitForEvent("download", {
    predicate: (download) => download.suggestedFilename() === "Badge_Group.jpg",
  });
  const loosePending = page.waitForEvent("download", {
    predicate: (download) => download.suggestedFilename() === "Loose_mark.jpg",
  });
  await runExactCommand(page, "Layer ▸ Export As…");
  await page.getByRole("dialog").getByRole("button", { name: "Export", exact: true }).click();
  const [groupDownload, looseDownload] = await Promise.all([groupPending, loosePending]);
  const [groupBytes, looseBytes] = await Promise.all([
    readFile((await groupDownload.path())!),
    readFile((await looseDownload.path())!),
  ]);

  expect(groupBytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  expect(looseBytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  expect(groupBytes.equals(Buffer.from(setup.group))).toBe(true);
  expect(looseBytes.equals(Buffer.from(setup.loose))).toBe(true);
  expect(groupBytes.equals(Buffer.from(setup.groupAt90))).toBe(false);
  expect(await withMv(page, `(mv, E) => ({
    active: E.active_layer_id(),
    selected: [...mv.store.state.selectedLayerIds],
    visible: mv.store.state.layers.map((layer) => E.layer_visible(layer.id)),
    undoDepth: E.undo_depth(),
    dirty: mv.store.docDirty(mv.store.state.activeDocId),
    composite: Array.from(E.export_png()),
  })`)).toEqual(setup.state);
});
