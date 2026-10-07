import { test, expect } from "@playwright/test";
import { gotoApp, importFixture } from "./helpers";

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("imports a video fixture into the project bin", async ({ page }) => {
  const before = await page.evaluate(() => (window as any).__mc.store.getProject().media.length);
  const media = await importFixture(page, "bars.webm");
  expect(media).not.toBeNull();
  expect(media!.kind).toBe("video");
  expect(media!.width).toBe(320);
  expect(media!.height).toBe(240);
  expect(media!.durationFrames).toBeGreaterThan(0);

  const after = await page.evaluate(() => (window as any).__mc.store.getProject().media.length);
  expect(after).toBe(before + 1);
});

test("imports a video+audio fixture and derives a waveform", async ({ page }) => {
  const media = await importFixture(page, "tone.webm");
  expect(media).not.toBeNull();
  expect(media!.hasAudio).toBe(true);

  // Peaks are decoded asynchronously into the runtime registry.
  await page.waitForFunction(
    (id) => {
      const peaks = (window as any).__mc.registry.getHandle(id)?.peaks;
      return peaks && peaks.length > 0;
    },
    media!.id,
    { timeout: 15_000 },
  );
});
