import { test, expect } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// File ▸ Export ▸ HEIC: HEVC encode is patent-encumbered, so — like the HEIC
// open path — there is no wasm encoder; the composite is encoded by the macOS OS
// codec (ImageIO/HEVC) in the native `heic` Tauri plugin. That path is exercised
// on real hardware and by the Rust round-trip test; the browser build has no
// native codec, so here we assert the menu item is wired and that invoking the
// export degrades gracefully (a clean "requires the desktop app" message, no
// crash, no download) rather than a real encode.

test("the HEIC export item is wired in File ▸ Export", async ({ page }) => {
  await gotoApp(page);
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Export HEIC…")),
    null, { timeout: 5000 },
  );
});

test("HEIC export degrades gracefully in the browser build (desktop-only)", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 64, 48);

  let dialogMsg = "";
  page.on("dialog", (d) => { dialogMsg = d.message(); void d.dismiss(); });

  // Must resolve without throwing (the isTauri() guard returns early in-browser).
  await page.evaluate(() => (window as any).__mv.exportHEIC("doc", 80));
  await page.waitForTimeout(200);

  expect(dialogMsg.toLowerCase()).toContain("desktop");
});
