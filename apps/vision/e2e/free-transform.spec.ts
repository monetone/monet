import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Edit ▸ Free Transform (⌘T) ───────────────────────────
// Adobe spec (helpx "Transform objects"): Free Transform scales, rotates and
// moves the active layer; the options bar takes numeric Width/Height %, angle
// and position. The engine had `transform_layer` but it was wired to no menu,
// dialog or ⌘T shortcut — this exposes it.
//
//   https://helpx.adobe.com/photoshop/using/transforming-objects.html

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isRed = async (page: Page, x: number, y: number) => { const p = await pixel(page, x, y); return p[0] > 180 && p[2] < 90; };

async function openMenu(page: Page, top: string) {
  await page.getByText(top, { exact: true }).first().click();
  await page.waitForTimeout(150);
}
async function clickMenuItem(page: Page, label: string) {
  const ok = await page.evaluate(async (label) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const labelOf = (e: Element) => (((e.querySelector(".monet-menu-label") || {}) as HTMLElement).textContent || "").trim();
    const findLeaf = () => [...document.querySelectorAll(".monet-menu-item")]
      .find((e) => e.getAttribute("aria-haspopup") !== "menu" && labelOf(e) === label) as HTMLElement | undefined;
    const openSub = (e: Element) => {
      e.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      e.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
    };
    const seen = new Set<Element>();
    const visit = async (): Promise<boolean> => {
      const hit = findLeaf();
      if (hit) { hit.click(); return true; }
      for (const s of [...document.querySelectorAll('.monet-menu-item[aria-haspopup="menu"]')]) {
        if (seen.has(s)) continue;
        seen.add(s);
        openSub(s);
        await sleep(45);
        if (await visit()) return true;
      }
      return false;
    };
    return await visit();
  }, label);
  await page.waitForTimeout(120);
  return ok;
}

// white base + a red square [10,30)×[10,30) on a top (active) layer.
async function squareDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "ft");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.add_layer("top");
    E.select_rect(10, 10, 20, 20, 0); E.fill_selection(220, 20, 20, 255); E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: scale shrinks the active layer ────────────────────
test("transformLayer scales the active layer around the centre", async ({ page }) => {
  await squareDoc(page);
  await page.evaluate(() => (window as any).__mv.xform.transformLayer(0.5, 0.5, 0, 0, 0));
  expect(await isRed(page, 20, 20)).toBe(true);  // centre still red
  expect(await isRed(page, 12, 20)).toBe(false); // edge vacated (shrunk to [15,25))
});

// ── Mouse + UI: the Free Transform dialog Width/Height fields ──────
test("the Free Transform dialog scales by the Width/Height percent", async ({ page }) => {
  await squareDoc(page);
  await openMenu(page, "Edit");
  expect(await clickMenuItem(page, "Free Transform…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Width" }).fill("50");
  await page.getByRole("spinbutton", { name: "Height" }).fill("50");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await isRed(page, 20, 20)).toBe(true);
  expect(await isRed(page, 12, 20)).toBe(false); // shrunk
});

// ── Mouse + UI: the Move field translates ──────────────────────────
test("the Free Transform dialog moves the layer by Move X", async ({ page }) => {
  await squareDoc(page);
  await openMenu(page, "Edit");
  expect(await clickMenuItem(page, "Free Transform…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("spinbutton", { name: "Move X" }).fill("12");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await isRed(page, 30, 20)).toBe(true);  // square moved right → [22,42)
  expect(await isRed(page, 15, 20)).toBe(false); // old left vacated
});

// ── Keyboard: ⌘T opens Free Transform ──────────────────────────────
test("⌘T opens the Free Transform dialog", async ({ page }) => {
  await squareDoc(page);
  await page.keyboard.press("Meta+KeyT");
  await expect(page.getByText("Free Transform", { exact: true })).toBeVisible();
});
