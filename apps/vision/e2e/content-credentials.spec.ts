import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Photoshop Content Credentials (C2PA). Vision produces an unsigned provenance
// manifest (open standard) recording the producer, time, format, and size.
test("Content Credentials produces a provenance manifest", async ({ page }) => {
  await gotoApp(page);
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 80, "cc");
    return mv.engine.engine.content_credentials("Monet Vision", "2026-07-05T00:00:00Z");
  });
  const parsed = JSON.parse(m);
  expect(parsed.claim_generator).toBe("Monet Vision");
  expect(m).toContain('"width":120');
  expect(m).toContain('"height":80');
  expect(m).toContain("c2pa.created");
});
