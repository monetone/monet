import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

// Shadows/Highlights, Selective Color and Equalize — each driven through the
// real `mv.adj` action layer must change the composite of the structured scene.
const ADJ: Array<{ name: string; code: string }> = [
  { name: "shadows/highlights", code: "mv.adj.shadowsHighlights(0.6, 0.5, 0.4, 0.5)" },
  {
    name: "selective color (black, all bands)",
    code: "const c=new Float32Array(36);for(let b=0;b<9;b++)c[b*4+3]=0.5;mv.adj.selectiveColor(c,false)",
  },
  {
    name: "selective color (reds → cyan, relative)",
    code: "const c=new Float32Array(36);c[0]=-1;mv.adj.selectiveColor(c,true)",
  },
  { name: "equalize", code: "mv.adj.equalize()" },
];

for (const a of ADJ) {
  test(`adjustment: ${a.name}`, async ({ page }) => {
    await gotoApp(page);
    await newScene(page);
    const before = await composite(page);
    await page.evaluate((code) => {
      const mv = (window as any).__mv;
      // eslint-disable-next-line no-new-func
      new Function("mv", code)(mv);
    }, a.code);
    const after = await composite(page);
    expect(after.chk).not.toBe(before.chk);
  });
}

// Selective Color must be band-selective: a reds-only shift must leave a scene
// with no reds unchanged, but change a red fill.
test("selective color is band-selective", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const chk = () => { const b = E().export_png(); let c = 0; for (let i = 0; i < b.length; i++) c = (c + b[i] * (i % 7 + 1)) % 1000003; return c; };
    // A pure-blue canvas: shifting the Reds band must do nothing.
    mv.store.newDocument(32, 32); E().select_all(); E().fill_selection(0, 0, 255, 255); E().select_none(); mv.engine.commit();
    const blueBefore = chk();
    const reds = new Float32Array(36); reds[0] = -1; reds[3] = 1; // strong reds shift
    E().adjust_selective_color(reds, true); mv.engine.commit();
    const blueAfter = chk();
    // A pure-red canvas: the same Reds shift must change it.
    mv.store.newDocument(32, 32); E().select_all(); E().fill_selection(255, 0, 0, 255); E().select_none(); mv.engine.commit();
    const redBefore = chk();
    E().adjust_selective_color(reds, true); mv.engine.commit();
    const redAfter = chk();
    return { blueBefore, blueAfter, redBefore, redAfter };
  });
  expect(r.blueAfter).toBe(r.blueBefore); // blue untouched by a Reds-band shift
  expect(r.redAfter).not.toBe(r.redBefore); // red changed
});
