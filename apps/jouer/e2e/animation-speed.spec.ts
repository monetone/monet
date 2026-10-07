import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Animation Playback Speed (Animator speed multiplier): a per-timeline
// `speed` mapped to the played/exported Phaser tween chain's timeScale (1 = normal,
// >1 faster). Like Unity's runtime Animator.speed it applies to the played/exported
// game only — the editor scrubs a single master playhead at real time. Specs build a
// keyframed timeline via __mj, set speed, and assert the exported chain. The last test
// doubles as the CSP smoke.

// Add an object + a 2-keyframe track on the active scene's first timeline, then set
// the timeline speed; returns the export JS string.
const exportWithSpeed = (page: Page, speed: number): Promise<string> =>
  page.evaluate((speed) => {
    const { cmd, store, exporter } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    store.mutate("seed track", (d: any) => {
      const sc = d.scenes.find((s: any) => s.id === d.activeSceneId);
      sc.timelines[0].tracks.push({
        id: "tk1", targetId: id, property: "x",
        keyframes: [{ id: "k0", time: 0, value: 0, ease: "linear" }, { id: "k1", time: 1, value: 200, ease: "linear" }],
      });
    });
    const tlId = store.getProject().scenes[0].timelines[0].id;
    if (speed !== 1) cmd.updateTimeline(tlId, { speed });
    return exporter.exportGameJs(store.getProject());
  }, speed);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a timeline speed of 2 scales the exported chain's timeScale", async ({ page }) => {
  const js = await exportWithSpeed(page, 2);
  expect(js).toContain("Object.assign(this.tweens.chain({");
  expect(js).toContain("}), { timeScale: 2 }));");
});

test("the default speed of 1 emits the plain chain (no timeScale)", async ({ page }) => {
  const js = await exportWithSpeed(page, 1);
  expect(js).toContain("this.tweens.chain({");
  expect(js).not.toContain("Object.assign");
  expect(js).not.toContain("timeScale");
});

test("timeline speed is preserved in the model and round-trips through .jouer", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer } = window.__mj;
    const tlId = store.getProject().scenes[0].timelines[0].id;
    cmd.updateTimeline(tlId, { speed: 1.5 });
    const live = store.getProject().scenes[0].timelines[0].speed;
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    return { live, back: back.scenes[0].timelines[0].speed };
  });
  expect(r).toEqual({ live: 1.5, back: 1.5 });
});

test("animation speed runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const js = await exportWithSpeed(page, 0.5);
  expect(js).toContain("}), { timeScale: 0.5 }));");
  expect(await cspViolations(page)).toEqual([]);
});
