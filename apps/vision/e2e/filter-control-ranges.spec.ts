import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// Current Adobe ranges:
// Motion Blur — Angle -360°..360°, Distance 1..999px.
// Unsharp Mask — Amount 1..500%, Radius 0.1..250px, Threshold 0..255.

async function clickMenuItem(page: Page, label: string) {
  await page.getByText("Filter", { exact: true }).first().click();
  await page.waitForTimeout(100);
  const ok = await page.evaluate(async (wanted) => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const text = (e: Element) => ((e.querySelector(".monet-menu-label") as HTMLElement | null)?.textContent || "").trim();
    const visit = async (seen: Set<Element>): Promise<boolean> => {
      const leaf = [...document.querySelectorAll(".monet-menu-item")]
        .find((e) => e.getAttribute("aria-haspopup") !== "menu" && text(e) === wanted) as HTMLElement | undefined;
      if (leaf) { leaf.click(); return true; }
      for (const item of [...document.querySelectorAll('.monet-menu-item[aria-haspopup="menu"]')]) {
        if (seen.has(item)) continue;
        seen.add(item);
        item.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
        item.dispatchEvent(new PointerEvent("pointerenter"));
        await sleep(40);
        if (await visit(seen)) return true;
      }
      return false;
    };
    return visit(new Set());
  }, label);
  expect(ok).toBe(true);
  await page.waitForTimeout(150);
}

async function tinyDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(8, 8, "ranges"));
}

async function expectEnds(row: ReturnType<Page["locator"]>, low: string, high: string) {
  await row.getByRole("slider").press("Home");
  await expect(row).toContainText(low);
  await row.getByRole("slider").press("End");
  await expect(row).toContainText(high);
}

test("Motion Blur exposes Adobe's full angle and distance ranges", async ({ page }) => {
  await tinyDoc(page);
  await clickMenuItem(page, "Motion Blur…");
  await expectEnds(page.locator(".monet-row").filter({ hasText: "Angle" }).first(), "-360°", "360°");
  await expectEnds(page.locator(".monet-row").filter({ hasText: "Distance" }).first(), "1px", "999px");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("Unsharp Mask exposes Adobe's full amount, radius, and threshold ranges", async ({ page }) => {
  await tinyDoc(page);
  await clickMenuItem(page, "Unsharp Mask…");
  await expectEnds(page.locator(".monet-row").filter({ hasText: "Radius" }).first(), "0.1px", "250.0px");
  await expectEnds(page.locator(".monet-row").filter({ hasText: "Amount" }).first(), "1%", "500%");
  await expectEnds(page.locator(".monet-row").filter({ hasText: "Threshold" }).first(), "0", "255");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
