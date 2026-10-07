import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Photoshop status-bar configurable info readout ─────────────────
// Adobe: the status bar's info field has a 'Show' menu (Document Sizes, Document
// Dimensions, Document Profile, Current Tool, …). Vision adds a selector that
// switches the [data-mv-status] readout, formatted by src/state/statusInfo.ts.
//   https://helpx.adobe.com/photoshop/using/image-information.html
//   https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/measure-scale/manage-measurement-scales.html

/** Fresh 1000×1000 doc (RGB 8-bit). */
async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(1000, 1000, "status"));
}

const status = (page: Page) => page.locator("[data-mv-status]");

async function runExactCommand(page: Page, label: string) {
  await page.waitForFunction((exact) => (window as any).__mv.commandPalette?.items?.some(
    (item: any) => item.label === exact,
  ), label, { timeout: 5000 });
  await page.evaluate((exact) => (window as any).__mv.commandPalette.items.find(
    (item: any) => item.label === exact,
  ).run(), label);
}

async function openMeasurementScale(page: Page) {
  await runExactCommand(page, "Image ▸ Analysis ▸ Set Measurement Scale ▸ Custom…");
}

test("the status bar shows a configurable info readout defaulting to Document Sizes", async ({ page }) => {
  await scene(page);
  await expect(page.locator("#mv-status-info")).toBeVisible();
  await expect(page.locator("#mv-status-info")).toHaveAttribute("data-value", "sizes");
  // 1000*1000*3 bytes = 2.86M flattened
  await expect(status(page)).toContainText("2.86M");
});

test("the selector switches the readout between Dimensions / Profile / Tool", async ({ page }) => {
  await scene(page);
  await chooseOption(page.locator("#mv-status-info"), "dimensions");
  await expect(status(page)).toHaveText("1000 px × 1000 px");
  await chooseOption(page.locator("#mv-status-info"), "profile");
  await expect(status(page)).toHaveText("RGB Color / 8-bit / sRGB IEC61966-2.1");
  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await chooseOption(page.locator("#mv-status-info"), "tool");
  await expect(status(page)).toHaveText("Move");
});

test("Measurement Scale updates live and follows its document through save, reopen, and duplicate", async ({ page }) => {
  await scene(page);
  await chooseOption(page.locator("#mv-status-info"), "measurement");
  await expect(status(page)).toHaveText("1 px = 1 px");
  const before = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.markActiveSaved();
    return { history: mv.store.state.history.slice(), undoDepth: mv.engine.engine.undo_depth() };
  });

  await openMeasurementScale(page);
  await page.getByLabel("Pixel length").fill("50");
  await page.getByLabel("Logical length").fill("1");
  await page.getByLabel("Logical units").fill("microns");
  await page.getByRole("button", { name: "OK" }).click();
  await expect(status(page)).toHaveText("50 px = 1 microns");
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      scale: mv.store.state.measureScale,
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
      history: mv.store.state.history.slice(),
      undoDepth: mv.engine.engine.undo_depth(),
    };
  })).toEqual({ scale: { px: 50, units: 1, unit: "microns" }, dirty: true, ...before });

  const lifecycle = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const docA = mv.store.state.activeDocId;
    mv.store.newDocument(64, 64, "scale-default");
    const docB = mv.store.state.activeDocId;
    const fresh = { ...mv.store.state.measureScale };
    mv.store.activateDoc(docA);
    const returnedA = { ...mv.store.state.measureScale };
    mv.store.activateDoc(docB);
    const returnedB = { ...mv.store.state.measureScale };
    const saved = mv.store.saveProjectForDoc(docA);
    mv.store.openProject(saved, "scale-roundtrip.mvision");
    const reopened = { ...mv.store.state.measureScale };
    mv.store.duplicateDocument("scale-copy");
    const duplicate = { ...mv.store.state.measureScale };
    return { fresh, returnedA, returnedB, reopened, duplicate };
  });
  expect(lifecycle).toEqual({
    fresh: { px: 1, units: 1, unit: "px" },
    returnedA: { px: 50, units: 1, unit: "microns" },
    returnedB: { px: 1, units: 1, unit: "px" },
    reopened: { px: 50, units: 1, unit: "microns" },
    duplicate: { px: 50, units: 1, unit: "microns" },
  });
  await expect(status(page)).toHaveText("50 px = 1 microns");
});

test("named Measurement Scale presets save, reload, apply, and delete from the Photoshop submenu", async ({ page }) => {
  await scene(page);
  await chooseOption(page.locator("#mv-status-info"), "measurement");
  const before = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.markActiveSaved();
    return { history: mv.store.state.history.slice(), undoDepth: mv.engine.engine.undo_depth() };
  });

  await openMeasurementScale(page);
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("ruler");
  await page.locator("#mv-measure-scale-preset").click();
  await expect(page.locator("#mv-measure-scale-preset-listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#mv-measure-scale-preset-listbox")).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Measurement Scale" })).toBeVisible();
  await page.getByLabel("Pixel length").fill("50");
  await page.getByLabel("Logical length").fill("1");
  await page.getByLabel("Logical units").fill("microns");
  await page.getByRole("button", { name: "Save Preset", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Temporary");
  await page.getByLabel("Name", { exact: true }).press("Escape");
  await expect(page.getByLabel("Name", { exact: true })).toBeHidden();
  await expect(page.locator("#mv-measure-scale-preset")).toBeFocused();
  await page.getByRole("button", { name: "Save Preset", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Microscope");
  await page.getByLabel("Pixel length").fill("0");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.getByLabel("Logical units").press("Enter");
  await expect(page.getByRole("dialog", { name: "Measurement Scale" })).toBeVisible();
  await page.getByLabel("Pixel length").fill("50");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(await page.evaluate(() => ({
    live: (window as any).__mv.store.state.measureScalePresets,
    persisted: localStorage.getItem("mv.measureScalePresets"),
  }))).toEqual({ live: [], persisted: null });
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(status(page)).toHaveText("50 px = 1 microns");
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      scale: mv.store.state.measureScale,
      names: mv.store.state.measureScalePresets.map((preset: any) => preset.name),
      persisted: JSON.parse(localStorage.getItem("mv.measureScalePresets") || "[]"),
      history: mv.store.state.history.slice(),
      undoDepth: mv.engine.engine.undo_depth(),
    };
  })).toEqual({
    scale: { px: 50, units: 1, unit: "microns" },
    names: ["Microscope"],
    persisted: [{ name: "Microscope", px: 50, units: 1, unit: "microns" }],
    ...before,
  });

  await openMeasurementScale(page);
  await page.getByRole("button", { name: "Save Preset", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("microscope");
  await expect(page.getByText("Saving replaces the preset with this name.")).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Cancelled");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => ({
    live: (window as any).__mv.store.state.measureScalePresets.map((preset: any) => preset.name),
    persisted: JSON.parse(localStorage.getItem("mv.measureScalePresets") || "[]").map((preset: any) => preset.name),
  }))).toEqual({ live: ["Microscope"], persisted: ["Microscope"] });

  await page.reload();
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(64, 64, "preset target");
    mv.store.markActiveSaved();
  });
  await chooseOption(page.locator("#mv-status-info"), "measurement");
  await expect(status(page)).toHaveText("1 px = 1 px");
  await runExactCommand(page, "Image ▸ Analysis ▸ Set Measurement Scale ▸ Microscope");
  await expect(status(page)).toHaveText("50 px = 1 microns");
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
      history: mv.store.state.history,
      undoDepth: mv.engine.engine.undo_depth(),
    };
  })).toEqual({ dirty: true, history: [], undoDepth: 0 });

  await openMeasurementScale(page);
  await page.locator("#mv-measure-scale-preset").click();
  await page.getByRole("option", { name: "Microscope", exact: true }).click();
  await page.getByRole("button", { name: "Delete Preset", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.measureScalePresets.map(
    (preset: any) => preset.name,
  ))).toEqual(["Microscope"]);

  await openMeasurementScale(page);
  await page.locator("#mv-measure-scale-preset").click();
  await page.getByRole("option", { name: "Microscope", exact: true }).click();
  await page.getByRole("button", { name: "Delete Preset", exact: true }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForFunction(() => !(window as any).__mv.commandPalette.items.some(
    (item: any) => item.label.endsWith("Set Measurement Scale ▸ Microscope"),
  ));
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      scale: mv.store.state.measureScale,
      presets: mv.store.state.measureScalePresets,
      persisted: JSON.parse(localStorage.getItem("mv.measureScalePresets") || "[]"),
    };
  })).toEqual({ scale: { px: 50, units: 1, unit: "microns" }, presets: [], persisted: [] });
});

test("Revert restores the saved measurement scale without adding pixel history", async ({ page }) => {
  await scene(page);
  await chooseOption(page.locator("#mv-status-info"), "measurement");
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setMeasureScale(25, 1, "mm");
    const id = mv.store.state.activeDocId;
    const bytes = mv.store.docProjectBytes(id);
    const document = mv.store.docDocumentMeta(id);
    mv.store.setMeasureScale(5, 2, "km");
    mv.store.revertActiveDoc(mv.engine.buildProject(bytes), document);
    return {
      scale: mv.store.state.measureScale,
      dirty: mv.store.docDirty(id),
      history: mv.store.state.history,
      undoDepth: mv.engine.engine.undo_depth(),
    };
  });

  expect(result).toEqual({ scale: { px: 25, units: 1, unit: "mm" }, dirty: false, history: [], undoDepth: 0 });
  await expect(status(page)).toHaveText("25 px = 1 mm");
});
