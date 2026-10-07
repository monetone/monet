import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── menu-triggered ML jobs surface errors via toast ────────────
// Generative Fill / Select Subject / Remove Background are fire-and-forget menu
// actions. They previously routed every failure — including the "make a
// selection" precondition thrown by generativeFillML — to console.error with no
// user-visible signal, and a double-click started two jobs on one engine. They
// now run through runMl(): a toast for progress/result and an in-flight lock.
// (See review Quality H1 / TC5.) The no-selection path rejects before any model
// load, so this is fast and deterministic.

test("Generative Fill from the menu with no selection shows an error toast (not a silent console.error)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await gotoApp(page);
  await page.waitForFunction(() => (window as unknown as { __mv: any }).__mv?.macMenu?.currentMenuTree?.().length === 8);

  // The fresh default document has no selection → generativeFillML rejects with
  // "Make a selection to fill first." Find the wired menu leaf and dispatch it.
  const id = await page.evaluate(() => {
    const out: { id: string; text: string }[] = [];
    const walk = (n: any) => {
      if (n.kind === "submenu") n.items.forEach(walk);
      else if (n.kind === "item") out.push({ id: n.id, text: n.text });
    };
    (window as unknown as { __mv: any }).__mv.macMenu.currentMenuTree().forEach(walk);
    return out.find((i) => /Generative Fill.*MI-GAN/i.test(i.text))?.id;
  });
  expect(id).toBeTruthy();

  await page.evaluate((mid) => (window as unknown as { __mv: any }).__mv.macMenu.dispatchMenuAction(mid), id);

  const errorToast = page.locator(".monet-toast--error");
  await expect(errorToast).toBeVisible();
  await expect(errorToast).toContainText(/make a selection/i);
  // The failure is surfaced to the user, not swallowed to the console.
  expect(consoleErrors.join("\n")).not.toMatch(/make a selection/i);
});
