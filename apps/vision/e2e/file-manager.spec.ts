import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene } from "./helpers";

// ── multi-document file manager ────────────────────────────────
// Opening files creates document tabs; switching/closing/reordering operate on
// independent wasm Engine instances. Native dialogs aren't drivable headlessly,
// so (as the rest of the suite does) we drive the underlying store API + assert
// the real title-bar tab strip in the DOM.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

/** Open a solid-colour PNG of the given size as a new document tab. */
async function openPng(page: Page, name: string, w: number, h: number, color: string) {
  await page.evaluate(async ({ name, w, h, color }) => {
    const mv = (window as any).__mv;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const cx = c.getContext("2d")!; cx.fillStyle = color; cx.fillRect(0, 0, w, h);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    mv.store.openImage(new Uint8Array(await blob.arrayBuffer()), name);
  }, { name, w, h, color });
}

const docState = (page: Page) => page.evaluate(() => {
  const s = (window as any).__mv.store.state;
  // Home (#476) holds no document and no engine, so the engine reads are
  // conditional — asking it for a width there is what the old test crashed on.
  const engine = (window as any).__mv.engine.engine;
  return {
    names: s.documents.map((d: any) => d.name),
    dirty: s.documents.map((d: any) => d.dirty),
    activeName: s.documents.find((d: any) => d.id === s.activeDocId)?.name,
    activeWidth: engine ? engine.width() : null,
    count: s.documents.length,
  };
});

test("boots with a single document", async ({ page }) => {
  const s = await docState(page);
  expect(s.count).toBe(1);
  expect(s.names[0]).toBe("Untitled.psd");
  await expect(page.locator(".monet-doctab")).toHaveCount(1);
});

test("opening files adds document tabs (and replaces the pristine blank)", async ({ page }) => {
  await openPng(page, "a.png", 64, 48, "#a03050"); // replaces the untouched boot blank
  expect((await docState(page)).count).toBe(1);
  await openPng(page, "b.png", 80, 60, "#3050a0");
  await openPng(page, "c.png", 96, 72, "#30a050");
  const s = await docState(page);
  expect(s.names).toEqual(["a.png", "b.png", "c.png"]);
  expect(s.activeName).toBe("c.png"); // a freshly opened doc becomes active
  await expect(page.locator(".monet-doctab")).toHaveCount(3);
});

test("switching tabs swaps the active wasm document", async ({ page }) => {
  await openPng(page, "small.png", 100, 100, "#cc4040");
  await openPng(page, "big.png", 240, 160, "#4040cc");
  const ids = await page.evaluate(() => (window as any).__mv.store.state.documents.map((d: any) => d.id));

  await page.evaluate((id) => (window as any).__mv.store.activateDoc(id), ids[0]);
  expect((await docState(page)).activeWidth).toBe(100);

  await page.evaluate((id) => (window as any).__mv.store.activateDoc(id), ids[1]);
  expect((await docState(page)).activeWidth).toBe(240);

  // Clicking the first tab in the real title bar switches the active document.
  await page.locator(".monet-doctab").first().click();
  const afterClick = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return s.activeDocId === s.documents[0].id;
  });
  expect(afterClick).toBe(true);
});

test("editing marks the document dirty; the tab shows '*'; saving clears it", async ({ page }) => {
  await newScene(page, 160, 120); // fills + commits → dirty
  let s = await docState(page);
  expect(s.dirty[0]).toBe(true);
  await expect(page.locator(".monet-doctab.is-modified")).toHaveCount(1);

  await page.evaluate(() => (window as any).__mv.store.markActiveSaved());
  s = await docState(page);
  expect(s.dirty[0]).toBe(false);
  await expect(page.locator(".monet-doctab.is-modified")).toHaveCount(0);
});

test("closeDocumentTab keeps normal dirty-document discard confirmation", async ({ page }) => {
  await newScene(page, 160, 120); // dirty normal document
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const prompts: string[] = [];
    const originalConfirm = window.confirm;
    try {
      window.confirm = (msg?: string) => { prompts.push(String(msg)); return false; };
      const id = mv.store.state.activeDocId;
      const canceled = await mv.closeDocumentTab(id);
      const countAfterCancel = mv.store.state.documents.length;
      const dirtyAfterCancel = mv.store.state.documents.find((d: { id: number }) => d.id === id)?.dirty;

      let step = 0;
      window.confirm = (msg?: string) => { prompts.push(String(msg)); return ++step === 2; };
      const closed = await mv.closeDocumentTab(id);
      return {
        prompts,
        canceled,
        countAfterCancel,
        dirtyAfterCancel,
        closed,
        names: mv.store.state.documents.map((d: { name: string }) => d.name),
        countAfterClose: mv.store.state.documents.length,
      };
    } finally {
      window.confirm = originalConfirm;
    }
  });
  expect(r.canceled).toBe(false);
  expect(r.countAfterCancel).toBe(1);
  expect(r.dirtyAfterCancel).toBe(true);
  expect(r.closed).toBe(true);
  // Closing the last document lands on Home rather than fabricating a blank
  // "Untitled.psd" — that is what #476 changed.
  expect(r.countAfterClose).toBe(0);
  expect(r.names).toEqual([]);
  await expect(page.locator("[data-mv-home-screen]")).toBeVisible();
  expect(r.prompts).toEqual([
    expect.stringContaining("Save changes"),
    expect.stringContaining("Close without saving?"),
    expect.stringContaining("Save changes"),
    expect.stringContaining("Close without saving?"),
  ]);
});

test("closing a document removes its tab and activates a neighbour", async ({ page }) => {
  await openPng(page, "a.png", 64, 64, "#a03050");
  await openPng(page, "b.png", 64, 64, "#3050a0");
  await openPng(page, "c.png", 64, 64, "#30a050");

  // Close the active (c) — the previous tab becomes active.
  await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    (window as any).__mv.store.closeDoc(s.activeDocId);
  });
  let s = await docState(page);
  expect(s.names).toEqual(["a.png", "b.png"]);
  expect(s.activeName).toBe("b.png");
  await expect(page.locator(".monet-doctab")).toHaveCount(2);

  // Close down to the last — the workspace gives way to Home (#476) instead of
  // fabricating a blank document to stand in for the one that was closed.
  await page.evaluate(() => {
    const ids = (window as any).__mv.store.state.documents.map((d: any) => d.id);
    for (const id of ids) (window as any).__mv.store.closeDoc(id);
  });
  s = await docState(page);
  expect(s.count).toBe(0);
  expect(s.activeWidth, "no document means no engine").toBeNull();
  await expect(page.locator("[data-mv-home-screen]")).toBeVisible();
  await expect(page.locator(".monet-doctab")).toHaveCount(0);
});

test("reordering tabs updates the document order", async ({ page }) => {
  await openPng(page, "a.png", 64, 64, "#a03050");
  await openPng(page, "b.png", 64, 64, "#3050a0");
  await openPng(page, "c.png", 64, 64, "#30a050");

  await page.evaluate(() => (window as any).__mv.store.reorderDocs(["c.png", "a.png", "b.png"]));
  expect((await docState(page)).names).toEqual(["c.png", "a.png", "b.png"]);
});

test("switching documents preserves each document's own zoom/pan", async ({ page }) => {
  await openPng(page, "A.png", 256, 192, "#a03050");
  await page.evaluate(() => (window as any).__mv.store.setZoom(2, 100, 50)); // custom view on A
  await openPng(page, "B.png", 128, 128, "#3050a0"); // different size → B fits; A's view is captured

  const a = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const A = mv.store.state.documents.find((d: any) => d.name === "A.png");
    mv.store.activateDoc(A.id);
    const s = mv.store.state;
    return { w: mv.engine.engine.width(), zoom: s.zoom, panX: s.panX, panY: s.panY };
  });
  expect(a.w).toBe(256);            // really switched back to A (256×192)
  expect(a.zoom).toBeCloseTo(2, 5); // ...and A's zoom/pan were restored, not re-fit
  expect(a.panX).toBe(100);
  expect(a.panY).toBe(50);
});

test("the document browser lists every open document with a thumbnail", async ({ page }) => {
  await openPng(page, "one.png", 120, 90, "#a03050");
  await openPng(page, "two.png", 60, 40, "#3050a0");
  const cards = await page.evaluate(() => (window as any).__mv.store.docCards());
  expect(cards.map((c: any) => c.name)).toEqual(["one.png", "two.png"]);
  expect(cards.filter((c: any) => c.active).length).toBe(1);
  for (const c of cards) {
    expect(c.thumb.startsWith("data:image/")).toBe(true);
    expect(c.width).toBeGreaterThan(0);
    expect(c.height).toBeGreaterThan(0);
  }
});
