import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Rotate View ─────────────────────────────────────────
// Non-destructive canvas rotation: the view spins but the pixels never change.
// Vision stores rotationAngle per document and weaves it (about the content
// centre) into the canvas transform + the pointer↔doc mapping. Joins the Hand
// flyout group. https://helpx.adobe.com/photoshop/using/rotate-canvas-view.html

const DOCW = 100;
const DOCH = 100;

async function scene(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "rot");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none();
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 });
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.1, null, { timeout: 5000 });
  return await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

test("setRotation updates state and wraps to (-180, 180]", async ({ page }) => {
  await scene(page);
  const vals = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const out: number[] = [];
    mv.store.setRotation(90); out.push(mv.store.state.rotationAngle);
    mv.store.setRotation(270); out.push(mv.store.state.rotationAngle); // → -90
    mv.store.rotateBy(15); out.push(mv.store.state.rotationAngle);     // -75
    mv.store.setRotation(0); out.push(mv.store.state.rotationAngle);
    return out;
  });
  expect(vals).toEqual([90, -90, -75, 0]);
});

test("the view rotation is non-destructive (the exported pixels are unchanged)", async ({ page }) => {
  await scene(page);
  const sig = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const before = mv.engine.engine.export_png().length;
    mv.store.setRotation(37);
    const after = mv.engine.engine.export_png().length;
    const px = ((mv.engine.engine.pick_color(10, 10) >>> 0) >>> 24) & 255; // still white
    return { before, after, px };
  });
  expect(sig.after).toBe(sig.before); // rotation never touches the pixels
  expect(sig.px).toBeGreaterThan(240);
});

test("rotation is stored per document tab", async ({ page }) => {
  await scene(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const aId = mv.store.state.activeDocId;
    mv.store.setRotation(90);
    mv.store.newDocument(60, 60, "B"); // switches to B (fresh view)
    const bRot = mv.store.state.rotationAngle;
    mv.store.activateDoc(aId); // back to A
    return { bRot, aRot: mv.store.state.rotationAngle };
  });
  expect(r.bRot).toBe(0);
  expect(r.aRot).toBe(90);
});

test("a rotated view maps pointer clicks correctly (180° flips the canvas)", async ({ page }) => {
  const box = await scene(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("brush");
    mv.store.setBrush({ size: 12, hardness: 1, flow: 1, opacity: 1, smoothing: 0 });
  });
  // Unrotated: a click 20% from the top-left lands top-left in the document.
  await page.evaluate(() => (window as any).__mv.store.setRotation(0));
  await page.mouse.click(box.x + box.w * 0.2, box.y + box.h * 0.2);
  // Rotated 180°: the SAME screen point now maps to the bottom-right of the doc.
  await page.evaluate(() => (window as any).__mv.store.setRotation(180));
  await page.mouse.click(box.x + box.w * 0.2, box.y + box.h * 0.2);
  const px = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const at = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return { tl: at(20, 20), br: at(80, 80) };
  });
  expect(px.tl).toBeLessThan(140); // first (unrotated) click painted near the top-left
  expect(px.br).toBeLessThan(140); // second click, rotated 180°, painted near the bottom-right
});

test("Rotate View is reachable from the Hand flyout group", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(40, 40, "g"));
  await page.locator('[data-tool-group="grp-hand"]').click({ button: "right" });
  await page.locator('[data-flyout-tool="rotateview"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("rotateview");
});
