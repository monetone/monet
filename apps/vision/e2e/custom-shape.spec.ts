import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp, composite } from "./helpers";

// ── Photoshop Edit ▸ Define Custom Shape ───────────────────────────
// Adobe: Define Custom Shape captures the current work path as a reusable vector
// preset; the Custom Shape tool then scales it into the drag rectangle. Vision
// captures the Pen path (store.penPath), stores it normalized to its bounding
// box, and fills the scaled polygon — reusing the engine's select_polygon +
// fill_selection (the Pen tool's close-path fill).
//   https://helpx.adobe.com/photoshop/using/creating-shapes.html

const DOCW = 200;
const DOCH = 140;

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.set({ customShapes: [], activeCustomShape: 0 }); // the shipped built-ins are asserted on their own below
    mv.store.newDocument(w, h, "cshape");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(255, 255, 255, 255); E.select_none(); // white bg
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red foreground
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

/** Decode the engine's PNG and read one composite pixel [r,g,b,a]. */
async function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(async ({ x, y }) => {
    const mv = (window as any).__mv;
    const png = mv.engine.engine.export_png();
    const blob = new Blob([png], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const img: HTMLImageElement = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const cx = c.getContext("2d")!; cx.drawImage(img, 0, 0);
    const d = cx.getImageData(x, y, 1, 1).data;
    URL.revokeObjectURL(url);
    return [d[0], d[1], d[2], d[3]];
  }, { x, y });
}

// triangle apex top-centre, base along the bottom (doc coords)
const TRI = [10, 130, 190, 130, 100, 10];
const defineTri = (page: Page, pts = TRI) =>
  page.evaluate((p) => {
    const mv = (window as any).__mv;
    mv.store.setPenPath(p);
    return mv.store.defineCustomShape();
  }, pts);

// Photoshop stocks the Custom Shape picker on a fresh install; Vision seeds the
// same library, so a profile that has never defined a shape can still draw one.
test("a fresh profile finds the picker stocked with the built-in shapes", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 140, "builtins");
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind: "custom" });
  });
  const names = await page.evaluate(() => (window as any).__mv.store.state.customShapes.map((s: any) => s.name));
  expect(names).toEqual(expect.arrayContaining(["Arrow", "Banner", "Ornament"]));
  await page.locator("#mv-customshape-select").click();
  await expect(page.locator(".monet-listbox [role=option]")).toHaveCount(names.length);
  await page.keyboard.press("Escape");
});

test("defineCustomShape captures the pen path normalized and selects it", async ({ page }) => {
  await scene(page);
  const idx = await defineTri(page);
  expect(idx).toBe(0);
  const st = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return { count: s.customShapes.length, kind: s.shapeKind, active: s.activeCustomShape, shape: s.customShapes[0] };
  });
  expect(st.count).toBe(1);
  expect(st.kind).toBe("custom");
  expect(st.active).toBe(0);
  expect(st.shape.name).toBe("Custom Shape 1");
  // every stored coord is normalized to 0..1
  expect(st.shape.path.every((v: number) => v >= 0 && v <= 1)).toBe(true);
});

test("defineCustomShape is a no-op without a valid path", async ({ page }) => {
  await scene(page);
  const idx = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setPenPath([5, 5, 10, 10]); // only 2 points
    return mv.store.defineCustomShape();
  });
  expect(idx).toBe(-1);
  expect(await page.evaluate(() => (window as any).__mv.store.state.customShapes.length)).toBe(0);
});

test("drawing the custom shape fills its scaled polygon with the foreground", async ({ page }) => {
  const m = await scene(page);
  await defineTri(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("shape"));
  const before = await composite(page);
  // drag the full canvas → the triangle scales to fill it
  await page.mouse.move(m.cx(0), m.cy(0));
  await page.mouse.down();
  await page.mouse.move(m.cx(200), m.cy(140), { steps: 8 });
  await page.mouse.up();
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);          // canvas changed
  expect(after.w).toBe(DOCW); expect(after.h).toBe(DOCH); // dims unchanged
  // a pixel inside the triangle is the red foreground; a top corner stays white
  const inside = await pixelAt(page, 100, 110);
  const corner = await pixelAt(page, 5, 5);
  expect(inside[0]).toBeGreaterThan(180); expect(inside[1]).toBeLessThan(80); expect(inside[2]).toBeLessThan(80);
  expect(corner[0]).toBeGreaterThan(230); expect(corner[1]).toBeGreaterThan(230); expect(corner[2]).toBeGreaterThan(230);
});

test("the options-bar picker switches the active custom shape", async ({ page }) => {
  await scene(page);
  await defineTri(page);                                  // Custom Shape 1 (idx 0)
  await defineTri(page, [0, 0, 20, 0, 20, 20, 0, 20]);    // Custom Shape 2 (idx 1)
  await page.evaluate(() => (window as any).__mv.store.setTool("shape"));
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeCustomShape)).toBe(1);
  await chooseOption(page.locator("#mv-customshape-select"), "0");
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeCustomShape)).toBe(0);
  await chooseOption(page.locator("#mv-customshape-select"), "1");
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeCustomShape)).toBe(1);
});

test("the Custom options segment switches the shape kind", async ({ page }) => {
  await scene(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("shape"));
  await page.getByText("Custom", { exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.shapeKind)).toBe("custom");
});

// ── Persistence + management (Photoshop keeps the custom-shape library across
//    launches and manages it in the Preset Manager; Vision persists mv.customShapes) ──

test("defining a shape persists it to localStorage", async ({ page }) => {
  await scene(page);
  await defineTri(page);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("mv.customShapes") || "null"));
  expect(persisted).toHaveLength(1);
  expect(persisted[0].name).toBe("Custom Shape 1");
  expect(persisted).toEqual(await page.evaluate(() => (window as any).__mv.store.state.customShapes));
});

test("loadCustomShapes restores a saved library; a corrupt payload is ignored", async ({ page }) => {
  await scene(page);
  const restored = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const lib = [{ name: "Saved Star", path: [0, 0, 1, 0, 1, 1, 0, 1] }];
    localStorage.setItem("mv.customShapes", JSON.stringify(lib));
    mv.store.set({ customShapes: [], activeCustomShape: 0 });
    mv.store.loadCustomShapes();
    return mv.store.state.customShapes;
  });
  expect(restored).toEqual([{ name: "Saved Star", path: [0, 0, 1, 0, 1, 1, 0, 1] }]);
  const kept = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const before = [...mv.store.state.customShapes];
    localStorage.setItem("mv.customShapes", "{ not json");
    mv.store.loadCustomShapes(); // must not throw, must not clobber
    return { before, after: mv.store.state.customShapes };
  });
  expect(kept.after).toEqual(kept.before);
});

test("removeCustomShape drops the shape, keeps the active pointer sensible, persists", async ({ page }) => {
  await scene(page);
  await defineTri(page);                                  // Custom Shape 1 (idx 0)
  await defineTri(page, [0, 0, 20, 0, 20, 20, 0, 20]);    // Custom Shape 2 (idx 1, now active)
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.removeCustomShape(0); // delete the first; active (was idx1) should follow to idx0
    const persisted = JSON.parse(localStorage.getItem("mv.customShapes") || "[]");
    return { names: mv.store.state.customShapes.map((s: any) => s.name), active: mv.store.state.activeCustomShape, persistedLen: persisted.length };
  });
  expect(r.names).toEqual(["Custom Shape 2"]);
  expect(r.active).toBe(0);       // the still-selected shape followed the reorder
  expect(r.persistedLen).toBe(1); // persisted
});

test("Preset Manager reorders and renames a custom shape, active pointer follows", async ({ page }) => {
  await scene(page);
  await defineTri(page);                                  // Custom Shape 1 (idx 0)
  await defineTri(page, [0, 0, 20, 0, 20, 20, 0, 20]);    // Custom Shape 2 (idx 1, active)
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.renameCustomShape(0, "  Arrow  "); // trimmed
    const renamed = mv.store.state.customShapes[0].name;
    mv.store.reorderCustomShape(1, -1); // move the active shape (idx1) up to idx0
    const afterOrder = mv.store.state.customShapes.map((s: any) => s.name);
    const persisted = JSON.parse(localStorage.getItem("mv.customShapes") || "[]");
    return { renamed, afterOrder, active: mv.store.state.activeCustomShape, firstPersisted: persisted[0]?.name };
  });
  expect(r.renamed).toBe("Arrow");
  expect(r.afterOrder).toEqual(["Custom Shape 2", "Arrow"]); // the active shape moved to front
  expect(r.active).toBe(0);                                  // active pointer followed its shape
  expect(r.firstPersisted).toBe("Custom Shape 2");           // reorder persisted
});
