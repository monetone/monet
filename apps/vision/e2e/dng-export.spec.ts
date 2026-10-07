import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { gotoApp, newScene } from "./helpers";

// File ▸ Export ▸ DNG: a minimal linear DNG (TIFF/EP) of the composite —
// little-endian "II", 16-bit LinearRaw samples, with the DNG-required tags. The
// export is captured as a download and its TIFF/DNG structure is asserted.

test("exports a linear DNG (little-endian TIFF with DNGVersion + LinearRaw)", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 40, 24);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate(() => (window as any).__mv.exportDNG("doc")),
  ]);
  const bytes = readFileSync(await download.path());

  // little-endian TIFF header
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("II");
  expect(bytes.readUInt16LE(2)).toBe(42);
  const ifd = bytes.readUInt32LE(4);
  const n = bytes.readUInt16LE(ifd);

  const tags = new Map<number, { type: number; count: number; off: number }>();
  for (let i = 0; i < n; i++) {
    const p = ifd + 2 + i * 12;
    tags.set(bytes.readUInt16LE(p), { type: bytes.readUInt16LE(p + 2), count: bytes.readUInt32LE(p + 4), off: p + 8 });
  }
  expect(tags.has(50706)).toBe(true); // DNGVersion
  expect(bytes.readUInt16LE(tags.get(262)!.off)).toBe(34892); // LinearRaw
  expect(bytes.readUInt32LE(tags.get(256)!.off)).toBe(40); // ImageWidth
  expect(bytes.readUInt32LE(tags.get(257)!.off)).toBe(24); // ImageLength
});

test("the DNG export item is wired in File ▸ Export", async ({ page }) => {
  await gotoApp(page);
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Export DNG…")),
    null, { timeout: 5000 },
  );
});
