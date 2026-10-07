import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// ── Type ▸ Match Font ────────────────────────────────────────────
// v1 works on editable type layers: it ranks Vision's local type families
// against the active layer's current font stack, previews the best candidate,
// and applies the chosen family across every run. Raster text OCR/ML remains a
// separate Photoshop-parity follow-up.

async function runCommand(page: Page, label: string) {
  await page.waitForFunction((needle) => {
    const items = (window as any).__mv.commandPalette?.items ?? [];
    return items.some((i: any) => i.label.includes(needle));
  }, label, { timeout: 5000 });
  await page.evaluate((needle) => {
    const items = (window as any).__mv.commandPalette.items;
    items.find((i: any) => i.label.includes(needle)).run();
  }, label);
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 180, 120);
});

test("Match Font opens from the Type menu and asks for an editable type layer", async ({ page }) => {
  await runCommand(page, "Match Font");
  await expect(page.getByText("Match Font", { exact: true })).toBeVisible();
  await expect(page.getByText("Select an editable type layer.")).toBeVisible();
  await expect(page.getByRole("button", { name: "OK", exact: true })).toBeDisabled();
});

test("an external font stack defaults to the highest-ranked local candidate", async ({ page }) => {
  const id = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const spec = mv.text.defaultSpec("Match me", {
      ax: 24,
      ay: 52,
      font: "Futura, Helvetica, Arial, sans-serif",
      runs: [{ text: "Match ", font: "Futura, Helvetica, Arial, sans-serif" }, { text: "me", font: "Futura, Helvetica, Arial, sans-serif", italic: true }],
    });
    return mv.text.create(spec);
  });

  await runCommand(page, "Match Font");
  await expect(page.getByLabel("Matched font")).toBeVisible();
  await expect(page.getByLabel("Matched font")).toContainText("Helvetica");
  await expect(page.locator("[data-mv-match-font-confidence]")).toContainText("High - 76%");
  await expect(page.locator("[data-mv-match-font-preview]")).toContainText("Match me");
  await page.getByRole("button", { name: "OK", exact: true }).click();

  const result = await page.evaluate((tid) => {
    const mv = (window as any).__mv;
    const s = mv.text.get(tid);
    return { font: s.font, runs: s.runs.map((r: any) => r.font) };
  }, id);
  expect(result.font).toBe("Helvetica, Arial, sans-serif");
  expect(result.runs).toEqual(["Helvetica, Arial, sans-serif", "Helvetica, Arial, sans-serif"]);
});

test("choosing another matched candidate applies that font to the active type layer", async ({ page }) => {
  const id = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return mv.text.create(mv.text.defaultSpec("Mono please", { ax: 20, ay: 60, font: "Courier, monospace" }));
  });

  await runCommand(page, "Match Font");
  await page.getByLabel("Matched font").click();
  await page.getByRole("option", { name: /Menlo/ }).click();
  await expect(page.locator("[data-mv-match-font-confidence]")).toContainText("Low - 48%");
  await page.getByRole("button", { name: "OK", exact: true }).click();

  const font = await page.evaluate((tid) => (window as any).__mv.text.get(tid).font, id);
  expect(font).toBe("Menlo, Monaco, monospace");
});
