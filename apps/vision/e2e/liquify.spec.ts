import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Liquify forward-warp brush ─────────────────────────────────
// Drives the engine warp session through window.__mv (mirroring shear.spec.ts'
// pick_color style): a Push dab shoves a black bar sideways, the whole session
// is ONE "Liquify" history entry, and Undo restores the original pixels.

// Column of the darkest (lowest-R) pixel in row y — tracks the black bar.
async function darkCol(page: Page, y: number): Promise<number> {
  return await page.evaluate((y) => {
    const E = (window as any).__mv.engine.engine;
    const w = E.width();
    let bx = 0, br = 256;
    for (let x = 0; x < w; x++) {
      const r = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
      if (r < br) { br = r; bx = x; }
    }
    return bx;
  }, y);
}

async function rgbaAt(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const p = ((window as any).__mv.engine.engine.pick_color(x, y) >>> 0);
    return [(p >>> 24) & 255, (p >>> 16) & 255, (p >>> 8) & 255, p & 255];
  }, { x, y });
}

async function runCommand(page: Page, id: string) {
  await page.waitForFunction((commandId) => {
    const items = (window as any).__mv.commandPalette?.items ?? [];
    return items.some((i: any) => i.id === commandId);
  }, id, { timeout: 5000 });
  await page.evaluate((commandId) => {
    const items = (window as any).__mv.commandPalette.items;
    items.find((i: any) => i.id === commandId).run();
  }, id);
}

// A white doc with a 2px black vertical bar at x=40.
async function barDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(80, 80, "liquify");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 80, 80, 0); E.fill_selection(255, 255, 255, 255);
    E.select_rect(40, 0, 2, 80, 0); E.fill_selection(0, 0, 0, 255);
    E.select_none();
    mv.engine.commit();
  });
}

// White background layer with a transparent active top layer containing the same
// 2px black vertical bar. The composite matches barDoc, but the active-layer-only
// backdrop is transparent outside the bar.
async function layeredBarDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(80, 80, "liquify-layered");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 80, 80, 0); E.fill_selection(255, 255, 255, 255);
    const top = E.add_layer("bar");
    E.set_active_layer(top);
    E.select_rect(40, 0, 2, 80, 0); E.fill_selection(0, 0, 0, 255);
    E.select_none();
    mv.engine.commit();
  });
}

async function targetLayerDoc(page: Page): Promise<{ target: number; active: number }> {
  await gotoApp(page);
  return await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(80, 80, "liquify-target-layer");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 80, 80, 0); E.fill_selection(255, 255, 255, 255);
    const target = E.add_layer("target bar");
    E.set_active_layer(target);
    E.select_rect(40, 0, 2, 80, 0); E.fill_selection(0, 0, 0, 255);
    const active = E.add_layer("active marker");
    E.set_active_layer(active);
    E.select_rect(4, 4, 6, 6, 0); E.fill_selection(255, 0, 0, 255);
    E.select_none();
    mv.engine.commit();
    mv.store.selectLayer(active);
    return { target, active };
  });
}

async function overlayPixel(page: Page, selector: string, x: number, y: number): Promise<number[] | null> {
  return await page.evaluate(({ selector, x, y }) => {
    const cv = document.querySelector(selector) as HTMLCanvasElement | null;
    if (!cv || cv.width <= x || cv.height <= y) return null;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    return Array.from(ctx.getImageData(x, y, 1, 1).data);
  }, { selector, x, y });
}

async function overlayAlphaPixels(page: Page, selector: string): Promise<number> {
  return await page.evaluate((selector) => {
    const cv = document.querySelector(selector) as HTMLCanvasElement | null;
    if (!cv || !cv.width || !cv.height) return 0;
    const ctx = cv.getContext("2d");
    if (!ctx) return 0;
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
    return count;
  }, selector);
}

test("a Push warp shoves the bar sideways, localised to the brush", async ({ page }) => {
  await barDoc(page);
  expect(await darkCol(page, 40)).toBe(40); // bar starts at x=40

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("liquify");
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    // One Push dab at the bar's middle, dragging right by 12px.
    mv.store.liquifyDab(41, 40, 12, 0, 1);
    mv.store.endLiquify();
  });

  expect(await darkCol(page, 40)).toBeGreaterThan(45); // the middle of the bar moved right
  // Outside the 20px brush radius the bar is untouched (top/bottom rows).
  expect(await darkCol(page, 2)).toBe(40);
  expect(await darkCol(page, 78)).toBe(40);
});

test("Filter Liquify opens a modal workspace and Apply commits the session", async ({ page }) => {
  await barDoc(page);
  await runCommand(page, "liquify");
  const workspace = page.locator("[data-mv-liquify-workspace='1']");
  await expect(workspace).toBeVisible();
  await expect(workspace.getByText("Liquify", { exact: true })).toBeVisible();
  await expect(workspace.locator("[data-mv-liquify-tool-rail='1']")).toBeVisible();
  await expect(workspace.locator("[data-mv-liquify-settings-panel='1']")).toBeVisible();
  await expect(page.locator("#mv-liquify-target-layer")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("liquify");

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });

  await workspace.getByRole("button", { name: "Apply" }).click();
  await expect(workspace).toHaveCount(0);
  expect(await darkCol(page, 40)).toBeGreaterThan(45);
  expect(await page.evaluate(() =>
    (Array.from((window as any).__mv.engine.engine.history_labels()) as string[]).filter((l) => l === "Liquify").length)).toBe(1);
});

test("Filter Liquify modal tool rail drives the live workspace mode", async ({ page }) => {
  await barDoc(page);
  await runCommand(page, "liquify");
  const workspace = page.locator("[data-mv-liquify-workspace='1']");
  await expect(workspace).toBeVisible();

  const freeze = workspace.locator("[data-mv-liquify-workspace-mode='6']");
  await freeze.click();
  await expect(freeze).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as any).__mv.store.state.liquify.mode)).toBe(6);

  const frozen = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ size: 40, density: 1, pressure: 1, strength: 1 });
    mv.store.liquifyDab(40, 40, 0, 0, 1);
    const buf = mv.engine.liquifyFreezeMaskBuffer();
    return buf ? buf[40 * 80 + 40] : 0;
  });
  expect(frozen).toBeGreaterThan(0);

  const thaw = workspace.locator("[data-mv-liquify-workspace-mode='7']");
  await thaw.click();
  await expect(thaw).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as any).__mv.store.state.liquify.mode)).toBe(7);
  const thawed = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.liquifyDab(40, 40, 0, 0, 1);
    const buf = mv.engine.liquifyFreezeMaskBuffer();
    return buf ? buf[40 * 80 + 40] : 0;
  });
  expect(thawed).toBeLessThan(frozen);

  await workspace.getByRole("button", { name: "Cancel" }).click();
  await expect(workspace).toHaveCount(0);
});

test("Filter Liquify modal Cancel discards the live session", async ({ page }) => {
  await barDoc(page);
  await runCommand(page, "liquify");
  const workspace = page.locator("[data-mv-liquify-workspace='1']");
  await expect(workspace).toBeVisible();

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });
  expect(await darkCol(page, 40)).toBeGreaterThan(45);

  await workspace.getByRole("button", { name: "Cancel" }).click();
  await expect(workspace).toHaveCount(0);
  expect(await darkCol(page, 40)).toBe(40);
  expect(await page.evaluate(() =>
    (Array.from((window as any).__mv.engine.engine.history_labels()) as string[]).filter((l) => l === "Liquify").length)).toBe(0);
});

test("an active selection limits the Liquify editable area", async ({ page }) => {
  await barDoc(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    E.select_rect(0, 0, 80, 20, 0); // freeze out the row we are about to push
    mv.engine.sync();
    mv.store.setTool("liquify");
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
    mv.store.endLiquify();
  });

  expect(await darkCol(page, 40)).toBe(40);
});

test("a Liquify session is exactly one history entry and Undo restores it", async ({ page }) => {
  await barDoc(page);
  const liquifyEntries = () => page.evaluate(() =>
    (Array.from((window as any).__mv.engine.engine.history_labels()) as string[]).filter((l) => l === "Liquify").length);
  expect(await liquifyEntries()).toBe(0);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("liquify");
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    // Several dabs across one session must still collapse to ONE undo step.
    mv.store.liquifyDab(41, 40, 6, 0, 1);
    mv.store.liquifyDab(45, 40, 6, 0, 1);
    mv.store.liquifyDab(49, 40, 6, 0, 1);
    mv.store.endLiquify();
  });

  expect(await liquifyEntries()).toBe(1); // one entry for the whole session
  expect(await darkCol(page, 40)).toBeGreaterThan(45);

  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await darkCol(page, 40)).toBe(40); // back to the original bar
});

test("Esc cancels the session, leaving pixels and history untouched", async ({ page }) => {
  await barDoc(page);
  const liquifyEntries = () => page.evaluate(() =>
    (Array.from((window as any).__mv.engine.engine.history_labels()) as string[]).filter((l) => l === "Liquify").length);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("liquify");
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });
  expect(await darkCol(page, 40)).toBeGreaterThan(45); // warped live

  await page.evaluate(() => (window as any).__mv.store.cancelLiquify());
  expect(await darkCol(page, 40)).toBe(40); // restored exactly
  expect(await liquifyEntries()).toBe(0);    // no history step left behind
});

test("Restore All resets the live warp while keeping the Liquify session open", async ({ page }) => {
  await barDoc(page);
  const liquifyEntries = () => page.evaluate(() =>
    (Array.from((window as any).__mv.engine.engine.history_labels()) as string[]).filter((l) => l === "Liquify").length);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("liquify");
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });
  expect(await darkCol(page, 40)).toBeGreaterThan(45);

  await page.evaluate(() => (window as any).__mv.store.restoreLiquify());
  expect(await darkCol(page, 40)).toBe(40);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.liquifyDab(41, 40, 8, 0, 1);
    mv.store.endLiquify();
  });
  expect(await darkCol(page, 40)).toBeGreaterThan(43);
  expect(await liquifyEntries()).toBe(1);
});

test("Save Mesh and Load Mesh restore a live Liquify displacement", async ({ page }) => {
  await barDoc(page);
  const liquifyEntries = () => page.evaluate(() =>
    (Array.from((window as any).__mv.engine.engine.history_labels()) as string[]).filter((l) => l === "Liquify").length);

  await page.evaluate(() => (window as any).__mv.store.setTool("liquify"));
  await expect(page.getByText("Save Mesh")).toBeVisible();
  await expect(page.getByText("Load Mesh")).toBeVisible();
  await expect(page.getByText("Export Mesh")).toBeVisible();
  await expect(page.getByText("Import Mesh")).toBeVisible();

  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
    return mv.store.saveLiquifyMesh();
  })).toBe(true);
  const payload = await page.evaluate(() => {
    const bytes = (window as any).__mv.store.exportLiquifyMesh();
    return bytes ? Array.from(bytes as Uint8Array) : null;
  });
  expect(payload).not.toBeNull();
  const meshBytes = payload ?? [];
  expect(await darkCol(page, 40)).toBeGreaterThan(45);

  await page.evaluate(() => (window as any).__mv.store.restoreLiquify());
  expect(await darkCol(page, 40)).toBe(40);

  const mismatched = await page.evaluate((bytes) => {
    const text = new TextDecoder().decode(new Uint8Array(bytes));
    const mesh = JSON.parse(text);
    mesh.width = 81;
    return Array.from(new TextEncoder().encode(JSON.stringify(mesh)));
  }, meshBytes);
  expect(await page.evaluate((bytes) =>
    (window as any).__mv.store.importLiquifyMesh(new Uint8Array(bytes)), mismatched)).toBe(false);
  expect(await darkCol(page, 40)).toBe(40);

  expect(await page.evaluate((bytes) =>
    (window as any).__mv.store.importLiquifyMesh(new Uint8Array(bytes)), meshBytes)).toBe(true);
  expect(await darkCol(page, 40)).toBeGreaterThan(45);

  await page.evaluate(() => (window as any).__mv.store.restoreLiquify());
  expect(await darkCol(page, 40)).toBe(40);

  expect(await page.evaluate(() => (window as any).__mv.store.loadLiquifyMesh())).toBe(true);
  expect(await darkCol(page, 40)).toBeGreaterThan(45);

  await page.evaluate(() => (window as any).__mv.store.endLiquify());
  expect(await liquifyEntries()).toBe(1);
});

test("Show Backdrop displays the pre-warp image as a display-only Liquify overlay", async ({ page }) => {
  await barDoc(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("liquify"));
  await expect(page.locator("#mv-liquify-show-backdrop")).toBeVisible();
  await page.locator("#mv-liquify-show-backdrop").click();

  expect(await page.evaluate(() => (window as any).__mv.store.state.liquify.showBackdrop)).toBe(true);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0, backdropOpacity: 0.5 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });

  expect(await darkCol(page, 40)).toBeGreaterThan(45);
  await expect.poll(async () => {
    const px = await overlayPixel(page, "[data-mv-liquify-backdrop='1']", 40, 40);
    return px ? { r: px[0], a: px[3] } : null;
  }).toEqual({ r: 0, a: 128 });

  await page.evaluate(() => (window as any).__mv.store.endLiquify());
  await expect.poll(async () => {
    const px = await overlayPixel(page, "[data-mv-liquify-backdrop='1']", 40, 40);
    return px?.[3] ?? 0;
  }).toBe(0);
});

test("Show Backdrop can switch between all-layers, active-layer and behind-active sources", async ({ page }) => {
  await layeredBarDoc(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("liquify"));
  await page.locator("#mv-liquify-show-backdrop").click();
  const source = page.locator("#mv-liquify-backdrop-source");
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute("data-value", "all");
  await chooseOption(source, "active");

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0, backdropOpacity: 1 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });
  expect(await darkCol(page, 40)).toBeGreaterThan(45);

  await expect.poll(async () => {
    const outside = await overlayPixel(page, "[data-mv-liquify-backdrop='1']", 0, 40);
    const bar = await overlayPixel(page, "[data-mv-liquify-backdrop='1']", 40, 40);
    return outside && bar ? { outsideA: outside[3], barR: bar[0], barA: bar[3] } : null;
  }).toEqual({ outsideA: 0, barR: 0, barA: 255 });

  await chooseOption(source, "all");
  await expect.poll(async () => {
    const outside = await overlayPixel(page, "[data-mv-liquify-backdrop='1']", 0, 40);
    return outside ? { r: outside[0], a: outside[3] } : null;
  }).toEqual({ r: 255, a: 255 });

  await chooseOption(source, "behind");
  await expect.poll(async () => {
    const outside = await overlayPixel(page, "[data-mv-liquify-backdrop='1']", 0, 40);
    const bar = await overlayPixel(page, "[data-mv-liquify-backdrop='1']", 40, 40);
    return outside && bar ? { outsideR: outside[0], outsideA: outside[3], barR: bar[0], barA: bar[3] } : null;
  }).toEqual({ outsideR: 255, outsideA: 255, barR: 255, barA: 255 });
  expect(await page.evaluate(() =>
    Array.from((window as any).__mv.engine.engine.history_labels()).includes("Visibility"))).toBe(false);

  await page.evaluate(() => (window as any).__mv.store.endLiquify());
});

test("Target can liquify a non-active pixel layer and restore the selected layer", async ({ page }) => {
  const ids = await targetLayerDoc(page);
  expect(await darkCol(page, 40)).toBe(40);
  expect(await rgbaAt(page, 5, 5)).toEqual([255, 0, 0, 255]);

  await page.evaluate(() => (window as any).__mv.store.setTool("liquify"));
  const target = page.locator("#mv-liquify-target-layer");
  await expect(target).toBeVisible();
  await chooseOption(target, "target bar");
  await expect(target).toHaveAttribute("data-value", String(ids.target));
  expect(await page.evaluate(() => (window as any).__mv.store.state.liquify.targetLayerId)).toBe(ids.target);

  const state = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
    const during = { storeActive: mv.store.state.activeLayerId, engineActive: E.active_layer_id() };
    mv.store.setLiquify({ targetLayerId: 0 });
    const targetAfterIgnoredChange = mv.store.state.liquify.targetLayerId;
    mv.store.endLiquify();
    return {
      during,
      targetAfterIgnoredChange,
      storeActive: mv.store.state.activeLayerId,
      engineActive: E.active_layer_id(),
      entries: (Array.from(E.history_labels()) as string[]).filter((l) => l === "Liquify").length,
    };
  });

  expect(state.during).toEqual({ storeActive: ids.active, engineActive: ids.target });
  expect(state.targetAfterIgnoredChange).toBe(ids.target);
  expect(state.storeActive).toBe(ids.active);
  expect(state.engineActive).toBe(ids.active);
  expect(state.entries).toBe(1);
  expect(await darkCol(page, 40)).toBeGreaterThan(45);
  expect(await rgbaAt(page, 5, 5)).toEqual([255, 0, 0, 255]);
});

test("Preview toggles between the live Liquify warp and the before image", async ({ page }) => {
  await barDoc(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("liquify"));
  const preview = page.locator("#mv-liquify-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toBeChecked();

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });
  expect(await darkCol(page, 40)).toBeGreaterThan(45);

  await preview.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.liquify.preview)).toBe(false);
  await expect.poll(async () => {
    const px = await overlayPixel(page, "[data-mv-liquify-backdrop='1']", 40, 40);
    return px ? { r: px[0], a: px[3] } : null;
  }).toEqual({ r: 0, a: 255 });
  expect(await darkCol(page, 40)).toBeGreaterThan(45);

  await preview.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.liquify.preview)).toBe(true);
  await expect.poll(async () => {
    const px = await overlayPixel(page, "[data-mv-liquify-backdrop]", 40, 40);
    return px?.[3] ?? 0;
  }).toBe(0);

  await page.evaluate(() => (window as any).__mv.store.endLiquify());
});

test("Show Mesh displays and clears the live Liquify displacement grid", async ({ page }) => {
  await barDoc(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("liquify"));
  const showMesh = page.locator("#mv-liquify-show-mesh");
  await expect(showMesh).toBeVisible();
  await expect(showMesh).not.toBeChecked();
  await showMesh.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.liquify.showMesh)).toBe(true);
  await expect(page.locator("[data-mv-liquify-mesh='1']")).toBeVisible();

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });

  await expect.poll(() => overlayAlphaPixels(page, "[data-mv-liquify-mesh='1']")).toBeGreaterThan(0);
  expect(await darkCol(page, 40)).toBeGreaterThan(45);

  await page.evaluate(() => (window as any).__mv.store.endLiquify());
  await expect.poll(() => overlayAlphaPixels(page, "[data-mv-liquify-mesh='1']")).toBe(0);
});

test("Mask All, Clear Mask and Invert Mask control the Liquify freeze mask", async ({ page }) => {
  await barDoc(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("liquify"));
  await expect(page.getByText("Mask All")).toBeVisible();
  await expect(page.getByText("Clear Mask")).toBeVisible();
  await expect(page.getByText("Invert Mask")).toBeVisible();

  const maskAtBar = () => page.evaluate(() => {
    const mv = (window as any).__mv;
    const buf = mv.engine.liquifyFreezeMaskBuffer();
    return buf ? buf[40 * 80 + 41] : 0;
  });

  await page.getByText("Mask All").click();
  expect(await maskAtBar()).toBeGreaterThan(0);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });
  expect(await darkCol(page, 40)).toBe(40);

  await page.getByText("Clear Mask").click();
  expect(await maskAtBar()).toBe(0);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });
  expect(await darkCol(page, 40)).toBeGreaterThan(45);

  await page.evaluate(() => (window as any).__mv.store.restoreLiquify());
  expect(await darkCol(page, 40)).toBe(40);

  await page.getByText("Invert Mask").click();
  expect(await maskAtBar()).toBeGreaterThan(0);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });
  expect(await darkCol(page, 40)).toBe(40);

  await page.getByText("Invert Mask").click();
  expect(await maskAtBar()).toBe(0);
  await page.evaluate(() => (window as any).__mv.store.endLiquify());
});

test("Freeze Mask and Thaw Mask protect then restore Liquify editability", async ({ page }) => {
  await barDoc(page);

  await page.evaluate(() => (window as any).__mv.store.setTool("liquify"));
  await expect(page.getByText("Freeze Mask")).toBeVisible();
  await expect(page.getByText("Thaw Mask")).toBeVisible();

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ size: 40, density: 1, pressure: 1, strength: 1, mode: 6 });
    mv.store.liquifyDab(41, 40, 0, 0, 1);
  });
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    const buf = mv.engine.liquifyFreezeMaskBuffer();
    return !!buf && buf[40 * 80 + 41] > 0;
  })).toBe(true);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ mode: 0, strength: 0.9 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
  });
  expect(await darkCol(page, 40)).toBe(40);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setLiquify({ mode: 7, strength: 1 });
    mv.store.liquifyDab(41, 40, 0, 0, 1);
    mv.store.setLiquify({ mode: 0, strength: 0.9 });
    mv.store.liquifyDab(41, 40, 12, 0, 1);
    mv.store.endLiquify();
  });
  expect(await darkCol(page, 40)).toBeGreaterThan(45);
});
