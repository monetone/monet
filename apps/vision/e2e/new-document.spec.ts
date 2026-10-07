import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop New Document presets ─────────────────────────────────
// File ▸ New offers preset document sizes that fill width/height. Vision adds a
// Preset dropdown to the New Document dialog (src/state/docPresets.ts) above the
// W/H fields.
//   https://helpx.adobe.com/photoshop/using/create-documents.html

/** Open the New Document dialog via the command palette (the File ▸ New action). */
async function openNewDialog(page: Page) {
  await gotoApp(page);
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp && cp.items && cp.items.some((i: any) => i.label.startsWith("File ▸ New"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.startsWith("File ▸ New")).run();
  });
  await expect(page.locator("#mv-doc-preset")).toBeVisible();
}

const dims = (page: Page): Promise<{ w: number; h: number }> =>
  page.evaluate(() => ({ w: (window as any).__mv.engine.engine.width(), h: (window as any).__mv.engine.engine.height() }));

test("the New dialog shows a Preset dropdown matching the default size", async ({ page }) => {
  await openNewDialog(page);
  // default fields are 1280×800 → the "Default" preset
  await expect(page.locator("#mv-doc-preset")).toContainText("Default");
});

test("choosing a preset creates a document of that size", async ({ page }) => {
  await openNewDialog(page);
  await page.locator("#mv-doc-preset").click(); // open the combobox
  await page.getByRole("option", { name: "Square 1080" }).click(); // 1080 × 1080
  await page.getByRole("button", { name: "Create" }).click();
  const d = await dims(page);
  expect(d.w).toBe(1080);
  expect(d.h).toBe(1080);
});

test("a different preset yields its dimensions", async ({ page }) => {
  await openNewDialog(page);
  await page.locator("#mv-doc-preset").click();
  await page.getByRole("option", { name: "Web 1920" }).click(); // 1920 × 1080
  await page.getByRole("button", { name: "Create" }).click();
  const d = await dims(page);
  expect(d.w).toBe(1920);
  expect(d.h).toBe(1080);
});

test("resolution and color mode are preset-owned document metadata", async ({ page }) => {
  await openNewDialog(page);
  await page.locator("#mv-doc-preset").click();
  await page.getByRole("option", { name: "A4 CMYK @300" }).click();
  await expect(page.getByRole("spinbutton", { name: "Resolution" })).toHaveValue("300");
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveValue("210.00");
  await expect(page.getByRole("spinbutton", { name: "Height" })).toHaveValue("297.00");
  await expect(page.getByRole("combobox", { name: "Units" })).toContainText("Millimeters");
  await expect(page.getByRole("radio", { name: "Portrait" })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Color Mode" })).toContainText("CMYK Color");
  await expect(page.getByRole("combobox", { name: "Color Profile" })).toHaveCount(0);

  await page.locator("#mv-doc-color-mode").click();
  await page.getByRole("option", { name: "RGB Color" }).click();
  await expect(page.getByRole("combobox", { name: "Color Profile" })).toContainText("sRGB IEC61966-2.1");
  await expect(page.locator("#mv-doc-preset")).toContainText("Custom");
  await page.locator("#mv-doc-color-mode").click();
  await page.getByRole("option", { name: "CMYK Color" }).click();
  await expect(page.getByRole("combobox", { name: "Color Profile" })).toHaveCount(0);
  await expect(page.locator("#mv-doc-preset")).toContainText("A4 CMYK @300");

  await page.locator("#mv-doc-units").click();
  await page.getByRole("option", { name: "Pixels" }).click();
  await page.getByRole("spinbutton", { name: "Width" }).fill("64");
  await page.getByRole("spinbutton", { name: "Width" }).press("Enter");
  await page.getByRole("spinbutton", { name: "Height" }).fill("48");
  await page.getByRole("spinbutton", { name: "Height" }).press("Enter");
  await expect(page.locator("#mv-doc-preset")).toContainText("Custom");
  await page.getByRole("button", { name: "Create" }).click();

  const lifecycle = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const state = () => [mv.store.state.resolutionPpi, mv.engine.engine.doc_mode()];
    const a = mv.store.state.activeDocId;
    const created = {
      state: state(),
      canUndo: mv.engine.engine.can_undo(),
      history: mv.store.state.history,
      dirty: mv.store.docDirty(a),
    };
    const saved = mv.store.saveProject();
    mv.store.markDirty();
    mv.store.markActiveSaved();

    mv.store.newDocument(32, 24, "Invalid mode defaults to RGB", "white", 1, { colorMode: 1.6 });
    const b = mv.store.state.activeDocId;
    const bState = state();
    mv.store.activateDoc(a);
    const aState = state();
    mv.store.activateDoc(b);
    const bAgain = state();
    mv.store.openProject(saved, "CMYK 300 ppi.mvision");
    const restored = { state: state(), canUndo: mv.engine.engine.can_undo() };
    return { created, aState, bState, bAgain, restored };
  });
  expect(lifecycle).toEqual({
    created: { state: [300, 2], canUndo: false, history: [], dirty: false },
    aState: [300, 2],
    bState: [72, 0],
    bAgain: [72, 0],
    restored: { state: [300, 2], canUndo: false },
  });

  await chooseOption(page.locator("#mv-status-info"), "profile");
  await expect(page.locator("[data-mv-status]")).toContainText("CMYK Color");
  await expect(page.locator("[data-mv-status]")).toContainText("No mode-specific profile");
  await page.evaluate(() => {
    const item = (window as any).__mv.commandPalette.items.find((entry: any) => entry.label.includes("File Info"));
    item.run();
  });
  await expect(page.locator('[data-mv-file-info-row="Resolution"]')).toContainText("300 ppi");
  await expect(page.locator('[data-mv-file-info-row="Color Mode"]')).toContainText("CMYK Color");
  await expect(page.locator('[data-mv-file-info-row="Profile"]')).toContainText("No mode-specific profile");
});

test("a built-in RGB profile is initial document state and survives its lifecycle", async ({ page }) => {
  await openNewDialog(page);
  await expect(page.getByRole("combobox", { name: "Color Profile" })).toContainText("sRGB IEC61966-2.1");
  await page.locator("#mv-doc-color-profile").click();
  await page.getByRole("option", { name: "Adobe RGB (1998)" }).click();
  await expect(page.locator("#mv-doc-preset")).toContainText("Custom");

  await page.getByRole("spinbutton", { name: "Width" }).fill("40");
  await page.getByRole("spinbutton", { name: "Width" }).press("Enter");
  await page.getByRole("spinbutton", { name: "Height" }).fill("32");
  await page.getByRole("spinbutton", { name: "Height" }).press("Enter");
  await page.getByRole("button", { name: "Create" }).click();

  const lifecycle = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const state = () => [mv.engine.engine.doc_profile(), mv.store.state.colorProfileAssigned];
    const a = mv.store.state.activeDocId;
    const created = {
      state: state(),
      canUndo: mv.engine.engine.can_undo(),
      history: mv.store.state.history,
      dirty: mv.store.docDirty(a),
    };
    const saved = mv.store.saveProject();
    mv.store.markDirty();
    mv.store.markActiveSaved();

    mv.store.newDocument(16, 12, "Invalid profile defaults to sRGB", "white", 1, { colorProfile: 99 });
    const b = mv.store.state.activeDocId;
    const bState = state();
    mv.store.activateDoc(a);
    const aState = state();
    mv.store.activateDoc(b);
    const bAgain = state();
    mv.store.openProject(saved, "Adobe RGB.mvision");
    const restored = { state: state(), canUndo: mv.engine.engine.can_undo() };
    return { created, aState, bState, bAgain, restored };
  });
  expect(lifecycle).toEqual({
    created: { state: [2, true], canUndo: false, history: [], dirty: false },
    aState: [2, true],
    bState: [0, true],
    bAgain: [0, true],
    restored: { state: [2, true], canUndo: false },
  });

  await chooseOption(page.locator("#mv-status-info"), "profile");
  await expect(page.locator("[data-mv-status]")).toContainText("Adobe RGB (1998)");
  await page.evaluate(() => {
    const item = (window as any).__mv.commandPalette.items.find((entry: any) => entry.label.includes("File Info"));
    item.run();
  });
  await expect(page.locator('[data-mv-file-info-row="Profile"]')).toContainText("Adobe RGB (1998)");
});

test("physical units and orientation create canonical pixels", async ({ page }) => {
  test.setTimeout(120_000);
  await openNewDialog(page);
  await expect(page.getByRole("radiogroup", { name: "Orientation" })).toBeVisible();
  await page.locator("#mv-doc-units").click();
  await page.getByRole("option", { name: "Inches" }).click();
  await page.getByRole("spinbutton", { name: "Resolution" }).fill("100");
  await page.getByRole("spinbutton", { name: "Resolution" }).press("Enter");
  await page.getByRole("spinbutton", { name: "Width" }).fill("2");
  await page.getByRole("spinbutton", { name: "Width" }).press("Enter");
  await page.getByRole("spinbutton", { name: "Height" }).fill("1");
  await page.getByRole("spinbutton", { name: "Height" }).press("Enter");
  await expect(page.locator("#mv-doc-preset")).toContainText("Custom");

  await page.getByRole("radio", { name: "Portrait" }).click();
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveValue("1.00");
  await expect(page.getByRole("spinbutton", { name: "Height" })).toHaveValue("2.00");
  await page.getByRole("radio", { name: "Landscape" }).click();
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveValue("2.00");
  await expect(page.getByRole("spinbutton", { name: "Height" })).toHaveValue("1.00");
  await page.getByRole("button", { name: "Create" }).click();

  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const engine = mv.engine.engine;
    return {
      size: [engine.width(), engine.height()],
      resolutionPpi: mv.store.state.resolutionPpi,
      canUndo: engine.can_undo(),
      history: mv.store.state.history,
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
    };
  });
  expect(result).toEqual({ size: [200, 100], resolutionPpi: 100, canUndo: false, history: [], dirty: false });
});

test("raising resolution visibly revalidates physical dimensions", async ({ page }) => {
  test.setTimeout(120_000);
  await openNewDialog(page);
  await page.locator("#mv-doc-units").click();
  await page.getByRole("option", { name: "Inches" }).click();
  await page.getByRole("spinbutton", { name: "Resolution" }).fill("600");
  await page.getByRole("spinbutton", { name: "Resolution" }).press("Enter");
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveValue("13.653");
  await expect(page.getByRole("spinbutton", { name: "Height" })).toHaveValue("11.111");
});

test("unit switching displays the canonical pixel size it creates", async ({ page }) => {
  test.setTimeout(120_000);
  await openNewDialog(page);
  await page.getByRole("spinbutton", { name: "Resolution" }).fill("300");
  await page.getByRole("spinbutton", { name: "Resolution" }).press("Enter");
  await page.getByRole("spinbutton", { name: "Width" }).fill("2");
  await page.getByRole("spinbutton", { name: "Width" }).press("Enter");
  await page.getByRole("spinbutton", { name: "Height" }).fill("1");
  await page.getByRole("spinbutton", { name: "Height" }).press("Enter");
  await page.locator("#mv-doc-units").click();
  await page.getByRole("option", { name: "Inches" }).click();
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveValue("0.007");
  await expect(page.getByRole("spinbutton", { name: "Height" })).toHaveValue("0.003");
  await page.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => page.evaluate(() => [(window as any).__mv.engine.engine.width(), (window as any).__mv.engine.engine.height()])).toEqual([2, 1]);
});

test("Grayscale converts the initial background without creating document history", async ({ page }) => {
  await openNewDialog(page);
  await page.evaluate(() => (window as any).__mv.store.setBackground({ h: 0, s: 1, v: 1, a: 1 }));
  await page.getByRole("spinbutton", { name: "Width" }).fill("32");
  await page.getByRole("spinbutton", { name: "Width" }).press("Enter");
  await page.getByRole("spinbutton", { name: "Height" }).fill("24");
  await page.getByRole("spinbutton", { name: "Height" }).press("Enter");
  await page.locator("#mv-doc-bg").click();
  await page.getByRole("option", { name: "Background Color" }).click();
  await page.getByRole("combobox", { name: "Color Mode" }).click();
  await page.locator(".monet-listbox").getByRole("option", { name: "Grayscale" }).click();
  await page.getByRole("button", { name: "Create" }).click();

  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const engine = mv.engine.engine;
    const packed = engine.pick_color(16, 12) >>> 0;
    return {
      color: [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255],
      mode: engine.doc_mode(),
      canUndo: engine.can_undo(),
      history: mv.store.state.history,
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
    };
  });
  expect(result.color[0]).toBe(result.color[1]);
  expect(result.color[1]).toBe(result.color[2]);
  expect(result.color[0]).toBeGreaterThan(20);
  expect(result.color[0]).toBeLessThan(100);
  expect(result.color[3]).toBe(255);
  expect(result).toMatchObject({ mode: 1, canUndo: false, history: [], dirty: false });
});
