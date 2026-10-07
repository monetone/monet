import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── the scripting console can read document state (V-SCRIPT-1) ─
// The console used to be write-only: every `vision.*` leaf recorded [path,args]
// and returned undefined, replayed only after the script had finished. A script
// therefore could not size an op to the canvas, iterate the layer stack, or
// test whether a selection exists. `await vision.read.*` flushes the ops
// recorded so far, the main thread executes them and answers with live state —
// so these tests would all fail against the pure recorder.

test("a script reads live document state and sees its own edits", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(async () => {
    const mv = (window as unknown as { __mv: any }).__mv;
    return mv.runScript(`
      vision.newDoc(120, 80, "reads");
      const before = await vision.read.layerCount();
      vision.addLayer();
      const after = await vision.read.layerCount();
      const doc = await vision.read.doc();
      vision.log("grew=" + (after === before + 1));
      vision.log("size=" + doc.width + "x" + doc.height);
      vision.selectRect(0, 0, 10, 10);
      vision.log("sel=" + (await vision.read.hasSelection()));
      vision.log("bounds=" + JSON.stringify(await vision.read.selectionBounds()));
    `);
  });
  // Each read observed the edits queued before it, not the state at script start.
  expect(out).toBe('✓ grew=true\nsize=120x80\nsel=true\nbounds={"x":0,"y":0,"w":10,"h":10}');
});

test("a script can loop and branch over the real layer stack", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(async () => {
    const mv = (window as unknown as { __mv: any }).__mv;
    return mv.runScript(`
      vision.newDoc(64, 64, "loop");
      const base = await vision.read.layerCount();
      vision.addLayer();
      vision.addLayer();
      const layers = await vision.read.layers();
      // Size an op to the canvas — impossible without a read channel.
      const { width, height } = await vision.read.doc();
      for (const layer of layers) {
        if (!layer.visible) continue;
        vision.selectRect(0, 0, width / layers.length, height);
      }
      vision.log("layers=" + (layers.length === base + 2));
      vision.log("active=" + ((await vision.read.activeLayer()).id === await vision.read.activeLayerId()));
      vision.log("thumbless=" + !("thumb" in layers[0]));
    `);
  });
  expect(out).toBe("✓ layers=true\nactive=true\nthumbless=true");
});

test("reads are allowlisted and cannot be used to write", async ({ page }) => {
  await gotoApp(page);
  const errors = await page.evaluate(async () => {
    const mv = (window as unknown as { __mv: any }).__mv;
    const errors = [await mv.runScript("vision.read.notAThing();")];
    // The read namespace holds only the curated leaves — no op is reachable
    // through it, so this cannot smuggle a mutation past the op allowlist.
    errors.push(await mv.runScript("vision.read.fill(255, 0, 0);"));
    // A read that throws is the script's to catch; the run continues.
    errors.push(await mv.runScript(`
      vision.newDoc(32, 32, "catch");
      try { await vision.read.notAThing(); } catch { vision.log("caught"); }
    `));
    return errors;
  });
  expect(errors[0]).toContain("not a function");
  expect(errors[1]).toContain("not a function");
  expect(errors[2]).toBe("✓ caught");
});
