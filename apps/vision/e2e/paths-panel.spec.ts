import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Paths panel (Window ▸ Paths) ─────────────────────────
// Adobe: the Paths panel lists the Work Path + saved named paths and runs the path
// ops — Load path as selection, Fill path (foreground), Save/name a path, Delete.
// Vision adds it reusing the Pen work path (store.penPath) + select_polygon /
// fill_selection (the Pen's own pattern). No engine change.
//   https://helpx.adobe.com/photoshop/using/managing-paths.html

const TRI = [8, 8, 32, 8, 20, 32]; // a triangle within a 40×40 doc

async function setup(page: Page) {
  await gotoApp(page);
  await page.evaluate((tri) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "paths");
    mv.store.setForeground({ h: 120, s: 1, v: 1, a: 1 }); // green
    mv.store.setPenPath(tri);
  }, TRI);
  await page.locator('[data-tab-id="paths"]').click(); // surface the Paths panel
}

test("the Work Path row shows and Make Selection creates a selection", async ({ page }) => {
  await setup(page);
  await expect(page.locator('[data-mv-path-row="work"]')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(false);
  await page.getByRole("button", { name: "Make Selection" }).click();
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(true);
});

test("Fill Path fills the path region with the foreground", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Fill Path" }).click();
  const c = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_color(20, 16) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 }; });
  expect(c.g).toBeGreaterThan(c.r); // green fill inside the triangle
  expect(c.g).toBeGreaterThan(c.b);
  // Fill Path leaves no selection (matches the Pen's fill).
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(false);
});

test("Stroke Path outlines the path with the brush (without filling it)", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setBrush({ size: 3, hardness: 1 })); // thin, so the outline is clearly not a fill
  await page.getByRole("button", { name: "Stroke Path" }).click();
  const at = (x: number, y: number) => page.evaluate(({ x, y }) => { const p = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 }; }, { x, y });
  const edge = await at(20, 8); // midpoint of the top edge → stroked green
  expect(edge.g).toBeGreaterThan(edge.r);
  expect(edge.g).toBeGreaterThan(edge.b);
  const interior = await at(20, 16); // interior → NOT filled (white bg shows)
  expect(interior.r).toBeGreaterThan(240);
  expect(interior.g).toBeGreaterThan(240);
  expect(interior.b).toBeGreaterThan(240);
});

test("Make Work Path traces the active selection into the work path (round-trips)", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "makeworkpath");
    mv.engine.engine.select_rect(8, 6, 20, 16, 0); // a clean rectangular selection
    mv.engine.commit(); // resync the store so selectionActive enables the button
  });
  await page.locator('[data-tab-id="paths"]').click();
  const bounds = () => page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds() as Int32Array));
  const before = await bounds();
  // trace the selection into a work path
  await page.getByRole("button", { name: "Make Work Path" }).click();
  const pen = await page.evaluate(() => (window as any).__mv.store.state.penPath as number[]);
  expect(pen.length).toBeGreaterThanOrEqual(8); // a valid traced polygon (≥4 corners for a rect)
  // round-trip: clear the selection, then Make Selection from the new work path
  await page.evaluate(() => { (window as any).__mv.engine.engine.select_none(); (window as any).__mv.engine.commit(); });
  await page.getByRole("button", { name: "Make Selection" }).click();
  const after = await bounds();
  for (let i = 0; i < 4; i++) expect(Math.abs(after[i] - before[i])).toBeLessThanOrEqual(1); // same rect (±1px)
});

test("Option-click Make Work Path exposes tolerance and coarser paths use fewer anchors", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "work-path-tolerance");
    const mask = new Uint8Array(40 * 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (x + y < 32) mask[y * 40 + x] = 255;
    mv.engine.engine.set_selection_mask(mask); // diagonal edge gives simplification visible work
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="paths"]').click();
  const make = page.getByRole("button", { name: "Make Work Path" });

  await make.click({ modifiers: ["Alt"] });
  const dialog = page.getByRole("dialog", { name: "Make Work Path" });
  await expect(dialog).toBeVisible();
  const tolerance = dialog.getByRole("spinbutton", { name: "Tolerance" });
  await expect(tolerance).toHaveAttribute("aria-valuemin", "0.5");
  await expect(tolerance).toHaveAttribute("aria-valuemax", "10");
  await tolerance.fill("0.5");
  await tolerance.press("Tab");
  await dialog.getByRole("button", { name: "OK" }).click();
  const fineAnchors = await page.evaluate(() => (window as any).__mv.store.state.penPath.length / 2);

  await make.click({ modifiers: ["Alt"] });
  await dialog.getByRole("spinbutton", { name: "Tolerance" }).fill("10");
  await dialog.getByRole("spinbutton", { name: "Tolerance" }).press("Tab");
  await dialog.getByRole("button", { name: "OK" }).click();
  const coarseAnchors = await page.evaluate(() => (window as any).__mv.store.state.penPath.length / 2);
  expect(coarseAnchors).toBeLessThan(fineAnchors);

  await page.evaluate(() => (window as any).__mv.store.deleteWorkPath());
  await page.locator('[data-tab-id="layers"]').click();
  await page.locator('[data-tab-id="paths"]').click();
  await make.click(); // ordinary click reuses the current tolerance
  expect(await page.evaluate(() => (window as any).__mv.store.state.penPath.length / 2)).toBe(coarseAnchors);
});

test("Make Work Path tolerance cancel is non-destructive and no selection disables the action", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "work-path-tolerance-safety");
    mv.engine.engine.select_rect(8, 6, 20, 16, 0);
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="paths"]').click();
  const make = page.getByRole("button", { name: "Make Work Path" });
  await make.click();
  const before = await page.evaluate(() => [...(window as any).__mv.store.state.penPath] as number[]);

  await make.click({ modifiers: ["Alt"] });
  const dialog = page.getByRole("dialog", { name: "Make Work Path" });
  await dialog.getByRole("spinbutton", { name: "Tolerance" }).fill("10");
  const close = dialog.getByRole("button", { name: "Close dialog" });
  const ok = dialog.getByRole("button", { name: "OK" });
  await ok.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(ok).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(make).toBeFocused();
  expect(await page.evaluate(() => (window as any).__mv.store.state.penPath)).toEqual(before);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.deleteWorkPath();
    mv.engine.engine.select_none();
    mv.engine.commit();
  });
  await expect(make).toBeDisabled();
  await expect(dialog).toHaveCount(0);
});

test("Save adds a named path that loads back, and Delete removes it", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator('[data-mv-path-row="0"]')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.savedPaths.length)).toBe(1);
  // clear the work path, then click the saved row → it reloads into penPath
  await page.evaluate(() => (window as any).__mv.store.deleteWorkPath());
  expect(await page.evaluate(() => (window as any).__mv.store.state.penPath.length)).toBe(0);
  await page.locator('[data-mv-path-row="0"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.penPath)).toEqual(TRI);
  // delete the saved path
  await page.locator('[data-mv-path-row="0"] .monet-iconbtn').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.savedPaths.length)).toBe(0);
});

// ── Paths panel menu ▸ Clipping Path… (#457) ──────────────────────
// Photoshop names one saved path, with a flatness, as the document's clipping
// path: a PSD carries each saved path as image resource 2000+ (Pascal-named)
// and the clipping path as resource 2999 (name, 16.16 flatness, fill rule).
//   https://helpx.adobe.com/photoshop/using/create-image-clipping-paths.html

const exportPsd = (page: Page) => page.evaluate(() => Array.from((window as any).__mv.exportPSDBytes() as Uint8Array));

/** A PSD's 8BIM image resources by id, each with its Pascal name and payload. */
function psdResources(bytes: number[]) {
  const psd = Uint8Array.from(bytes);
  const view = new DataView(psd.buffer);
  let pos = 30 + view.getUint32(26); // past the color mode data
  const end = pos + 4 + view.getUint32(pos);
  pos += 4;
  const out = new Map<number, { name: string; data: number[] }>();
  while (pos + 12 <= end) {
    const id = view.getUint16(pos + 4);
    const nameLength = psd[pos + 6];
    const name = String.fromCharCode(...psd.slice(pos + 7, pos + 7 + nameLength));
    pos += 7 + nameLength + ((1 + nameLength) % 2);
    const length = view.getUint32(pos);
    out.set(id, { name, data: Array.from(psd.slice(pos + 4, pos + 4 + length)) });
    pos += 4 + length + (length % 2);
  }
  return out;
}

const activeDocument = (page: Page) => page.evaluate(() => {
  const mv = (window as any).__mv;
  const doc = mv.store.state.documents.find((d: { id: number }) => d.id === mv.store.state.activeDocId);
  return { dirty: doc?.dirty as boolean, paths: mv.store.state.savedPaths as { name: string; path: number[]; clipFlatness?: number }[] };
});

async function openClippingPath(page: Page) {
  await page.locator('[data-mv-panel-flyout="Paths"]').click();
  await page.getByRole("menuitem", { name: "Clipping Path…" }).click();
  const dialog = page.getByRole("dialog", { name: "Clipping Path" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("Clipping Path… marks a saved path and a PSD export reopens with it", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Save" }).click();
  const row = page.locator('[data-mv-path-row="0"]');
  await expect(row).toBeVisible();

  const dialog = await openClippingPath(page);
  await dialog.getByRole("combobox", { name: "Path" }).click();
  await page.getByRole("option", { name: "Path 1", exact: true }).click();
  const flatness = dialog.getByRole("spinbutton", { name: "Flatness" });
  await flatness.fill("2");
  await flatness.press("Tab");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveAttribute("data-mv-path-clipping", "2");
  expect((await activeDocument(page)).paths[0].clipFlatness).toBe(2);

  const bytes = await exportPsd(page);
  const resources = psdResources(bytes);
  expect(resources.get(2000)?.name).toBe("Path 1");
  const name = [..."Path 1"].map((c) => c.charCodeAt(0));
  expect(resources.get(2999)?.data).toEqual([name.length, ...name, 0, 2, 0, 0, 0, 1]);

  // Opening the PSD reads the path and the clipping choice back, clean.
  await page.evaluate((psd) => (window as any).__mv.store.openPsd(new Uint8Array(psd), "clip.psd"), bytes);
  const reopened = await activeDocument(page);
  expect(reopened.dirty).toBe(false);
  expect(reopened.paths).toHaveLength(1);
  expect(reopened.paths[0]).toMatchObject({ name: "Path 1", clipFlatness: 2 });
  expect(reopened.paths[0].path).toHaveLength(TRI.length);
  reopened.paths[0].path.forEach((v, i) => expect(Math.abs(v - TRI[i])).toBeLessThanOrEqual(1));
  await expect(page.locator('[data-mv-path-row="0"]')).toHaveAttribute("data-mv-path-clipping", "2");
});

test("Clipping Path Cancel, Escape and refused input leave the document unchanged", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Save" }).click();
  // A reopened PSD is a clean document holding one saved path.
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.openPsd(mv.exportPSDBytes(), "paths.psd"); });
  const before = await activeDocument(page);
  expect(before.dirty).toBe(false);
  expect(before.paths).toHaveLength(1);
  expect(before.paths[0].clipFlatness).toBeUndefined();

  let dialog = await openClippingPath(page);
  const flatness = dialog.getByRole("spinbutton", { name: "Flatness" });
  await expect(flatness).toHaveAttribute("aria-valuemin", "0.2");
  await expect(flatness).toHaveAttribute("aria-valuemax", "100");
  await flatness.fill("500");
  await flatness.press("Tab");
  await expect(flatness).toHaveAttribute("aria-valuenow", "100"); // out of range clamps
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await activeDocument(page)).toEqual(before);

  dialog = await openClippingPath(page);
  await dialog.getByRole("spinbutton", { name: "Flatness" }).fill("3");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await activeDocument(page)).toEqual(before);

  // Scripted callers are refused with the reason, not clamped.
  const refused = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const errors: string[] = [];
    const previous = mv.engine.onEditError;
    mv.engine.onEditError = (message: string) => errors.push(message);
    try {
      return { results: [mv.store.setClippingPath(0, 500), mv.store.setClippingPath(7, 2)], errors };
    } finally {
      mv.engine.onEditError = previous;
    }
  });
  expect(refused).toEqual({
    results: [false, false],
    errors: ["Flatness must be between 0.2 and 100 device pixels.", "That saved path no longer exists. Choose another path for the clipping path."],
  });
  expect(await activeDocument(page)).toEqual(before);

  // Deleting the clipping path takes 2000 and 2999 out of the next export.
  expect(await page.evaluate(() => (window as any).__mv.store.setClippingPath(0, 2))).toBe(true);
  expect(psdResources(await exportPsd(page)).has(2999)).toBe(true);
  await page.locator('[data-mv-path-row="0"] .monet-iconbtn').click();
  const after = psdResources(await exportPsd(page));
  expect(after.has(2000)).toBe(false);
  expect(after.has(2999)).toBe(false);
});
