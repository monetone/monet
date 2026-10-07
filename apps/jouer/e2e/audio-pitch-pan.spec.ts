import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity AudioSource Pitch (Phaser sound `rate`) + Stereo Pan (`pan`).
// Audio is play/export only (the editor never previews it while scrubbing), so
// these specs assert the model, the .jouer round-trip and the exported Phaser
// sound.play config. Under the `desktop` project the last test is the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

async function seedAudio(page: Page, audio: Record<string, unknown>): Promise<string> {
  return page.evaluate((audio) => {
    const { cmd } = window.__mj;
    cmd.addAsset({ id: "clip1", kind: "audio", name: "beep", src: "data:audio/wav;base64,UklGRiQAAABXQVZF" });
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.updateObject(id, { audio: { assetId: "clip1", playOnAwake: true, loop: false, volume: 1, pitch: 1, pan: 0, ...audio } });
    return id;
  }, audio);
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("pitch (rate) + pan appear in the exported sound.play config", async ({ page }) => {
  await seedAudio(page, { pitch: 1.5, pan: -0.5 });
  const js = await exportJs(page);
  expect(js).toContain('"rate":1.5');
  expect(js).toContain('"pan":-0.5');
});

test("default pitch/pan emit no rate/pan (plain play)", async ({ page }) => {
  await seedAudio(page, {});
  const js = await exportJs(page);
  expect(js).toContain("this.sound.play('beep');"); // no config object
  expect(js).not.toContain('"rate"');
  expect(js).not.toContain('"pan"');
});

test("pitch + pan round-trip through .jouer", async ({ page }) => {
  const id = await seedAudio(page, { pitch: 2, pan: 0.75 });
  const r = await page.evaluate((id) => {
    const { store, jouer, query } = window.__mj;
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    const a = query.findObject(scene, id).audio;
    return { pitch: a.pitch, pan: a.pan };
  }, id);
  expect(r).toEqual({ pitch: 2, pan: 0.75 });
});

test("audio pitch/pan runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await seedAudio(page, { pitch: 1.25, pan: 0.5 });
  expect(await exportJs(page)).toContain('"rate":1.25');
  expect(await cspViolations(page)).toEqual([]);
});
