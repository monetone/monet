import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity AudioSource Mute (Phaser sound `mute`): the source is authored muted
// (silenced while preserving its volume). Audio is play/export only (the editor never
// previews it while scrubbing), so these specs assert the model, the .jouer round-trip
// and the exported Phaser sound.play config. Under `desktop` the last test is the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

async function seedAudio(page: Page, audio: Record<string, unknown>): Promise<string> {
  return page.evaluate((audio) => {
    const { cmd } = window.__mj;
    cmd.addAsset({ id: "clip1", kind: "audio", name: "beep", src: "data:audio/wav;base64,UklGRiQAAABXQVZF" });
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.updateObject(id, { audio: { assetId: "clip1", playOnAwake: true, loop: false, volume: 1, pitch: 1, pan: 0, mute: false, ...audio } });
    return id;
  }, audio);
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a muted AudioSource exports the mute flag in the play config", async ({ page }) => {
  await seedAudio(page, { mute: true });
  expect(await exportJs(page)).toContain('"mute":true');
});

test("an unmuted AudioSource omits the mute flag (plain play)", async ({ page }) => {
  await seedAudio(page, {});
  const js = await exportJs(page);
  expect(js).toContain("this.sound.play('beep');"); // no config object
  expect(js).not.toContain('"mute"');
});

test("mute round-trips through .jouer", async ({ page }) => {
  const id = await seedAudio(page, { mute: true });
  const r = await page.evaluate((id) => {
    const { store, jouer, query } = window.__mj;
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return query.findObject(scene, id).audio.mute;
  }, id);
  expect(r).toBe(true);
});

test("audio mute runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await seedAudio(page, { mute: true });
  expect(await exportJs(page)).toContain('"mute":true');
  expect(await cspViolations(page)).toEqual([]);
});
