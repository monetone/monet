import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop Gradient presets (Gradients panel / preset picker) ───
// Adobe: the Gradient tool options bar has a preset picker of named gradients;
// clicking one loads it as the active gradient. Vision adds a preset dropdown that
// loads the preset's stops into the editable ramp (src/state/gradientPresets.ts).
//   https://helpx.adobe.com/photoshop/using/gradients.html

const DOCW = 200;
const DOCH = 160;

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "gradient-presets");
    mv.engine.commit();
    mv.store.setTool("gradient");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

const stops = (page: Page): Promise<{ pos: number; r: number; g: number; b: number; a: number }[]> =>
  page.evaluate(() => (window as any).__mv.store.state.gradientStops);
/** ARGB pick → {r,g,b}. */
const pick = (page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> =>
  page.evaluate(({ x, y }) => {
    const v = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return { r: (v >>> 16) & 255, g: (v >>> 8) & 255, b: v & 255 };
  }, { x, y });

test("the gradient tool shows a Preset dropdown defaulting to 'Black, White'", async ({ page }) => {
  await scene(page);
  await expect(page.locator("#mv-gradient-preset")).toBeVisible();
  await expect(page.locator("#mv-gradient-preset")).toHaveAttribute("data-value", "Black, White");
});

test("choosing 'White, Black' loads its stops (first stop white)", async ({ page }) => {
  await scene(page);
  await chooseOption(page.locator("#mv-gradient-preset"), "White, Black");
  const s = await stops(page);
  expect(s[0]).toMatchObject({ pos: 0, r: 255, g: 255, b: 255 });
  expect(s[s.length - 1]).toMatchObject({ pos: 1, r: 0, g: 0, b: 0 });
});

test("choosing 'Spectrum' loads a multi-stop ramp", async ({ page }) => {
  await scene(page);
  await chooseOption(page.locator("#mv-gradient-preset"), "Spectrum");
  expect((await stops(page)).length).toBeGreaterThan(2);
});

test("drawing after picking 'White, Black' renders light→dark left to right", async ({ page }) => {
  const m = await scene(page);
  await chooseOption(page.locator("#mv-gradient-preset"), "White, Black");
  await page.mouse.move(m.cx(10), m.cy(80));
  await page.mouse.down();
  await page.mouse.move(m.cx(100), m.cy(80));
  await page.mouse.move(m.cx(190), m.cy(80));
  await page.mouse.up();
  const left = await pick(page, 15, 80);
  const right = await pick(page, 185, 80);
  expect(left.r).toBeGreaterThan(200); // near-white start
  expect(right.r).toBeLessThan(60); // near-black end
});

// ── User gradient library: save / persist / restore (Photoshop keeps the
//    Gradients panel library across launches; Vision persists it to localStorage) ──

test("＋ Save adds the current ramp as a preset, shown in the picker and persisted", async ({ page }) => {
  await scene(page);
  // Load a distinctive ramp, then save it as a new preset.
  await chooseOption(page.locator("#mv-gradient-preset"), "White, Black");
  const countBefore = await page.evaluate(() => (window as any).__mv.store.state.gradientPresets.length);
  await page.locator("#mv-gradient-preset-save").click();
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const list = mv.store.state.gradientPresets;
    const persisted = JSON.parse(localStorage.getItem("mv.gradientPresets") || "null");
    return { count: list.length, lastName: list[list.length - 1].name, lastStops: list[list.length - 1].stops, persisted };
  });
  expect(r.count).toBe(countBefore + 1);
  expect(r.lastName).toBe("Gradient 1"); // auto-named
  expect(r.lastStops[0]).toMatchObject({ r: 255, g: 255, b: 255 }); // captured the White,Black ramp
  expect(r.persisted).toEqual(await page.evaluate(() => (window as any).__mv.store.state.gradientPresets)); // localStorage mirrors live
  // The saved preset is now selectable in the picker and reloads its stops.
  await chooseOption(page.locator("#mv-gradient-preset"), "Gradient 1");
  expect((await stops(page))[0]).toMatchObject({ r: 255, g: 255, b: 255 });
});

test("loadGradientPresets restores a saved library; a corrupt payload is ignored", async ({ page }) => {
  await scene(page);
  const restored = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const lib = [{ name: "Saved Ramp", stops: [{ pos: 0, r: 1, g: 2, b: 3, a: 255 }, { pos: 1, r: 4, g: 5, b: 6, a: 255 }] }];
    localStorage.setItem("mv.gradientPresets", JSON.stringify(lib));
    mv.store.set({ gradientPresets: [] });
    mv.store.loadGradientPresets();
    return mv.store.state.gradientPresets;
  });
  expect(restored).toEqual([{ name: "Saved Ramp", stops: [{ pos: 0, r: 1, g: 2, b: 3, a: 255 }, { pos: 1, r: 4, g: 5, b: 6, a: 255 }] }]);
  const kept = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const before = [...mv.store.state.gradientPresets];
    localStorage.setItem("mv.gradientPresets", "{ not json");
    mv.store.loadGradientPresets(); // must not throw, must not clobber
    return { before, after: mv.store.state.gradientPresets };
  });
  expect(kept.after).toEqual(kept.before);
});

test("Preset Manager reorders, renames and deletes gradient presets", async ({ page }) => {
  await scene(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const n = mv.store.state.gradientPresets.length;
    mv.store.renameGradientPreset(0, "  Renamed  "); // trimmed
    const renamed = mv.store.state.gradientPresets[0].name;
    mv.store.reorderGradientPreset(0, 1); // renamed preset moves to index 1
    const moved = mv.store.state.gradientPresets[1].name;
    mv.store.removeGradientPreset(mv.store.state.gradientPresets.length - 1); // drop last
    const persisted = JSON.parse(localStorage.getItem("mv.gradientPresets") || "[]");
    return { n, renamed, moved, count: mv.store.state.gradientPresets.length, persisted };
  });
  expect(r.renamed).toBe("Renamed");
  expect(r.moved).toBe("Renamed"); // rename survived the reorder
  expect(r.count).toBe(r.n - 1); // one deleted
  expect(r.persisted.length).toBe(r.count); // persisted through every mutation
});
