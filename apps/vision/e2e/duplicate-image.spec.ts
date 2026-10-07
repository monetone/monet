import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Image ▸ Duplicate ────────────────────────────────────
// Adobe spec (helpx "Duplicate an image"): Image ▸ Duplicate makes an exact
// independent copy of the whole document in a new window/tab (named "<name>
// copy"), optionally "Duplicate Merged Layers Only" (flattened). Editing the
// copy doesn't affect the original. The app had a multi-doc system but no
// Duplicate command.
//
//   https://helpx.adobe.com/photoshop/using/duplicating-images.html

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isRed = (p: number[]) => p[0] > 180 && p[2] < 90;
const isBlue = (p: number[]) => p[2] > 180 && p[0] < 90;
const docCount = (page: Page) => page.evaluate(() => (window as any).__mv.store.state.documents.length);
const activeId = (page: Page) => page.evaluate(() => (window as any).__mv.store.state.activeDocId);
const docNames = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__mv.store.state.documents.map((d: any) => d.name));
const layerCount = (page: Page) => page.evaluate(() => (window as any).__mv.engine.engine.layer_count());

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

// white doc with a red square [10,30)×[10,30).
async function redSquareDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(60, 60, "orig");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(10, 10, 20, 20, 0); E.fill_selection(220, 20, 20, 255); E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: the copy is identical and a new tab ───────────────
test("duplicate opens an identical copy in a new tab", async ({ page }) => {
  await redSquareDoc(page);
  const origId = await activeId(page);
  const before = await docCount(page);
  await page.evaluate(() => (window as any).__mv.store.duplicateDocument());
  expect(await docCount(page)).toBe(before + 1); // a new tab
  expect(await activeId(page)).not.toBe(origId);  // the copy is now active
  expect(isRed(await pixel(page, 20, 20))).toBe(true); // identical content
  expect((await docNames(page)).some((n) => n.includes("copy"))).toBe(true);
});

// ── Integration: the copy is independent of the original ───────────
test("editing the copy does not affect the original", async ({ page }) => {
  await redSquareDoc(page);
  const origId = await activeId(page);
  await page.evaluate(() => (window as any).__mv.store.duplicateDocument());
  // paint blue on the COPY (now active)
  await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    E.select_rect(40, 40, 10, 10, 0); E.fill_selection(0, 0, 255, 255); E.select_none();
    (window as any).__mv.engine.commit();
  });
  expect(isBlue(await pixel(page, 44, 44))).toBe(true); // present on the copy
  // switch back to the original
  await page.evaluate((id) => (window as any).__mv.store.activateDoc(id), origId);
  expect(isBlue(await pixel(page, 44, 44))).toBe(false); // original untouched there
  expect(isRed(await pixel(page, 20, 20))).toBe(true);   // original still has its red
});

// ── Mouse + UI: Image ▸ Duplicate… dialog with a name ──────────────
test("the Image ▸ Duplicate… dialog OK creates the named copy", async ({ page }) => {
  await redSquareDoc(page);
  const before = await docCount(page);
  await openMenu(page, "Image");
  expect(await clickMenuItem(page, "Duplicate…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("textbox", { name: "Duplicate name" }).fill("MyCopy");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await docCount(page)).toBe(before + 1);
  expect((await docNames(page)).includes("MyCopy")).toBe(true);
});

// ── Integration: Duplicate Merged Layers Only flattens ─────────────
test("duplicate merged only flattens the copy", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "multi");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(0, 0, 230, 255); E.select_none(); // base
    E.add_layer("top"); E.select_rect(5, 5, 10, 10, 0); E.fill_selection(220, 20, 20, 255); E.select_none();
    mv.engine.commit();
  });
  expect(await layerCount(page)).toBe(2);
  await page.evaluate(() => (window as any).__mv.store.duplicateDocument("flat", true));
  expect(await layerCount(page)).toBe(1); // the active copy is flattened
  expect((await docNames(page)).includes("flat")).toBe(true);
});
