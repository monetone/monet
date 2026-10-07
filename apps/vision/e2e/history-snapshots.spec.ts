import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

// End-to-end History Snapshots — named full-document checkpoints (Photoshop's
// History panel snapshots). Drives store.takeSnapshot / restoreSnapshot /
// deleteSnapshot through the live app and the real wasm engine.

test("captures a snapshot and restores the document to it", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await newScene(page, 64, 48);
  const original = await composite(page);

  const id = await page.evaluate(() => (window as any).__mv.store.takeSnapshot());

  // Mutate the document so the composite is genuinely different.
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    E().select_rect(0, 0, 64, 48, 0); E().fill_selection(255, 0, 0, 255); E().select_none();
    mv.engine.commit();
  });
  const mutated = await composite(page);
  expect(mutated.chk).not.toBe(original.chk);

  // Restore → the document matches the snapshot bit-for-bit (project round-trip).
  await page.evaluate((sid) => (window as any).__mv.store.restoreSnapshot(sid), id);
  const restored = await composite(page);
  expect(restored.w).toBe(64);
  expect(restored.h).toBe(48);
  expect(restored.chk).toBe(original.chk);

  // #511: the pre-restore state was checkpointed first, so the mutation is
  // recoverable — restoring that checkpoint brings the mutated document back.
  const recoverId = await page.evaluate(() => {
    const rows = (window as any).__mv.store.state.snapshots as { id: number; name: string }[];
    return rows.find((r) => r.name.startsWith("Before "))?.id ?? 0;
  });
  expect(recoverId).toBeGreaterThan(0);
  await page.evaluate((sid) => (window as any).__mv.store.restoreSnapshot(sid), recoverId);
  const recovered = await composite(page);
  expect(recovered.chk).toBe(mutated.chk);
});

test("adds, auto-names, and deletes snapshots", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await newScene(page, 40, 40);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const s0 = mv.store.state.snapshots.length;
    const first = mv.store.takeSnapshot();          // auto-named "Snapshot 1" after the document-named auto-first snapshot
    mv.store.takeSnapshot("My Checkpoint");          // explicit name
    const names = mv.store.state.snapshots.map((s: { name: string }) => s.name);
    const afterAdd = mv.store.state.snapshots.length;
    mv.store.deleteSnapshot(first);
    return { s0, afterAdd, afterDel: mv.store.state.snapshots.length, names };
  });
  expect(r.s0).toBe(1);
  expect(r.afterAdd).toBe(3);
  expect(r.names).toContain("Snapshot 1");
  expect(r.names).toContain("My Checkpoint");
  expect(r.afterDel).toBe(2);
});

test("keeps snapshots isolated per document", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await newScene(page, 32, 32);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.takeSnapshot();                 // doc A gets one manual snapshot after its auto-first snapshot
    const docA = mv.store.state.activeDocId;
    mv.store.newDocument(24, 24, "B");        // switch to a fresh doc B
    const bCount = mv.store.state.snapshots.length;
    mv.store.activateDoc(docA);               // back to A
    return { bCount, aCount: mv.store.state.snapshots.length };
  });
  expect(r.bCount).toBe(1); // doc B has its default auto-first snapshot
  expect(r.aCount).toBe(2); // doc A's auto-first + manual snapshots survived the switch
});
