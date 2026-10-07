import { test, expect } from "@playwright/test";
import { decodeAndSignature, gotoApp, importFixture } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("an empty program composites to the black background", async ({ page }) => {
  const sig = await decodeAndSignature(page, 0);
  expect(sig.mean).toBeLessThan(2);
  expect(sig.variance).toBeLessThan(2);
});

test("a color matte composites to its solid color", async ({ page }) => {
  await page.evaluate(() => (window as any).__mc.cmd.addColorMatte("#3366cc"));
  const sig = await decodeAndSignature(page, 0);
  // luma of #3366cc ≈ 0.299*51 + 0.587*102 + 0.114*204 ≈ 98
  expect(sig.mean).toBeGreaterThan(80);
  expect(sig.mean).toBeLessThan(120);
  expect(sig.variance).toBeLessThan(5); // solid fill
});

test("a placed video decodes real, changing frames into the program", async ({ page }) => {
  await importFixture(page, "bars.webm");
  await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const m = mc.store.getProject().media[0];
    mc.cmd.addMediaToTimeline(m.id);
    // Scale the 320×240 clip up to fill the 1920×1080 sequence so the decoded
    // content dominates the program (not diluted by background).
    const seq = mc.query.activeSequence(mc.store.getProject());
    const v1 = seq.tracks.find((t: any) => t.kind === "video");
    mc.cmd.editClip(v1.clips[0].id, "Fill", (c: any) => {
      c.transform.scaleX = 600;
      c.transform.scaleY = 600;
      c.transform.scale = 600;
    });
  });

  const a = await decodeAndSignature(page, 6);
  const b = await decodeAndSignature(page, 36);

  // Real decoded content: non-black, with structure (the moving bar + hue bg).
  expect(a.mean).toBeGreaterThan(5);
  expect(a.mean).toBeLessThan(250);
  expect(a.variance).toBeGreaterThan(50);

  // Different timeline frames yield different program frames (the bar moves,
  // the background hue sweeps) — proves we're decoding video, not a still.
  expect(Math.abs(a.mean - b.mean)).toBeGreaterThan(1);
});
