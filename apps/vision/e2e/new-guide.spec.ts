import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop View ▸ New Guide… dialog ─────────────────────────────
// Adobe: View ▸ New Guide… opens a dialog with Orientation (Horizontal / Vertical)
// + a Position field, then adds a single guide there. Vision replaces the old
// hardwired "vertical at centre" stub with this dialog, backed by the pure
// clamp/default helpers in src/state/newGuide.ts.
//   https://helpx.adobe.com/photoshop/using/grid-guides.html

async function showNewGuideDialog(page: Page) {
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("New Guide…"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.includes("New Guide…")).run();
  });
  await expect(page.locator("#mv-newguide-pos")).toBeVisible();
}

async function showNewGuideLayoutDialog(page: Page) {
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("New Guide Layout…"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.includes("New Guide Layout…")).run();
  });
  await expect(page.locator("#mv-guide-layout-cols")).toBeVisible();
}

/** Fresh 400×300 doc, New Guide dialog open. */
async function openNewGuide(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(400, 300, "guide"));
  await showNewGuideDialog(page);
}

/** The store's guide list. */
const guides = (page: Page): Promise<{ o: string; p: number; color: string }[]> =>
  page.evaluate(() => (window as any).__mv.store.state.guides);

async function setPos(page: Page, v: number) {
  await page.locator("#mv-newguide-pos").fill(String(v));
  await page.locator("#mv-newguide-pos").press("Enter");
}

test("View ▸ New Guide… opens a dialog with Orientation + Position", async ({ page }) => {
  await openNewGuide(page);
  await expect(page.getByRole("radio", { name: "Horizontal" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Vertical" })).toBeVisible();
  await expect(page.locator("#mv-newguide-pos")).toBeVisible();
  await expect(page.getByLabel("Guide color")).toHaveValue("#33aaff");
});

test("a Horizontal guide is added at the typed position and renders", async ({ page }) => {
  await openNewGuide(page);
  await setPos(page, 100);
  await page.getByRole("button", { name: "OK" }).click();
  expect(await guides(page)).toContainEqual({ o: "h", p: 100, color: "#33aaff" });
  await expect(page.locator('[data-mv-guide="h"]')).toHaveCount(1);
});

test("a Vertical guide is added at the typed position and renders", async ({ page }) => {
  await openNewGuide(page);
  await page.getByRole("radio", { name: "Vertical" }).click();
  await setPos(page, 250);
  await page.getByRole("button", { name: "OK" }).click();
  expect(await guides(page)).toContainEqual({ o: "v", p: 250, color: "#33aaff" });
  await expect(page.locator('[data-mv-guide="v"]')).toHaveCount(1);
});

test("an out-of-range position clamps to the document bound", async ({ page }) => {
  await openNewGuide(page); // default Horizontal on a 300-tall doc
  await setPos(page, 9999);
  await page.getByRole("button", { name: "OK" }).click();
  const g = await guides(page);
  expect(g).toHaveLength(1);
  expect(g[0]).toEqual({ o: "h", p: 300, color: "#33aaff" }); // clamped to docH
});

test("Position accepts percentages and resolution-aware physical units", async ({ page }) => {
  await openNewGuide(page);
  await page.locator("#mv-newguide-pos").fill("12 bananas");
  await expect(page.getByRole("button", { name: "OK" })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("px, %, in, cm");

  await page.locator("#mv-newguide-pos").fill("50%");
  await page.getByRole("button", { name: "OK" }).click();
  await showNewGuideDialog(page);
  await page.getByRole("radio", { name: "Vertical" }).click();
  await page.locator("#mv-newguide-pos").fill("1 in");
  await page.getByRole("button", { name: "OK" }).click();
  await showNewGuideDialog(page);
  await page.getByRole("radio", { name: "Vertical" }).click();
  await page.locator("#mv-newguide-pos").fill("2.54 cm");
  await page.getByRole("button", { name: "OK" }).click();

  expect(await guides(page)).toEqual([
    { o: "h", p: 150, color: "#33aaff" },
    { o: "v", p: 72, color: "#33aaff" },
    { o: "v", p: 72, color: "#33aaff" },
  ]);
});

test("colored guides are per-document metadata and persist through .mvision save/open", async ({ page }) => {
  await openNewGuide(page);
  await page.evaluate(() => (window as any).__mv.store.markActiveSaved());
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return mv.store.docDirty(mv.store.state.activeDocId);
  })).toBe(false);

  await setPos(page, 60);
  await page.getByLabel("Guide color").fill("#ff0000");
  await page.getByRole("button", { name: "OK" }).click();
  await showNewGuideDialog(page);
  await page.getByRole("radio", { name: "Vertical" }).click();
  await setPos(page, 80);
  await page.getByLabel("Guide color").fill("#0000ff");
  await page.getByRole("button", { name: "OK" }).click();

  const expected = [
    { o: "h", p: 60, color: "#ff0000" },
    { o: "v", p: 80, color: "#0000ff" },
  ];
  expect(await guides(page)).toEqual(expected);
  await expect(page.locator('[data-mv-guide="h"]')).toHaveAttribute("stroke", "#ff0000");
  await expect(page.locator('[data-mv-guide="v"]')).toHaveAttribute("stroke", "#0000ff");

  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const docA = mv.store.state.activeDocId;
    const dirtyAfterGuides = mv.store.docDirty(docA);
    mv.store.newDocument(120, 90, "guide-b");
    const docB = mv.store.state.activeDocId;
    const guidesInNewDoc = mv.store.state.guides.slice();
    mv.store.activateDoc(docA);
    const guidesAfterReturn = mv.store.state.guides.slice();
    mv.store.activateDoc(docB);
    const guidesAfterSecondReturn = mv.store.state.guides.slice();
    mv.store.activateDoc(docA);
    const saved = mv.store.saveProject();
    mv.store.openProject(saved, "guides-roundtrip.mvision");
    return {
      dirtyAfterGuides,
      guidesInNewDoc,
      guidesAfterReturn,
      guidesAfterSecondReturn,
      restored: mv.store.state.guides.slice(),
    };
  });

  expect(result).toEqual({
    dirtyAfterGuides: true,
    guidesInNewDoc: [],
    guidesAfterReturn: expected,
    guidesAfterSecondReturn: [],
    restored: expected,
  });
});

test("a geometry change preserves an off-canvas guide identically through reopen", async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(800, 600, "guide-geometry");
    mv.store.addGuide("v", 700, "#00aa00");
    mv.xform.resizeCanvas(400, 300, 0, 0);
    const afterResize = mv.store.state.guides.slice();
    const saved = mv.store.saveProject();
    mv.store.openProject(saved, "guide-geometry-roundtrip.mvision");
    return { afterResize, reopened: mv.store.state.guides.slice() };
  });

  expect(result).toEqual({
    afterResize: [{ o: "v", p: 700, color: "#00aa00" }],
    reopened: [{ o: "v", p: 700, color: "#00aa00" }],
  });
});

test("New Guide Layout preserves existing guides unless Clear Existing Guides is selected", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(800, 300, "guide-layout");
    mv.store.addGuide("v", 700, "#ff0000");
    mv.xform.resizeCanvas(400, 300, 0, 0);
    mv.store.markActiveSaved();
    mv.store.setOptions({ showGuides: false });
  });

  await showNewGuideLayoutDialog(page);
  await expect(page.getByRole("spinbutton", { name: "Columns" })).toHaveValue("3");
  await expect(page.getByRole("spinbutton", { name: "Rows" })).toHaveValue("3");
  await expect(page.getByLabel("Guide layout color")).toHaveValue("#33aaff");
  await expect(page.getByRole("checkbox", { name: "Clear Existing Guides" })).not.toBeChecked();
  await page.getByLabel("Guide layout color").fill("#00aa00");
  await page.getByRole("button", { name: "OK" }).click();

  const layout = (color: string) => [
    { o: "v", p: 133, color },
    { o: "v", p: 267, color },
    { o: "h", p: 100, color },
    { o: "h", p: 200, color },
  ];
  expect(await guides(page)).toEqual([{ o: "v", p: 700, color: "#ff0000" }, ...layout("#00aa00")]);
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return { dirty: mv.store.docDirty(mv.store.state.activeDocId), showGuides: mv.store.state.showGuides };
  })).toEqual({ dirty: true, showGuides: true });

  await page.evaluate(() => (window as any).__mv.store.markActiveSaved());
  await showNewGuideLayoutDialog(page);
  await page.getByRole("checkbox", { name: "Clear Existing Guides" }).click();
  await page.getByLabel("Guide layout color").fill("#0000ff");
  await page.getByRole("button", { name: "OK" }).click();
  expect(await guides(page)).toEqual(layout("#0000ff"));

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.markActiveSaved();
    mv.store.setOptions({ showGuides: false });
  });
  await showNewGuideLayoutDialog(page);
  await page.getByRole("checkbox", { name: "Clear Existing Guides" }).click();
  await page.getByLabel("Guide layout color").fill("#ff00ff");
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await guides(page)).toEqual(layout("#0000ff"));
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return { dirty: mv.store.docDirty(mv.store.state.activeDocId), showGuides: mv.store.state.showGuides };
  })).toEqual({ dirty: false, showGuides: false });
});
