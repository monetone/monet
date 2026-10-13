import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

// Scripts create their own canvases; keep the initial blank small so its
// composite work leaves the worker's unchanged idle budget available to run.
test.beforeEach(async ({ page }) => { await gotoApp(page, { w: 256, h: 192 }); });

test("scripting console runs against the vision API", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const code = `
      vision.newDoc(140, 100, "scripted");
      vision.selectRect(10, 10, 90, 70);
      vision.fill(210, 60, 60);
      vision.deselect();
      vision.adj.vibrance(0.4, 0.1);
    `;
    const err = await mv.runScript(code);
    return { err, w: E().width(), h: E().height() };
  });
  expect(r.err).toBe(""); // no error
  expect(r.w).toBe(140);
  expect(r.h).toBe(100);
});

test("scripting reports errors instead of throwing", async ({ page }) => {
  const err = await page.evaluate(async () => await (window as any).__mv.runScript("vision.nope.totallyMissing();"));
  expect(typeof err).toBe("string");
  expect(err.length).toBeGreaterThan(0);
});

test("scripting reads cannot extend the absolute runtime budget", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const error = await mv.runScript("for (;;) { await vision.read.width(); }");
    const nextError = await mv.runScript('vision.newDoc(46, 47, "after-runtime-budget");');
    return { error, nextError, w: mv.engine.engine.width(), h: mv.engine.engine.height() };
  });
  expect(result).toEqual({
    error: "Script exceeded the 30000 ms runtime budget",
    nextError: "",
    w: 46,
    h: 47,
  });
});

test("actions: record and replay a macro", async ({ page }) => {
  await newScene(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.actions.start();
    mv.adj.invert();
    mv.adj.posterize(4);
    mv.actions.stop();
    return { recording: mv.actions.isRecording(), count: mv.actions.count() };
  });
  expect(r.recording).toBe(false);
  expect(r.count).toBe(2);

  // replay on a fresh scene
  await newScene(page);
  const before = await composite(page);
  await page.evaluate(() => (window as any).__mv.actions.play());
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

// A reload lands on Home when nothing was open (#476), and Home has no engine
// — so wait for the app, then make a document the way gotoApp does.
const waitReady = async (page: import("@playwright/test").Page) => {
  await page.waitForFunction(() => {
    const mv = (window as any).__mv;
    return mv && mv.engine && mv.store;
  }, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    if (!mv.store.state.documents.length) mv.store.newDocument(1280, 800, "Untitled.psd");
  });
};

test("actions: a saved macro survives reload and replays", async ({ page }) => {
  await newScene(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.actions.start();
    mv.adj.invert();
    mv.adj.posterize(4);
    mv.actions.stop();
    mv.actions.save("Persisted");
  });
  await page.reload();
  await waitReady(page);
  const listed = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return mv.actions.list().map((a: any) => ({ name: a.name, steps: a.stepCount, persistable: mv.actions.isPersistable(a.id) }));
  });
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ name: "Persisted", steps: 2, persistable: true });

  await newScene(page);
  const before = await composite(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.actions.playNamed(mv.actions.list()[0].id); });
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
});

test("actions: export / clear / import round-trips and replays", async ({ page }) => {
  await newScene(page);
  const json = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.actions.start(); mv.adj.invert(); mv.adj.posterize(4); mv.actions.stop();
    mv.actions.save("Exported");
    const json = mv.actions.exportJson();
    mv.actions.clearNamed();
    return json;
  });
  const cleared = await page.evaluate(() => (window as any).__mv.actions.list().length);
  expect(cleared).toBe(0);

  const imp = await page.evaluate((j) => (window as any).__mv.actions.importJson(j), json);
  expect(imp).toMatchObject({ imported: 1 });
  expect(imp.rejected).toEqual([]);

  await newScene(page);
  const before = await composite(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.actions.playNamed(mv.actions.list()[0].id); });
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);

  // A doctored payload naming a non-allowlisted op is rejected whole.
  const doctored = await page.evaluate(() => (window as any).__mv.actions.importJson(JSON.stringify({
    format: "mvactions", version: 1, app: "x", exportedAt: 0,
    actions: [{ name: "Evil", favorite: false, createdAt: 0, steps: [["engine.raw", []]] }],
  })));
  expect(doctored.imported).toBe(0);
  expect(doctored.rejected).toHaveLength(1);
  expect(doctored.rejected[0].name).toBe("Evil");
});

test("actions: export contains the captured descriptor", async ({ page }) => {
  await newScene(page);
  const json = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.actions.start(); mv.adj.invert(); mv.actions.stop(); mv.actions.save("Inv");
    return mv.actions.exportJson();
  });
  expect(json).toContain('["adj.invert",[]]');
});

test("actions: a non-proxied dialog commit records a VOLATILE step (stale-descriptor regression)", async ({ page }) => {
  await newScene(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.actions.start();
    mv.adj.invert();                       // proxied → op captured on step 0
    // Emulate the PreviewDialog commit protocol for a NON-proxied apply (Perspective Warp):
    mv.actions.suspend(true);
    mv.perspectiveWarp([{ dx: 5, dy: 0 }]); // free fn, no rec(), no proxy → no descriptor
    mv.actions.suspend(false);
    mv.actions.record(() => mv.perspectiveWarp([{ dx: 5, dy: 0 }]));
    mv.actions.stop();
    const id = mv.actions.save("Mixed");
    const json = mv.actions.exportJson();
    return { steps: mv.actions.count(), persistable: mv.actions.isPersistable(id), exported: JSON.parse(json).actions.length, json };
  });
  expect(r.steps).toBe(2);
  expect(r.persistable).toBe(false);       // perspectiveWarp step is volatile — whole action can't persist
  expect(r.exported).toBe(0);              // action omitted from export
  expect(r.json).not.toContain("perspectiveWarp");
  expect(r.json).not.toContain("adj.invert"); // NOT mis-attributed to the perspectiveWarp step
});

test("actions: a proxied dialog commit records a PERSISTABLE step", async ({ page }) => {
  await newScene(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.actions.start();
    mv.actions.suspend(true);
    mv.adj.posterize(4);                   // proxied → descriptor stamped even under suspend
    mv.actions.suspend(false);
    mv.actions.record(() => mv.adj.posterize(4));
    mv.actions.stop();
    const id = mv.actions.save("Posterized");
    const json = mv.actions.exportJson();
    return { persistable: mv.actions.isPersistable(id), occurrences: json.split('["adj.posterize",[4]]').length - 1 };
  });
  expect(r.persistable).toBe(true);
  expect(r.occurrences).toBe(1);
});

test("color picker reads a pixel", async ({ page }) => {
  await newScene(page);
  const r = await page.evaluate(() => {
    const E = () => (window as any).__mv.engine.engine;
    E().select_rect(40, 40, 60, 40, 0); E().fill_selection(12, 200, 64, 255); E().select_none(); (window as any).__mv.engine.commit();
    const packed = E().pick_color(70, 60) >>> 0;
    return { r: (packed >>> 24) & 255, g: (packed >>> 16) & 255, b: (packed >>> 8) & 255 };
  });
  expect(r.g).toBeGreaterThan(r.r);
  expect(r.g).toBeGreaterThan(r.b);
});

test("Batch plays a saved action over picked files and saves the chosen format", async ({ page }) => {
  await newScene(page);
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  const processed = await page.evaluate(async () => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    // Save an invert action, then batch it over a File built from a real PNG.
    mv.actions.start(); mv.adj.invert(); mv.actions.stop();
    const id = mv.actions.save("BatchInvert");
    const png: Uint8Array = E.export_png();
    const file = new File([png as BlobPart], "shot.png", { type: "image/png" });
    return await mv.batchProcessFiles([file], id, "jpeg");
  });
  expect(processed).toBe(1);
  await expect.poll(() => downloads.length, { timeout: 10_000 }).toBe(1);
  // The default File Naming template is "{name}_{serial}_processed".
  expect(downloads[0]).toBe("shot_001_processed.jpg");
});
