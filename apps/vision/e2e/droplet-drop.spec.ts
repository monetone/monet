import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gotoApp } from "./helpers";

// ── Droplets dropped on the window (#469) ─────────────────────
// A droplet descriptor (File ▸ Automate ▸ Create Droplet) dropped together
// with images runs the droplet's batch over them, with progress and a summary,
// instead of opening them as documents: each image is closed once its output
// is written. JSON that is not a droplet opens (or is reported) like any
// other file.

const INVERTED = [55, 215, 225]; // the solid (200, 40, 30) sources, inverted
const DROPLET = JSON.stringify({ actionName: "Invert", format: "png", template: "{name}_web", stopOnError: false });

type Drop = { name: string; json?: string };

/** Drop solid 16×16 (200, 40, 30) PNGs and any JSON files on the canvas. */
async function dropOnCanvas(page: Page, files: Drop[]) {
  const transfer = await page.evaluateHandle(async (specs) => {
    const transfer = new DataTransfer();
    for (const spec of specs) {
      if (spec.json !== undefined) {
        transfer.items.add(new File([spec.json], spec.name, { type: "application/json" }));
        continue;
      }
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "rgb(200, 40, 30)";
      context.fillRect(0, 0, 16, 16);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
      transfer.items.add(new File([blob], spec.name, { type: "image/png" }));
    }
    return transfer;
  }, files);
  const canvas = page.locator(".mv-canvas-viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not visible");
  await canvas.dispatchEvent("drop", { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await transfer.dispose();
}

const docNames = (page: Page) => page.evaluate(() =>
  (window as any).__mv.store.state.documents.map((doc: { name: string }) => doc.name) as string[]);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.actions.start();
    mv.adj.invert();
    mv.actions.stop();
    mv.actions.save("Invert");
  });
});

test("a droplet dropped with images runs its batch over them, with progress and a summary", async ({ page }) => {
  const downloads: { name: string; bytes: number[] }[] = [];
  page.on("download", async (d) => downloads.push({ name: d.suggestedFilename(), bytes: [...readFileSync((await d.path())!)] }));
  await page.evaluate(() => {
    const w = window as any;
    w.__dropletStatus = [];
    new MutationObserver(() => {
      const text = document.getElementById("mv-droplet-progress")?.textContent ?? "";
      if (text && text !== w.__dropletStatus.at(-1)) w.__dropletStatus.push(text);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const before = await docNames(page);

  await dropOnCanvas(page, [{ name: "a.png" }, { name: "Web.json", json: DROPLET }, { name: "b.png" }]);

  const dialog = page.getByRole("dialog", { name: "Droplet — Web" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("Processed 2 of 2: a.png, b.png", { timeout: 30_000 });
  expect(await page.evaluate(() => (window as any).__dropletStatus)).toEqual(expect.arrayContaining(["1 of 2 — a.png", "2 of 2 — b.png"]));
  await expect.poll(() => downloads.map((d) => d.name).sort()).toEqual(["a_web.png", "b_web.png"]);
  // The droplet's action ran on each image, and none of them is left open.
  const pixels = await page.evaluate(async (files) => Promise.all(files.map(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return [...context.getImageData(8, 8, 1, 1).data.slice(0, 3)];
  })), downloads.map((d) => d.bytes));
  expect(pixels).toEqual([INVERTED, INVERTED]);
  expect(await docNames(page)).toEqual(before);

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("the same drop without a droplet opens every file, JSON included", async ({ page }) => {
  const prompts: string[] = [];
  page.on("dialog", (d) => { prompts.push(d.message()); void d.dismiss(); });
  await dropOnCanvas(page, [{ name: "a.png" }, { name: "package.json", json: JSON.stringify({ name: "x", format: "png" }) }]);
  await expect.poll(() => docNames(page)).toContain("a.png");
  // Not a droplet, and not an image either: reported, never dropped silently.
  await expect.poll(() => prompts.join("\n")).toContain("Could not open “package.json”");
  await expect(page.getByRole("dialog", { name: /^Droplet/ })).toHaveCount(0);
});
