import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// Photoshop Paint Symmetry: brush strokes are echoed across a symmetry axis.
// Vision mirrors each brush dab across the document-centre axis/axes.
test("Paint Symmetry mirrors a brush stroke across the axis", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "sym");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, 40, 0); E.fill_selection(255, 255, 255, 255); E.select_none();
    E.set_brush(4, 1, 1, 1, 0.1, 255, 0, 0, 255, false);
    E.set_brush_mode(0);
    mv.store.setPaintSymmetry(1); // vertical axis at the document centre (x = 20)
    E.stroke_begin();
    E.stroke_to(8, 20, 1);
    E.stroke_end();
    E.composite(); // refresh the composite so pick_color sees the paint
    const saved = mv.store.saveProject();
    mv.store.setPaintSymmetry(0);
    mv.store.openProject(saved, "symmetry-roundtrip.mvision");
    const reopened = mv.engine.engine;
    return {
      sym: mv.store.state.paintSymmetry,
      left: E.pick_color(8, 20),
      right: E.pick_color(32, 20),
      axis: E.pick_color(20, 20),
      engineSym: reopened.paint_symmetry_mode(),
      axisX: reopened.paint_symmetry_axis_x(),
      axisY: reopened.paint_symmetry_axis_y(),
    };
  });
  expect(r.sym).toBe(1);
  expect(r.engineSym).toBe(1);
  expect(r.axisX).toBe(20);
  expect(r.axisY).toBe(20);
  expect(r.left).not.toBe(r.axis); // the dab painted the left
  expect(r.right).not.toBe(r.axis); // and its mirror painted the right
  expect(r.right).toBe(r.left); // both are the same red
});

test("advanced symmetry presets expose bounded controls and persist", async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-tab-id="brushes"]').click();
  for (const mode of [4, 5, 6, 7, 8]) {
    await page.locator(`[data-mv-symmetry="${mode}"]`).click();
    expect(await page.evaluate(() => (window as any).__mv.store.state.paintSymmetry)).toBe(mode);
  }

  await page.locator('[data-mv-symmetry="9"]').click();
  const segments = page.getByLabel("Symmetry segments");
  await expect(segments).toBeVisible();
  await segments.fill("12");
  await segments.press("Enter");
  await expect(segments).toHaveValue("12");

  await page.locator('[data-mv-symmetry="10"]').click();
  await expect(segments).toHaveValue("10");
  await segments.fill("7");
  await segments.press("Enter");

  const reopened = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const saved = mv.store.saveProject();
    mv.store.setPaintSymmetry(0);
    mv.store.openProject(saved, "mandala-roundtrip.mvision");
    return {
      mode: mv.store.state.paintSymmetry,
      segments: mv.store.state.paintSymmetrySegments,
      engineSegments: mv.engine.engine.paint_symmetry_segment_count(),
    };
  });
  expect(reopened).toEqual({ mode: 10, segments: 7, engineSegments: 7 });
});

test("Image Transform Symmetry translates, rotates, scales, undoes, and persists", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 60, "symmetry-transform");
    mv.store.setPaintSymmetry(1);
    mv.store.markActiveSaved();
  });
  await page.locator('[data-tab-id="brushes"]').click();
  await expect(page.locator('[data-mv-symmetry-guide="1"]')).toBeVisible();

  await page.locator("[data-mv-toggle-symmetry-guide]").click();
  await expect(page.locator("[data-mv-symmetry-guide]")).toHaveCount(0);
  await page.locator("[data-mv-toggle-symmetry-guide]").click();
  await expect(page.locator('[data-mv-symmetry-guide="1"]')).toBeVisible();

  await page.getByText("Image", { exact: true }).first().click();
  await page.getByText("Transform Symmetry", { exact: true }).locator("..").evaluate((item: HTMLElement) => item.click());
  await expect(page.locator("[data-mv-symmetry-handle]")).toBeVisible();
  await expect(page.locator("[data-mv-symmetry-transform-handle]")).toBeVisible();

  const dragCentreBy = async (dx: number, dy: number) => {
    const box = await page.locator("[data-mv-symmetry-handle]").boundingBox();
    expect(box).not.toBeNull();
    const zoom = await page.evaluate(() => (window as any).__mv.store.state.zoom);
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx * zoom, y + dy * zoom, { steps: 5 });
    await page.mouse.up();
  };
  const dragOuterTo = async (angle: number, scale: number) => {
    const centre = await page.locator("[data-mv-symmetry-handle]").boundingBox();
    const outer = await page.locator("[data-mv-symmetry-transform-handle]").boundingBox();
    expect(centre).not.toBeNull();
    expect(outer).not.toBeNull();
    const state = await page.evaluate(() => {
      const s = (window as any).__mv.store.state;
      return { zoom: s.zoom, width: s.doc.width, height: s.doc.height };
    });
    const cx = centre!.x + centre!.width / 2;
    const cy = centre!.y + centre!.height / 2;
    const radius = Math.min(state.width, state.height) * 0.35 * scale * state.zoom;
    const radians = angle * Math.PI / 180;
    const targetX = cx + Math.sin(radians) * radius;
    const targetY = cy - Math.cos(radians) * radius;
    await page.mouse.move(outer!.x + outer!.width / 2, outer!.y + outer!.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 8 });
    await page.mouse.up();
  };

  await dragCentreBy(5, 0);
  await dragOuterTo(45, 1.2);
  await page.evaluate(() => (window as any).__mv.engine.sync());
  expect(await page.evaluate(() => (window as any).__mv.store.state.paintSymmetryAxisX)).toBeCloseTo(55, 3);
  expect(await page.evaluate(() => (window as any).__mv.store.state.paintSymmetryAngle)).toBeCloseTo(45, 2);
  expect(await page.evaluate(() => (window as any).__mv.store.state.paintSymmetryScale)).toBeCloseTo(1.2, 2);
  await page.keyboard.press("Escape");
  const cancelled = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      x: mv.store.state.paintSymmetryAxisX,
      y: mv.store.state.paintSymmetryAxisY,
      angle: mv.store.state.paintSymmetryAngle,
      scale: mv.store.state.paintSymmetryScale,
      transforming: mv.store.state.paintSymmetryTransforming,
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
    };
  });
  expect(cancelled).toEqual({ x: 50, y: 30, angle: 0, scale: 1, transforming: false, dirty: false });

  await page.locator("[data-mv-transform-symmetry]").click();
  await dragCentreBy(10, 0);
  await dragOuterTo(90, 1.5);
  await page.keyboard.press("Enter");
  const transformed = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      x: mv.store.state.paintSymmetryAxisX,
      y: mv.store.state.paintSymmetryAxisY,
      angle: mv.store.state.paintSymmetryAngle,
      scale: mv.store.state.paintSymmetryScale,
      undoLabel: mv.engine.engine.undo_label(),
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
    };
  });
  expect(transformed.x).toBeCloseTo(60, 3);
  expect(transformed.y).toBeCloseTo(30, 3);
  expect(transformed.angle).toBeCloseTo(90, 2);
  expect(transformed.scale).toBeCloseTo(1.5, 2);
  expect(transformed.undoLabel).toBe("Paint Symmetry");
  expect(transformed.dirty).toBe(true);

  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return [s.paintSymmetryAxisX, s.paintSymmetryAxisY, s.paintSymmetryAngle, s.paintSymmetryScale];
  })).toEqual([50, 30, 0, 1]);
  await page.evaluate(() => (window as any).__mv.store.redo());
  const redone = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return [s.paintSymmetryAxisX, s.paintSymmetryAxisY, s.paintSymmetryAngle, s.paintSymmetryScale];
  });
  expect(redone[0]).toBeCloseTo(60, 3);
  expect(redone[1]).toBeCloseTo(30, 3);
  expect(redone[2]).toBeCloseTo(90, 2);
  expect(redone[3]).toBeCloseTo(1.5, 2);

  const committed = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none();
    E.set_brush(3, 1, 1, 1, 0.1, 255, 0, 0, 255, false);
    E.set_brush_mode(0);
    E.stroke_begin(); E.stroke_to(60, 15, 1); E.stroke_end(); E.composite();
    const dirty = mv.store.docDirty(mv.store.state.activeDocId);
    const saved = mv.store.saveProject();
    mv.store.setPaintSymmetry(0);
    mv.store.openProject(saved, "transformed-symmetry.mvision");
    const reopened = mv.engine.engine;
    return {
      axis: mv.store.state.paintSymmetryAxisX,
      engineAxis: reopened.paint_symmetry_axis_x(),
      angle: reopened.paint_symmetry_angle(),
      scale: reopened.paint_symmetry_scale(),
      transforming: mv.store.state.paintSymmetryTransforming,
      dirty,
      source: reopened.pick_color(60, 15),
      mirror: reopened.pick_color(60, 45),
      background: reopened.pick_color(10, 10),
    };
  });
  expect(committed.axis).toBeCloseTo(60, 3);
  expect(committed.engineAxis).toBeCloseTo(60, 3);
  expect(committed.angle).toBeCloseTo(90, 2);
  expect(committed.scale).toBeCloseTo(1.5, 2);
  expect(committed.transforming).toBe(false);
  expect(committed.dirty).toBe(true);
  expect(committed.source).not.toBe(committed.background);
  expect(committed.mirror).toBe(committed.source);
});
