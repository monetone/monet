import { test, expect, type Page } from "@playwright/test";
import { gotoApp, composite } from "./helpers";

// ── Photoshop Edit ▸ Content-Aware Fill… workspace (#430) ─────────
// The command opens a workspace: a paintable Sampling Area overlay (green;
// Auto / Rectangular / Custom with an add/subtract brush), Fill Settings (Color
// and Rotation Adaptation, Scale, Mirror), a live Preview and Output To
// (Current / New / Duplicate Layer). Cancel leaves the document untouched.
// https://helpx.adobe.com/photoshop/using/content-aware-fill.html

const W = 120;
const H = 60;
const HOLE = { x: 20, y: 20, w: 12, h: 12 }; // a green blemish in the red half
const CX = HOLE.x + 6;
const CY = HOLE.y + 6;

type Rgb = number[];
const isRed = (p: Rgb) => p[0] > 150 && p[1] < 90 && p[2] < 90;
const isBlue = (p: Rgb) => p[2] > 150 && p[0] < 90 && p[1] < 90;
const isGreen = (p: Rgb) => p[1] > 150 && p[0] < 90 && p[2] < 90;

/** Red left half, blue right half, a green blemish in the red half, selected. */
async function scene(page: Page, select = true) {
  await gotoApp(page);
  await page.evaluate(({ w, h, hole, select }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "caf");
    mv.store.renameLayer(mv.store.state.activeLayerId, "Photo");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(220, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(0, 0, 220, 255);
    E.select_rect(hole.x, hole.y, hole.w, hole.h, 0); E.fill_selection(0, 200, 0, 255);
    if (!select) E.select_none();
    mv.engine.commit();
    (window as any).__cafErrors = [];
    const toast = mv.engine.onEditError;
    mv.engine.onEditError = (message: string) => { (window as any).__cafErrors.push(message); toast?.(message); };
  }, { w: W, h: H, hole: HOLE, select });
}

async function docState(page: Page) {
  const { chk } = await composite(page);
  return {
    chk,
    ...await page.evaluate(() => {
      const E = (window as any).__mv.engine.engine;
      return { layers: E.layer_count() as number, depth: E.undo_depth() as number, labels: Array.from(E.history_labels()) as string[] };
    }),
  };
}

async function openWorkspace(page: Page) {
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.includes("Content-Aware Fill…")),
    null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.includes("Content-Aware Fill…")).run();
  });
  await expect(page.getByRole("dialog").locator("[data-mv-caf-workspace]")).toBeVisible();
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Wait until the workspace's own preview canvas shows `want` at the hole. */
async function previewShows(page: Page, want: "red" | "blue") {
  await page.waitForFunction(({ x, y, w, want }) => {
    const c = document.querySelector<HTMLCanvasElement>("#mv-caf-preview");
    if (!c || c.width !== w) return false;
    const [r, g, b] = c.getContext("2d")!.getImageData(x, y, 1, 1).data;
    return want === "red" ? r > 150 && g < 90 && b < 90 : b > 150 && r < 90 && g < 90;
  }, { x: CX, y: CY, w: W, want });
}

/** A real pointer stroke on the preview canvas between document points. */
async function strokeOnPreview(page: Page, points: [number, number][]) {
  const r = (await page.locator("#mv-caf-preview").boundingBox())!;
  const k = Math.min(r.width / W, r.height / H); // object-fit: contain
  const at = ([x, y]: [number, number]) => [r.x + (r.width - W * k) / 2 + x * k, r.y + (r.height - H * k) / 2 + y * k] as const;
  await page.mouse.move(...at(points[0]));
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...at(p));
  await page.mouse.up();
}

const pixel = (page: Page, mode: "composite" | "layer") => page.evaluate(({ x, y, mode }) => {
  const E = (window as any).__mv.engine.engine;
  const c = (mode === "composite" ? E.pick_color(x, y) : E.pick_sample(x, y, 0, 1)) >>> 0;
  return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
}, { x: CX, y: CY, mode });

test("Edit ▸ Content-Aware Fill… opens the workspace, previews inside it and commits one step", async ({ page }) => {
  await scene(page);
  const before = await docState(page);
  await openWorkspace(page);

  for (const name of ["Color adaptation", "Rotation adaptation", "Output to"]) {
    await expect(page.getByRole("combobox", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("checkbox", { name: "Scale", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Mirror", exact: true })).not.toBeChecked();
  await expect(page.getByRole("radio", { name: "Auto", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("img", { name: "Content-Aware Fill preview and sampling area" })).toBeVisible();

  // The hole was green before the workspace opened; its own canvas shows it filled.
  await previewShows(page, "red");
  expect((await docState(page)).labels, "no history step while the workspace is open").toEqual(before.labels);

  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.locator("[data-mv-caf-workspace]")).toHaveCount(0);
  const after = await docState(page);
  expect(after.labels).toEqual([...before.labels, "Content-Aware Fill"]);
  expect(isRed(await pixel(page, "composite"))).toBe(true);
});

for (const how of ["Cancel", "Escape"] as const) {
  test(`${how} leaves the document untouched even after New Layer previews`, async ({ page }) => {
    await scene(page);
    const before = await docState(page);
    await openWorkspace(page);
    await pick(page, "Output to", "New Layer");
    await pick(page, "Rotation adaptation", "Full");
    await previewShows(page, "red");
    await strokeOnPreview(page, [[80, 10], [95, 30], [110, 50]]);
    await expect(page.getByRole("radio", { name: "Custom", exact: true })).toHaveAttribute("aria-checked", "true");
    await previewShows(page, "red");

    if (how === "Cancel") await page.getByRole("button", { name: "Cancel", exact: true }).click();
    else await page.keyboard.press("Escape");

    await expect(page.locator("[data-mv-caf-workspace]")).toHaveCount(0);
    expect(await docState(page)).toEqual(before);
    expect(isGreen(await pixel(page, "composite"))).toBe(true);
  });
}

test("a painted Custom sampling area steers the fill", async ({ page }) => {
  await scene(page);
  await openWorkspace(page);
  await previewShows(page, "red"); // Auto samples the red surroundings
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  await strokeOnPreview(page, [[85, 25], [95, 30], [100, 35]]); // Add brush over the blue half
  await previewShows(page, "blue");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.locator("[data-mv-caf-workspace]")).toHaveCount(0);
  expect(isBlue(await pixel(page, "composite"))).toBe(true);
});

for (const option of ["New Layer", "Duplicate Layer"] as const) {
  test(`Output To ${option} puts the fill on one new layer and leaves the source alone`, async ({ page }) => {
    await scene(page);
    const before = await docState(page);
    await openWorkspace(page);
    await pick(page, "Output to", option);
    await previewShows(page, "red");
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await expect(page.locator("[data-mv-caf-workspace]")).toHaveCount(0);

    const after = await docState(page);
    expect(after.layers, "exactly one layer, however many previews ran").toBe(before.layers + 1);
    expect(after.labels).toEqual([...before.labels, "Content-Aware Fill"]);
    const names = await page.evaluate(() => (window as any).__mv.store.state.layers.map((l: any) => l.name) as string[]);
    if (option === "Duplicate Layer") expect(names).toContain("Photo copy");
    expect(isGreen(await pixel(page, "layer")), "the active source layer still holds the blemish").toBe(true);
    expect(isRed(await pixel(page, "composite")), "the new layer shows the fill").toBe(true);
  });
}

test("invalid input is refused with a message, and OK then changes nothing", async ({ page }) => {
  await scene(page, false);
  let before = await docState(page);
  await openWorkspace(page);
  await page.waitForFunction(() => (window as any).__cafErrors.some((m: string) => m.includes("needs a selection")));
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.locator("[data-mv-caf-workspace]")).toHaveCount(0);
  expect(await docState(page)).toEqual(before);

  await page.evaluate(({ hole }) => {
    const mv = (window as any).__mv;
    mv.engine.engine.select_rect(hole.x, hole.y, hole.w, hole.h, 0);
    mv.engine.commit();
  }, { hole: HOLE });
  before = await docState(page);
  await openWorkspace(page);
  await previewShows(page, "red");
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  await page.waitForFunction(() => (window as any).__cafErrors.some((m: string) => m.includes("sampling area is empty")));
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.locator("[data-mv-caf-workspace]")).toHaveCount(0);
  expect(await docState(page)).toEqual(before);
});
