import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity AudioSource: an object can carry a sound that plays on awake.
// Audio is play/export only (the editor never previews it while scrubbing), so —
// like physics — these specs assert the model, the .jouer round-trip and the
// exported Phaser code rather than live playback. Under the `desktop` project the
// last test doubles as the CSP smoke.

/** Add an audio asset + a rectangle with an AudioSource; returns the object id. */
async function seed(page: Page, audio: Record<string, unknown>): Promise<string> {
  return page.evaluate((audio) => {
    const { cmd } = window.__mj;
    cmd.addAsset({ id: "clip1", kind: "audio", name: "beep", src: "data:audio/wav;base64,UklGRiQAAABXQVZF" });
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.updateObject(id, { audio: { assetId: "clip1", playOnAwake: true, loop: false, volume: 1, pitch: 1, pan: 0, mute: false, ...audio } });
    return id;
  }, audio);
}

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("an AudioSource is preserved in the model and round-trips through .jouer", async ({ page }) => {
  const id = await seed(page, { loop: true, volume: 0.5, playOnAwake: false });
  const r = await page.evaluate((id) => {
    const { store, jouer, query } = window.__mj;
    const live = query.findObject(query.activeScene(store.getProject()), id).audio;
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { live, back: query.findObject(scene, id).audio };
  }, id);
  expect(r.live).toEqual({ assetId: "clip1", playOnAwake: false, loop: true, volume: 0.5, pitch: 1, pan: 0, mute: false });
  expect(r.back).toEqual({ assetId: "clip1", playOnAwake: false, loop: true, volume: 0.5, pitch: 1, pan: 0, mute: false });
});

test("the exported game preloads the clip and plays it on awake with the loop/volume config", async ({ page }) => {
  await seed(page, { loop: true, volume: 0.5 });
  const js = await exportJs(page);
  expect(js).toContain("this.load.audio('beep', \"data:audio/wav;base64,UklGRiQAAABXQVZF\")");
  expect(js).toContain('this.sound.play(\'beep\', {"loop":true,"volume":0.5})');
});

test("a one-shot at full volume plays with no config object", async ({ page }) => {
  await seed(page, {}); // loop false, volume 1
  const js = await exportJs(page);
  expect(js).toContain("this.sound.play('beep');");
});

test("Play On Awake off preloads the clip but emits no play", async ({ page }) => {
  await seed(page, { playOnAwake: false });
  const js = await exportJs(page);
  expect(js).toContain("this.load.audio('beep'");
  expect(js).not.toContain("this.sound.play(");
});

test("an audio source pointing at a missing clip emits no play (no unloaded key)", async ({ page }) => {
  // A dangling assetId (e.g. the clip was deleted) must not produce a
  // this.sound.play on a key that was never preloaded.
  await page.evaluate(() => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.updateObject(id, { audio: { assetId: "ghost", playOnAwake: true, loop: true, volume: 1 } });
  });
  const js = await exportJs(page);
  expect(js).not.toContain("this.sound.play(");
});

test("an inactive-in-hierarchy object plays no audio", async ({ page }) => {
  const id = await seed(page, { loop: true });
  await page.evaluate((id) => window.__mj.cmd.setActive(id, false), id);
  const js = await exportJs(page);
  expect(js).not.toContain("this.sound.play(");
});

test("audio source runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await seed(page, { loop: true, volume: 0.3 });
  expect(await page.evaluate((id) => !!window.__mj.probe(id), id)).toBe(true);
  expect(await cspViolations(page)).toEqual([]);
});
