import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// End-to-end HEIC *import* — the graceful-unsupported browser path only.
// HEIC decodes through the macOS OS codec in the native `heic` Tauri plugin
// (ImageIO), so the actual decode runs in native Rust and is gated by a cargo
// test in src-tauri — NO Playwright test can observe it (playwright.config.ts:
// "Playwright can't drive the native WKWebView on macOS"; the `desktop` project
// runs Chromium against vite preview and never reaches a Tauri command). Here we
// only assert what the webview CAN observe: in the browser (no Tauri) opening a
// .heic surfaces a clean "requires the desktop app" message and creates no
// document. Native end-to-end verification is manual `pnpm tauri dev`.

test("HEIC open in the browser shows a desktop-required message and creates no document", async ({ page }) => {
  await gotoApp(page);
  let dialogMsg = "";
  page.on("dialog", (d) => {
    dialogMsg = d.message();
    void d.dismiss();
  });
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const before = mv.store.state.documents.length;
    // Bytes are irrelevant — the browser build has no native codec, so openHeic
    // must reject before touching them.
    await mv.openHeic(new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4]), "IMG_0001.heic");
    return { added: mv.store.state.documents.length - before };
  });
  expect(r.added).toBe(0);
  expect(dialogMsg).toMatch(/desktop app/i);
});
