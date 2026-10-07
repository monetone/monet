import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Scene transitions: every effect kind + trigger is stored on the model and
// wired correctly into the exported Phaser scene's create().

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

async function twoScenes(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const s1 = store.getProject().scenes[0].id;
    const s2 = cmd.addScene();
    store.setActiveScene(s1);
    return { s1, s2, key2: store.getProject().scenes.find((s: any) => s.id === s2).key };
  });
}

test("transition is stored and exported with the target scene key", async ({ page }) => {
  const { s1, s2, key2 } = await twoScenes(page);
  const js = await page.evaluate(({ s1, s2 }) => {
    const { cmd, store, exporter } = window.__mj;
    cmd.addTransition(s1, s2, { kind: "fade", trigger: "pointerdown" });
    return exporter.exportGameJs(store.getProject());
  }, { s1, s2 });
  expect(js).toContain(`mjTransition(this, '${key2}', { kind: 'fade'`);
  expect(js).toContain("this.input.once('pointerdown'");
});

test("every trigger wires the right Phaser hook", async ({ page }) => {
  const { s1, s2 } = await twoScenes(page);
  const js = await page.evaluate(({ s1, s2 }) => {
    const { cmd, store, exporter } = window.__mj;
    cmd.addTransition(s1, s2, { kind: "fade", trigger: "pointerdown" });
    cmd.addTransition(s1, s2, { kind: "fade", trigger: "key", triggerKey: "ENTER" });
    cmd.addTransition(s1, s2, { kind: "fade", trigger: "timer", delay: 1500 });
    cmd.addTransition(s1, s2, { kind: "fade", trigger: "manual" });
    return exporter.exportGameJs(store.getProject());
  }, { s1, s2 });
  expect(js).toContain("this.input.once('pointerdown'");
  expect(js).toContain("keydown-ENTER");
  expect(js).toContain("this.time.delayedCall(1500");
  expect(js).toContain("this.go_"); // manual helper
});

test("every effect kind is emitted with the helper + scene transition", async ({ page }) => {
  const { s1, s2 } = await twoScenes(page);
  const js = await page.evaluate(({ s1, s2 }) => {
    const { cmd, store, exporter } = window.__mj;
    for (const kind of ["fade", "slide", "wipe", "zoom", "none"]) cmd.addTransition(s1, s2, { kind, trigger: "manual", direction: "right" });
    return exporter.exportGameJs(store.getProject());
  }, { s1, s2 });
  for (const kind of ["fade", "slide", "wipe", "zoom", "none"]) {
    expect(js).toContain(`kind: '${kind}'`);
  }
  // the shared helper that implements fade/slide/wipe/zoom is present
  expect(js).toContain("function mjTransition(scene, targetKey, opts)");
  expect(js).toContain("scene.scene.transition(");
});

test("deleting a scene removes its transitions", async ({ page }) => {
  const { s1, s2 } = await twoScenes(page);
  const count = await page.evaluate(({ s1, s2 }) => {
    const { cmd, store } = window.__mj;
    cmd.addTransition(s1, s2, { kind: "fade", trigger: "manual" });
    cmd.deleteScene(s2);
    return store.getProject().transitions.length;
  }, { s1, s2 });
  expect(count).toBe(0);
});
