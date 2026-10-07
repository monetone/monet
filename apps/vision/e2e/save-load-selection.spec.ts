import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Select ▸ Save Selection / Load Selection ─────────────
// Adobe spec (helpx "Save and load selections"): a selection can be saved as an
// alpha channel and loaded again later, combining with the current selection via
// Replace / Add / Subtract / Intersect. The app had no saved selections.
//
//   https://helpx.adobe.com/photoshop/using/saving-selections-masks.html

// fill the current selection green and commit (to read the selection back).
async function fillGreen(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.fill_selection(0, 255, 0, 255);
    mv.engine.commit();
  });
}
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}
const isGreen = (p: number[]) => p[1] > 200 && p[0] < 60 && p[2] < 60;

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

async function freshDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "ssel");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(255, 255, 255, 255); // white canvas
    E.select_none();
    mv.engine.commit();
  });
}

// ── Integration: save, deselect, load restores the selection ───────
test("a saved selection can be loaded back after deselecting", async ({ page }) => {
  await freshDoc(page);
  await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    E.select_rect(5, 5, 10, 10, 0); // a 10×10 marquee
  });
  await page.evaluate(() => (window as any).__mv.store.saveSelection("box"));
  await page.evaluate(() => (window as any).__mv.engine.engine.select_none());
  await page.evaluate(() => (window as any).__mv.store.loadSelection("box", 0)); // Replace
  await fillGreen(page);
  expect(isGreen(await pixel(page, 8, 8))).toBe(true);   // inside the restored selection
  expect(isGreen(await pixel(page, 30, 30))).toBe(false); // outside is untouched (white)
});

// ── Integration: Load with Add unions the selections ───────────────
test("loading a saved selection with Add unions it with the current one", async ({ page }) => {
  await freshDoc(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.select_rect(0, 0, 10, 40, 0); // left strip
    mv.store.saveSelection("left");
    mv.engine.engine.select_rect(30, 0, 10, 40, 0); // right strip (replace)
    mv.store.loadSelection("left", 1); // Add → both strips
  });
  await fillGreen(page);
  expect(isGreen(await pixel(page, 5, 20))).toBe(true);  // loaded left strip
  expect(isGreen(await pixel(page, 35, 20))).toBe(true); // current right strip
  expect(isGreen(await pixel(page, 20, 20))).toBe(false); // gap between them stays white
});

// ── Channels ▸ Duplicate Channel copies a plane to a loadable alpha channel ──
// Adobe spec (helpx "Duplicate, split, and merge channels"): a channel can be
// duplicated to a new alpha channel. Vision now maps the RGB composite planes.
//   https://helpx.adobe.com/photoshop/using/duplicate-split-merge-channels.html
test("Duplicate Channel copies a document channel into a loadable alpha channel", async ({ page }) => {
  await freshDoc(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(255, 0, 0, 255);  // left half red
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(0, 0, 255, 255); // right half blue
    E.select_none();
    mv.engine.commit();
    mv.store.duplicateChannel(1, "Red copy"); // duplicate the Red channel → alpha
  });
  const names = await page.evaluate(() => (window as any).__mv.store.savedSelectionNames());
  expect(names).toContain("Red copy");
  // Loading the Red alpha channel selects the red half (R=255); the blue half (R=0) is excluded.
  await page.evaluate(() => (window as any).__mv.store.loadSelection("Red copy", 0));
  await fillGreen(page);
  expect(isGreen(await pixel(page, 8, 20))).toBe(true);   // red plane selected → painted green
  expect(isGreen(await pixel(page, 32, 20))).toBe(false); // blue region excluded
});

// ── Channels ▸ Split Channels opens one grayscale doc per RGB channel ──
test("Split Channels opens one grayscale document per RGB channel", async ({ page }) => {
  await freshDoc(page); // document named "ssel"
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(255, 0, 0, 255);  // left red
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(0, 0, 255, 255); // right blue
    E.select_none(); mv.engine.commit();
  });
  const before = await page.evaluate(() => (window as any).__mv.store.docs.length);
  await page.evaluate(() => (window as any).__mv.store.splitChannels());
  const after = await page.evaluate(() => ({
    count: (window as any).__mv.store.docs.length,
    names: (window as any).__mv.store.docs.map((d: any) => d.name),
  }));
  expect(after.count).toBe(before + 3);
  expect(after.names.some((n: string) => n.endsWith("_Red"))).toBe(true);
  expect(after.names.some((n: string) => n.endsWith("_Green"))).toBe(true);
  expect(after.names.some((n: string) => n.endsWith("_Blue"))).toBe(true);
});

// ── Channels ▸ Merge Channels rebuilds an RGB doc from a Split set ──
test("Merge Channels rebuilds an RGB document from a Split set", async ({ page }) => {
  await freshDoc(page); // document named "ssel"
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(200, 100, 50, 255);
    E.select_none(); mv.engine.commit();
  });
  await page.evaluate(() => (window as any).__mv.store.splitChannels());
  const before = await page.evaluate(() => (window as any).__mv.store.docs.length);
  const merged = await page.evaluate(() => (window as any).__mv.store.mergeChannels());
  const after = await page.evaluate(() => ({
    count: (window as any).__mv.store.docs.length,
    names: (window as any).__mv.store.docs.map((d: any) => d.name),
  }));
  expect(merged).toBe(true);
  expect(after.count).toBe(before + 1);
  expect(after.names.some((n: string) => n.endsWith("_Merged"))).toBe(true);
});

// ── Channels ▸ New Spot Channel overprints a tinted plate + lists it ──
test("New Spot Channel adds a tinted plate to the panel and composite", async ({ page }) => {
  await freshDoc(page); // document named "ssel"
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(255, 255, 255, 255); // white
    E.select_rect(0, 0, 20, 40, 0); // left-half selection = the plate's coverage
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red ink
  });
  const before = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine; E.composite(); return E.pick_color(0, 0);
  });
  await page.evaluate(() => (window as any).__mv.store.newSpotChannel());
  const after = await page.evaluate(() => {
    const mv = (window as any).__mv; const E = mv.engine.engine; E.composite();
    return { spots: mv.store.state.spotChannelNames, px: E.pick_color(0, 0) };
  });
  expect(after.spots).toEqual(["Spot 1"]);
  expect(after.px).not.toBe(before); // the ink plate overprints the composite

  const reopened = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const saved = mv.store.saveProject();
    mv.store.openProject(saved, "spot-roundtrip.mvision");
    const E = mv.engine.engine; E.composite();
    return { spots: mv.store.state.spotChannelNames, left: E.pick_color(0, 0), right: E.pick_color(39, 0) };
  });
  expect(reopened.spots).toEqual(["Spot 1"]);
  expect(reopened.left).toBe(after.px);
  expect(reopened.right).toBe(before);
});

// ── Object Selection selects the distinct object inside a drawn box ──
test("Object Selection selects the distinct object in a box", async ({ page }) => {
  await freshDoc(page); // 40×40 document
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(255, 255, 255, 255); // white background
    E.select_rect(15, 15, 10, 10, 0); E.fill_selection(255, 0, 0, 255); // a red square
    E.select_none(); mv.engine.commit();
    mv.store.setTool("objectselection");
    mv.store.selectObject(10, 10, 20, 20); // box around the square
    const m = E.get_selection_mask();
    return { center: m[20 * 40 + 20], bg: m[11 * 40 + 11], tool: mv.store.state.tool };
  });
  expect(r.tool).toBe("objectselection");
  expect(r.center).toBeGreaterThan(0); // the object is selected
  expect(r.bg).toBe(0); // the background inside the box is not
});

// ── Select ▸ Select and Mask applies the global edge refinements ──
test("Select and Mask shifts the selection edge", async ({ page }) => {
  await freshDoc(page); // 40×40 document
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(10, 10, 20, 20, 0);
    mv.engine.commit();
    const before = E.get_selection_mask()[20 * 40 + 8]; // a pixel just outside
    mv.store.selectAndMask({ radius: 0, smartRadius: false, smooth: 0, feather: 0, contrast: 0, shift: 3 }, new Uint8Array(40 * 40));
    const after = E.get_selection_mask()[20 * 40 + 8];
    return { before, after };
  });
  expect(r.before).toBe(0);
  expect(r.after).toBeGreaterThan(0);
});

// ── Select and Mask ▸ Refine Edge softens a soft image edge into a matte ──
test("Select and Mask Refine Edge adds partial alpha in the band", async ({ page }) => {
  await freshDoc(page); // 40×40 document
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    // dark backdrop, bright block, with a soft 3-column luminance ramp at the edge
    E.select_rect(0, 0, 40, 40, 0);
    E.fill_selection(40, 40, 40, 255);
    E.select_rect(16, 0, 12, 40, 0);
    E.fill_selection(235, 235, 235, 255);
    for (const [x, v] of [[13, 88], [14, 137], [15, 186]] as const) {
      E.select_rect(x, 0, 1, 40, 0);
      E.fill_selection(v, v, v, 255);
    }
    E.select_rect(14, 0, 14, 40, 0); // crisp binary cut through the soft edge
    mv.engine.commit();
    const at = (x: number) => E.get_selection_mask()[20 * 40 + x];
    const interiorBefore = at(20);
    mv.store.selectAndMask({ radius: 3, smartRadius: false, smooth: 0, feather: 0, contrast: 0, shift: 0 }, new Uint8Array(40 * 40));
    const band = [11, 12, 13, 14, 15, 16, 17].map(at);
    return { interiorBefore, interiorAfter: at(20), exterior: at(5), band };
  });
  expect(r.interiorBefore).toBe(255);
  expect(r.interiorAfter).toBe(255); // solid interior stays fully selected
  expect(r.exterior).toBe(0); // far exterior stays unselected
  // the crisp binary edge now carries intermediate coverage in the band
  expect(r.band.some((v) => v > 0 && v < 255)).toBe(true);
});

// ── Select and Mask ▸ Decontaminate Colors emits a new masked layer ──
test("Decontaminate Colors adds a new layer with a mask", async ({ page }) => {
  await freshDoc(page); // 40×40 document
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, 40, 0);
    E.fill_selection(0, 0, 255, 255); // blue backdrop
    E.select_rect(20, 0, 20, 40, 0);
    E.fill_selection(255, 0, 0, 255); // red half
    E.select_rect(20, 0, 20, 40, 0); // select the red half
    E.select_none();
    const layersBefore = E.layer_count();
    // Re-select the red half so decontaminate has an edge to work on.
    E.select_rect(20, 0, 20, 40, 0);
    mv.engine.commit();
    mv.store.decontaminateColors(1);
    return { layersBefore, layersAfter: E.layer_count() };
  });
  expect(r.layersAfter).toBe(r.layersBefore + 1); // one output layer added
});

// ── Mouse + UI: the Save Selection… then Load Selection… dialogs ───
test("the Save/Load Selection dialogs round-trip a selection", async ({ page }) => {
  await freshDoc(page);
  await page.evaluate(() => (window as any).__mv.engine.engine.select_rect(5, 5, 10, 10, 0));

  await openMenu(page, "Select");
  expect(await clickMenuItem(page, "Save Selection…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("textbox", { name: "Channel name" }).fill("box");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(150);

  await page.evaluate(() => (window as any).__mv.engine.engine.select_none());

  await openMenu(page, "Select");
  expect(await clickMenuItem(page, "Load Selection…")).toBe(true);
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "OK", exact: true }).click(); // default channel + Replace
  await page.waitForTimeout(150);

  await fillGreen(page);
  expect(isGreen(await pixel(page, 8, 8))).toBe(true);
  expect(isGreen(await pixel(page, 30, 30))).toBe(false);
});
