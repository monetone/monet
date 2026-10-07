import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop-style toolbar groups (flyouts) ──────────────────────
// Adobe Photoshop collapses related tools into a single toolbar slot with a
// flyout (a corner triangle marks it): the slot shows the active/last-used tool,
// a click selects it, click-and-hold or right-click opens the flyout to pick a
// hidden sibling, and each slot remembers its last tool. Vision groups its tools
// the same way (src/App.tsx TOOLS) on top of the generic monet-ui ToolRail.

const tool = (page: Page): Promise<string> =>
  page.evaluate(() => (window as any).__mv.store.state.tool as string);

async function scene(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 160, "tool-groups");
    mv.engine.commit();
    mv.store.setTool("brush");
  });
  // The grouped rail is part of the editor chrome.
  await page.locator('[data-tool-group="grp-marquee"]').first().waitFor();
}

test("related tools collapse into flyout slots instead of one button each", async ({ page }) => {
  await scene(page);
  // The marquee family is a single flyout slot (triangle indicator present).
  const marquee = page.locator('[data-tool-group="grp-marquee"]');
  await expect(marquee).toHaveCount(1);
  await expect(marquee.locator(".monet-tool-flyout")).toHaveCount(1);

  // Hidden members (e.g. Ellipse Marquee) are NOT rendered as their own rail
  // buttons until the flyout opens — only the visible member is.
  expect(await page.locator('[data-tool="ellipse"]').count()).toBe(0);

  // Far fewer top-level slots than the ~33 flat tools we had before.
  const slots = await page.locator(".monet-tool").count();
  expect(slots).toBeLessThan(25);
  expect(slots).toBeGreaterThan(10);
});

test("right-click opens the flyout and selects a hidden tool; the slot then shows it", async ({ page }) => {
  await scene(page);
  const marquee = page.locator('[data-tool-group="grp-marquee"]');
  // Default visible member is the first child (Rectangle Marquee).
  await expect(marquee).toHaveAttribute("data-tool", "marquee");

  await marquee.click({ button: "right" });
  const ellipseItem = page.locator('[data-flyout-tool="ellipse"]');
  await expect(ellipseItem).toBeVisible();
  await ellipseItem.click();

  expect(await tool(page)).toBe("ellipse");
  // The slot remembers and shows the newly-picked tool.
  await expect(marquee).toHaveAttribute("data-tool", "ellipse");
});

test("a long press (click-and-hold) opens the flyout without selecting", async ({ page }) => {
  await scene(page);
  const eyedropper = page.locator('[data-tool-group="grp-eyedropper"]');
  await expect(eyedropper).toHaveAttribute("data-tool", "dropper");
  const box = await eyedropper.boundingBox();
  if (!box) throw new Error("no eyedropper slot box");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(450); // exceed the 350ms long-press dwell
  await expect(page.locator('[data-flyout-tool="ruler"]')).toBeVisible();
  await page.mouse.up();

  // Holding must not have selected the visible tool.
  expect(await tool(page)).toBe("brush");
  await page.locator('[data-flyout-tool="ruler"]').click();
  expect(await tool(page)).toBe("ruler");
});

test("Alt-click cycles through a group's tools", async ({ page }) => {
  await scene(page);
  const marquee = page.locator('[data-tool-group="grp-marquee"]');
  await marquee.click({ modifiers: ["Alt"] });
  // brush is not in this group → visible was the first child (marquee); cycling
  // advances to the next child.
  expect(await tool(page)).toBe("ellipse");
  await marquee.click({ modifiers: ["Alt"] });
  expect(await tool(page)).toBe("singlerow");
});

test("single-key shortcuts still select grouped tools and update the slot", async ({ page }) => {
  await scene(page);
  // Pick a hidden member via the flyout first…
  await page.locator('[data-tool-group="grp-marquee"]').click({ button: "right" });
  await page.locator('[data-flyout-tool="ellipse"]').click();
  expect(await tool(page)).toBe("ellipse");

  // …the M shortcut still selects the (rectangle) Marquee, and the slot reflects it.
  await page.keyboard.press("m");
  expect(await tool(page)).toBe("marquee");
  await expect(page.locator('[data-tool-group="grp-marquee"]')).toHaveAttribute("data-tool", "marquee");

  // A shortcut for a tool in another group drives that group's slot too.
  await page.keyboard.press("l");
  expect(await tool(page)).toBe("lasso");
  await expect(page.locator('[data-tool-group="grp-lasso"]')).toHaveAttribute("data-tool", "lasso");
});
