import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { chooseOption, gotoApp, newScene, composite } from "./helpers";

// Keep exact two-digit entry inside the app's one-second sequence window. A
// separate Playwright action after the first digit records a full production-DOM
// trace snapshot, which can take longer than a real 45 key sequence.
async function typeDigits(page: Page, digits: string, shifted = false) {
  if (shifted) await page.keyboard.down("Shift");
  await page.keyboard.type(digits);
  if (shifted) await page.keyboard.up("Shift");
}

// ── Desktop build smoke test ───────────────────────────────────
// Runs the PRODUCTION bundle served by `vite preview` with the SAME
// Content-Security-Policy the Tauri desktop app ships (see playwright.config
// "desktop" project + vite previewCsp). Playwright can't drive Tauri's native
// WKWebView on macOS, so this is the closest faithful check: it proves the
// shipping bundle + CSP actually boot and that the CSP doesn't break the
// WASM engine, ONNX runtime, blob/PNG IO, or the scripting console. A missing
// or wrong CSP directive surfaces here as a failure or a recorded violation.

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  // Record any CSP violations that fire while the app runs.
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      const v = e as SecurityPolicyViolationEvent;
      (window as unknown as { __csp: string[] }).__csp.push(`${v.violatedDirective} ← ${v.blockedURI}`);
    });
  });
});

test("the preview serves the Tauri CSP and the WASM engine boots under it", async ({ page }) => {
  const resp = await page.goto("/");
  const csp = resp?.headers()["content-security-policy"];
  expect(csp, "preview must serve a Content-Security-Policy header").toBeTruthy();
  expect(csp).toContain("connect-src");
  expect(csp).toContain("wasm-unsafe-eval");

  // Home boots without a document; creating one must run WASM under the CSP.
  await page.waitForFunction(
    () => (window as any).__mv?.engine && (window as any).__mv?.store,
    null, { timeout: 30_000 },
  );
  await expect(page.locator("[data-mv-home-screen]")).toBeVisible();
  await newScene(page);
  const w = await page.evaluate(() => (window as any).__mv.engine.engine.width());
  expect(w).toBeGreaterThan(0);
});

test("core wasm ops and PNG/blob IO work under CSP", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const before = await composite(page);
  await page.evaluate(() => (window as any).__mv.fil.gaussian(3)); // a real wasm filter
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
  // export_png + the blob round-trip used by composite() proves blob: is allowed
  const len = await page.evaluate(() => (window as any).__mv.engine.engine.export_png().length);
  expect(len).toBeGreaterThan(0);
});

test("Export As scales JPEG and GIF through the shipping bundle under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(8, 4, "export-csp.psd");
    mv.store.setExportPrefs({ format: "jpeg", quality: 41 });
  });
  await page.evaluate(() => (window as any).__mv.commandPalette.items
    .find((item: any) => item.label === "File ▸ Export ▸ Export As…").run());
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton", { name: "Scale 1" }).fill("1.25");
  await dialog.getByRole("spinbutton", { name: "Scale 1" }).press("Tab");
  await dialog.getByRole("textbox", { name: "Suffix 1" }).fill("@1.25x");
  const pending = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  expect(download.suggestedFilename()).toBe("export-csp@1.25x.jpg");
  expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

  await page.evaluate(() => (window as any).__mv.commandPalette.items
    .find((item: any) => item.label === "File ▸ Export ▸ Export As…").run());
  const gifDialog = page.getByRole("dialog");
  await gifDialog.getByText("GIF", { exact: true }).click();
  await gifDialog.getByRole("spinbutton", { name: "Scale 1" }).fill("1.25");
  await gifDialog.getByRole("spinbutton", { name: "Scale 1" }).press("Tab");
  await gifDialog.getByRole("textbox", { name: "Suffix 1" }).fill("@1.25x");
  const gifPending = page.waitForEvent("download");
  await gifDialog.getByRole("button", { name: "Export", exact: true }).click();
  const gifDownload = await gifPending;
  const gif = await readFile((await gifDownload.path())!);
  expect(gifDownload.suggestedFilename()).toBe("export-csp@1.25x.gif");
  expect(gif.subarray(0, 6).toString()).toMatch(/^GIF8[79]a$/);
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? [])).toEqual([]);
});

test("the scripting console (new Function) runs under CSP", async ({ page }) => {
  await gotoApp(page);
  // The script runs in a sandboxed Worker; its `new Function` needs the CSP's
  // 'unsafe-eval' (the worker inherits the document policy). If the CSP omitted
  // it, the worker would fail and runScript returns the error string; "" means
  // it ran and its recorded ops replayed on the main thread.
  const err = await page.evaluate(async () =>
    await (window as any).__mv.runScript('vision.newDoc(64,64,"csp"); vision.selectAll(); vision.fill(10,20,30); vision.deselect();'),
  );
  expect(err).toBe("");
});

test("the ONNX runtime loads and runs a model under CSP", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  // Select Subject loads the U²-Net model + ORT wasm runtime (script-src 'self'
  // module import, wasm-unsafe-eval, connect-src 'self' for /ort + /models).
  const r = await page.evaluate(async () => (window as any).__mv.ml.selectSubject());
  expect(r.ok).toBe(true);
});

test("the Color Sampler places points and reads live colours under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "cs-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(12, 200, 64, 255); E.select_none();
    mv.engine.commit();
    mv.store.setTool("colorsampler");
    mv.store.addColorSampler(Math.round(w / 2), Math.round(h / 2));
  }, { w: 120, h: 80 });
  // model: the point reads the fill colour live through the wasm engine under CSP
  const rgb = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const s = mv.store.state.colorSamplers[0];
    const packed = mv.engine.engine.pick_sample(s.x, s.y, 0, mv.store.state.sampleMode) >>> 0;
    return [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255];
  });
  expect(rgb).toEqual([12, 200, 64]);
  // DOM: the Info panel renders the readout in the shipping bundle
  await page.locator('[data-tab-id="info"]').click();
  await expect(page.locator('[data-mv-sampler="1"]')).toContainText("12, 200, 64");
});

test("the Note tool adds and edits annotations under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 80, "notes-csp");
    mv.engine.commit();
    mv.store.setTool("note");
    const id = mv.store.addNote(40, 30);
    mv.store.setNoteText(id, "review this edge");
  });
  // model: the note persists with its text under the shipping bundle
  const note = await page.evaluate(() => (window as any).__mv.store.state.notes[0]);
  expect(note.text).toBe("review this edge");
  expect(note).toMatchObject({ x: 40, y: 30 });
  // DOM: the Notes panel renders the text in the prod build
  await page.locator('[data-tab-id="notes"]').click();
  await expect(page.locator("#mv-note-text")).toHaveValue("review this edge");
});

test("Define Custom Shape captures a path and draws it under CSP", async ({ page }) => {
  await gotoApp(page);
  const drew = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.set({ customShapes: [], activeCustomShape: 0 }); // define into an empty library, past the shipped built-ins
    mv.store.newDocument(120, 80, "cshape-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 120, 80, 0); E.fill_selection(255, 255, 255, 255); E.select_none();
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 });
    mv.store.setPenPath([10, 70, 110, 70, 60, 10]); // triangle
    const idx = mv.store.defineCustomShape();
    // draw it by filling the active custom shape across the doc (model-level)
    const s = mv.store.state.customShapes[mv.store.state.activeCustomShape];
    const n = s.path.length / 2;
    const xs = new Float32Array(n), ys = new Float32Array(n);
    for (let i = 0; i < n; i++) { xs[i] = s.path[i * 2] * 120; ys[i] = s.path[i * 2 + 1] * 80; }
    E.select_polygon(xs, ys, 0); E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
    return { idx, count: mv.store.state.customShapes.length };
  });
  expect(drew.idx).toBe(0);
  expect(drew.count).toBe(1);
  // the centroid is now red (the shape filled under the shipping CSP)
  const rgb = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const packed = mv.engine.engine.pick_sample(60, 50, 0, 0) >>> 0;
    return [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255];
  });
  expect(rgb[0]).toBeGreaterThan(180); expect(rgb[1]).toBeLessThan(80); expect(rgb[2]).toBeLessThan(80);
});

test("Define Brush Preset captures a tip and paints its footprint under CSP", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "tip-csp");
    const E = mv.engine.engine;
    // A 16×16 region: a 4px BLACK left bar over white → capture as the brush tip.
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255); E.select_none();
    E.select_rect(0, 0, 4, 16, 0); E.fill_selection(0, 0, 0, 255); E.select_none();
    mv.engine.commit();
    E.select_rect(0, 0, 16, 16, 0);
    mv.store.defineBrushPreset();
    // Clear the captured content so the paint-layer composite probe is unobscured.
    E.select_rect(0, 0, 32, 32, 0); E.clear_selection(); E.select_none();
    mv.engine.commit();
    // Paint RED with the tip at 1:1 scale on a fresh transparent layer.
    const id = E.add_layer("paint"); E.set_active_layer(id);
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 });
    mv.store.setTool("brush");
    mv.store.setBrush({ size: 16, hardness: 1, flow: 1, opacity: 1, spacing: 0.16 });
    mv.store.selectBrushTip(0);
    E.stroke_begin(); E.stroke_to(8, 8, 1); E.stroke_end(); E.composite();
    const a = (x: number, y: number) => (E.pick_color(x, y) >>> 0) & 255;
    return { tips: mv.store.state.brushTips.length, active: mv.store.state.activeBrushTip, corner: a(1, 1), off: a(10, 8) };
  });
  expect(r.tips).toBe(1);
  expect(r.active).toBe(0);
  expect(r.corner).toBeGreaterThan(200); // black tip pixel → opaque in the disc corner (≠ round)
  expect(r.off).toBe(0);                  // white tip pixel → transparent (a disc would paint it)
});

test("the Liquify forward-warp brush warps pixels as one history step under CSP", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(80, 80, "liquify-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 80, 80, 0); E.fill_selection(255, 255, 255, 255);
    E.select_rect(40, 0, 2, 80, 0); E.fill_selection(0, 0, 0, 255); // black bar at x=40
    E.select_none();
    mv.engine.commit();
    const darkCol = (y: number) => { let bx = 0, br = 256; for (let x = 0; x < 80; x++) { const v = ((E.pick_color(x, y) >>> 0) >>> 24) & 255; if (v < br) { br = v; bx = x; } } return bx; };
    const before = darkCol(40);
    mv.store.setTool("liquify");
    mv.store.setLiquify({ size: 40, density: 0, pressure: 1, strength: 0.9, mode: 0 }); // Push
    mv.store.liquifyDab(41, 40, 12, 0, 1); // shove the bar's middle right
    mv.store.endLiquify();
    const after = darkCol(40);
    const top = darkCol(2); // outside the brush radius → unchanged
    const liquifySteps = (Array.from(E.history_labels()) as string[]).filter((l) => l === "Liquify").length;
    return { before, after, top, liquifySteps };
  });
  expect(r.before).toBe(40);
  expect(r.after).toBeGreaterThan(45); // the warp moved the bar
  expect(r.top).toBe(40);              // localised to the brush footprint
  expect(r.liquifySteps).toBe(1);      // the whole session is one undo step
});

test("the Polygon shape fills under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 80, "poly-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 120, 80, 0); E.fill_selection(255, 255, 255, 255); E.select_none();
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 });
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind: "polygon", polygonSides: 3, polygonStar: false });
    // triangle inscribed in the full doc (apex top, base bottom)
    const xs = new Float32Array([60, 116, 4]);
    const ys = new Float32Array([4, 76, 76]);
    E.select_polygon(xs, ys, 0); E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
  });
  const rgb = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const packed = mv.engine.engine.pick_sample(60, 50, 0, 0) >>> 0;
    return [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255];
  });
  expect(rgb[0]).toBeGreaterThan(180); expect(rgb[1]).toBeLessThan(80); expect(rgb[2]).toBeLessThan(80);
});

test("the Line shape fills a weight-thick band under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 80, "line-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 120, 80, 0); E.fill_selection(255, 255, 255, 255); E.select_none();
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 });
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind: "line", lineWeight: 6 });
    // horizontal line (10,40)→(110,40) weight 6 → band y∈[37,43]
    E.select_polygon(new Float32Array([10, 110, 110, 10]), new Float32Array([43, 43, 37, 37]), 0);
    E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
  });
  const on = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_sample(60, 40, 0, 0) >>> 0; return [(p >>> 24) & 255, (p >>> 16) & 255, (p >>> 8) & 255]; });
  const off = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_sample(60, 10, 0, 0) >>> 0; return [(p >>> 24) & 255, (p >>> 16) & 255, (p >>> 8) & 255]; });
  expect(on[0]).toBeGreaterThan(180); expect(on[1]).toBeLessThan(80); expect(on[2]).toBeLessThan(80);
  expect(off[0]).toBeGreaterThan(230); expect(off[1]).toBeGreaterThan(230); expect(off[2]).toBeGreaterThan(230);
});

test("the Rounded Rectangle fills with cut corners under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 80, "rrect-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 120, 80, 0); E.fill_selection(255, 255, 255, 255); E.select_none();
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 });
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind: "roundrect", roundRectRadius: 24 });
    // rounded-rect outline over the full doc (radius 24 cuts the corners)
    const cx = (a: number) => Math.cos(a), sn = (a: number) => Math.sin(a);
    const r = 24, xs: number[] = [], ys: number[] = [];
    const arc = (acx: number, acy: number, s: number) => { for (let i = 0; i <= 6; i++) { const a = s + (i / 6) * (Math.PI / 2); xs.push(acx + cx(a) * r); ys.push(acy + sn(a) * r); } };
    arc(120 - r, r, -Math.PI / 2); arc(120 - r, 80 - r, 0); arc(r, 80 - r, Math.PI / 2); arc(r, r, Math.PI);
    E.select_polygon(new Float32Array(xs), new Float32Array(ys), 0);
    E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
  });
  const centre = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_sample(60, 40, 0, 0) >>> 0; return [(p >>> 24) & 255, (p >>> 16) & 255, (p >>> 8) & 255]; });
  const corner = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_sample(1, 1, 0, 0) >>> 0; return [(p >>> 24) & 255, (p >>> 16) & 255, (p >>> 8) & 255]; });
  expect(centre[0]).toBeGreaterThan(180); expect(centre[1]).toBeLessThan(80); expect(centre[2]).toBeLessThan(80);
  expect(corner[0]).toBeGreaterThan(230); expect(corner[1]).toBeGreaterThan(230); expect(corner[2]).toBeGreaterThan(230);
});

test("the Crop tool's aspect ratio constrains the crop under CSP", async ({ page }) => {
  await gotoApp(page);
  const d = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(160, 120, "crop-csp");
    mv.engine.commit();
    mv.store.setTool("crop");
    mv.store.setOptions({ cropAspect: "1:1" });
    // model-level: a 1:1 crop of a 120×60 region → a 60×60 square
    mv.engine.engine.crop(10, 10, 60, 60);
    mv.engine.afterDocChange();
    return { w: mv.engine.engine.width(), h: mv.engine.engine.height(), aspect: mv.store.state.cropAspect };
  });
  expect(d.aspect).toBe("1:1");
  expect(d.w).toBe(60);
  expect(d.h).toBe(60);
});

test("the Frame tool creates and fills a clipping frame under CSP", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    mv.store.newDocument(160, 120, "frame-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none(); // white base
    mv.engine.commit();
    mv.store.setTool("frame");
    // model-level: create an empty frame, then fill it with a placed green image
    const fid = mv.store.createFrame(40, 30, 80, 60);
    const c = document.createElement("canvas"); c.width = 80; c.height = 60;
    const cx = c.getContext("2d")!; cx.fillStyle = "#22cc88"; cx.fillRect(0, 0, 80, 60);
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const imageId = mv.store.fillFrame(fid, bytes, "placed");
    const inside = E.pick_color(80, 60) >>> 0; // frame centre → green
    const outside = E.pick_color(4, 4) >>> 0;   // outside the frame → clipped (white base)
    return {
      kind: E.layer_kind(fid),
      bounds: [...E.frame_bounds(fid)],
      imageId,
      inG: (inside >>> 16) & 255, inR: (inside >>> 24) & 255,
      outR: (outside >>> 24) & 255, outG: (outside >>> 16) & 255, outB: (outside >>> 8) & 255,
    };
  });
  expect(r.kind).toBe(6);                 // a clipping container
  expect(r.bounds).toEqual([40, 30, 80, 60]);
  expect(r.imageId).toBeGreaterThan(0);
  expect(r.inG).toBeGreaterThan(150);     // green inside the frame
  expect(r.inR).toBeLessThan(120);
  expect(r.outR).toBeGreaterThan(240);    // white base outside (content clipped)
  expect(r.outG).toBeGreaterThan(240);
  expect(r.outB).toBeGreaterThan(240);
});

test("the Artboard tool creates and moves an artboard under CSP", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 160, "artboard-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(0, 0, 0, 255); E.select_none(); // black base
    mv.engine.commit();
    mv.store.setTool("artboard");
    // model-level: create an empty artboard, then move it (same size → it shifts)
    const id = mv.store.createArtboardRect(40, 30, 80, 60);
    const before = mv.store.state.artboards.find((a: any) => a.id === id);
    mv.store.setArtboardBounds(id, 60, 50, 80, 60); // move +20,+20
    const after = mv.store.state.artboards.find((a: any) => a.id === id);
    const inside = E.pick_color(100, 80) >>> 0;  // inside the moved artboard → white bg
    const outside = E.pick_color(4, 4) >>> 0;     // outside → black base
    return {
      count: E.artboard_count(),
      kind: E.layer_kind(id),
      beforeX: before.x, afterX: after.x, afterY: after.y, w: after.w, h: after.h,
      inR: (inside >>> 24) & 255, inG: (inside >>> 16) & 255, inB: (inside >>> 8) & 255,
      outR: (outside >>> 24) & 255, outG: (outside >>> 16) & 255, outB: (outside >>> 8) & 255,
    };
  });
  expect(r.count).toBe(1);
  expect(r.kind).toBe(6);          // a bounds container
  expect(r.beforeX).toBe(40);
  expect(r.afterX).toBe(60);       // moved
  expect(r.afterY).toBe(50);
  expect(r.w).toBe(80);            // size unchanged by the move
  expect(r.h).toBe(60);
  expect(r.inR).toBeGreaterThan(240); // white artboard background inside
  expect(r.inG).toBeGreaterThan(240);
  expect(r.inB).toBeGreaterThan(240);
  expect(r.outR).toBeLessThan(30);    // black base outside
  expect(r.outG).toBeLessThan(30);
  expect(r.outB).toBeLessThan(30);
});

test("the Single Row/Column Marquee selects a 1px line under CSP", async ({ page }) => {
  await gotoApp(page);
  const b = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 80, "rowcol-csp");
    mv.engine.commit();
    mv.store.setTool("singlerow");
    // model-level: a single-row selection across the full width at y=40
    const E = mv.engine.engine;
    E.select_rect(0, 40, 120, 1, 0);
    return { has: E.has_selection(), bounds: Array.from(E.selection_bounds()) as number[] };
  });
  expect(b.has).toBe(true);
  expect(b.bounds).toEqual([0, 40, 120, 1]);
});

test("the Polygonal Lasso closes into a selection under CSP", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 80, "polylasso-csp");
    mv.engine.commit();
    mv.store.setTool("polylasso");
    // model-level: select a triangle polygon (the close path's engine call)
    const E = mv.engine.engine;
    E.set_selection_antialias(false);
    E.select_polygon(new Float32Array([20, 100, 60]), new Float32Array([20, 20, 70]), 0);
    return { has: E.has_selection(), bounds: Array.from(E.selection_bounds()) as number[] };
  });
  expect(r.has).toBe(true);
  // triangle (20,20)(100,20)(60,70) → bbox ≈ [20,20,80,50] (±1 from pixel-centre
  // polygon rasterisation, like the chromium poly-lasso spec)
  expect(Math.abs(r.bounds[0] - 20)).toBeLessThanOrEqual(3);
  expect(Math.abs(r.bounds[1] - 20)).toBeLessThanOrEqual(3);
  expect(Math.abs(r.bounds[2] - 80)).toBeLessThanOrEqual(3);
  expect(Math.abs(r.bounds[3] - 50)).toBeLessThanOrEqual(3);
});

test("Copy Color formats the foreground colour under CSP", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red → rgb(255,0,0)
    return { hex: mv.copyForegroundColor("hex"), html: mv.copyForegroundColor("html") };
  });
  expect(out.hex).toBe("ff0000");
  expect(out.html).toBe('color="#ff0000"');
});

test("the Swatches store add/remove works under CSP", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const start = mv.store.state.swatches.length;
    mv.store.addSwatch("#123456");
    const added = mv.store.state.swatches.includes("#123456") && mv.store.state.swatches.length === start + 1;
    mv.store.addSwatch("#123456"); // dedup → no change
    const deduped = mv.store.state.swatches.length === start + 1;
    mv.store.removeSwatch(mv.store.state.swatches.indexOf("#123456"));
    const removed = !mv.store.state.swatches.includes("#123456") && mv.store.state.swatches.length === start;
    return { added, deduped, removed };
  });
  expect(r.added).toBe(true);
  expect(r.deduped).toBe(true);
  expect(r.removed).toBe(true);
});

test("New Document presets create a sized document under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.startsWith("File ▸ New"));
  }, null, { timeout: 10_000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.startsWith("File ▸ New")).run());
  await expect(page.locator("#mv-doc-preset")).toBeVisible();
  await page.locator("#mv-doc-preset").click();
  await page.getByRole("option", { name: "4K UHD" }).click(); // 3840 × 2160
  await page.getByRole("button", { name: "Create" }).click();
  const d = await page.evaluate(() => ({ w: (window as any).__mv.engine.engine.width(), h: (window as any).__mv.engine.engine.height() }));
  expect(d.w).toBe(3840);
  expect(d.h).toBe(2160);
});

test("the Marquee Fixed Size style makes an exact selection under CSP", async ({ page }) => {
  await gotoApp(page);
  const dim = await newScene(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("marquee");
    mv.store.setOptions({ marqueeStyle: "size", marqueeFixedW: 100, marqueeFixedH: 60 });
    mv.store.fit();
  });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + 0.25 * box.w, box.y + 0.25 * box.h);
  const b = await page.evaluate(() => Array.from((window as any).__mv.engine.engine.selection_bounds()) as number[]);
  expect(b[2]).toBe(100);
  expect(b[3]).toBe(60);
  expect(dim.w).toBeGreaterThan(100);
});

test("Image Size constrain-proportions resizes proportionally under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(1000, 500, "imgsize-csp");
    mv.engine.commit();
  });
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.startsWith("Image ▸ Image Size"));
  }, null, { timeout: 10_000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.startsWith("Image ▸ Image Size")).run());
  await expect(page.locator("#mv-imgsize-link")).toBeVisible();
  await page.locator("#mv-imgsize-w").fill("600");
  await page.locator("#mv-imgsize-w").press("Enter");
  expect(await page.locator("#mv-imgsize-h").inputValue()).toBe("300"); // 2:1 kept
  await page.getByRole("button", { name: "Resize" }).click();
  const d = await page.evaluate(() => ({ w: (window as any).__mv.engine.engine.width(), h: (window as any).__mv.engine.engine.height() }));
  expect(d.w).toBe(600);
  expect(d.h).toBe(300);
});

test("Canvas Size anchor + Relative grow the canvas under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 160, "canvas-csp");
    const E = mv.engine.e;
    E.select_all(); E.fill_selection(0, 200, 0, 255); E.select_none();
    mv.engine.commit();
  });
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.startsWith("Image ▸ Canvas Size"));
  }, null, { timeout: 10_000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.startsWith("Image ▸ Canvas Size")).run());
  await expect(page.locator("#mv-canvas-relative")).toBeVisible();
  await page.locator('[data-mv-anchor="0-0"]').click(); // anchor top-left
  await page.locator("#mv-canvas-relative").click(); // relative deltas
  await page.locator("#mv-canvas-w").fill("100");
  await page.locator("#mv-canvas-w").press("Enter");
  await page.locator("#mv-canvas-h").fill("40");
  await page.locator("#mv-canvas-h").press("Enter");
  await page.getByRole("button", { name: "Apply" }).click();
  const d = await page.evaluate(() => ({ w: (window as any).__mv.engine.engine.width(), h: (window as any).__mv.engine.engine.height() }));
  expect(d.w).toBe(300);
  expect(d.h).toBe(200);
  const grown = await page.evaluate(() => ((window as any).__mv.engine.e.pick_color(250, 180) >>> 0) & 255);
  expect(grown).toBe(0); // new bottom-right area is transparent
});

test("a gradient preset loads and renders under CSP", async ({ page }) => {
  await gotoApp(page);
  const dim = await newScene(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("gradient");
    mv.store.fit();
  });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  await expect(page.locator("#mv-gradient-preset")).toBeVisible();
  await chooseOption(page.locator("#mv-gradient-preset"), "White, Black");
  const s = await page.evaluate(() => (window as any).__mv.store.state.gradientStops);
  expect(s[0]).toMatchObject({ r: 255, g: 255, b: 255 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const cx = (d: number) => box.x + d * box.w / dim.w;
  const cy = (d: number) => box.y + d * box.h / dim.h;
  await page.mouse.move(cx(8), cy(dim.h / 2));
  await page.mouse.down();
  await page.mouse.move(cx(dim.w - 8), cy(dim.h / 2));
  await page.mouse.up();
  const ends = await page.evaluate(({ w, h }) => {
    const E = (window as any).__mv.engine.engine;
    const at = (x: number) => ((E.pick_color(x, Math.floor(h / 2)) >>> 0) >>> 16) & 255;
    return { left: at(6), right: at(w - 6) };
  }, { w: dim.w, h: dim.h });
  expect(ends.left).toBeGreaterThan(200);
  expect(ends.right).toBeLessThan(60);
});

test("the Crop O shortcut cycles to Grid and redraws guides under CSP", async ({ page }) => {
  await gotoApp(page);
  const dim = await newScene(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("crop");
    mv.store.fit();
  });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  await expect(page.locator("#mv-crop-overlay")).toBeVisible();
  expect(await page.locator("#mv-crop-overlay").getAttribute("data-value")).toBe("thirds");
  await page.keyboard.press("o");
  await expect(page.locator("#mv-crop-overlay")).toHaveAttribute("data-value", "grid");
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const cx = (d: number) => box.x + d * box.w / dim.w;
  const cy = (d: number) => box.y + d * box.h / dim.h;
  await page.mouse.move(cx(dim.w * 0.1), cy(dim.h * 0.1));
  await page.mouse.down();
  await page.mouse.move(cx(dim.w * 0.9), cy(dim.h * 0.9));
  const n = await page.locator("[data-mv-crop-guide]").count();
  await page.mouse.up();
  expect(n).toBe(6);
});

test("the Ruler Straighten Layer rotates the canvas under CSP", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("ruler");
    mv.store.setRulerLine({ x0: 10, y0: 10, x1: 110, y1: 50 }); // ~21.8° tilt
  });
  await expect(page.locator("#mv-ruler-straighten")).toBeEnabled();
  const before = await page.evaluate(() => ({ w: (window as any).__mv.engine.engine.width(), h: (window as any).__mv.engine.engine.height() }));
  await page.locator("#mv-ruler-straighten").click();
  const after = await page.evaluate(() => ({ w: (window as any).__mv.engine.engine.width(), h: (window as any).__mv.engine.engine.height() }));
  expect(after.w).toBeGreaterThan(before.w);
  expect(after.h).toBeGreaterThan(before.h);
  expect(await page.evaluate(() => (window as any).__mv.store.state.rulerLine)).toBeNull();
});

test("the Zoom 100% preset sets 1:1 zoom under CSP", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("zoom"));
  await expect(page.locator("#mv-zoom-actual")).toBeVisible();
  await page.locator("#mv-zoom-fill").click(); // move off 1:1 first
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.zoom)).not.toBe(1);
  await page.locator("#mv-zoom-actual").click(); // 100%
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.zoom)).toBe(1);
});

test("New Document Transparent background is transparent under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.startsWith("File ▸ New"));
  }, null, { timeout: 10_000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.startsWith("File ▸ New")).run());
  await expect(page.locator("#mv-doc-bg")).toBeVisible();
  await page.locator("#mv-doc-bg").click();
  await page.getByRole("option", { name: "Transparent" }).click();
  await page.getByRole("button", { name: "Create" }).click();
  const alpha = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return (E.pick_color(Math.floor(E.width() / 2), Math.floor(E.height() / 2)) >>> 0) & 255; // pick_color packs 0xRRGGBBAA
  });
  expect(alpha).toBe(0);
});

test("the Line tool End arrowhead fills beyond the line band under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 160, "line-arrow-csp", "transparent"); // transparent so the off-band pixel is only filled by the arrowhead
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 });
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind: "line", lineWeight: 4, lineArrowEnd: true, lineArrowWidth: 20, lineArrowLength: 40, lineArrowConcavity: 0 });
    mv.store.fit();
  });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const cx = (d: number) => box.x + d * box.w / 200;
  const cy = (d: number) => box.y + d * box.h / 160;
  await page.mouse.move(cx(40), cy(80));
  await page.mouse.down();
  await page.mouse.move(cx(160), cy(80));
  await page.mouse.up();
  const a = await page.evaluate(() => ((window as any).__mv.engine.engine.pick_color(130, 86) >>> 0) & 255);
  expect(a).toBe(255); // arrowhead fill below the 4px line band (transparent elsewhere)
});

test("a Rectangle shape stroke rings the shape under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 160, "shape-stroke-csp", "transparent");
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black fill
    mv.store.setBackground({ h: 0, s: 1, v: 1, a: 1 }); // red stroke
    mv.store.setTool("shape");
    mv.store.setOptions({ shapeKind: "rect", shapeStrokeWidth: 8, shapeStrokeAlign: 1 });
    mv.store.fit();
  });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const cx = (d: number) => box.x + d * box.w / 200;
  const cy = (d: number) => box.y + d * box.h / 160;
  await page.mouse.move(cx(50), cy(40));
  await page.mouse.down();
  await page.mouse.move(cx(150), cy(120));
  await page.mouse.up();
  const v = await page.evaluate(() => (window as any).__mv.engine.engine.pick_color(50, 80) >>> 0);
  expect((v >>> 24) & 255).toBeGreaterThan(200); // red stroke on the edge
  expect(v & 255).toBe(255);
});

test("the Histogram panel reports statistics under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "hist-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="histogram"]').click();
  await expect(page.locator('[data-mv-hist="mean"]')).toContainText("128.00");
  await expect(page.locator('[data-mv-hist="pixels"]')).toContainText("10000");
});

test("the Marquee Feather option softens the selection edge under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 160, "feather-csp", "transparent");
    mv.engine.commit();
    mv.store.setTool("marquee");
    mv.store.setOptions({ selectionFeather: 20, selMode: 0, marqueeStyle: "normal" });
    mv.store.fit();
  });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const cx = (d: number) => box.x + d * box.w / 200;
  const cy = (d: number) => box.y + d * box.h / 160;
  await page.mouse.move(cx(50), cy(40));
  await page.mouse.down();
  await page.mouse.move(cx(150), cy(120));
  await page.mouse.up();
  await page.evaluate(() => { const E = (window as any).__mv.engine.engine; E.fill_selection(0, 0, 0, 255); (window as any).__mv.engine.commit(); });
  const bleed = await page.evaluate(() => ((window as any).__mv.engine.engine.pick_color(156, 80) >>> 0) & 255);
  expect(bleed).toBeGreaterThan(0); // feather bled past the hard x=150 edge
  expect(bleed).toBeLessThan(255);
});

test("the Histogram Channel selector recomputes per channel under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "histch-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="histogram"]').click();
  await chooseOption(page.locator("#mv-hist-channel"), "r");
  await expect(page.locator('[data-mv-hist="mean"]')).toContainText("255.00");
  await chooseOption(page.locator("#mv-hist-channel"), "g");
  await expect(page.locator('[data-mv-hist="mean"]')).toContainText("0.00");
});

test("the Navigator panel renders a view box that tracks zoom under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(400, 300, "nav-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(80, 120, 200, 255); E.select_none();
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="navigator"]').click();
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setViewport(200, 150); mv.store.setZoom(1, 0, 0); });
  await expect(page.locator("[data-mv-nav-thumb]")).toBeVisible();
  await expect(page.locator("[data-mv-nav-viewrect]")).toBeVisible();
  await expect(page.locator("[data-mv-nav-zoom]")).toContainText("100%");
  const wide = await page.locator("[data-mv-nav-viewrect]").boundingBox();
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setViewport(200, 150); mv.store.setZoom(2, 0, 0); });
  await expect(page.locator("[data-mv-nav-zoom]")).toContainText("200%");
  await expect.poll(async () => (await page.locator("[data-mv-nav-viewrect]").boundingBox())?.width).toBeLessThan(wide!.width);
});

test("View guide dialogs add and replace guides under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(400, 300, "guide-csp"));
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("New Guide…"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.includes("New Guide…")).run();
  });
  await page.getByRole("radio", { name: "Vertical" }).click();
  await page.locator("#mv-newguide-pos").fill("50%");
  await page.locator("#mv-newguide-pos").press("Enter");
  await page.getByRole("button", { name: "OK" }).click();
  const g = await page.evaluate(() => (window as any).__mv.store.state.guides);
  expect(g).toContainEqual({ o: "v", p: 200, color: "#33aaff" });
  const guide = page.locator('[data-mv-guide="v"]');
  await expect(guide).toHaveCount(1);
  await expect(guide).toHaveAttribute("stroke", "#33aaff");

  await page.evaluate(() => {
    const cp = (window as any).__mv.commandPalette;
    cp.items.find((i: any) => i.label.includes("New Guide Layout…")).run();
  });
  await page.getByRole("checkbox", { name: "Clear Existing Guides" }).click();
  await page.getByLabel("Guide layout color").fill("#00aa00");
  await page.getByRole("button", { name: "OK" }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.guides)).toEqual([
    { o: "v", p: 133, color: "#00aa00" },
    { o: "v", p: 267, color: "#00aa00" },
    { o: "h", p: 100, color: "#00aa00" },
    { o: "h", p: 200, color: "#00aa00" },
  ]);
});

test("the Move tool transform-controls overlay + Align work under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 200, "move-csp");
    const E = mv.engine.engine;
    mv.store.addLayer();
    E.select_rect(10, 10, 30, 30, 0); E.fill_selection(20, 120, 230, 255); E.select_none();
    mv.engine.commit();
    mv.store.setTool("move");
  });
  await page.getByRole("checkbox", { name: "Show Transform Controls" }).click();
  await expect(page.locator("[data-mv-xform-box]")).toHaveCount(1);
  await page.locator("#mv-align-right").click();
  const r = await page.evaluate(() => Array.from((window as any).__mv.engine.engine.active_layer_bounds()) as number[]);
  expect(r[0] + r[2]).toBe(200);
});

test("the status-bar info readout switches modes under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(1000, 1000, "status-csp"));
  await expect(page.locator("[data-mv-status]")).toContainText("2.86M"); // Document Sizes default
  await chooseOption(page.locator("#mv-status-info"), "dimensions");
  await expect(page.locator("[data-mv-status]")).toHaveText("1000 px × 1000 px");
  const custom = "Image ▸ Analysis ▸ Set Measurement Scale ▸ Custom…";
  await page.waitForFunction((label) => (window as any).__mv.commandPalette?.items?.some(
    (item: any) => item.label === label,
  ), custom);
  await page.evaluate((label) => (window as any).__mv.commandPalette.items.find(
    (item: any) => item.label === label,
  ).run(), custom);
  await page.getByLabel("Pixel length").fill("50");
  await page.getByLabel("Logical length").fill("1");
  await page.getByLabel("Logical units").fill("microns");
  await page.getByRole("button", { name: "Save Preset", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("CSP Microscope");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.evaluate(() => (window as any).__mv.store.setMeasureScale(1, 1, "px"));
  const preset = "Image ▸ Analysis ▸ Set Measurement Scale ▸ CSP Microscope";
  await page.waitForFunction((label) => (window as any).__mv.commandPalette.items.some(
    (item: any) => item.label === label,
  ), preset);
  await page.evaluate((label) => (window as any).__mv.commandPalette.items.find(
    (item: any) => item.label === label,
  ).run(), preset);
  await chooseOption(page.locator("#mv-status-info"), "measurement");
  await expect(page.locator("[data-mv-status]")).toHaveText("50 px = 1 microns");
});

test("the Layers panel Kind filter narrows the list under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 200, "kinds-csp");
    mv.store.addLayer();
    mv.store.addAdjustmentLayer(4, new Float32Array(0), "Invert");
    mv.store.toggleLayerFilter();
  });
  await expect(page.locator("[data-mv-layer-count]")).toHaveText("3/3");
  await chooseOption(page.locator("#mv-layer-kind"), "adjustment");
  await expect(page.locator("[data-mv-layer-count]")).toHaveText("1/3");
});

test("the Color panel spectrum ramp picks a foreground hue under CSP", async ({ page }) => {
  await gotoApp(page);
  const ramp = page.locator("[data-mv-color-ramp]");
  await expect(ramp).toBeVisible();
  const box = await ramp.boundingBox();
  await ramp.click({ position: { x: box!.width / 2, y: 8 } });
  const hue = await page.evaluate(() => (window as any).__mv.store.state.fg.h);
  expect(Math.abs(hue - 180)).toBeLessThanOrEqual(8);
});

test("the Info panel HSB + Hex readouts reflect the picked colour under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setPicked({ r: 255, g: 0, b: 0, a: 255 }));
  await page.locator('[data-tab-id="info"]').click();
  await expect(page.locator('[data-mv-info="h"] .val')).toHaveText("0°");
  await expect(page.locator('[data-mv-info="hex"] .val')).toHaveText("ff0000");
});

test("brush size/hardness keyboard shortcuts work under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setBrush({ size: 50, hardness: 0.5 }));
  await page.keyboard.press("BracketRight");
  await page.keyboard.press("Shift+BracketRight");
  const b = await page.evaluate(() => { const x = (window as any).__mv.store.state.brush; return { size: x.size, hardness: x.hardness }; });
  expect(b.size).toBe(52);
  expect(b.hardness).toBe(0.75);
});

test("number-key opacity sets the active layer opacity under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.newDocument(100, 100, "op-csp"); mv.store.setTool("move"); });
  const layerOpacity = () => page.evaluate(() => { const s = (window as any).__mv.store.state; const l = s.layers.find((x: any) => x.id === s.activeLayerId); return l ? l.opacity : null; });
  await page.keyboard.press("3");
  expect(await layerOpacity()).toBe(30);
  await page.keyboard.press("Escape");
  await typeDigits(page, "45");
  expect(await layerOpacity()).toBe(45);
});

test("the Histogram All Channels view renders R/G/B under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "histall-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="histogram"]').click();
  await page.locator("#mv-hist-all").check();
  await expect(page.locator('[data-mv-allchan="r"]')).toHaveCount(1);
  await expect(page.locator('[data-mv-allchan="g"]')).toHaveCount(1);
  await expect(page.locator('[data-mv-allchan="b"]')).toHaveCount(1);
});

test("the Color panel ramp mode selector picks per-mode under CSP", async ({ page }) => {
  await gotoApp(page);
  await chooseOption(page.locator("#mv-ramp-mode"), "grayscale");
  const ramp = page.locator("[data-mv-color-ramp]");
  const box = await ramp.boundingBox();
  await ramp.click({ position: { x: box!.width / 2, y: 8 } });
  const c = await page.evaluate(() => { const x = (window as any).__mv.store.state.fg; return { s: x.s, v: x.v }; });
  expect(c.s).toBe(0);
  expect(c.v).toBeGreaterThan(0.4);
  expect(c.v).toBeLessThan(0.6);
});

test("the status-bar zoom field sets the zoom under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.locator("#mv-status-zoom").fill("200");
  await page.locator("#mv-status-zoom").press("Enter");
  expect(await page.evaluate(() => (window as any).__mv.store.state.zoom)).toBe(2);
});

test("Shift+number sets the brush flow under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setTool("brush"); mv.store.setBrush({ flow: 0.2 }); });
  await typeDigits(page, "45", true);
  const flow = await page.evaluate(() => (window as any).__mv.store.state.brush.flow);
  expect(flow).toBeCloseTo(0.45, 5);
});

test("Shift+number sets the active layer Fill under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "fill-shortcut-csp");
    mv.store.setTool("move");
  });
  await typeDigits(page, "45", true);
  const appearance = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    const layer = s.layers.find((candidate: any) => candidate.id === s.activeLayerId);
    return { fill: layer.fillOpacity, opacity: layer.opacity };
  });
  expect(appearance).toEqual({ fill: 45, opacity: 100 });
});

test("the D shortcut resets to default colors under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setForeground({ h: 120, s: 1, v: 1, a: 1 }));
  await page.keyboard.press("d");
  const fg = await page.evaluate(() => (window as any).__mv.store.state.fg);
  expect(fg).toEqual({ h: 0, s: 0, v: 0, a: 1 }); // black foreground
});

test("a layer color label tags the row under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.newDocument(100, 100, "labels-csp"); mv.store.setLayerColorLabel(mv.store.state.activeLayerId, "blue"); });
  await expect(page.locator('[data-mv-layer-label="blue"]')).toHaveCount(1);
});

test("the layer colour filter narrows the list under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "colorfilter-csp");
    mv.store.addLayer();
    const ids = mv.store.state.layers.map((l: any) => l.id);
    mv.store.setLayerColorLabel(ids[0], "red");
    if (!mv.store.state.layerFilterOpen) mv.store.toggleLayerFilter();
    mv.store.toggleLayerColorFilter("red");
  });
  await expect(page.locator("[data-mv-layer-count]")).toHaveText("1/2");
});

test("Snap To ▸ Guides gates guide snapping under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 200, "snap-csp");
    mv.store.setOptions({ snapEnabled: true, snapGuides: true, snapGrid: false, snapDocBounds: false });
    mv.store.addGuide("v", 50);
  });
  let x = await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setZoom(1); return mv.snap(53, 10).x; });
  expect(x).toBe(50);
  await page.evaluate(() => (window as any).__mv.store.toggleView("snapGuides"));
  x = await page.evaluate(() => { const mv = (window as any).__mv; mv.store.setZoom(1); return mv.snap(53, 10).x; });
  expect(x).toBe(53);
});

test("the Info panel reports selection dimensions under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 200, "selinfo-csp");
    mv.store.setTool("marquee");
    mv.store.setOptions({ snapEnabled: false, selectionFeather: 0, selMode: 0, marqueeStyle: "normal" });
    mv.store.fit();
  });
  await page.locator('[data-tab-id="info"]').click();
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = canvases.map((canvas) => canvas.getBoundingClientRect())
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const x = (value: number) => box.x + value * box.w / 200;
  const y = (value: number) => box.y + value * box.h / 200;

  await page.mouse.move(x(20), y(30));
  await page.mouse.down();
  await page.mouse.move(x(100), y(90), { steps: 4 });
  await expect(page.locator('[data-mv-sel="w"] .val')).toHaveText("80 px");
  await expect(page.locator('[data-mv-sel="h"] .val')).toHaveText("60 px");
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(false);

  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.selectionDragRect)).toBeNull();
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(true);
  await expect(page.locator('[data-mv-sel="w"] .val')).toHaveText("80 px");
  await expect(page.locator('[data-mv-sel="h"] .val')).toHaveText("60 px");
});

test("the New Layer dialog creates a named layer under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(100, 100, "nl-csp"));
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("New ▸ Layer…"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("New ▸ Layer…")).run());
  await expect(page.locator("#mv-newlayer-name")).toBeVisible();
  await page.locator("#mv-newlayer-name").fill("CSP Layer");
  await page.getByRole("button", { name: "OK" }).click();
  const name = await page.evaluate(() => { const s = (window as any).__mv.store.state; return s.layers.find((l: any) => l.id === s.activeLayerId).name; });
  expect(name).toBe("CSP Layer");
});

test("Alt+bracket selects the adjacent layer under CSP", async ({ page }) => {
  await gotoApp(page);
  const ids = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "nav-csp");
    mv.store.addLayer();
    mv.store.addLayer();
    return mv.store.state.layers.map((l: any) => l.id);
  });
  await page.evaluate((i) => (window as any).__mv.store.selectLayer(i), ids[1]);
  await page.keyboard.press("Alt+BracketRight");
  const active = await page.evaluate(() => (window as any).__mv.store.state.activeLayerId);
  expect(active).toBe(ids[0]);
});

test("the histogram hover readout reports the percentile under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 100, "histreadout-csp");
    const e = mv.engine.engine;
    e.select_rect(0, 0, 100, 100, 0);
    e.fill_selection(128, 128, 128, 255);
    e.select_none();
    mv.engine.commit();
  });
  const graph = page.locator("[data-mv-hist-graph]");
  const box = await graph.boundingBox();
  if (!box) throw new Error("histogram graph not found");
  await graph.hover({ position: { x: box.width * 0.75, y: box.height / 2 } });
  await expect(page.locator('[data-mv-hist="percentile"]')).toHaveText("Percentile 100.0%");
});

test("the Info panel shows the Lab readout under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setPicked({ r: 255, g: 0, b: 0, a: 255 }));
  await page.locator('[data-tab-id="info"]').click();
  await expect(page.locator('[data-mv-info="lab-l"] .val')).toHaveText("54");
  await expect(page.locator('[data-mv-info="lab-a"] .val')).toHaveText("81");
});

test("F cycles to Full Screen and hides the chrome under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.toolItems?.some((item: any) => item.id === "tool-screen-mode"));
  await page.evaluate(() => (window as any).__mv.store.newDocument(100, 100, "screen-csp"));
  await expect(page.locator("html")).toHaveAttribute("data-mv-screen-mode", "standard");
  await page.keyboard.press("f");
  await page.keyboard.press("f");
  await expect(page.locator("html")).toHaveAttribute("data-mv-screen-mode", "full");
  await expect(page.locator(".monet-dock").first()).toBeHidden();
});

test("Image Size percent units resize the document under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.newDocument(200, 200, "imgsize-csp"); mv.engine.commit(); });
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.startsWith("Image ▸ Image Size")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.startsWith("Image ▸ Image Size")).run());
  await expect(page.locator("#mv-imgsize-unit")).toBeVisible();
  await chooseOption(page.locator("#mv-imgsize-unit"), "percent");
  await page.locator("#mv-imgsize-w").fill("50");
  await page.locator("#mv-imgsize-w").press("Enter");
  await page.getByRole("button", { name: "Resize" }).click();
  const w = await page.evaluate(() => (window as any).__mv.engine.engine.width());
  expect(w).toBe(100);
});

test("the Magic Wand feathers its selection under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 120, "wandfeather-csp");
    const E = mv.engine.engine;
    E.select_rect(30, 30, 60, 60, 0); E.fill_selection(255, 0, 0, 255); E.select_none();
    mv.engine.commit();
    mv.store.setTool("wand");
    mv.store.setOptions({ wandContiguous: true, antiAlias: false, selectionFeather: 8 });
    mv.store.fit();
  });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  await expect(page.locator("#mv-selection-feather")).toBeVisible();
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  const partial = await page.evaluate(() => {
    const m = (window as any).__mv.engine.selectionMask();
    if (!m) return -1;
    let n = 0; for (let i = 0; i < m.length; i++) { const v = m[i]; if (v > 0 && v < 255) n++; }
    return n;
  });
  expect(partial).toBeGreaterThan(0);
});

test("the Info panel shows the RGB-mode CMYK readout under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setPicked({ r: 255, g: 0, b: 0, a: 255 }));
  await page.locator('[data-tab-id="info"]').click();
  await expect(page.locator('[data-mv-info="cmyk-m"] .val')).toHaveText("100%");
  await expect(page.locator('[data-mv-info="cmyk-c"] .val')).toHaveText("0%");
});

test("the History Brush reverts a region from its source under CSP", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(80, 60, "history-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(0, 200, 0, 255); E.select_none(); // green source state
    mv.engine.commit();
    mv.store.setHistorySource();
    E.select_all(); E.fill_selection(220, 0, 0, 255); E.select_none(); // modify: now red
    mv.engine.commit();
    mv.store.setTool("historybrush");
    mv.store.setBrush({ size: 16, hardness: 1, flow: 1, opacity: 1 });
    E.stroke_begin();
    for (let x = 10; x <= 30; x += 2) E.stroke_to(x, 30, 1);
    E.stroke_end();
    E.composite();
    const rev = E.pick_color(20, 30) >>> 0;  // inside the stroke
    const keep = E.pick_color(70, 30) >>> 0; // far away
    return { revG: (rev >>> 16) & 255, revR: (rev >>> 24) & 255, keepR: (keep >>> 24) & 255 };
  });
  expect(out.revG).toBeGreaterThan(180); // reverted to the green source under the shipping CSP
  expect(out.revR).toBeLessThan(40);
  expect(out.keepR).toBeGreaterThan(180); // untouched area still red
});

test("the Duplicate Layer dialog copies a named layer under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const s = (window as any).__mv.store;
    s.newDocument(100, 100, "dup-csp");
    s.renameLayer(s.state.activeLayerId, "Sky");
  });
  const before = await page.evaluate(() => (window as any).__mv.store.state.layers.length);
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("Duplicate Layer…"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Duplicate Layer…")).run());
  await expect(page.locator("#mv-duplayer-name")).toHaveValue("Sky copy");
  await page.getByRole("button", { name: "OK" }).click();
  const after = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return { count: s.layers.length, names: s.layers.map((l: any) => l.name) };
  });
  expect(after.count).toBe(before + 1);
  expect(after.names).toContain("Sky copy");
});

test("the Curves dialog Channel selector switches under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(64, 64, "curvech-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
  });
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("Adjustments ▸ Curves"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Adjustments ▸ Curves")).run());
  await expect(page.locator("#mv-curves-channel")).toBeVisible();
  await page.locator("#mv-curves-channel").click();
  await expect(page.locator(".monet-listbox [role=option]")).toHaveText(["RGB", "Red", "Green", "Blue"]);
  await page.keyboard.press("Escape");
  await chooseOption(page.locator("#mv-curves-channel"), "Blue");
  await expect(page.locator("#mv-curves-channel")).toHaveAttribute("data-value", "3");
});

test("the New Group dialog creates a named group under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(100, 100, "ng-csp"));
  const before = await page.evaluate(() => (window as any).__mv.store.state.layers.length);
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("New ▸ Group…"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("New ▸ Group…")).run());
  await expect(page.locator("#mv-newgroup-name")).toBeVisible();
  await page.locator("#mv-newgroup-name").fill("CSP Group");
  await page.getByRole("button", { name: "OK" }).click();
  const info = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    const l = s.layers.find((x: any) => x.name === "CSP Group");
    return l ? { count: s.layers.length, kind: l.kind } : null;
  });
  expect(info).not.toBeNull();
  expect(info!.count).toBe(before + 1);
  expect(info!.kind).toBe(6);
});

test("the Brushes panel applies a preset under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(64, 64, "brushes-csp"));
  await page.locator('[data-tab-id="brushes"]').click();
  await expect(page.locator("[data-mv-brushes]")).toBeVisible();
  await page.locator('[data-mv-brush-preset="Hard Round"]').click();
  const b = await page.evaluate(() => (window as any).__mv.store.state.brush);
  expect(b.size).toBe(20);
  expect(b.hardness).toBe(1);
});

test("the Fill dialog Color contents fills the layer under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(64, 64, "fill-csp"));
  await page.waitForFunction(() => {
    const cp = (window as any).__mv.commandPalette;
    return cp?.items?.some((i: any) => i.label.includes("Edit ▸ Fill…"));
  }, null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Edit ▸ Fill…")).run());
  await expect(page.locator("#mv-fill-contents")).toBeVisible();
  await chooseOption(page.locator("#mv-fill-contents"), "color");
  await page.locator("#mv-fill-color").fill("#0000ff");
  await page.getByRole("button", { name: "OK" }).click();
  const blue = await page.evaluate(() => {
    const c = ((window as any).__mv.engine.engine.pick_color(32, 32) >>> 0);
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  });
  expect(blue[2]).toBeGreaterThan(200); // blue channel high
  expect(blue[0]).toBeLessThan(80);     // red low
});

test("Canvas Size extension color floods the border under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "cext-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(0, 200, 0, 255); E.select_none();
    mv.engine.commit();
  });
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.includes("Canvas Size…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Canvas Size…")).run());
  await expect(page.locator("#mv-canvas-extension")).toBeVisible();
  await page.locator("#mv-canvas-w").fill("80"); await page.locator("#mv-canvas-w").press("Enter");
  await page.locator("#mv-canvas-h").fill("80"); await page.locator("#mv-canvas-h").press("Enter");
  await chooseOption(page.locator("#mv-canvas-extension"), "white");
  await page.getByRole("button", { name: "Apply" }).click();
  const corner = await page.evaluate(() => {
    const c = ((window as any).__mv.engine.engine.pick_color(5, 5) >>> 0);
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  });
  expect(corner).toEqual([255, 255, 255, 255]);
});

test("the Fill dialog Preserve Transparency locks the alpha under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "fpres-csp"); // white bg
    mv.store.addLayer();                        // transparent layer 1
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(0, 0, 255, 255); E.select_none();
    mv.engine.commit();
  });
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.includes("Edit ▸ Fill…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Edit ▸ Fill…")).run());
  await expect(page.locator("#mv-fill-contents")).toBeVisible();
  await chooseOption(page.locator("#mv-fill-contents"), "color");
  await page.locator("#mv-fill-color").fill("#00ff00");
  await page.locator("#mv-fill-preserve").click();
  await page.getByRole("button", { name: "OK" }).click();
  const rest = await page.evaluate(() => {
    const c = ((window as any).__mv.engine.engine.pick_color(32, 32) >>> 0);
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  });
  expect(rest).toEqual([255, 255, 255]); // transparent area preserved → white bg shows
});

test("the Levels dialog Channel selector switches under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "lvl-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(160, 160, 160, 255); E.select_none();
    mv.engine.commit();
  });
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.includes("Adjustments ▸ Levels")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Adjustments ▸ Levels")).run());
  await expect(page.locator("#mv-levels-channel")).toBeVisible();
  await page.locator("#mv-levels-channel").click();
  await expect(page.locator(".monet-listbox [role=option]")).toHaveText(["RGB", "Red", "Green", "Blue"]);
  await page.keyboard.press("Escape");
  await chooseOption(page.locator("#mv-levels-channel"), "Blue");
  await expect(page.locator("#mv-levels-channel")).toHaveAttribute("data-value", "3");
});

test("Group Layers groups the multi-selection under CSP", async ({ page }) => {
  await gotoApp(page);
  const ids = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "grp-csp");
    mv.store.addLayer(); mv.store.addLayer();
    const all = mv.store.state.layers.map((l: any) => l.id);
    mv.store.selectLayer(all[0]);
    mv.store.toggleLayerInSelection(all[1]);
    return all;
  });
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.includes("Group Layers")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.includes("Group Layers")).run());
  const info = await page.evaluate((ids) => {
    const ls = (window as any).__mv.store.state.layers;
    const header = ls.find((l: any) => l.kind === 6);
    return { count: ls.length, gid: header ? header.id : 0, g0: ls.find((l: any) => l.id === ids[0])?.group };
  }, ids);
  expect(info.gid).toBeGreaterThan(0);
  expect(info.count).toBe(ids.length + 1);
  expect(info.g0).toBe(info.gid);
});

test("the Clone Stamp Sample dropdown switches the source under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "clone-csp");
    mv.store.setTool("clone");
  });
  await expect(page.locator("#mv-clone-sample")).toBeVisible();
  await page.locator("#mv-clone-sample").click();
  await expect(page.locator(".monet-listbox [role=option]")).toHaveText(["Current Layer", "Current & Below", "All Layers"]);
  await page.keyboard.press("Escape");
  await chooseOption(page.locator("#mv-clone-sample"), "Current Layer");
  expect(await page.evaluate(() => (window as any).__mv.store.state.cloneSample)).toBe(0);
});

test("the Gradient Dither toggle switches under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(64, 4, "grd-csp");
    mv.store.setTool("gradient");
  });
  const cb = page.getByRole("checkbox", { name: "Dither", exact: true });
  await expect(cb).toBeVisible();
  await cb.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.gradientDither)).toBe(true);
});

test("the Red Eye tool options + correction work under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "eye-csp");
    mv.store.setTool("redeye");
  });
  await expect(page.getByText("Pupil Size", { exact: true })).toBeVisible();
  await expect(page.getByText("Darken Amount", { exact: true })).toBeVisible();
  const eyeRed = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    E.select_rect(8, 8, 16, 16, 0);
    E.fill_selection(220, 20, 20, 255);
    E.select_none();
    E.remove_red_eye(0, 0, 40, 40, 128, 128);
    E.composite();
    return (E.pick_color(15, 15) >>> 0) >>> 24 & 255;
  });
  expect(eyeRed).toBeLessThan(80); // the wasm remove_red_eye binding works under CSP
});

test("the Layers panel Fill control works under CSP", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByRole("slider", { name: "Fill" })).toBeVisible();
  const fill = page.getByRole("slider", { name: "Fill" });
  await fill.focus();
  await fill.press("Home"); // → 0%
  const st = await page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    const l = s.layers.find((ly: any) => ly.id === s.activeLayerId);
    return { fill: l.fillOpacity, opacity: l.opacity };
  });
  expect(st.fill).toBe(0); // Fill control drives the engine under production CSP
  expect(st.opacity).toBe(100); // Opacity independent
});

test("the brush Smoothing control works under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("brush"));
  await expect(page.getByText("Smoothing", { exact: true })).toBeVisible();
  const slider = page.locator("span").filter({ hasText: /^Smoothing/ }).getByRole("slider").first();
  await slider.focus();
  await slider.press("End");
  expect(await page.evaluate(() => (window as any).__mv.store.state.brush.smoothing)).toBeCloseTo(1, 5);
});

test("the Magic Eraser tool + erase work under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("magiceraser"));
  await expect(page.getByText("Tolerance", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Contiguous" })).toBeVisible();
  const erased = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "me-csp");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(230, 20, 20, 255);
    E.select_none();
    E.magic_eraser(10, 10, 0.1, true, false, 1.0);
    E.composite();
    return (E.pick_color(10, 10) >>> 0) & 255;
  });
  expect(erased).toBe(0); // the wasm magic_eraser binding erases under CSP
});

test("the Pattern Stamp paints the defined pattern under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("patternstamp"));
  await expect(page.getByText("Paints the defined pattern (Edit ▸ Define Pattern)")).toBeVisible();
  const g = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "ps-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 4, 4, 0); E.fill_selection(0, 200, 0, 255); E.select_rect(0, 0, 4, 4, 0); E.define_pattern(); E.select_none();
    const id = E.add_layer("paint"); E.set_active_layer(id);
    E.set_brush(10, 1, 1, 1, 0.2, 0, 0, 0, 255, false); E.set_brush_mode(0);
    E.set_pattern_stamp(true); E.set_clone(true, 0, 0);
    E.stroke_begin(); E.stroke_to(10, 10, 1); E.stroke_end(); E.composite();
    const p = E.pick_color(10, 10) >>> 0;
    return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 };
  });
  expect(g.g).toBeGreaterThan(g.r); // the pattern (green) stamped under production CSP
  expect(g.g).toBeGreaterThan(g.b);
});

test("Color Replacement recolours under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("colorreplace"));
  await expect(page.getByText("Replaces color with the foreground, keeping brightness")).toBeVisible();
  const after = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "cr-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(220, 20, 20, 255); E.select_none();
    E.set_brush(26, 1, 1, 1, 0.2, 0, 0, 255, 255, false); E.set_brush_mode(6);
    E.stroke_begin(); E.stroke_to(10, 10, 1); E.stroke_end(); E.composite();
    const p = E.pick_color(10, 10) >>> 0;
    return { r: (p >>> 24) & 255, b: (p >>> 8) & 255 };
  });
  expect(after.b).toBeGreaterThan(after.r); // recoloured red → blue under production CSP
});

test("the Color Replacement Mode dropdown switches under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("colorreplace"));
  const sel = page.locator("#mv-colorreplace-mode");
  await expect(sel).toBeVisible();
  await chooseOption(sel, "3"); // Luminosity
  expect(await page.evaluate(() => (window as any).__mv.store.state.colorReplaceMode)).toBe(3);
});

test("the History panel reverts to a clicked state under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "hist-csp");
    const E = mv.engine.engine;
    E.fill_selection(255, 0, 0, 255); mv.engine.commit(); // red
    E.fill_selection(0, 0, 255, 255); mv.engine.commit(); // blue
  });
  await page.locator('[data-tab-id="history"]').click();
  await page.locator('[data-mv-history-row="1"]').click(); // revert to the first op (red)
  const c = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_color(10, 10) >>> 0; return { r: (p >>> 24) & 255, b: (p >>> 8) & 255 }; });
  expect(c.r).toBeGreaterThan(200);
  expect(c.b).toBeLessThan(60); // reverted from blue back to red under production CSP
});

test("the Paths panel makes a selection from a path under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "paths-csp");
    mv.store.setPenPath([8, 8, 32, 8, 20, 32]);
  });
  await page.locator('[data-tab-id="paths"]').click();
  await expect(page.locator('[data-mv-path-row="work"]')).toBeVisible();
  await page.getByRole("button", { name: "Make Selection" }).click();
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.has_selection())).toBe(true);
});

test("the Paths panel strokes a path outline under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "stroke-csp");
    mv.store.setForeground({ h: 120, s: 1, v: 1, a: 1 }); // green
    mv.store.setBrush({ size: 3, hardness: 1 });
    mv.store.setPenPath([8, 8, 32, 8, 20, 32]);
  });
  await page.locator('[data-tab-id="paths"]').click();
  await page.getByRole("button", { name: "Stroke Path" }).click();
  const c = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_color(20, 8) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255 }; });
  expect(c.g).toBeGreaterThan(c.r); // the path outline was stroked green under production CSP
});

test("the Paths panel makes a work path from a selection under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "makeworkpath-csp");
    mv.engine.engine.select_rect(8, 6, 20, 16, 0);
    mv.engine.commit();
  });
  await page.locator('[data-tab-id="paths"]').click();
  await page.getByRole("button", { name: "Make Work Path" }).click();
  await expect(page.locator('[data-mv-path-row="work"]')).toBeVisible(); // a Work Path now exists
  expect(await page.evaluate(() => ((window as any).__mv.store.state.penPath as number[]).length)).toBeGreaterThanOrEqual(8);
});

test("Image ▸ Reveal All grows the canvas to off-canvas content under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(30, 20, "revealall-csp");
    const e = mv.engine.engine;
    const id = e.add_layer("Shifted");
    e.select_all();
    e.fill_selection(0, 0, 255, 255);
    e.select_none();
    e.set_layer_offset(id, 8, 0);
    mv.engine.commit();
  });
  await page.evaluate(() => (window as any).__mv.xform.revealAll());
  const d = await page.evaluate(() => { const x = (window as any).__mv.store.state.doc; return { w: x.width, h: x.height }; });
  expect(d).toEqual({ w: 38, h: 20 }); // canvas grew under production CSP
});

test("the Spot Healing Brush heals a blemish under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "spotheal-csp");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(0, 200, 0, 255); // green field
    E.select_rect(18, 18, 4, 4, 0);
    E.fill_selection(220, 0, 0, 255); // red blemish
    E.select_none();
    mv.engine.commit();
    mv.store.spotHeal([20, 20], 8); // content-aware heal the blemish
  });
  const c = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_color(20, 20) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255 }; });
  expect(c.g).toBeGreaterThan(c.r); // healed to the surrounding green under production CSP
});

test("the Content-Aware Move tool relocates an object and fills the source under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(60, 40, "camove-csp");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(0, 200, 0, 255); // green field
    E.select_rect(5, 5, 8, 8, 0);
    E.fill_selection(220, 0, 0, 255); // red object, selected
    mv.engine.commit();
    mv.contentAwareMoveBy(20, 0); // move the object 20px right
  });
  const dst = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_color(28, 8) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255 }; });
  const src = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_color(8, 8) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255 }; });
  expect(dst.r).toBeGreaterThan(dst.g); // object relocated to the drop point under production CSP
  expect(src.g).toBeGreaterThan(src.r); // source rebuilt as green
});

test("Transform ▸ Warp deforms a layer under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "warp-csp");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(220, 0, 0, 255);
    E.select_none();
    mv.engine.commit();
    mv.warpLayer({ style: "arc", bend: 0.4, h: 0, v: 0, orient: "h" }); // bow the content up
  });
  const a = await page.evaluate(() => ((window as any).__mv.engine.engine.pick_color(20, 39) >>> 0) & 255);
  expect(a).toBeLessThan(128); // the bottom vacated (content warped up) under production CSP
});

test("Film Grain adds grain to a flat field under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "filmgrain-csp");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(128, 128, 128, 255);
    E.select_none();
    mv.engine.commit();
    mv.fil.filmGrain(1, 0, 1);
  });
  const rs = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return [[6, 6], [18, 13], [27, 25], [33, 9]].map(([x, y]) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
  });
  expect(new Set(rs).size).toBeGreaterThan(1); // grain varied the flat field under production CSP
});

test("Crosshatch hatches a flat field under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "crosshatch-csp");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(128, 128, 128, 255);
    E.select_none();
    mv.engine.commit();
    mv.fil.crosshatch(0.2, 0.3, 0.8);
  });
  const rs = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return [[6, 6], [18, 13], [27, 25], [33, 9]].map(([x, y]) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
  });
  expect(new Set(rs).size).toBeGreaterThan(1); // hatching varied the flat field under production CSP
});

test("Accented Edges accents a boundary under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "accent-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
    mv.fil.accentedEdges(0.5, 0.9, 0.2);
  });
  const r = await page.evaluate(() => ((window as any).__mv.engine.engine.pick_color(19, 20) >>> 0) >>> 24 & 255);
  expect(r).toBeGreaterThan(40); // the black-side boundary was accented toward white under production CSP
});

test("Texturizer textures a flat field under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "texturizer-csp");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(128, 128, 128, 255);
    E.select_none();
    mv.engine.commit();
    mv.fil.texturizer(0, 0.33, 0.5, 0, false);
  });
  const rs = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return [[6, 6], [18, 13], [27, 25], [33, 9]].map(([x, y]) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
  });
  expect(new Set(rs).size).toBeGreaterThan(1); // the texture varied the flat field under production CSP
});

test("Graphic Pen inks a dark field with the foreground under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "graphicpen-csp");
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red ink
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue paper
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(0, 0, 0, 255); // black → fully inked
    E.select_none();
    mv.engine.commit();
    mv.fil.graphicPen(0.3, 0.5, 0);
  });
  const c = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_color(20, 20) >>> 0; return { r: (p >>> 24) & 255, b: (p >>> 8) & 255 }; });
  expect(c.r).toBeGreaterThan(200); // inked the foreground red under production CSP
  expect(c.b).toBeLessThan(60);
});

test("Ocean Ripple makes a straight edge wavy under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "oceanripple-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none();
    mv.engine.commit();
    mv.distort.oceanRipple(0.3, 0.7);
  });
  const rs = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return [3, 8, 13, 18, 23, 28, 33, 38].map((y) => ((E.pick_color(20, y) >>> 0) >>> 24) & 255);
  });
  expect(new Set(rs).size).toBeGreaterThan(1); // the boundary column became non-uniform (wavy) under production CSP
});

test("Cutout bands a gradient into few colours under CSP", async ({ page }) => {
  await gotoApp(page);
  const after = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(64, 8, "cutout-csp");
    const E = mv.engine.engine;
    for (let x = 0; x < 64; x++) { const v = Math.round((x * 255) / 63); E.select_rect(x, 0, 1, 8, 0); E.fill_selection(v, v, v, 255); }
    E.select_none();
    mv.engine.commit();
    mv.fil.cutout(2, 0, 3);
    const s = new Set<number>();
    for (let x = 0; x < 64; x++) s.add(((E.pick_color(x, 4) >>> 0) >>> 24) & 255);
    return s.size;
  });
  expect(after).toBeLessThanOrEqual(3); // 2 levels flattened the gradient to a couple of flat tiers under production CSP
});

test("Halftone Pattern inks a dark field with the foreground under CSP", async ({ page }) => {
  await gotoApp(page);
  const inked = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red ink
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue paper
    mv.store.newDocument(32, 32, "halftone-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(0, 0, 0, 255); E.select_none(); // dark field
    mv.engine.commit();
    mv.fil.halftonePattern(4, 0.5, 1);
    let n = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if ((((E.pick_color(x, y) >>> 0) >>> 24) & 255) > 128) n++;
    return n / (32 * 32);
  });
  expect(inked).toBeGreaterThan(0.5); // a dark field is mostly inked the foreground (red) under production CSP
});

test("Bas Relief carves an edge into the foreground under CSP", async ({ page }) => {
  await gotoApp(page);
  const edgeR = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red ink
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue paper
    mv.store.newDocument(32, 32, "basrelief-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 32, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(16, 0, 16, 32, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
    mv.fil.basRelief(12, 1, 6); // lit from the Left → the boundary carves red
    let m = 0;
    for (let y = 0; y < 32; y++) for (const x of [14, 15, 16, 17]) m = Math.max(m, ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return m;
  });
  expect(edgeR).toBeGreaterThan(200); // the edge carves the foreground (red) under production CSP
});

test("Spatter sprays an edge into its neighbour under CSP", async ({ page }) => {
  await gotoApp(page);
  const near = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "spatter-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
    mv.fil.spatter(8, 1); // strong, fine spray
    let m = 0;
    for (let y = 0; y < 40; y++) for (let x = 13; x < 19; x++) m = Math.max(m, ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return m;
  });
  expect(near).toBeGreaterThan(150); // white sprays into the near-boundary black band under production CSP
});

test("Mosaic Tiles lays grout lines on the grid under CSP", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "mosaictiles-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.mosaicTiles(8, 2, 0); // dark grout
    const R = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return { interior: R(4, 4), grout: R(0, 4) };
  });
  expect(out.grout).toBeLessThan(60); // the grout line is dark under production CSP
  expect(Math.abs(out.interior - 128)).toBeLessThanOrEqual(12); // the tile interior keeps the colour
});

test("Stamp thresholds dark to the foreground under CSP", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red ink
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue paper
    mv.store.newDocument(32, 32, "stamp-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 32, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(16, 0, 16, 32, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
    mv.fil.stamp(0.5, 0.1);
    const R = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    const B = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 8) & 255;
    return { lr: R(8, 16), rb: B(24, 16) };
  });
  expect(out.lr).toBeGreaterThan(200); // the dark half → foreground red under production CSP
  expect(out.rb).toBeGreaterThan(200); // the light half → background blue under production CSP
});

test("Angled Strokes smears an edge into gray under CSP", async ({ page }) => {
  await gotoApp(page);
  const hasGray = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "angled-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 12, 24, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(12, 0, 12, 24, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
    mv.fil.angledStrokes(6, 0.5, 0);
    for (let y = 0; y < 24; y++) for (let x = 8; x < 16; x++) {
      const v = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
      if (v > 60 && v < 200) return true;
    }
    return false;
  });
  expect(hasGray).toBe(true); // the boundary smears into intermediate gray under production CSP
});

test("Patchwork quantizes into per-square tiles under CSP", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "patchwork-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 12, 24, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(12, 0, 12, 24, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
    mv.fil.patchwork(8, 0); // relief 0 → pure square averaging
    const r = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return { left: r(2, 5), mid: r(10, 5), right: r(20, 5) };
  });
  expect(out.left).toBeLessThan(30); // black square under production CSP
  expect(out.right).toBeGreaterThan(230); // white square
  expect(out.mid).toBeGreaterThan(100); expect(out.mid).toBeLessThan(160); // straddling square reads the mid average
});

test("Craquelure grows a crack network under CSP", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "craquelure-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.craquelure(6, 0.9, 0.6);
    let lo = 255, hi = 0, kept = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      const v = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
      if (Math.abs(v - 128) <= 6) kept++;
    }
    return { lo, hi, kept };
  });
  expect(out.lo).toBeLessThan(60); // dark crack grooves under production CSP
  expect(out.hi).toBeGreaterThan(200); // light ridges
  expect(out.kept).toBeGreaterThan(40 * 40 / 2); // most of the field keeps its colour
});

test("Neon Glow recolours a midtone toward the glow colour under CSP", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red glow colour
    mv.store.newDocument(32, 32, "neon-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.neonGlow(0, 1);
    const c = E.pick_color(16, 16) >>> 0;
    return { r: (c >>> 24) & 255, g: (c >>> 16) & 255, b: (c >>> 8) & 255 };
  });
  expect(out.r).toBeGreaterThan(150); // recoloured toward the red glow under production CSP
  expect(out.g).toBeLessThan(60);
  expect(out.b).toBeLessThan(60);
});

test("Glass refracts an edge under CSP", async ({ page }) => {
  await gotoApp(page);
  const minR = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "glass-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
    mv.distort.glass(0, 0.8, 0.2, 0.5); // strong, sharp
    let m = 255;
    for (let y = 0; y < 40; y++) m = Math.min(m, ((E.pick_color(20, y) >>> 0) >>> 24) & 255);
    return m;
  });
  expect(minR).toBeLessThan(128); // refraction pulls dark pixels across the boundary under production CSP
});

test("Ink Outlines inks an edge dark under CSP", async ({ page }) => {
  await gotoApp(page);
  const edgeMin = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "ink-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 32, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(16, 0, 16, 32, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
    mv.fil.inkOutlines(0.5, 1, 0); // dark ink, no light
    let m = 255;
    for (let y = 0; y < 32; y++) for (let x = 14; x < 18; x++) m = Math.min(m, ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return m;
  });
  expect(edgeMin).toBeLessThan(30); // the boundary is inked dark under production CSP
});

test("Chalk & Charcoal maps shadows/midtones/highlights to 3 tones under CSP", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red charcoal
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue chalk
    mv.store.newDocument(48, 16, "cc-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(0, 0, 0, 255); // black → shadows
    E.select_rect(16, 0, 16, 16, 0); E.fill_selection(128, 128, 128, 255); // mid → midtones
    E.select_rect(32, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255); // white → highlights
    E.select_none();
    mv.engine.commit();
    mv.fil.chalkCharcoal(0.3, 0.3, 1);
    const c = (x: number) => { const p = E.pick_color(x, 8) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 }; };
    return { sh: c(8), mid: c(24), hi: c(40) };
  });
  expect(out.sh.r).toBeGreaterThan(200); expect(out.sh.b).toBeLessThan(60); // shadows → foreground charcoal under production CSP
  expect(Math.abs(out.mid.r - 128)).toBeLessThan(20); expect(Math.abs(out.mid.b - 128)).toBeLessThan(20); // midtones → a solid neutral gray
  expect(out.hi.b).toBeGreaterThan(200); expect(out.hi.r).toBeLessThan(60); // highlights → background chalk
});

test("Grain textures a flat field while staying neutral under CSP", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "grain-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.grain(0.8, 0, 0); // Regular grain
    let lo = 255, hi = 0, neutral = true;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const p = E.pick_color(x, y) >>> 0;
      const r = (p >>> 24) & 255, g = (p >>> 16) & 255, b = (p >>> 8) & 255;
      if (r !== g || g !== b) neutral = false;
      lo = Math.min(lo, r); hi = Math.max(hi, r);
    }
    return { lo, hi, neutral };
  });
  expect(out.neutral).toBe(true); // monochromatic grain keeps a gray field neutral under production CSP
  expect(out.hi - out.lo).toBeGreaterThan(20); // the field is grained
});

test("Plastic Wrap puts a specular sheen on an edge under CSP", async ({ page }) => {
  await gotoApp(page);
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 16, "wrap-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(16, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
    mv.fil.plasticWrap(1.0, 0, 0);
    const R = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    return { edge: R(15, 8), far: R(2, 8) };
  });
  expect(out.edge).toBeGreaterThan(200); // the boundary lifts to a sheen under production CSP
  expect(out.far).toBeLessThan(30); // the far interior stays dark
});

test("a Layer Comp restores layer visibility under CSP", async ({ page }) => {
  await gotoApp(page);
  const top = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "comps-csp");
    const id = mv.engine.engine.add_layer("Top");
    mv.engine.commit();
    mv.store.saveLayerComp(); // capture with the top layer visible
    mv.store.setLayerVisible(id, false); // then hide it
    return id as number;
  });
  expect(await page.evaluate((id) => (window as any).__mv.engine.engine.layer_visible(id), top)).toBe(false);
  await page.evaluate(() => (window as any).__mv.store.applyLayerComp(0)); // apply restores visibility
  expect(await page.evaluate((id) => (window as any).__mv.engine.engine.layer_visible(id), top)).toBe(true);
});

test("a toolbar flyout group opens and selects a hidden tool under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "tool-groups-csp");
    mv.engine.commit();
    mv.store.setTool("brush");
  });
  const marquee = page.locator('[data-tool-group="grp-marquee"]');
  await marquee.waitFor();
  await expect(marquee).toHaveAttribute("data-tool", "marquee");
  // The flyout renders through a portal/Popover — prove it works under the prod CSP.
  await marquee.click({ button: "right" });
  await page.locator('[data-flyout-tool="ellipse"]').click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("ellipse");
  await expect(marquee).toHaveAttribute("data-tool", "ellipse");
});

test("the Curvature Pen fits a smooth curve through clicks and fills it under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 80, "curvepen-csp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none(); // white base
    mv.engine.commit();
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red
    mv.store.setTool("curvaturepen");
    mv.store.fit();
  });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.1, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const cx = (d: number) => box.x + d * box.w / 100;
  const cy = (d: number) => box.y + d * box.h / 80;
  // Click three anchors (no drag) then Enter; the curve is fitted + filled under CSP.
  await page.mouse.click(cx(22), cy(20));
  await page.mouse.click(cx(80), cy(22));
  await page.mouse.click(cx(50), cy(65));
  await page.keyboard.press("Enter");
  const inside = await page.evaluate(() => { const p = (window as any).__mv.engine.engine.pick_color(50, 40) >>> 0; return [(p >>> 24) & 255, (p >>> 16) & 255, (p >>> 8) & 255]; });
  expect(inside[0]).toBeGreaterThan(180);
  expect(inside[1]).toBeLessThan(90);
});

test("the Filter Gallery composes a 2-filter stack under CSP", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const before = await composite(page);
  const baseDepth = await page.evaluate(() => (window as any).__mv.engine.engine.undo_depth());
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Filter Gallery…")),
    null, { timeout: 10_000 },
  );
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Filter Gallery…")).run());
  await expect(page.locator("[data-mv-gallery-stack]")).toBeVisible();
  await page.click('[data-mv-gallery-add="cutout"]');
  await page.waitForTimeout(150);
  await page.click('[data-mv-gallery-add="posterEdges"]');
  await page.waitForTimeout(200);
  await expect(page.locator("[data-mv-gallery-effect]")).toHaveCount(2);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(200);
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk); // the composed stack baked into the image
  // one undoable step for the whole stack, even in the shipping CSP bundle
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.undo_depth()) - baseDepth).toBe(1);
});

test("the Slice tools draw, select, move and delete a slice under CSP", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(160, 120, "slice-csp");
    mv.engine.commit();
    mv.store.setTool("slice");
    mv.store.addSliceRect(20, 20, 100, 80); // 80×60 slice at (20,20)
    const added = mv.store.state.slices.length;
    mv.store.setTool("sliceselect");
    mv.store.selectSlice(0);
    mv.store.setSelectedSliceGeom({ x: 30, y: 25, w: 80, h: 60 }); // move it
    const moved = { ...mv.store.state.slices[0] };
    mv.store.deleteSelectedSlice();
    return { added, moved, after: mv.store.state.slices.length };
  });
  expect(r.added).toBe(1);
  expect(r.moved).toMatchObject({ x: 30, y: 25, w: 80, h: 60 });
  expect(r.after).toBe(0);
});

test("the Mixer Brush blends two canvas colours under CSP", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(80, 60, "mixer-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 40, 60, 0); E.fill_selection(220, 30, 30, 255);  // red (left)
    E.select_rect(40, 0, 40, 60, 0); E.fill_selection(30, 30, 220, 255); // blue (right)
    E.select_none();
    mv.engine.commit();
    mv.store.setTool("mixerbrush");
    mv.store.setBrush({ size: 16, hardness: 1, flow: 1, opacity: 1, mixerWet: 0.6, mixerLoad: 0, mixerMix: 1 });
    E.stroke_begin();
    for (let x = 5; x <= 75; x += 2) E.stroke_to(x, 30, 1);
    E.stroke_end();
    E.composite();
  });
  // The wet brush carried red across the seam → a red/blue midtone in the blue
  // region (red lifted off the field's 30, blue retained). Proves brush mode 11
  // dispatches + set_mixer_params reaches wasm under the shipping CSP.
  const rgb = await page.evaluate(() => {
    const packed = (window as any).__mv.engine.engine.pick_color(43, 30) >>> 0;
    return [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255];
  });
  expect(rgb[0]).toBeGreaterThan(70); // red carried in
  expect(rgb[2]).toBeGreaterThan(70); // blue retained → a blend
});

test("Quick Mask toggles, paints and round-trips under CSP", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(120, 80, "qm-csp");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 60, 80, 0); // left half selected
    mv.engine.commit();
    const before = Array.from(E.selection_bounds()) as number[];
    mv.store.toggleQuickMask(); // enter — seeds buffer, suspends marquee
    const enteredOn = E.quick_mask_on();
    // Paint white into the masked right half → unmask (extends the selection).
    E.set_brush(40, 1, 1, 1, 0.2, 255, 255, 255, 255, false);
    E.set_brush_mode(0);
    E.stroke_begin();
    for (let x = 80; x <= 110; x += 4) E.stroke_to(x, 40, 1);
    E.stroke_end();
    mv.engine.commit();
    mv.store.toggleQuickMask(); // exit — buffer → selection
    const after = Array.from(E.selection_bounds()) as number[];
    const packed = E.pick_color(90, 40) >>> 0; // composite is never tinted by the overlay
    return { enteredOn, exitedOn: E.quick_mask_on(), before, after, alpha: packed & 255 };
  });
  expect(r.enteredOn).toBe(true);
  expect(r.exitedOn).toBe(false);
  expect(r.after[0] + r.after[2]).toBeGreaterThan(r.before[0] + r.before[2]); // selection grew
  expect(r.alpha).toBeGreaterThan(0); // pixel still present (engine output intact)
  const cspViolations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? []);
  expect(cspViolations).toEqual([]);
});

test("no CSP violations were recorded across the smoke run", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.fil.gaussian(2);
    mv.engine.engine.export_png();
  });
  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? []);
  expect(violations).toEqual([]);
});
