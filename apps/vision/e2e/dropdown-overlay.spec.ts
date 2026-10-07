import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Dropdowns are Monet Selects, rendered above everything ─────────
// Every single-choice dropdown is the Monet <Select>, whose listbox renders
// through the overlay portal (#monet-overlay-root) with fixed positioning — so
// no panel's overflow or dialog's stacking context can clip or cover it.

/** Open the Select `sel` and prove its popup escapes a clipping ancestor: it is
 *  portalled, fully on screen, and its last option is the topmost hit. */
async function expectListboxOnTop(page: Page, sel: string) {
  await page.locator(sel).click();
  const list = page.locator(".monet-listbox");
  await expect(list).toBeVisible();
  await list.getByRole("option").last().scrollIntoViewIfNeeded();
  const r = await page.evaluate((sel) => {
    const clips = (el: Element | null): boolean => {
      for (let p = el?.parentElement; p; p = p.parentElement) {
        if (getComputedStyle(p).overflow !== "visible") return true;
      }
      return false;
    };
    const list = document.querySelector(".monet-listbox")!;
    const opts = list.querySelectorAll('[role="option"]');
    const last = opts[opts.length - 1];
    const lr = list.getBoundingClientRect();
    const or = last.getBoundingClientRect();
    const hit = document.elementFromPoint(or.left + or.width / 2, or.top + or.height / 2);
    return {
      triggerClipped: clips(document.querySelector(sel)),
      portalled: !!list.closest("#monet-overlay-root"),
      inViewport: lr.left >= 0 && lr.top >= 0 && lr.right <= innerWidth && lr.bottom <= innerHeight,
      lastOptionOnTop: !!hit && last.contains(hit),
    };
  }, sel);
  expect(r).toEqual({ triggerClipped: true, portalled: true, inViewport: true, lastOptionOnTop: true });
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
}

async function runCommand(page: Page, label: string) {
  await page.waitForFunction(
    (label) => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.includes(label)),
    label,
    { timeout: 5000 },
  );
  await page.evaluate((label) => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes(label)).run(), label);
}

test("a panel's Select opens above its clipping panel", async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-tab-id="histogram"]').click();
  await expectListboxOnTop(page, "#mv-hist-channel");
});

test("the window has no native single-choice dropdowns, dialogs included", async ({ page }) => {
  await gotoApp(page);
  const native = page.locator("select:not([multiple])");
  await expect(native).toHaveCount(0);
  for (const [command, field] of [
    ["New ▸ Layer…", "#mv-newlayer-mode"],
    ["Image ▸ Image Size", "#mv-imgsize-unit"],
    ["Edit ▸ Fill…", "#mv-fill-contents"],
  ]) {
    await runCommand(page, command);
    await expect(page.locator(field)).toBeVisible();
    await expect(native).toHaveCount(0);
    await expectListboxOnTop(page, field); // a dialog's Select also opens above the dialog
    await page.keyboard.press("Escape");
    await expect(page.locator(field)).toHaveCount(0);
  }
});
