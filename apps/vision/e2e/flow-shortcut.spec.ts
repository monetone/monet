import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Shift+number → paint Flow or layer Fill ──────────────
// A rapid second digit gives the exact percentage. Physical e.code preserves the
// digit under Shift. Groups have no Fill control, so the chord changes Opacity.
//   https://community.adobe.com/bug-reports-711/p-keyboard-shortcut-to-set-fill-opacity-for-layer-groups-doesn-t-work-658298

const brush = (page: Page): Promise<{ flow: number; opacity: number }> =>
  page.evaluate(() => { const b = (window as any).__mv.store.state.brush; return { flow: b.flow, opacity: b.opacity }; });

const layerAppearance = (page: Page): Promise<{ fill: number; opacity: number; kind: number }> =>
  page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    const layer = s.layers.find((candidate: any) => candidate.id === s.activeLayerId);
    return { fill: layer.fillOpacity, opacity: layer.opacity, kind: layer.kind };
  });

test("Shift+number sets the brush flow with a paint tool", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setTool("brush"); mv.store.setBrush({ flow: 0.2 }); });
  await page.keyboard.press("Shift+Digit3");
  expect((await brush(page)).flow).toBeCloseTo(0.3, 5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Digit4");
  await page.keyboard.press("Shift+Digit5");
  expect((await brush(page)).flow).toBeCloseTo(0.45, 5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Digit0");
  expect((await brush(page)).flow).toBe(1);
});

test("Shift+number sets a regular layer's Fill with a non-paint tool", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "fill-shortcut");
    mv.store.setTool("move");
    mv.store.setBrush({ flow: 0.5 });
  });
  await page.keyboard.press("Shift+Digit2");
  expect(await layerAppearance(page)).toMatchObject({ fill: 20, opacity: 100 });
  expect((await brush(page)).flow).toBe(0.5);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Digit4");
  await page.keyboard.press("Shift+Digit5");
  expect(await layerAppearance(page)).toMatchObject({ fill: 45, opacity: 100 });
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerAppearance(page)).toMatchObject({ fill: 20, opacity: 100 });
  await page.evaluate(() => (window as any).__mv.store.redo());
  expect(await layerAppearance(page)).toMatchObject({ fill: 45, opacity: 100 });

  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Digit0");
  await page.keyboard.press("Shift+Digit5");
  expect(await layerAppearance(page)).toMatchObject({ fill: 5, opacity: 100 });

  // Separate gestures on the same control must remain separate Undo steps.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Digit6");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Digit7");
  await page.keyboard.press("Escape");
  expect(await layerAppearance(page)).toMatchObject({ fill: 70, opacity: 100 });
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerAppearance(page)).toMatchObject({ fill: 60, opacity: 100 });
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerAppearance(page)).toMatchObject({ fill: 5, opacity: 100 });
});

test("opacity and flow digit sequences stay independent", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setTool("brush"); mv.store.setBrush({ flow: 0.5, opacity: 0.9 }); });
  await page.keyboard.press("Digit3");
  await page.keyboard.press("Shift+Digit4");
  const b = await brush(page);
  expect(b.opacity).toBeCloseTo(0.3, 5);
  expect(b.flow).toBeCloseTo(0.4, 5);
});

test("layer Opacity and Fill digit sequences stay independent", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "fill-independent");
    mv.store.setTool("move");
  });
  await page.keyboard.press("Digit3");
  await page.keyboard.press("Shift+Digit4");
  expect(await layerAppearance(page)).toMatchObject({ opacity: 30, fill: 40 });
});

test("paint Flow and layer Fill sequences stay independent across a tool switch", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "flow-fill-independent");
    mv.store.setTool("brush");
  });
  await page.keyboard.press("Shift+Digit3");
  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await page.keyboard.press("Shift+Digit4");
  expect((await brush(page)).flow).toBeCloseTo(0.3, 5);
  expect(await layerAppearance(page)).toMatchObject({ fill: 40 });
});

test("a Fill sequence does not cross document-local layer ids", async ({ page }) => {
  await gotoApp(page);
  const ids = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "fill-a");
    mv.store.setTool("move");
    const docA = mv.store.state.activeDocId;
    const layerA = mv.store.state.activeLayerId;
    mv.store.setFillOpacity(layerA, 90);
    mv.store.setFillOpacity(layerA, 100);
    mv.store.newDocument(100, 100, "fill-b");
    const docB = mv.store.state.activeDocId;
    const layerB = mv.store.state.activeLayerId;
    mv.store.activateDoc(docA);
    return { docA, docB, layerA, layerB };
  });
  expect(ids.docA).not.toBe(ids.docB);
  expect(ids.layerA).toBe(ids.layerB);

  await page.keyboard.press("Shift+Digit4");
  await page.evaluate((docB) => (window as any).__mv.store.activateDoc(docB), ids.docB);
  await page.keyboard.press("Shift+Digit5");
  expect(await layerAppearance(page)).toMatchObject({ fill: 50 });
  await page.evaluate((docA) => (window as any).__mv.store.activateDoc(docA), ids.docA);
  expect(await layerAppearance(page)).toMatchObject({ fill: 40 });
});

test("a Fill sequence does not cross a document activation round-trip", async ({ page }) => {
  await gotoApp(page);
  const ids = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "fill-roundtrip-a");
    mv.store.setTool("move");
    mv.store.addLayer(); // keep A open when the pristine B document is created
    const a = mv.store.state.activeDocId;
    mv.store.newDocument(100, 100, "fill-roundtrip-b");
    const b = mv.store.state.activeDocId;
    mv.store.activateDoc(a);
    return { a, b };
  });
  expect(ids.a).not.toBe(ids.b);
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeDocId)).toBe(ids.a);

  await page.keyboard.press("Shift+Digit4");
  await page.evaluate(({ a, b }) => {
    const mv = (window as any).__mv;
    mv.store.activateDoc(b);
    mv.store.activateDoc(a);
  }, ids);
  await page.keyboard.press("Shift+Digit5");
  await page.keyboard.press("Escape");
  expect(await layerAppearance(page)).toMatchObject({ fill: 50 });
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerAppearance(page)).toMatchObject({ fill: 40 });
});

test("a Fill sequence does not cross a same-document engine replacement", async ({ page }) => {
  await gotoApp(page);
  const snapshotId = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "fill-restore");
    mv.store.setTool("move");
    return mv.store.takeSnapshot("Original");
  });

  await page.keyboard.press("Shift+Digit4");
  expect(await layerAppearance(page)).toMatchObject({ fill: 40 });
  await page.evaluate((id) => (window as any).__mv.store.restoreSnapshot(id), snapshotId);
  await page.keyboard.press("Shift+Digit5");
  await page.keyboard.press("Escape");
  expect(await layerAppearance(page)).toMatchObject({ fill: 50 });

  // The replacement engine's property edit must close independently so the
  // next gesture gets its own Undo step.
  await page.keyboard.press("Shift+Digit6");
  await page.keyboard.press("Escape");
  expect(await layerAppearance(page)).toMatchObject({ fill: 60 });
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerAppearance(page)).toMatchObject({ fill: 50 });
});

test("focused Layers-panel controls keep exact Fill entry in one Undo step", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "fill-focused");
    mv.store.setTool("move");
  });
  await page.getByRole("slider", { name: "Fill" }).focus();
  await page.keyboard.press("Shift+Digit4");
  await page.keyboard.press("Shift+Digit5");
  expect(await layerAppearance(page)).toMatchObject({ fill: 45 });
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerAppearance(page)).toMatchObject({ fill: 100 });
});

test("Shift+number changes a group's overall Opacity because groups have no Fill", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "group-opacity-shortcut");
    mv.store.createGroup();
    mv.store.setTool("move");
  });
  expect(await layerAppearance(page)).toMatchObject({ kind: 6, opacity: 100 });
  await page.keyboard.press("Shift+Digit4");
  await page.keyboard.press("Shift+Digit5");
  expect(await layerAppearance(page)).toMatchObject({ kind: 6, opacity: 45, fill: 100 });
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerAppearance(page)).toMatchObject({ kind: 6, opacity: 100, fill: 100 });

  await page.keyboard.press("Shift+Digit4");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Digit5");
  await page.keyboard.press("Escape");
  expect(await layerAppearance(page)).toMatchObject({ kind: 6, opacity: 50, fill: 100 });
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerAppearance(page)).toMatchObject({ kind: 6, opacity: 40, fill: 100 });
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await layerAppearance(page)).toMatchObject({ kind: 6, opacity: 100, fill: 100 });
});
