import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("dragging a layer thumbnail exposes the exact trimmed PNG without editing the document", async ({ page }) => {
  const setup = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(12, 10, "drag-out", "transparent");
    const E = mv.engine.engine;
    const exported = E.add_layer("Hero / glow");
    E.set_active_layer(exported);
    E.select_rect(3, 2, 4, 5, 0);
    E.fill_selection(24, 132, 230, 255);
    E.select_none();
    const other = E.add_layer("Selected");
    E.set_active_layer(other);
    mv.engine.commit();
    mv.store.markActiveSaved();
    return {
      exported,
      expected: Array.from(E.export_layer_png_trimmed(exported) as Uint8Array),
      state: {
        active: E.active_layer_id(),
        order: Array.from({ length: E.layer_count() }, (_, index) => E.layer_id_at(index)),
        history: E.history_current(),
        dirty: mv.store.docDirty(mv.store.state.activeDocId),
        documents: mv.store.state.documents.map((document: { name: string }) => document.name),
      },
    };
  });
  const transfer = await page.evaluateHandle(() => new DataTransfer());

  await page.locator(`[data-mv-layer-export-drag="${setup.exported}"]`).dispatchEvent("dragstart", {
    dataTransfer: transfer,
  });

  const file = await transfer.evaluate(async (dataTransfer) => {
    const png = dataTransfer.files[0];
    return {
      count: dataTransfer.files.length,
      name: png?.name,
      type: png?.type,
      bytes: png ? Array.from(new Uint8Array(await png.arrayBuffer())) : [],
    };
  });
  expect(file).toEqual({
    count: 1,
    name: "Hero_glow.png",
    type: "image/png",
    bytes: setup.expected,
  });
  expect(file.bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    return {
      active: E.active_layer_id(),
      order: Array.from({ length: E.layer_count() }, (_, index) => E.layer_id_at(index)),
      history: E.history_current(),
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
      documents: mv.store.state.documents.map((document: { name: string }) => document.name),
    };
  })).toEqual(setup.state);
  await transfer.dispose();
});

test("dragging the rest of a layer row still reorders without creating a file", async ({ page }) => {
  const { source, target, before } = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(8, 8, "reorder");
    const E = mv.engine.engine;
    const target = E.active_layer_id();
    const source = E.add_layer("Move me");
    mv.engine.commit();
    return {
      source,
      target,
      before: Array.from({ length: E.layer_count() }, (_, index) => E.layer_id_at(index)),
    };
  });
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const sourceRow = page.locator(`[data-mv-layer-drag="${source}"]`);
  const targetRow = page.locator(`[data-mv-layer-drag="${target}"]`);
  const targetBox = await targetRow.boundingBox();
  if (!targetBox) throw new Error("Target layer row is not visible");

  await sourceRow.dispatchEvent("dragstart", { dataTransfer: transfer });
  await targetRow.dispatchEvent("dragover", {
    dataTransfer: transfer,
    clientY: targetBox.y + targetBox.height - 1,
  });
  await targetRow.dispatchEvent("drop", {
    dataTransfer: transfer,
    clientY: targetBox.y + targetBox.height - 1,
  });
  await sourceRow.dispatchEvent("dragend", { dataTransfer: transfer });

  expect(await transfer.evaluate((dataTransfer) => ({
    files: dataTransfer.files.length,
    layer: dataTransfer.getData("text/plain"),
  }))).toEqual({ files: 0, layer: String(source) });
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    return {
      order: Array.from({ length: E.layer_count() }, (_, index) => E.layer_id_at(index)),
      documents: mv.store.state.documents.map((document: { name: string }) => document.name),
    };
  })).toEqual({ order: [...before].reverse(), documents: ["reorder"] });
  await transfer.dispose();
});

// The export is a synchronous engine call made while building the drag, so a
// throw there used to escape the promise handler entirely — no toast, and the
// exception surfaced through React instead.
test("a failing layer export reports a toast instead of throwing through the panel", async ({ page }) => {
  const id = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(8, 8, "export-failure");
    const E = mv.engine.engine;
    const layer = E.add_layer("Broken");
    mv.engine.commit();
    E.export_layer_png_trimmed = () => { throw new Error("layer has no pixels"); };
    return layer;
  });
  const transfer = await page.evaluateHandle(() => new DataTransfer());

  await page.locator(`[data-mv-layer-export-drag="${id}"]`).dispatchEvent("dragstart", {
    dataTransfer: transfer,
  });

  const errorToast = page.locator(".monet-toast--error");
  await expect(errorToast).toBeVisible();
  await expect(errorToast).toContainText("layer has no pixels");
  // The row survives the failure and no half-built drag payload is left behind.
  await expect(page.locator(`[data-mv-layer-export-drag="${id}"]`)).toBeVisible();
  expect(await transfer.evaluate((dataTransfer) => dataTransfer.files.length)).toBe(0);
  await transfer.dispose();
});
