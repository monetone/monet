import { expect, test, type JSHandle, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gotoApp } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));

async function pngTransfer(
  page: Page,
  files: { name: string; width: number; height: number; color: string }[],
): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle(async (specs) => {
    const transfer = new DataTransfer();
    for (const spec of specs) {
      const canvas = document.createElement("canvas");
      canvas.width = spec.width;
      canvas.height = spec.height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = spec.color;
      context.fillRect(0, 0, spec.width, spec.height);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
      transfer.items.add(new File([blob], spec.name, { type: "image/png" }));
    }
    return transfer;
  }, files);
}

async function byteTransfer(page: Page, name: string, type: string, bytes: number[]): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle(({ name, type, bytes }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type }));
    return transfer;
  }, { name, type, bytes });
}

const state = (page: Page) => page.evaluate(() => {
  const mv = (window as any).__mv;
  const active = mv.store.state.documents.find((doc: { id: number }) => doc.id === mv.store.state.activeDocId);
  return {
    names: mv.store.state.documents.map((doc: { name: string }) => doc.name),
    active: active?.name,
    width: mv.engine.engine.width(),
    height: mv.engine.engine.height(),
    layers: mv.engine.engine.layer_count(),
  };
});

async function dispatchCanvasDrop(page: Page, type: "dragover" | "drop", transfer: JSHandle<DataTransfer>) {
  const canvas = page.locator(".mv-canvas-viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not visible");
  await canvas.dispatchEvent(type, {
    dataTransfer: transfer,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  });
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("dropping a PNG on the canvas shows feedback and auto-imports it", async ({ page }) => {
  const transfer = await pngTransfer(page, [
    { name: "canvas-drop.png", width: 37, height: 23, color: "#2868c7" },
  ]);

  const before = await state(page);
  const menubar = page.getByRole("menubar", { name: "Application menu" });
  const menuBox = await menubar.boundingBox();
  if (!menuBox) throw new Error("Menubar is not visible");
  await menubar.dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: menuBox.x + menuBox.width / 2,
    clientY: menuBox.y + menuBox.height / 2,
  });
  await expect.poll(() => state(page)).toEqual(before);

  await dispatchCanvasDrop(page, "dragover", transfer);
  await expect(page.getByRole("status")).toContainText("Drop files to import");

  await dispatchCanvasDrop(page, "drop", transfer);
  await expect(page.locator(".mv-dropzone")).toHaveCount(0);
  await expect.poll(() => state(page)).toEqual({
    names: ["canvas-drop.png"],
    active: "canvas-drop.png",
    width: 37,
    height: 23,
    layers: 1,
  });
  await transfer.dispose();
});

// #476 put a Home screen where the canvas used to always be, and the drop
// handlers still asked for `.mv-canvas-viewport` — so dragging a photo onto a
// freshly launched window did nothing at all, with no overlay and no error.
test("dropping a PNG on the Home screen opens it", async ({ page }) => {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    for (const doc of [...mv.store.state.documents]) mv.store.closeDoc(doc.id);
  });
  const home = page.locator("[data-mv-home-screen]");
  await expect(home).toBeVisible();
  const box = await home.boundingBox();
  if (!box) throw new Error("Home is not visible");
  const transfer = await pngTransfer(page, [
    { name: "home-drop.png", width: 33, height: 21, color: "#c78a28" },
  ]);
  const point = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };

  await home.dispatchEvent("dragover", { dataTransfer: transfer, ...point });
  await expect(page.getByRole("status")).toContainText("Drop files to import");

  await home.dispatchEvent("drop", { dataTransfer: transfer, ...point });

  await expect.poll(() => state(page)).toEqual({
    names: ["home-drop.png"],
    active: "home-drop.png",
    width: 33,
    height: 21,
    layers: 1,
  });
  await transfer.dispose();
});

test("one canvas drop auto-imports every file exactly once and in order", async ({ page }) => {
  const before = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const frame = mv.store.createFrame(4, 4, 20, 20);
    mv.engine.engine.set_active_layer(frame);
    mv.engine.commit();
    return { frame, activeFrame: mv.store.activeFrameId(), names: mv.store.state.documents.map((doc: { name: string }) => doc.name) };
  });
  expect(before.activeFrame).toBe(before.frame);
  const transfer = await pngTransfer(page, [
    { name: "first-drop.png", width: 31, height: 19, color: "#bd3147" },
    { name: "second-drop.png", width: 43, height: 29, color: "#287d49" },
  ]);

  await dispatchCanvasDrop(page, "drop", transfer);
  await expect.poll(() => state(page)).toEqual({
    names: [...before.names, "first-drop.png", "second-drop.png"],
    active: "second-drop.png",
    width: 43,
    height: 29,
    layers: 1,
  });
  await transfer.dispose();
});

test("the Document Browser owns its drop exactly once", async ({ page }) => {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Document Browser…", exact: true }).click();
  const browser = page.locator(".mv-docbrowser");
  await expect(browser).toBeVisible();
  const box = await browser.boundingBox();
  if (!box) throw new Error("Document Browser is not visible");
  const transfer = await pngTransfer(page, [
    { name: "browser-drop.png", width: 29, height: 17, color: "#8a4bb8" },
  ]);

  await browser.dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  });
  await expect.poll(() => state(page)).toEqual({
    names: ["browser-drop.png"],
    active: "browser-drop.png",
    width: 29,
    height: 17,
    layers: 1,
  });
  await transfer.dispose();
});

test("dropping a layered Photoshop file routes through the real PSD importer", async ({ page }) => {
  const bytes = Array.from(readFileSync(join(here, "../../../packages/monet-ui/crates/monet-format/test-assets/fixtures", "sample.psd")));
  const transfer = await byteTransfer(page, "dropped.psd", "image/vnd.adobe.photoshop", bytes);

  await dispatchCanvasDrop(page, "drop", transfer);
  await expect.poll(() => state(page)).toEqual({
    names: ["dropped.psd"],
    active: "dropped.psd",
    width: 16,
    height: 16,
    layers: 8,
  });
  await transfer.dispose();
});

test("awaits SVG decoding before opening the next dropped file", async ({ page }) => {
  const svg = Array.from(new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="41" height="27"><rect width="100%" height="100%" fill="#7159c1"/></svg>',
  ));
  const transfer = await page.evaluateHandle(async ({ svg }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(svg)], "first-drop.svg", { type: "image/svg+xml" }));
    const canvas = document.createElement("canvas");
    canvas.width = 53;
    canvas.height = 31;
    canvas.getContext("2d")!.fillRect(0, 0, 53, 31);
    const png = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    transfer.items.add(new File([png], "second-drop.png", { type: "image/png" }));
    return transfer;
  }, { svg });

  await dispatchCanvasDrop(page, "drop", transfer);
  await expect.poll(() => state(page)).toEqual({
    names: ["first-drop.svg", "second-drop.png"],
    active: "second-drop.png",
    width: 53,
    height: 31,
    layers: 1,
  });
  await transfer.dispose();
});
