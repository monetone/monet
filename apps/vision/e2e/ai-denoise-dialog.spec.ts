import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// The AI Denoise menu action now opens a dialog with an Amount slider (which
// blends the denoised result back toward the original) instead of running the
// model directly. This verifies the dialog wiring — it is CI-safe because it
// never runs the gitignored DRUNet model, only opens the dialog.
test("the AI Denoise dialog opens with an Amount control and Apply/Cancel", async ({ page }) => {
  await gotoApp(page);
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("AI Denoise…")),
    null, { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("AI Denoise…")).run());
  await expect(page.getByText(/blends the denoised result back toward the original/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply → New Layer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
});
