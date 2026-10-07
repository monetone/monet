import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { gotoApp, newScene } from "./helpers";

// File ▸ Export ▸ WebP (Lossy): the Rust `image` crate only encodes LOSSLESS
// WebP, so lossy WebP goes through the bundled @jsquash/webp WASM encoder. The
// export is captured as a download and the RIFF/WEBP container is asserted, with
// a "VP8 " (space) chunk that marks a lossy bitstream (lossless is "VP8L").

test("exports a lossy WebP (RIFF/WEBP with a VP8 bitstream)", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 120, 90);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate(() => (window as any).__mv.exportWebPLossy("doc", 70)),
  ]);
  const bytes = readFileSync(await download.path());

  expect(bytes.length).toBeGreaterThan(0);
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
  // A lossy bitstream carries a "VP8 " chunk (trailing space) — present whether
  // the container is simple or VP8X-extended; a lossless file would carry "VP8L".
  expect(bytes.indexOf(Buffer.from("VP8 "))).toBeGreaterThanOrEqual(12);
  expect(bytes.indexOf(Buffer.from("VP8L"))).toBe(-1);
});

test("the WebP (Lossy) export item is wired in File ▸ Export", async ({ page }) => {
  await gotoApp(page);
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Export WebP (Lossy)…")),
    null, { timeout: 5000 },
  );
});
