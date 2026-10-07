import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { gotoApp, newScene } from "./helpers";

// File ▸ Export ▸ SVG (Document): unlike "Paths to Illustrator" (vector strokes
// only), this embeds the raster composite as a base64 <image> with the vector
// paths overlaid — a self-contained document SVG. The export is captured as a
// download and the SVG text is asserted (valid wrapper + embedded raster).

test("exports a self-contained document SVG with the composite embedded", async ({ page }) => {
  await gotoApp(page);
  const { w, h } = await newScene(page, 120, 90);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate(() => (window as any).__mv.exportDocumentSVG("doc.svg")),
  ]);
  const svg = readFileSync(await download.path(), "utf8");

  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  // The composite is embedded as a base64 PNG data URI at the document size.
  expect(svg).toContain("href=\"data:image/png;base64,");
  expect(svg).toContain(`width="${w}" height="${h}"`);
  // The <image> background precedes any vector <path> overlay.
  const img = svg.indexOf("<image");
  expect(img).toBeGreaterThan(0);
  const path = svg.indexOf("<path");
  if (path >= 0) expect(img).toBeLessThan(path);
});

test("the SVG (Document) export item is wired in File ▸ Export", async ({ page }) => {
  await gotoApp(page);
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Export SVG (Document)…")),
    null, { timeout: 5000 },
  );
});
