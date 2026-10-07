import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// #451: Text on Path used to be a one-shot create — the menu bound type to the
// work path once and could never re-bind it, and the Align/Flip/Spacing/
// start-end model the on-path layout already honoured had no control surface.
// This drives both new doors from the real menu bar, on the real app.

const PATH = [24, 140, 128, 48, 232, 140];

interface OnPathSpec {
  path?: number[]; pathAlign?: string; pathFlip?: boolean;
  pathSpacing?: number; pathStart?: number; pathEnd?: number;
}
const activeSpec = (page: Page): Promise<OnPathSpec> => page.evaluate(() => {
  const mv = (window as any).__mv;
  return mv.text.get(mv.store.state.activeLayerId);
});

/** Open Type ▸ Text on Path ▸ <item> from the live menu bar. */
async function textOnPath(page: Page, item: string) {
  await page.getByRole("menuitem", { name: "Type", exact: true }).click();
  await page.getByRole("menuitem", { name: "Text on Path", exact: true }).hover();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

async function setNumber(page: Page, label: string, value: string) {
  const field = page.getByRole("spinbutton", { name: label, exact: true });
  await field.fill(value);
  await field.press("Enter");
}

test("Text on Path re-binds an existing type layer and retunes it from the menu", async ({ page }) => {
  test.setTimeout(120_000); // cold swiftshader boot + real Canvas2D type layout
  await gotoApp(page);
  await newScene(page);

  // A plain type layer plus a work path drawn with the Pen tool.
  await page.evaluate((p) => {
    const mv = (window as any).__mv;
    mv.text.create(mv.text.defaultSpec("Ride the curve", { ax: 24, ay: 140, size: 24 }));
    mv.store.setPenPath(p);
  }, PATH);
  expect((await activeSpec(page)).path).toBeUndefined();

  await textOnPath(page, "Bind to Work Path");
  await expect.poll(async () => (await activeSpec(page)).path).toEqual(PATH);

  await textOnPath(page, "Type on a Path Options…");
  const align = page.getByRole("combobox", { name: "Align to path", exact: true });
  await expect(align).toBeVisible();
  await align.click();
  await page.getByRole("option", { name: "Center", exact: true }).click();
  await page.getByRole("checkbox", { name: "Flip across the path", exact: true }).click();
  await setNumber(page, "Spacing", "6");
  await setNumber(page, "Start", "20");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await expect.poll(async () => {
    const s = await activeSpec(page);
    return [s.pathAlign, s.pathFlip, s.pathSpacing, s.pathStart];
  }).toEqual(["center", true, 6, 20]);
});
