import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Filter ▸ Vanishing Point ─────────────────────────────────────
// Photoshop's Vanishing Point is a modal workspace: planes tear off each other's
// edges at a settable angle, and its own Marquee and Paste move and clone pixels
// in perspective. OK renders into the active layer as one history step; Cancel
// discards everything. The engine's Rust tests prove plane-space clone sampling;
// this spec drives the Vision shell with real pointer and keyboard input (#447).

const DOCW = 160;
const DOCH = 120;
type CanvasMap = { cx: (d: number) => number; cy: (d: number) => number };

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  }, { x, y });
}

async function canvasMap(page: Page): Promise<CanvasMap> {
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = canvases.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

// A red | green document with one root plane, the Vanishing Point tool armed.
async function setupPlane(page: Page, plane: number[] = [0, 0, DOCW, 0, DOCW, DOCH, 0, DOCH]) {
  await gotoApp(page);
  await page.evaluate(({ w, h, plane }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "vanishing-point");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w / 2, h, 0); E.fill_selection(255, 0, 0, 255);
    E.select_rect(w / 2, 0, w / 2, h, 0); E.fill_selection(0, 255, 0, 255);
    E.select_none();
    mv.engine.commit();
    mv.store.setBrush({ size: 18, hardness: 1, flow: 1, opacity: 1, smoothing: 0 });
    mv.store.setOptions({
      cloneSample: 2,
      vanishingPointPlanes: [{ quad: plane, parent: null, edge: 0, angle: 90 }],
      vanishingPointActivePlane: 0,
      vanishingPointSource: null,
    });
    mv.store.setTool("vanishingpoint");
    mv.store.fit();
  }, { w: DOCW, h: DOCH, plane });
  return await canvasMap(page);
}

async function openWorkspace(page: Page) {
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Vanishing Point…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Vanishing Point…")).run());
  const ws = page.locator("[data-mv-vp-workspace='1']");
  await expect(ws).toBeVisible();
  return ws;
}

async function vpState(page: Page) {
  return await page.evaluate(() => {
    const mv = (window as any).__mv;
    const s = mv.store.state;
    return {
      planes: s.vanishingPointPlanes as { quad: number[]; parent: number | null; edge: number; angle: number }[],
      active: s.vanishingPointActivePlane as number,
      source: s.vanishingPointSource as { x: number; y: number } | null,
      marquee: s.vanishingPointMarquee as { plane: number; u0: number; v0: number; u1: number; v1: number } | null,
      float: s.vanishingPointFloat as { plane: number; u0: number; v0: number; u1: number; v1: number } | null,
      history: [...s.history] as string[],
      transaction: mv.engine.engine.history_transaction_active() as boolean,
    };
  });
}

// Keys must reach the window handler, not a focused workspace button.
async function blurControls(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function altClick(page: Page, m: CanvasMap, x: number, y: number) {
  await page.keyboard.down("Alt");
  await page.mouse.move(m.cx(x + 0.5), m.cy(y + 0.5));
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("Alt");
}

async function dab(page: Page, m: CanvasMap, x: number, y: number) {
  await page.mouse.move(m.cx(x + 0.5), m.cy(y + 0.5));
  await page.mouse.down();
  await page.mouse.up();
}

async function drag(page: Page, m: CanvasMap, from: [number, number], to: [number, number], modifier?: "Alt" | "ControlOrMeta") {
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(m.cx(from[0]), m.cy(from[1]));
  await page.mouse.down();
  await page.mouse.move(m.cx(to[0]), m.cy(to[1]), { steps: 4 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

const isRed = (c: number[]) => c[0] > 200 && c[1] < 100 && c[2] < 100;
const isGreen = (c: number[]) => c[0] < 100 && c[1] > 200 && c[2] < 100;
const isBlue = (c: number[]) => c[0] < 100 && c[1] < 100 && c[2] > 200;

test("Vanishing Point opens from the Filter menu as a workspace and arms the tool", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => (window as any).__mv.store.newDocument(w, h, "vanishing-point-dialog"), { w: DOCW, h: DOCH });
  await page.getByRole("menuitem", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Vanishing Point…/ }).click(); // the name carries the shortcut hint
  const ws = page.locator("[data-mv-vp-workspace='1']");
  await expect(ws).toBeVisible();
  await expect(ws).toHaveAttribute("role", "dialog");
  await expect(ws).toHaveAttribute("aria-label", "Vanishing Point");
  await expect(ws.getByRole("toolbar", { name: "Vanishing Point tools" })).toBeVisible();
  await expect(ws.getByRole("button", { name: "Edit Plane" })).toHaveAttribute("aria-pressed", "true");
  await expect(ws.getByRole("button", { name: "Marquee" })).toHaveAttribute("aria-pressed", "false");
  expect((await vpState(page)).transaction).toBe(true);

  await ws.getByRole("button", { name: "OK", exact: true }).click();
  await expect(ws).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("vanishingpoint");
  await expect(page.locator("[data-mv-vanishing-point]")).toBeVisible();
  await expect(page.locator("[data-mv-vp-handle]")).toHaveCount(4);
  expect((await vpState(page)).transaction).toBe(false);
});

test("numeric corners edit the plane, and Reset then Esc in a corner field keeps the original plane and source", async ({ page }) => {
  const initial = [20, 20, 140, 20, 130, 90, 30, 90];
  await setupPlane(page, initial);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ vanishingPointSource: { x: 30, y: 60 } }));
  const ws = await openWorkspace(page);

  const tlx = ws.getByRole("spinbutton", { name: "TL X" });
  await tlx.fill("12");
  await tlx.press("Enter"); // commits the field; Enter in a text field never applies the workspace
  await expect.poll(async () => (await vpState(page)).planes[0].quad[0]).toBe(12);
  await expect(ws).toBeVisible();

  await ws.getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(async () => (await vpState(page)).source).toBeNull();
  expect((await vpState(page)).planes[0].quad).not.toEqual(initial);

  await tlx.press("Escape"); // Esc discards even from inside one of the workspace's own fields
  await expect(ws).toHaveCount(0);
  const after = await vpState(page);
  expect(after.planes).toEqual([{ quad: initial, parent: null, edge: 0, angle: 90 }]);
  expect(after.source).toEqual({ x: 30, y: 60 });
  expect(after.transaction).toBe(false);
});

test("Alt-click source plus a Vanishing Point dab clones through the tool path", async ({ page }) => {
  const m = await setupPlane(page);
  await expect(page.locator("[data-mv-vp-source]")).toHaveCount(0);

  await altClick(page, m, 30, 60);
  await expect(page.locator("[data-mv-vp-source]")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.vanishingPointSource)).toEqual({ x: 30, y: 60 });

  await dab(page, m, 120, 60);
  const c = await pixel(page, 120, 60);
  expect(c[0]).toBeGreaterThan(200);
  expect(c[1]).toBeLessThan(100);
});

test("dragging a Vanishing Point handle edits the plane quad", async ({ page }) => {
  const initial = [20, 20, 140, 20, 130, 90, 30, 90];
  const m = await setupPlane(page, initial);
  await expect(page.locator("[data-mv-vanishing-point]")).toBeVisible();

  await page.mouse.move(m.cx(20), m.cy(20));
  await page.mouse.down();
  await page.mouse.move(m.cx(8), m.cy(14), { steps: 3 });
  await page.mouse.up();

  const plane = (await vpState(page)).planes[0].quad;
  expect(plane[0]).toBeLessThan(20);
  expect(plane[1]).toBeLessThan(20);
  expect(plane.slice(2)).toEqual(initial.slice(2));
});

test("planes tear off an edge, stay linked to their parent, and fold at a settable angle", async ({ page }) => {
  const m = await setupPlane(page, [20, 20, 100, 20, 100, 100, 20, 100]);
  const ws = await openWorkspace(page);
  await expect(page.locator("[data-mv-vp-edge]")).toHaveCount(4);

  // ⌘/Ctrl-drag from the right edge's midpoint handle.
  await drag(page, m, [100, 60], [110, 60], "ControlOrMeta");
  await expect(page.locator("[data-mv-vp-plane]")).toHaveCount(2);
  let s = await vpState(page);
  expect(s.active).toBe(1);
  expect(s.planes[1]).toMatchObject({ parent: 0, edge: 1, angle: 90 });
  expect([s.planes[1].quad.slice(0, 2), s.planes[1].quad.slice(6, 8)]).toEqual([[100, 20], [100, 100]]);
  await expect(page.locator("[data-mv-vp-plane='1'][data-mv-vp-plane-active]")).toHaveCount(1);
  expect(s.transaction).toBe(true);

  const planeSelect = ws.getByRole("combobox", { name: "Vanishing Point plane" });
  await planeSelect.click();
  await expect(page.locator(".monet-listbox [role=option]")).toHaveCount(2);
  await page.locator('.monet-listbox [role=option][data-value="0"]').click();
  await expect.poll(async () => (await vpState(page)).active).toBe(0);
  await expect(ws.getByRole("spinbutton", { name: "Angle" })).toBeDisabled(); // a root plane has no fold
  await chooseOption(planeSelect, "1");
  await expect.poll(async () => (await vpState(page)).active).toBe(1);

  const angle = ws.getByRole("spinbutton", { name: "Angle" });
  await angle.fill("120");
  await angle.press("Enter");
  await expect.poll(async () => (await vpState(page)).planes[1].angle).toBe(120);
  const folded = (await vpState(page)).planes[1].quad;
  expect([folded.slice(0, 2), folded.slice(6, 8)]).toEqual([[100, 20], [100, 100]]); // the shared edge stays put
  expect(folded.slice(2, 6)).not.toEqual(s.planes[1].quad.slice(2, 6));

  // Moving the root's top-right corner carries the torn-off plane's shared corner.
  await drag(page, m, [100, 20], [104, 16]);
  s = await vpState(page);
  expect(s.planes[0].quad.slice(2, 4)).toEqual([104, 16]);
  expect([s.planes[1].quad.slice(0, 2), s.planes[1].quad.slice(6, 8)]).toContainEqual([104, 16]);

  // Keyboard only: Enter on the focused Tear Off button tears off; it must not apply the workspace.
  await chooseOption(planeSelect, "0");
  await planeSelect.focus();
  await page.keyboard.press("Tab");
  const edgeSelect = ws.getByRole("combobox", { name: "Tear-off edge" });
  await expect(edgeSelect).toBeFocused();
  await chooseOption(edgeSelect, "3");
  await page.keyboard.press("Tab");
  await expect(ws.getByRole("button", { name: "Tear Off" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-mv-vp-plane]")).toHaveCount(3);
  await expect(ws).toBeVisible();
  s = await vpState(page);
  expect(s.planes[2]).toMatchObject({ parent: 0, edge: 3 });
  expect(s.transaction).toBe(true);
});

test("the perspective marquee moves without editing pixels and Alt-drag clones on OK as one step", async ({ page }) => {
  const m = await setupPlane(page);
  const historyBefore = (await vpState(page)).history;
  const ws = await openWorkspace(page);
  await ws.getByRole("button", { name: "Marquee" }).click();
  await expect(ws.getByRole("button", { name: "Marquee" })).toHaveAttribute("aria-pressed", "true");

  await drag(page, m, [10, 40], [40, 80]);
  await expect(page.locator("[data-mv-vp-marquee]")).toHaveCount(1);
  let s = await vpState(page);
  expect(s.marquee!.plane).toBe(0);
  expect(s.marquee!.u0).toBeCloseTo(10 / DOCW, 2);
  expect(s.marquee!.u1).toBeCloseTo(40 / DOCW, 2);

  await drag(page, m, [25, 60], [35, 60]); // a plain drag inside moves the outline
  s = await vpState(page);
  expect(s.marquee!.u0).toBeCloseTo(20 / DOCW, 2);
  expect(s.float).toBeNull();
  expect(isRed(await pixel(page, 30, 60))).toBe(true);
  expect(isGreen(await pixel(page, 135, 60))).toBe(true);

  await drag(page, m, [30, 60], [130, 60], "Alt"); // Alt-drag floats a copy
  await expect(page.locator("[data-mv-vp-float]")).toHaveCount(1);
  await expect(page.locator("[data-mv-vp-float-preview]")).toHaveCount(1);
  s = await vpState(page);
  expect(s.float!.u0).toBeCloseTo(120 / DOCW, 2);
  expect(isGreen(await pixel(page, 135, 60))).toBe(true); // nothing is rendered before OK

  await ws.getByRole("button", { name: "OK", exact: true }).click();
  await expect(ws).toHaveCount(0);
  expect(isRed(await pixel(page, 135, 60))).toBe(true);
  expect(isGreen(await pixel(page, 110, 60))).toBe(true);
  s = await vpState(page);
  expect(s.history).toEqual([...historyBefore, "Vanishing Point"]);

  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(isGreen(await pixel(page, 135, 60))).toBe(true);
});

test("paste into perspective floats the clipboard onto a plane and renders it on OK", async ({ page }) => {
  const m = await setupPlane(page, [20, 20, 100, 20, 100, 100, 20, 100]);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 20, 0); E.fill_selection(0, 0, 255, 255);
    E.copy();
    E.select_none();
    mv.engine.commit();
  });
  const ws = await openWorkspace(page);
  await page.evaluate(() => {
    const store = (window as any).__mv.store;
    store.tearOffVanishingPlane(0, 1);
    store.setOptions({ vanishingPointActivePlane: 0 });
  });

  // ⌘V right after clicking a workspace button (which Chromium focuses) still pastes.
  const editPlane = ws.getByRole("button", { name: "Edit Plane" });
  await editPlane.click();
  await expect(editPlane).toBeFocused();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator("[data-mv-vp-float]")).toHaveCount(1);
  let s = await vpState(page);
  expect(s.float!.plane).toBe(0);
  await expect(ws.getByRole("button", { name: "Marquee" })).toHaveAttribute("aria-pressed", "true");

  // Drag the float from plane 0 onto the torn-off plane.
  await drag(page, m, [60, 60], [110, 60]);
  s = await vpState(page);
  expect(s.float!.plane).toBe(1);
  const pts = (await page.locator("[data-mv-vp-float]").getAttribute("points"))!.split(/[ ,]/).map(Number);
  const cx = Math.floor((pts[0] + pts[2] + pts[4] + pts[6]) / 4);
  const cy = Math.floor((pts[1] + pts[3] + pts[5] + pts[7]) / 4);
  expect(isGreen(await pixel(page, cx, cy))).toBe(true);

  await ws.getByRole("button", { name: "OK", exact: true }).click();
  await expect(ws).toHaveCount(0);
  expect(isBlue(await pixel(page, cx, cy))).toBe(true);
  expect(isGreen(await pixel(page, 140, 60))).toBe(true);
  expect(isRed(await pixel(page, 60, 60))).toBe(true);
});

for (const via of ["the Cancel button", "Escape"] as const) {
  test(`${via} discards tear-offs, strokes, clones and floats`, async ({ page }) => {
    const m = await setupPlane(page);
    await page.evaluate(() => (window as any).__mv.store.setOptions({ vanishingPointSource: { x: 30, y: 60 } }));
    const before = await vpState(page);
    const ws = await openWorkspace(page);
    await page.evaluate(() => (window as any).__mv.store.tearOffVanishingPlane(0, 1));

    await ws.getByRole("button", { name: "Stamp" }).click();
    await dab(page, m, 120, 60); // a clone stroke inside the open transaction
    expect(isRed(await pixel(page, 120, 60))).toBe(true);

    await ws.getByRole("button", { name: "Marquee" }).click();
    await drag(page, m, [10, 40], [40, 80]);
    await drag(page, m, [25, 60], [140, 60], "Alt");
    await expect(page.locator("[data-mv-vp-float]")).toHaveCount(1);

    if (via === "Escape") {
      await blurControls(page);
      await page.keyboard.press("Escape");
    } else {
      await ws.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    await expect(ws).toHaveCount(0);
    const after = await vpState(page);
    expect(after.planes).toEqual(before.planes);
    expect(after.source).toEqual({ x: 30, y: 60 });
    expect(after.history).toEqual(before.history);
    expect(after.transaction).toBe(false);
    expect(isGreen(await pixel(page, 120, 60))).toBe(true);
    expect(isGreen(await pixel(page, 140, 60))).toBe(true);
  });
}

test("paste with nothing copied reports how to fix it and floats nothing", async ({ page }) => {
  await setupPlane(page);
  const ws = await openWorkspace(page);
  await blurControls(page);
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.getByText("Edit blocked")).toBeVisible();
  await expect(page.getByText("Copy an image first", { exact: false })).toBeVisible();
  await expect(page.locator("[data-mv-vp-float]")).toHaveCount(0);
  await expect(ws).toBeVisible();
});

test("a float OK'd onto a locked layer reports the lock, keeps the workspace, and applies once unlocked", async ({ page }) => {
  const m = await setupPlane(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.set_layer_locked(mv.store.state.activeLayerId, true);
    mv.engine.commit();
  });
  const historyBefore = (await vpState(page)).history;
  const ws = await openWorkspace(page);
  await ws.getByRole("button", { name: "Marquee" }).click();
  await drag(page, m, [10, 40], [40, 80]);
  await drag(page, m, [25, 60], [140, 60], "Alt");
  await expect(page.locator("[data-mv-vp-float]")).toHaveCount(1);

  await ws.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByText("active layer is locked", { exact: false })).toBeVisible();
  // The refusal keeps the workspace and its float, so the toast's advice can be followed.
  await expect(ws).toBeVisible();
  await expect(page.locator("[data-mv-vp-float]")).toHaveCount(1);
  expect(isGreen(await pixel(page, 140, 60))).toBe(true);
  expect((await vpState(page)).transaction).toBe(true);

  await page.evaluate(() => {
    const store = (window as any).__mv.store;
    store.setLayerLocked(store.state.activeLayerId, false);
  });
  await ws.getByRole("button", { name: "OK", exact: true }).click();
  await expect(ws).toHaveCount(0);
  expect(isRed(await pixel(page, 140, 60))).toBe(true);
  const s = await vpState(page);
  expect(s.history).toEqual([...historyBefore, "Vanishing Point"]);
  expect(s.transaction).toBe(false);
});

test("hiding and showing a layer from the Layers panel mid-session still applies as one undoable step", async ({ page }) => {
  const m = await setupPlane(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ vanishingPointSource: { x: 30, y: 60 } }));
  const historyBefore = (await vpState(page)).history;
  const ws = await openWorkspace(page);
  await ws.getByRole("button", { name: "Stamp" }).click();
  await dab(page, m, 120, 60);
  expect(isRed(await pixel(page, 120, 60))).toBe(true);

  // The non-undoable eye pushes a state and drops it again inside the session.
  // Dispatched, so the test does not depend on where the dock sits under the workspace panels.
  await page.getByRole("switch", { name: "Hide layer" }).first().dispatchEvent("click");
  await expect(page.getByRole("switch", { name: "Show layer" })).toHaveCount(1);
  await page.getByRole("switch", { name: "Show layer" }).first().dispatchEvent("click");
  await expect(page.getByRole("switch", { name: "Show layer" })).toHaveCount(0);

  await ws.getByRole("button", { name: "OK", exact: true }).click();
  await expect(ws).toHaveCount(0);
  const s = await vpState(page);
  expect(s.transaction).toBe(false);
  expect(s.history).toEqual([...historyBefore, "Vanishing Point"]);
  expect(isRed(await pixel(page, 120, 60))).toBe(true);

  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(isGreen(await pixel(page, 120, 60))).toBe(true);
});

test("switching documents closes the workspace and leaves no open transaction", async ({ page }) => {
  await setupPlane(page);
  const ids = await page.evaluate(() => {
    const store = (window as any).__mv.store;
    const a = store.state.activeDocId;
    store.newDocument(80, 60, "other");
    const b = store.state.activeDocId;
    store.activateDoc(a);
    return { a, b };
  });
  const ws = await openWorkspace(page);
  await page.evaluate(() => (window as any).__mv.store.tearOffVanishingPlane(0, 1));

  await page.evaluate((b) => (window as any).__mv.store.activateDoc(b), ids.b);
  await expect(ws).toHaveCount(0);
  await page.evaluate((a) => (window as any).__mv.store.activateDoc(a), ids.a);
  const s = await vpState(page);
  expect(s.transaction).toBe(false);
  expect(s.planes).toHaveLength(1);
});

test("Enter with focus off the workspace controls applies", async ({ page }) => {
  const m = await setupPlane(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ vanishingPointSource: { x: 30, y: 60 } }));
  const historyBefore = (await vpState(page)).history;
  const ws = await openWorkspace(page);
  await ws.getByRole("button", { name: "Stamp" }).click();
  await dab(page, m, 120, 60);

  await blurControls(page);
  await page.keyboard.press("Enter");
  await expect(ws).toHaveCount(0);
  const s = await vpState(page);
  expect(s.history).toEqual([...historyBefore, "Vanishing Point"]);
  expect(s.transaction).toBe(false);
  expect(isRed(await pixel(page, 120, 60))).toBe(true);
});
