import { expect, test, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

const DOC = { w: 160, h: 120 };

async function setup(page: Page) {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "temporary-erase");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none();
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 });
    mv.store.setTool("brush");
    mv.store.setBrush({ size: 14, hardness: 1, flow: 1, opacity: 1, spacing: 0.1 });
    mv.store.fit();
  }, DOC);
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5);
  const box = await page.locator(".mv-canvas-viewport canvas").first().boundingBox();
  if (!box) throw new Error("document canvas is not visible");
  return {
    x: (value: number) => box.x + value * box.width / DOC.w,
    y: (value: number) => box.y + value * box.height / DOC.h,
  };
}

const rgba = (page: Page, x: number, y: number) => page.evaluate(({ x, y }) => {
  const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
  return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
}, { x, y });

const dispatchBackquote = (
  page: Page,
  type: "keydown" | "keyup",
  modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
) => page.evaluate(({ type, modifiers }) => !window.dispatchEvent(new KeyboardEvent(type, {
  ...modifiers,
  bubbles: true,
  cancelable: true,
  code: "Backquote",
  key: "`",
})), { type, modifiers });

test("holding grave temporarily erases with the same Brush and release or blur restores painting", async ({ page }) => {
  const map = await setup(page);
  const signature = () => page.evaluate(() => {
    const state = (window as any).__mv.store.state;
    const { size, hardness, flow, opacity, spacing } = state.brush;
    return { tool: state.tool, activeBrushTip: state.activeBrushTip, size, hardness, flow, opacity, spacing };
  });
  const brush = await signature();

  await page.keyboard.down("Backquote");
  await page.keyboard.down("Backquote");
  expect(await signature()).toEqual(brush);
  await page.mouse.click(map.x(30), map.y(30));
  expect((await rgba(page, 30, 30))[3]).toBeLessThan(128);
  await page.keyboard.up("Backquote");

  await page.mouse.click(map.x(70), map.y(30));
  const painted = await rgba(page, 70, 30);
  expect(painted[0]).toBeLessThan(40);
  expect(painted[3]).toBeGreaterThan(240);

  await page.keyboard.down("Backquote");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.click(map.x(110), map.y(30));
  await page.keyboard.up("Backquote");
  const afterBlur = await rgba(page, 110, 30);
  expect(afterBlur[0]).toBeLessThan(40);
  expect(afterBlur[3]).toBeGreaterThan(240);

  // Brush-setting pushes during a live drag must retain the mode sampled at
  // pointerdown, or local pixels can diverge from undo/collaboration history.
  await page.keyboard.down("Backquote");
  await page.mouse.move(map.x(25), map.y(65));
  await page.mouse.down();
  await page.keyboard.up("Backquote");
  await page.keyboard.press("BracketRight");
  await page.keyboard.press("BracketLeft");
  await page.keyboard.press("Shift+KeyB");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("pencil");
  await page.mouse.move(map.x(55), map.y(65), { steps: 4 });
  await page.mouse.up();
  expect((await rgba(page, 55, 65))[3]).toBeLessThan(128);
  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));

  await page.mouse.move(map.x(75), map.y(65));
  await page.mouse.down();
  await page.keyboard.down("Backquote");
  await page.keyboard.press("BracketRight");
  await page.keyboard.press("BracketLeft");
  await page.mouse.move(map.x(105), map.y(65), { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Backquote");
  const latchedPaint = await rgba(page, 105, 65);
  expect(latchedPaint[0]).toBeLessThan(40);
  expect(latchedPaint[3]).toBeGreaterThan(240);

  await page.keyboard.down("Shift");
  await page.keyboard.down("Backquote");
  await page.mouse.click(map.x(15), map.y(100));
  await page.keyboard.up("Backquote");
  await page.keyboard.up("Shift");
  expect((await rgba(page, 15, 100))[3]).toBeLessThan(128);

  for (const [x, modifiers] of [
    [45, { altKey: true }],
    [75, { ctrlKey: true }],
    [105, { metaKey: true }],
  ] as const) {
    expect(await dispatchBackquote(page, "keydown", modifiers)).toBe(false);
    await page.mouse.click(map.x(x), map.y(100));
    await dispatchBackquote(page, "keyup", modifiers);
    const color = await rgba(page, x, 100);
    expect(color[0]).toBeLessThan(40);
    expect(color[3]).toBeGreaterThan(240);
  }

  await page.evaluate(() => (window as any).__mv.store.setTool("pencil"));
  expect(await dispatchBackquote(page, "keydown")).toBe(false);
  await page.mouse.click(map.x(135), map.y(100));
  await dispatchBackquote(page, "keyup");
  const pencil = await rgba(page, 135, 100);
  expect(pencil[0]).toBeLessThan(40);
  expect(pencil[3]).toBeGreaterThan(240);
  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));

  await page.locator("#mv-status-zoom").focus();
  await page.keyboard.down("Backquote");
  await page.mouse.click(map.x(130), map.y(85));
  await page.keyboard.up("Backquote");
  const inputGuard = await rgba(page, 130, 85);
  expect(inputGuard[0]).toBeLessThan(40);
  expect(inputGuard[3]).toBeGreaterThan(240);
  expect(await signature()).toEqual(brush);
});

test("grave erases with the selected custom Brush tip instead of a round disc", async ({ page }) => {
  const map = await setup(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255); E.select_none();
    E.select_rect(0, 0, 4, 16, 0); E.fill_selection(0, 0, 0, 255); E.select_none();
    mv.engine.commit();
    E.select_rect(0, 0, 16, 16, 0);
    mv.store.defineBrushPreset();
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255); E.select_none();
    mv.engine.commit();
    mv.store.setBrush({ size: 16, hardness: 1, flow: 1, opacity: 1, spacing: 0.1 });
  });

  expect(await page.evaluate(() => (window as any).__mv.store.state.activeBrushTip)).toBe(0);
  await page.keyboard.down("Backquote");
  await page.mouse.click(map.x(40), map.y(40));
  await page.keyboard.up("Backquote");

  expect((await rgba(page, 33, 33))[3]).toBeLessThan(128);
  expect((await rgba(page, 42, 40))[3]).toBeGreaterThan(240);
  expect(await page.evaluate(() => (window as any).__mv.store.state.activeBrushTip)).toBe(0);
});

test("pointer cancellation fully terminates paint and non-paint drags", async ({ page }) => {
  const map = await setup(page);
  const dragThenCancel = (
    start: { x: number; y: number },
    end: { x: number; y: number },
    afterCancel?: { x: number; y: number },
  ) => page.evaluate(({ start, end, afterCancel }) => {
    const target = document.querySelector(".mv-canvas-viewport")!;
    const fire = (type: string, point: { x: number; y: number }, buttons: number) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 71,
      pointerType: "mouse",
      button: 0,
      buttons,
      clientX: point.x,
      clientY: point.y,
    }));
    fire("pointerdown", start, 1);
    fire("pointermove", end, 1);
    fire("pointercancel", end, 0);
    // A canceled gesture is terminal: later events for that pointer must not
    // revive stale drag state or commit the canceled tool operation.
    if (afterCancel) {
      fire("pointermove", afterCancel, 1);
      fire("pointerup", afterCancel, 0);
    }
  }, { start, end, afterCancel });

  await page.evaluate(() => (window as any).__mv.store.setTool("crop"));
  await dragThenCancel(
    { x: map.x(20), y: map.y(20) },
    { x: map.x(100), y: map.y(80) },
    { x: map.x(120), y: map.y(90) },
  );
  expect(await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return [E.width(), E.height()];
  })).toEqual([DOC.w, DOC.h]);

  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  const moveHistory = await page.evaluate(() => (window as any).__mv.store.state.undoDepth);
  await dragThenCancel(
    { x: map.x(60), y: map.y(60) },
    { x: map.x(90), y: map.y(60) },
    { x: map.x(110), y: map.y(60) },
  );
  expect((await rgba(page, 2, 60))[3]).toBeGreaterThan(240);
  expect(await page.evaluate(() => (window as any).__mv.store.state.undoDepth)).toBe(moveHistory);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setOptions({ vanishingPointPlanes: [{ quad: [20, 20, 140, 20, 140, 100, 20, 100], parent: null, edge: 0, angle: 90 }], vanishingPointActivePlane: 0 });
    mv.store.setTool("vanishingpoint");
    mv.store.markActiveSaved();
  });
  const vpBox = await page.locator(".mv-canvas-viewport canvas").first().boundingBox();
  if (!vpBox) throw new Error("document canvas is not visible for Vanishing Point");
  const vpX = (value: number) => vpBox.x + value * vpBox.width / DOC.w;
  const vpY = (value: number) => vpBox.y + value * vpBox.height / DOC.h;
  const vpHistory = await page.evaluate(() => (window as any).__mv.store.state.undoDepth);
  await page.mouse.move(vpX(20), vpY(20));
  await page.mouse.down();
  await page.mouse.move(vpX(30), vpY(30));
  await expect.poll(() => page.evaluate(() =>
    (window as any).__mv.store.state.vanishingPointPlanes[0].quad.slice(0, 2),
  )).toEqual([30, 30]);
  await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y) ?? document.querySelector(".mv-canvas-viewport")!;
    target.dispatchEvent(new PointerEvent("pointercancel", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 0,
      clientX: x,
      clientY: y,
    }));
  }, { x: vpX(30), y: vpY(30) });
  await page.mouse.move(vpX(50), vpY(50));
  await page.mouse.up();
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      handle: mv.store.state.vanishingPointPlanes[0].quad.slice(0, 2),
      history: mv.store.state.undoDepth,
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
    };
  })).toEqual({ handle: [30, 30], history: vpHistory, dirty: false });

  const rejectedHistory = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("brush");
    mv.engine.engine.set_layer_locked(mv.store.state.activeLayerId, true);
    mv.store.markActiveSaved();
    return mv.engine.engine.undo_depth();
  });
  await dragThenCancel({ x: map.x(120), y: map.y(80) }, { x: map.x(130), y: map.y(80) });
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      history: mv.engine.engine.undo_depth(),
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
    };
  })).toEqual({ history: rejectedHistory, dirty: false });
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.set_layer_locked(mv.store.state.activeLayerId, false);
  });

  const gradientBefore = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("gradient");
    return { history: mv.store.state.undoDepth, pixel: mv.engine.engine.pick_color(80, 60) >>> 0 };
  });
  await dragThenCancel(
    { x: map.x(20), y: map.y(20) },
    { x: map.x(140), y: map.y(100) },
    { x: map.x(80), y: map.y(60) },
  );
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return { history: mv.store.state.undoDepth, pixel: mv.engine.engine.pick_color(80, 60) >>> 0 };
  })).toEqual(gradientBefore);

  const frameBefore = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("frame");
    return { history: mv.store.state.undoDepth, layers: mv.engine.engine.layer_count() };
  });
  await dragThenCancel(
    { x: map.x(20), y: map.y(20) },
    { x: map.x(100), y: map.y(80) },
    { x: map.x(120), y: map.y(90) },
  );
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return { history: mv.store.state.undoDepth, layers: mv.engine.engine.layer_count() };
  })).toEqual(frameBefore);

  const patchBefore = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(20, 20, 20, 20, 0);
    mv.engine.commit();
    mv.store.setTool("patch");
    return { history: mv.store.state.undoDepth, pixel: E.pick_color(30, 30) >>> 0 };
  });
  await dragThenCancel(
    { x: map.x(30), y: map.y(30) },
    { x: map.x(80), y: map.y(30) },
    { x: map.x(100), y: map.y(30) },
  );
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    return { history: mv.store.state.undoDepth, pixel: mv.engine.engine.pick_color(30, 30) >>> 0 };
  })).toEqual(patchBefore);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.select_none();
    mv.store.setTool("liquify");
    mv.store.setLiquify({ size: 40, density: 1, pressure: 1, strength: 1, mode: 1, rate: 1 });
  });
  await dragThenCancel({ x: map.x(80), y: map.y(60) }, { x: map.x(80), y: map.y(60) });
  const liquifyGen = await page.evaluate(() => (window as any).__mv.store.state.liquifyMeshGen);
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => (window as any).__mv.store.state.liquifyMeshGen)).toBe(liquifyGen);
  await page.evaluate(() => (window as any).__mv.store.cancelLiquify());

  const history = await page.evaluate(() => (window as any).__mv.store.state.undoDepth);
  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));
  await page.keyboard.down("Backquote");
  await dragThenCancel({ x: map.x(30), y: map.y(100) }, { x: map.x(80), y: map.y(100) });
  await page.keyboard.up("Backquote");
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.undoDepth)).toBeGreaterThan(history);
  expect((await rgba(page, 55, 100))[3]).toBeLessThan(128);
});

test("switching document tabs closes a live stroke on its source document", async ({ page }) => {
  const map = await setup(page);
  const ids = await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    const source = mv.store.state.activeDocId;
    const sourceHistory = mv.store.state.undoDepth;
    mv.store.newDocument(w, h, "stroke-target");
    const target = mv.store.state.activeDocId;
    const targetHistory = mv.store.state.undoDepth;
    mv.store.activateDoc(source);
    return { source, target, sourceHistory, targetHistory };
  }, DOC);

  await page.mouse.move(map.x(20), map.y(60));
  await page.mouse.down();
  await page.mouse.move(map.x(60), map.y(60), { steps: 4 });
  await page.evaluate((target) => (window as any).__mv.store.activateDoc(target), ids.target);
  await page.mouse.move(map.x(120), map.y(60), { steps: 4 });
  await page.mouse.up();

  const target = await rgba(page, 120, 60);
  expect(target[0]).toBeGreaterThan(240);
  expect(await page.evaluate(() => (window as any).__mv.store.state.undoDepth)).toBe(ids.targetHistory);

  await page.evaluate((source) => (window as any).__mv.store.activateDoc(source), ids.source);
  const painted = await rgba(page, 50, 60);
  expect(painted[0]).toBeLessThan(40);
  expect(await page.evaluate(() => (window as any).__mv.store.state.undoDepth)).toBe(ids.sourceHistory + 1);

  await page.mouse.click(map.x(140), map.y(100));
  expect((await rgba(page, 140, 100))[0]).toBeLessThan(40);
  expect(await page.evaluate(() => (window as any).__mv.store.state.undoDepth)).toBe(ids.sourceHistory + 2);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect((await rgba(page, 140, 100))[0]).toBeGreaterThan(240);
  expect((await rgba(page, 50, 60))[0]).toBeLessThan(40);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect((await rgba(page, 50, 60))[0]).toBeGreaterThan(240);
});
