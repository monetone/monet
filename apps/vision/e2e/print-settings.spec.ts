import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── File ▸ Print… / Print One Copy (#440) ──
// File ▸ Print… opens Vision's Print Settings: a preview of the image on the
// media, Position and Size, and Color Management, whose settings decide the page
// CSS and the pixels spooled. Print One Copy reuses them without the dialog.
// The OS print dialog never opens here: the hidden print frame's print() is
// replaced as the frame is inserted, and records the job it would have printed.

interface PrintJob { css: string; w: number; h: number; center: number[] }

async function printDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    localStorage.setItem("mv.rulerUnit", "in"); // Top/Left and the print size read in inches
    const mv = (window as any).__mv;
    mv.store.newDocument(300, 200, "print"); // 72 ppi: 4.1667 × 2.7778 in
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(220, 40, 30, 255);
    E.select_none();
    mv.engine.commit();
    (window as any).__printJobs = [];
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof HTMLIFrameElement) || node.title !== "Monet Vision print") continue;
        node.contentWindow!.print = () => {
          const doc = node.contentDocument!;
          const img = doc.querySelector("img")!;
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          (window as any).__printJobs.push({
            css: doc.querySelector("style")!.textContent,
            w: canvas.width,
            h: canvas.height,
            center: Array.from(ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data),
          });
        };
      }
    }).observe(document.body, { childList: true });
  });
}

const jobs = (page: Page) => page.evaluate(() => (window as any).__printJobs as PrintJob[]);

async function fileMenu(page: Page, item: RegExp) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function pick(page: Page, id: string, option: string) {
  await page.locator(id).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function type(page: Page, id: string, value: string) {
  await page.locator(id).fill(value);
  await page.locator(id).press("Enter");
}

/** The preview image's box on the media, in inches. */
const previewBox = (page: Page) => page.evaluate(() => {
  const media = document.querySelector<HTMLElement>("[data-mv-print-media]")!;
  const image = document.querySelector<HTMLElement>("canvas[data-mv-print-preview]")!;
  const perInch = parseFloat(media.style.width) / 8.2677; // A4 portrait
  const at = (v: string) => Math.round(parseFloat(v) / perInch * 1000) / 1000;
  return { left: at(image.style.left), top: at(image.style.top), width: at(image.style.width), height: at(image.style.height) };
});

/** Which printer profile File ▸ Print… saved: the choice, its name and its bytes. */
const savedProfile = (page: Page) => page.evaluate(() => {
  const { profile, profileName, profileIcc } = JSON.parse(localStorage.getItem("mv.print")!);
  return { profile, profileName, profileIcc } as { profile: string; profileName: string; profileIcc: string };
});

const previewPixel = (page: Page) => page.evaluate(() => {
  const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-mv-print-preview]")!;
  return Array.from(canvas.getContext("2d")!.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data);
});

test("Print… settings drive the spooled page and pixels, and Print One Copy reuses them without the dialog", async ({ page }) => {
  await printDoc(page);

  // Never opened: Print One Copy prints the document's own pixels fit to Letter.
  await fileMenu(page, /^Print One Copy/);
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const [unmanaged] = await jobs(page);
  expect(unmanaged.css).toContain("@page{size:8.5in 11in;margin:0}");
  expect(unmanaged.css).toContain("width:8.5in;height:5.6667in");
  expect(unmanaged.center).toEqual([220, 40, 30, 255]);

  await fileMenu(page, /^Print…/);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Print Settings");
  await expect(page.locator("#mv-print-color-handling")).toContainText("Printer Manages Colors");

  // Position and Size: A4, 50%, 1 in down and 0.5 in across — the preview follows.
  await pick(page, "#mv-print-media", "A4");
  await page.locator("#mv-print-fit").click();
  await type(page, "#mv-print-scale", "50");
  await page.locator("#mv-print-center").click();
  await type(page, "#mv-print-top", "1");
  await type(page, "#mv-print-left", "0.5");
  await expect(page.locator("#mv-print-width")).toHaveValue("2.08");
  await expect(page.locator("[data-mv-print-resolution]")).toHaveText("Print Resolution: 144 PPI");
  expect(await previewBox(page)).toEqual({ left: 0.5, top: 1, width: 2.083, height: 1.389 });

  // Color Management: Photoshop manages colours through the press profile.
  await pick(page, "#mv-print-color-handling", "Photoshop Manages Colors");
  await expect(page.locator("#mv-print-profile")).toContainText("Working CMYK");
  const screen = [220, 40, 30, 255]; // an sRGB document previews its own numbers
  await expect.poll(() => previewPixel(page)).toEqual(screen);
  await page.locator("#mv-print-match").click();
  await expect(page.locator("canvas[data-mv-print-preview]")).toHaveAttribute("data-mv-print-preview", "proof");
  await expect.poll(() => previewPixel(page), "Match Print Colors soft-proofs the preview").not.toEqual(screen);
  const proofed = await previewPixel(page);
  await page.locator("#mv-print-paper-white").click();
  await expect(page.locator("canvas[data-mv-print-preview]")).toHaveAttribute("data-mv-print-preview", "paper");
  await expect.poll(() => previewPixel(page), "Show Paper White simulates the paper").not.toEqual(proofed);

  // A junk printer profile is refused with a reason; a real one is picked up.
  const loadProfile = async (name: string, buffer: Buffer) => {
    const chooser = page.waitForEvent("filechooser");
    await pick(page, "#mv-print-profile", "Load Profile…");
    await (await chooser).setFiles({ name, mimeType: "application/vnd.iccprofile", buffer });
  };
  await loadProfile("junk.icc", Buffer.alloc(200));
  await expect(page.locator("[data-mv-print-error]")).toContainText("not an ICC profile");
  const press = readFileSync(fileURLToPath(new URL("../public/profiles/ISOcoated_v2_300_eci.icc", import.meta.url)));
  await loadProfile("press.icc", press);
  // The bundled option reads "Working CMYK — ISO Coated v2 300% (ECI)" too, so
  // the name alone would pass had the load done nothing.
  await expect(page.locator("#mv-print-profile")).toContainText("ISO Coated v2 300% (ECI)");
  await expect(page.locator("#mv-print-profile")).not.toContainText("Working CMYK");
  await expect(page.locator("[data-mv-print-error]")).toHaveCount(0);
  await pick(page, "#mv-print-intent", "Perceptual");

  await page.getByRole("button", { name: "Print", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await jobs(page)).length).toBe(2);
  const managed = (await jobs(page))[1];
  expect(managed.css).toContain("@page{size:8.2677in 11.6929in;margin:0}");
  expect(managed.css).toContain("left:0.5in;top:1in;width:2.0833in;height:1.3889in");
  expect([managed.w, managed.h]).toEqual([300, 200]);
  expect(managed.center, "the press conversion reaches the spooled pixels").not.toEqual(unmanaged.center);
  expect(await savedProfile(page), "the loaded profile's own bytes are what was saved").toEqual(
    { profile: "icc", profileName: "ISO Coated v2 300% (ECI)", profileIcc: press.toString("base64") });

  // Print One Copy: the same job again, and no dialog.
  await fileMenu(page, /^Print One Copy/);
  await expect.poll(async () => (await jobs(page)).length).toBe(3);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await jobs(page))[2]).toEqual(managed);

  // …and after a reload, loaded profile included.
  await printDoc(page);
  expect((await savedProfile(page)).profileIcc, "the profile survived the reload, not the quota fallback").toBe(press.toString("base64"));
  await fileMenu(page, /^Print One Copy/);
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  expect((await jobs(page))[0]).toEqual(managed);
});

test("Print… reports settings that cannot print, and Cancel keeps nothing", async ({ page }) => {
  await printDoc(page);
  await fileMenu(page, /^Print…/);
  await page.locator("#mv-print-center").click();
  await type(page, "#mv-print-left", "20");
  await page.getByRole("button", { name: "Print", exact: true }).click();
  await expect(page.locator("[data-mv-print-error]")).toContainText("entirely off the page");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("[data-mv-print-error]")).toContainText("entirely off the page");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(await jobs(page)).toEqual([]);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("mv.print"))).toBeNull();

  // Done keeps the settings without printing; Print One Copy then uses them.
  await fileMenu(page, /^Print…/);
  await expect(page.locator("#mv-print-center")).toHaveAttribute("aria-checked", "true");
  await pick(page, "#mv-print-orientation", "Landscape");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await jobs(page)).toEqual([]);
  await fileMenu(page, /^Print One Copy/);
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  expect((await jobs(page))[0].css).toContain("@page{size:11in 8.5in;margin:0}");
});
