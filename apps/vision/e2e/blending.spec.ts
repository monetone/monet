import { test, expect } from "@playwright/test";
import { gotoApp, composite } from "./helpers";

// ─────────────────────────────────────────────────────────────
// Blending Options (Photoshop Layer Style): advanced blending
// (fill opacity, knockout, Blend If) + the 10 layer effects, and
// blend modes working on every layer kind (raster, text, smart
// object, adjustment, group).
//
// Effects are verified by their *coverage* / region behaviour on a
// transparent canvas (a centred opaque red square on its own layer),
// which is blend-mode- and backdrop-independent:
//   • below-effects (drop shadow, outer glow) and outside-stroke add
//     alpha OUTSIDE the shape (transparent → opaque);
//   • overlays / inner effects / bevel change colour INSIDE the shape.
// ─────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => { await gotoApp(page); });

// FX ids (engine/src/effects.rs, state/effects.ts)
const FX = {
  DROP_SHADOW: 0, INNER_SHADOW: 1, OUTER_GLOW: 2, INNER_GLOW: 3, BEVEL: 4,
  SATIN: 5, COLOR_OVERLAY: 6, GRADIENT_OVERLAY: 7, PATTERN_OVERLAY: 8, STROKE: 9,
};

// Transparent canvas + red square on layer above a hidden white background.
// Returns the shape layer id. Square occupies x,y ∈ [40,80).
async function shapeScene(page: import("@playwright/test").Page, keepBg = false) {
  return await page.evaluate((keepBg) => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(120, 120, "fx");
    if (!keepBg) E().set_layer_visible(E().layer_id_at(0), false);
    const id = E().add_layer("shape");
    E().set_active_layer(id);
    E().select_rect(40, 40, 40, 40, 0);
    E().fill_selection(255, 0, 0, 255);
    E().select_none();
    mv.engine.commit();
    return id;
  }, keepBg);
}

// ── below-effects + stroke: add alpha outside the shape ──────────

test("outer glow adds a halo (alpha) outside the shape", async ({ page }) => {
  const id = await shapeScene(page);
  const r = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    const A = (x: number, y: number) => (E().pick_color(x, y) >>> 0) & 0xff;
    const before = A(34, 60);
    E().set_layer_effect(id, FX.OUTER_GLOW, Float32Array.from([1, 7, 0.9, 0, 1, 1, 0.4, 24]));
    const c = E().pick_color(60, 60) >>> 0;
    return { before, after: A(34, 60), centerR: (c >>> 24) & 0xff, centerA: c & 0xff, hasFx: E().layer_has_effects(id) };
  }, { id, FX });
  expect(r.before).toBe(0);          // outside was transparent
  expect(r.after).toBeGreaterThan(20); // glow halo now covers it
  expect(r.centerR).toBeGreaterThan(220); // shape interior unchanged
  expect(r.centerA).toBe(255);
  expect(r.hasFx).toBe(true);
});

test("drop shadow casts an offset, dark halo outside the shape", async ({ page }) => {
  const id = await shapeScene(page);
  const r = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    const before = (E().pick_color(88, 88) >>> 0) & 0xff;
    E().set_layer_effect(id, FX.DROP_SHADOW, Float32Array.from([1, 0, 0.9, 0, 0, 0, 135, 14, 0, 8]));
    const c = E().pick_color(88, 88) >>> 0;
    return { before, afterA: c & 0xff, r: (c >>> 24) & 0xff, g: (c >>> 16) & 0xff, b: (c >>> 8) & 0xff };
  }, { id, FX });
  expect(r.before).toBe(0);
  expect(r.afterA).toBeGreaterThan(20);   // shadow present down-right
  expect(r.r).toBeLessThan(90);           // and dark
  expect(r.g).toBeLessThan(90);
  expect(r.b).toBeLessThan(90);
});

test("stroke (outside) outlines the shape edge", async ({ page }) => {
  const id = await shapeScene(page);
  const r = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    const before = (E().pick_color(37, 60) >>> 0) & 0xff;
    E().set_layer_effect(id, FX.STROKE, Float32Array.from([1, 0, 1, 0, 1, 0, 4, 0]));
    const c = E().pick_color(37, 60) >>> 0;
    return { before, afterA: c & 0xff, g: (c >>> 16) & 0xff, r: (c >>> 24) & 0xff };
  }, { id, FX });
  expect(r.before).toBe(0);
  expect(r.afterA).toBeGreaterThan(150); // solid stroke ring
  expect(r.g).toBeGreaterThan(150);      // green
  expect(r.r).toBeLessThan(90);
});

// ── above-effects: recolour inside the shape ────────────────────

test("color overlay repaints the shape interior", async ({ page }) => {
  const id = await shapeScene(page);
  const r = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    const before = E().pick_color(60, 60) >>> 0;
    E().set_layer_effect(id, FX.COLOR_OVERLAY, Float32Array.from([1, 0, 1, 0, 0, 1]));
    const after = E().pick_color(60, 60) >>> 0;
    return { beforeR: (before >>> 24) & 0xff, afterB: (after >>> 8) & 0xff, afterR: (after >>> 24) & 0xff, afterA: after & 0xff };
  }, { id, FX });
  expect(r.beforeR).toBeGreaterThan(220); // was red
  expect(r.afterB).toBeGreaterThan(220);  // now blue
  expect(r.afterR).toBeLessThan(60);
  expect(r.afterA).toBe(255);
});

test("inner glow brightens the shape edges, not its centre", async ({ page }) => {
  const id = await shapeScene(page);
  const r = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    E().set_layer_effect(id, FX.INNER_GLOW, Float32Array.from([1, 7, 1, 0, 0, 1, 0, 10, 0]));
    const edge = (E().pick_color(42, 60) >>> 0 >>> 8) & 0xff;   // B near left edge
    const center = (E().pick_color(60, 60) >>> 0 >>> 8) & 0xff; // B at centre
    return { edge, center };
  }, { id, FX });
  expect(r.edge).toBeGreaterThan(50);          // blue glow at the edge
  expect(r.edge - r.center).toBeGreaterThan(40); // and brighter there than at the centre
  expect(r.center).toBeLessThan(60);           // centre still ~red
});

test("bevel & emboss makes the interior non-uniform (lit relief)", async ({ page }) => {
  const id = await shapeScene(page);
  const r = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    E().set_layer_effect(id, FX.BEVEL, Float32Array.from([1, 7, 0.9, 1, 1, 1, 3, 0.9, 0, 0, 0, 120, 30, 3, 9, 0, 0]));
    const lum = (x: number, y: number) => { const c = E().pick_color(x, y) >>> 0; return ((c >>> 24) & 0xff) + ((c >>> 16) & 0xff) + ((c >>> 8) & 0xff); };
    return { tl: lum(44, 44), br: lum(76, 76) };
  }, { id, FX });
  // light from 120° → top-left highlighted, bottom-right shadowed
  expect(Math.abs(r.tl - r.br)).toBeGreaterThan(20);
});

test("satin, gradient and pattern overlays each change the interior", async ({ page }) => {
  const id = await shapeScene(page);
  const r = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    const base = E().pick_color(60, 60) >>> 0;
    E().set_layer_effect(id, FX.GRADIENT_OVERLAY, Float32Array.from([1, 0, 1, 90, 1, 0, 0, 0.1, 0.2, 0.6, 0.9, 0.4, 0.1]));
    const grad = E().pick_color(60, 50) >>> 0;
    const grad2 = E().pick_color(60, 72) >>> 0;
    E().set_layer_effect(id, FX.GRADIENT_OVERLAY, new Float32Array(0)); // clear
    E().set_layer_effect(id, FX.PATTERN_OVERLAY, Float32Array.from([1, 0, 1, 8, 0]));
    const pat = E().pick_color(60, 60) >>> 0;
    E().set_layer_effect(id, FX.PATTERN_OVERLAY, new Float32Array(0));
    E().set_layer_effect(id, FX.SATIN, Float32Array.from([1, 3, 0.7, 0.2, 0.3, 0.8, 19, 11, 14, 1]));
    const sat = E().pick_color(60, 60) >>> 0;
    return { base, grad, grad2, pat, sat };
  }, { id, FX });
  expect(r.grad).not.toBe(r.base);    // gradient overlay applied
  expect(r.grad).not.toBe(r.grad2);   // and it actually varies across the shape
  expect(r.pat).not.toBe(r.base);     // pattern overlay applied
  expect(r.sat).not.toBe(r.base);     // satin applied
});

// ── advanced blending: fill opacity, knockout, blend-if ─────────

test("fill opacity hides the fill but keeps the effect", async ({ page }) => {
  const id = await shapeScene(page);
  const r = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    E().set_layer_fill_opacity(id, 0);
    const noFill = (E().pick_color(60, 60) >>> 0) & 0xff;             // fill gone → transparent
    E().set_layer_effect(id, FX.COLOR_OVERLAY, Float32Array.from([1, 0, 1, 0, 1, 0]));
    const c = E().pick_color(60, 60) >>> 0;
    return { noFill, withFxA: c & 0xff, withFxG: (c >>> 16) & 0xff };
  }, { id, FX });
  expect(r.noFill).toBeLessThan(30);       // fill opacity 0 → interior transparent
  expect(r.withFxA).toBeGreaterThan(200);  // but the effect still paints (independent of fill)
  expect(r.withFxG).toBeGreaterThan(180);
});

test("knockout (deep) punches the fill shape through to transparency", async ({ page }) => {
  const id = await shapeScene(page, /*keepBg*/ true); // opaque white bg visible
  const r = await page.evaluate(({ id }) => {
    const E = () => (window as any).__mv.engine.engine;
    E().set_layer_fill_opacity(id, 0);
    E().set_layer_knockout(id, 0);
    const none = (E().pick_color(60, 60) >>> 0) & 0xff; // bg shows through → 255
    E().set_layer_knockout(id, 2);
    const deep = (E().pick_color(60, 60) >>> 0) & 0xff; // hole punched → < 255
    return { none, deep };
  }, { id });
  expect(r.none).toBe(255);
  expect(r.deep).toBeLessThan(200);
});

test("blend-if hides the layer's dark pixels", async ({ page }) => {
  const id = await shapeScene(page, /*keepBg*/ true);
  const r = await page.evaluate(({ id }) => {
    const E = () => (window as any).__mv.engine.engine;
    const before = E().pick_color(60, 60) >>> 0; // red over white
    const ch = [0, 0, 1, 1, 0, 0, 1, 1];
    const bi = [...ch, ...ch, ...ch, ...ch];
    bi[0] = bi[1] = 120 / 255; // gray "this layer" black slider — hide pixels darker than 120
    E().set_layer_blend_if(id, Float32Array.from(bi));
    const after = E().pick_color(60, 60) >>> 0;
    return { beforeG: (before >>> 16) & 0xff, afterG: (after >>> 16) & 0xff };
  }, { id });
  expect(r.beforeG).toBeLessThan(40);    // red (G≈0)
  expect(r.afterG).toBeGreaterThan(200); // red (gray 76 < 120) hidden → white bg shows
});

// ── blend modes / effects across all layer kinds ────────────────

test("blend mode now affects ADJUSTMENT layers", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(120, 120, "fx");
    E().select_all(); E().fill_selection(40, 120, 200, 255); E().select_none(); mv.engine.commit();
    const id = mv.store.addAdjustmentLayer(4, new Float32Array(0), "Invert"); // kind 4 invert
    E().set_layer_blend(id, 0); const normal = E().pick_color(60, 60) >>> 0;       // plain invert
    E().set_layer_blend(id, 17); const difference = E().pick_color(60, 60) >>> 0;  // difference
    return { kind: E().layer_kind(id), normal, difference };
  });
  expect(r.kind).toBe(1);
  expect(r.normal).not.toBe(r.difference); // previously identical (blend was ignored)
});

test("groups: Pass Through default, Normal isolates, blend modes apply (Photoshop semantics)", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(120, 120, "fx");
    E().select_all(); E().fill_selection(200, 200, 200, 255); E().select_none(); // grey bg
    const top = E().add_layer("top"); E().set_active_layer(top);
    E().select_rect(40, 40, 40, 40, 0); E().fill_selection(255, 128, 0, 255); E().select_none();
    const gid = E().create_group("g"); // wraps `top`
    mv.engine.commit();
    const defaultBlend = E().layer_blend(gid); // 25 = pass-through (PS default)
    // An invert adjustment INSIDE the group: leaks below under Pass Through,
    // contained once the group is set to Normal (isolated).
    const adj = mv.store.addAdjustmentLayer(4, new Float32Array(0), "Invert");
    E().set_layer_group(adj, gid);
    mv.engine.commit();
    const leaked = E().pick_color(10, 10) >>> 0; // outside the orange square
    E().set_layer_blend(gid, 0); // Normal → isolated
    const isolated = E().pick_color(10, 10) >>> 0;
    E().set_layer_blend(gid, 3); const multiply = E().pick_color(60, 60) >>> 0; // isolated multiply
    E().set_layer_blend(gid, 25); const pass = E().pick_color(60, 60) >>> 0;    // back to pass-through
    return { kind: E().layer_kind(gid), defaultBlend, leaked, isolated, multiply, pass };
  });
  expect(r.kind).toBe(6);
  expect(r.defaultBlend).toBe(25); // Pass Through is the group default
  expect(r.leaked >>> 8).toBe(0x373737);   // invert(200,200,200) = 55 grey leaks below the group
  expect(r.isolated >>> 8).toBe(0xc8c8c8); // Normal group contains the adjustment
  expect(r.pass).not.toBe(r.multiply);     // group blend mode changes rendering
});

test("effects work on SMART OBJECT layers", async ({ page }) => {
  const id = await shapeScene(page);
  const r = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    E().convert_to_smart_object(id);
    const before = (E().pick_color(34, 60) >>> 0) & 0xff;
    E().set_layer_effect(id, FX.OUTER_GLOW, Float32Array.from([1, 7, 0.9, 1, 1, 0, 0.4, 24]));
    return { kind: E().layer_kind(id), before, after: (E().pick_color(34, 60) >>> 0) & 0xff };
  }, { id, FX });
  expect(r.kind).toBe(7);
  expect(r.before).toBe(0);
  expect(r.after).toBeGreaterThan(20);
});

test("effects work on TEXT layers", async ({ page }) => {
  const setup = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(220, 120, "fx");
    E().set_layer_visible(E().layer_id_at(0), false); // transparent canvas
    const id = mv.text.create(mv.text.defaultSpec("Ag", { ax: 12, ay: 84, size: 72, color: [255, 255, 255, 255] }));
    mv.engine.commit();
    return { id, kind: E().layer_kind(id) };
  });
  expect(setup.kind).toBe(2); // text layer
  const before = await composite(page);
  expect((before as any).alphaMean).toBeGreaterThan(2); // glyphs rendered

  const changed = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    E().set_layer_effect(id, FX.COLOR_OVERLAY, Float32Array.from([1, 0, 1, 1, 0, 0])); // recolour glyphs red
    return E().layer_has_effects(id);
  }, { id: setup.id, FX });
  expect(changed).toBe(true);
  const afterOverlay = await composite(page);
  expect(afterOverlay.chk).not.toBe(before.chk); // overlay changed the composite

  const afterGlow = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    E().set_layer_effect(id, FX.OUTER_GLOW, Float32Array.from([1, 7, 1, 1, 1, 0, 0.4, 16]));
    return true;
  }, { id: setup.id, FX });
  expect(afterGlow).toBe(true);
  const glow = await composite(page);
  expect((glow as any).alphaMean).toBeGreaterThan((afterOverlay as any).alphaMean); // glow adds coverage
});

// ── persistence round-trip ──────────────────────────────────────

test("blending options survive a project save/open round-trip", async ({ page }) => {
  const id = await shapeScene(page);
  const r = await page.evaluate(({ id, FX }) => {
    const E = () => (window as any).__mv.engine.engine;
    E().set_layer_effect(id, FX.STROKE, Float32Array.from([1, 0, 1, 0, 0.4, 1, 5, 0]));
    E().set_layer_fill_opacity(id, 0.5);
    const saved = E().save_project();
    // Reload through the static Engine.loadProject (custom .mvision v3 reader).
    // Layer ids are preserved across save/load, so query the shape by id.
    const reloaded = E().constructor.loadProject(saved);
    const stroke = Array.from(reloaded.layer_effect_params(id, FX.STROKE)) as number[];
    return {
      has: reloaded.layer_has_effects(id),
      fillOp: reloaded.layer_fill_opacity(id),
      strokeLen: stroke.length,
      strokeEnabled: stroke[0],
    };
  }, { id, FX });
  expect(r.has).toBe(true);
  expect(Math.round(r.fillOp * 100)).toBe(50);
  expect(r.strokeLen).toBeGreaterThan(0);
  expect(r.strokeEnabled).toBe(1);
});

// ── the dialog itself wires through to the engine ───────────────

test("Blending Options dialog toggles an effect on the active layer", async ({ page }) => {
  const activeId = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(140, 110, "ui"); // small doc → fast fx, no big-canvas cost
    mv.engine.commit();
    return mv.store.state.activeLayerId;
  });
  const hasEffects = () => page.evaluate((id) => (window as any).__mv.engine.engine.layer_has_effects(id), activeId);

  // open the dialog via the Layers-panel fx button
  await page.locator('button.monet-iconbtn[title="Blending Options (layer effects)"]').click();
  await expect(page.getByRole("checkbox", { name: "Drop Shadow", exact: true })).toBeVisible();
  expect(await hasEffects()).toBe(false);

  // enable Drop Shadow → its fields appear and the engine layer gains effects
  await page.getByRole("checkbox", { name: "Drop Shadow", exact: true }).click();
  await expect(page.getByText("Distance", { exact: true })).toBeVisible();
  expect(await hasEffects()).toBe(true);

  // disable it again → effects cleared
  await page.getByRole("checkbox", { name: "Drop Shadow", exact: true }).click();
  expect(await hasEffects()).toBe(false);

  await page.keyboard.press("Escape");
});

test("Blending Options Fill preview cancels cleanly and commits as one Undo step", async ({ page }) => {
  const before = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(140, 110, "fill-style-history");
    return { id: mv.store.state.activeLayerId, undoDepth: mv.store.state.undoDepth };
  });
  const fill = () => page.evaluate((id) =>
    Math.round((window as any).__mv.engine.engine.layer_fill_opacity(id) * 100), before.id);
  const openDialog = () => page.locator('button.monet-iconbtn[title="Blending Options (layer effects)"]').click();

  await openDialog();
  const fillSlider = page.getByRole("slider", { name: "Fill Opacity" });
  await fillSlider.focus();
  await fillSlider.press("Home");
  expect(await fill()).toBe(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await fill()).toBe(100);
  expect(await page.evaluate(() => (window as any).__mv.store.state.undoDepth)).toBe(before.undoDepth);

  await openDialog();
  await page.getByRole("slider", { name: "Fill Opacity" }).focus();
  await page.getByRole("slider", { name: "Fill Opacity" }).press("Home");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await fill()).toBe(0);
  expect(await page.evaluate(() => (window as any).__mv.store.state.undoDepth)).toBe(before.undoDepth + 1);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await fill()).toBe(100);
});

test("Blending Options is reachable via layer right-click", async ({ page }) => {
  // add a second layer so we can prove the right-click re-targets the row under it
  const ids = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    mv.store.newDocument(140, 110, "ui");
    const bottom = E().layer_id_at(E().layer_count() - 1); // background row
    mv.store.addLayer(); // new layer goes on top and becomes active
    mv.engine.commit();
    return { bottom, active: mv.store.state.activeLayerId };
  });
  expect(ids.active).not.toBe(ids.bottom);

  // right-click the bottom row → it selects + the context menu opens at the cursor
  const row = page.locator(`[role="option"][id="${ids.bottom}"]`);
  await expect(row).toBeVisible();
  const _b = (await row.boundingBox())!;
  const _cx = _b.x + _b.width / 2, _cy = _b.y + _b.height / 2;
  await row.click({ button: "right", position: { x: _b.width / 2, y: _b.height / 2 } });
  await page.getByRole("menuitem", { name: "Blending Options" }).waitFor();
  // the menu opens at the pointer (monet-ui ContextMenu), not pinned at 0,0
  const _menu = (await page.getByRole("menu").boundingBox())!;
  expect(Math.abs(_menu.x - _cx)).toBeLessThan(_menu.width + 8);
  expect(Math.abs(_menu.y - _cy)).toBeLessThan(_menu.height + 8);
  await page.getByRole("menuitem", { name: "Blending Options" }).click();

  // the right-clicked layer is now active and the dialog opened on it
  const nowActive = await page.evaluate(() => (window as any).__mv.store.state.activeLayerId);
  expect(nowActive).toBe(ids.bottom);
  await expect(page.getByRole("checkbox", { name: "Drop Shadow", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

// ── Dissolve dither + Linear Dodge (Add) clamp-add on plain layers ──

test("Dissolve dithers and Linear Dodge (Add) clamps", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const rgb = (x: number, y: number) => {
      const c = E().pick_color(x, y) >>> 0;
      return [(c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff];
    };

    // Dissolve (engine index 1): a red layer at 50% opacity over a blue
    // backdrop resolves every pixel to pure red or pure blue (all-or-nothing).
    mv.store.newDocument(40, 40, "diss");
    E().fill_selection(0, 0, 255, 255);        // blue backdrop (base layer)
    const d = E().add_layer("d");
    E().set_active_layer(d);
    E().fill_selection(255, 0, 0, 255);        // solid red
    E().set_layer_blend(d, 1);                 // Dissolve
    E().set_layer_opacity(d, 0.5);
    mv.engine.commit();
    let red = 0, blue = 0, other = 0;
    for (let y = 2; y < 40; y += 4) for (let x = 2; x < 40; x += 4) {
      const [R, G, B] = rgb(x, y);
      if (R === 255 && G === 0 && B === 0) red++;
      else if (R === 0 && G === 0 && B === 255) blue++;
      else other++;
    }

    // Linear Dodge / Add (engine index 9): clamp-add of straight channels.
    const add = (backdrop: number, top: number) => {
      mv.store.newDocument(8, 8, "add");
      E().fill_selection(backdrop, backdrop, backdrop, 255);
      const a = E().add_layer("a");
      E().set_active_layer(a);
      E().fill_selection(top, top, top, 255);
      E().set_layer_blend(a, 9);               // LinearDodge (Add)
      mv.engine.commit();
      return rgb(4, 4)[0];
    };
    return { red, blue, other, clamp: add(100, 200), plain: add(50, 40) };
  });

  expect(r.other).toBe(0);                     // dissolve never blends colors
  expect(r.red).toBeGreaterThan(0);
  expect(r.blue).toBeGreaterThan(0);
  const frac = r.red / (r.red + r.blue);
  expect(frac).toBeGreaterThanOrEqual(0.35);
  expect(frac).toBeLessThanOrEqual(0.65);
  expect(r.clamp).toBe(255);                   // 100 + 200 clamps to 255
  expect(Math.abs(r.plain - 90)).toBeLessThanOrEqual(1); // 50 + 40 = 90
});
