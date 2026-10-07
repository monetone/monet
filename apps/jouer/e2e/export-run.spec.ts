import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// The strongest proof that exported animations work: generate the Phaser code,
// load it into a blank page with a real (local) Phaser build, run it, and watch
// the exported tween actually move a property over time. Chromium-only — it
// injects an inline <script>, which the desktop CSP (script-src 'self') forbids.

test("exported game runs in real Phaser and its tween animates a property", async ({ page }) => {
  await gotoApp(page);
  const gameJs = await page.evaluate(() => {
    const { jouer, exporter } = window.__mj;
    const raw = {
      name: "run", width: 800, height: 300,
      scenes: [{ id: "s", key: "Main", name: "Main",
        objects: [{ id: "rect", kind: "rectangle", name: "mover", width: 30, height: 30, transform: { x: 0, y: 150 } }],
        timelines: [{ id: "tl", name: "T", duration: 1, autoplay: true, loop: true, tracks: [
          { id: "t", targetId: "rect", property: "x", keyframes: [{ time: 0, value: 0, ease: "linear" }, { time: 1, value: 500, ease: "linear" }] },
        ] }], activeTimelineId: "tl" }],
      activeSceneId: "s",
    };
    return exporter.exportGameJs(jouer.normalizeProject(raw));
  });

  const run = await page.context().newPage();
  const errors: string[] = [];
  run.on("pageerror", (e) => errors.push(e.message));
  run.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await run.setContent("<!doctype html><html><body></body></html>");
  await run.addScriptTag({ path: "node_modules/phaser/dist/phaser.min.js" });
  // Capture the game instance the generated `new Phaser.Game(config)` builds
  // (Phaser 4 has no global game registry).
  await run.evaluate(() => {
    const P = (window as any).Phaser;
    const Orig = P.Game;
    P.Game = function (c: any) { const g = new Orig(c); (window as any).__game = g; return g; };
    P.Game.prototype = Orig.prototype;
  });
  await run.addScriptTag({ content: gameJs });

  // Boot + the scene's autoplay tween chain begins.
  await run.waitForFunction(() => {
    const sc = (window as any).__game?.scene?.scenes?.[0];
    return !!sc && sc.children?.list?.some((o: any) => o.type === "Rectangle");
  }, null, { timeout: 10_000 });

  const readX = () => run.evaluate(() => {
    const sc = (window as any).__game.scene.scenes[0];
    return sc.children.list.find((o: any) => o.type === "Rectangle").x as number;
  });

  const x0 = await readX();
  await run.waitForTimeout(400);
  const x1 = await readX();
  await run.close();

  expect(errors).toEqual([]);
  expect(x1).toBeGreaterThan(x0);  // the tween moved it
  expect(x1).toBeGreaterThan(40);  // meaningfully along the 0→500 path
});

test("standalone HTML export is self-contained and runnable", async ({ page }) => {
  await gotoApp(page);
  const html = await page.evaluate(() => {
    const { jouer, exporter } = window.__mj;
    return exporter.exportStandaloneHtml(jouer.normalizeProject({ name: "Doc", scenes: [{ id: "s", key: "Main", name: "Main", objects: [{ id: "r", kind: "rectangle" }] }] }));
  });
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("cdn.jsdelivr.net/npm/phaser");
  expect(html).toContain("new Phaser.Game(config)");
  expect(html).toContain("class Main extends Phaser.Scene");
});
