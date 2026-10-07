// ─────────────────────────────────────────────────────────────
// e2e/raster — drives the Rust/WASM hybrid renderer (?renderer=rust)
// ─────────────────────────────────────────────────────────────
// Loads the real app with the Rust renderer ON, builds documents through the
// dev hook, and asserts the engine actually paints: reads <canvas.artisan-raster>
// pixels back, checks the hybrid SVG text/effects fallback, the Rust-vs-SVG
// partition, and that view changes repaint. Run via `pnpm e2e:raster`.
//   node scripts/e2e/raster.mjs

// Must be set BEFORE harness.mjs is imported (it reads ARTISAN_URL at load).
process.env.ARTISAN_URL = process.env.ARTISAN_URL || "http://127.0.0.1:1421/?renderer=rust";
const { ensureServer } = await import("./server.mjs");
const { launch } = await import("./harness.mjs");

const stop = await ensureServer();
const s = await launch();
const results = [];

const test = async (id, fn) => {
  try {
    const r = await fn();
    results.push({ id, ...r });
    console.log(`${r.pass ? "✅" : "❌"} ${id.padEnd(34)} ${r.detail ? JSON.stringify(r.detail) : ""}`);
  } catch (e) {
    results.push({ id, pass: false, detail: String(e) });
    console.log(`❌ ${id.padEnd(34)} ${e}`);
  }
};

/** Read the Rust-painted canvas back and tally opaque + per-channel pixels. */
const rasterStats = () =>
  s.page.evaluate(() => {
    const c = document.querySelector("canvas.artisan-raster");
    if (!c || !c.width) return null;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let opaque = 0,
      red = 0,
      green = 0,
      blue = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] <= 10) continue;
      opaque++;
      const r = d[i],
        g = d[i + 1],
        b = d[i + 2];
      if (r > 150 && r > g + 40 && r > b + 40) red++;
      if (g > 120 && g > r + 30 && g > b + 30) green++;
      if (b > 150 && b > r + 40 && b > g + 40) blue++;
    }
    return { w: c.width, h: c.height, opaque, red, green, blue };
  });

await test("raster-canvas-paints-a-shape", async () => {
  await s.fixture(`const r=E.makeRect(40,40,200,140,0,0,{fill:E.solid(E.rgba(220,30,40))}); doc.layers[0].items.push(r); return [];`);
  await s.page.waitForTimeout(400);
  const st = await rasterStats();
  return { pass: !!st && st.opaque > 3000 && st.red > 800, detail: st };
});

await test("raster-multi-color-fills", async () => {
  await s.fixture(`
    doc.layers[0].items.push(
      E.makeRect(20,20,120,100,0,0,{fill:E.solid(E.rgba(220,30,40))}),
      E.makeEllipse(180,40,120,90,{fill:E.solid(E.rgba(30,180,60))}),
      E.makeRect(60,180,140,90,0,0,{fill:E.solid(E.rgba(40,80,230))}));
    return [];`);
  await s.page.waitForTimeout(400);
  const st = await rasterStats();
  return { pass: !!st && st.red > 300 && st.green > 300 && st.blue > 300, detail: st };
});

await test("raster-gradient-fill", async () => {
  // E.linearGradient() already RETURNS a Paint ({type:"gradient",gradient:{…}});
  // wrapping it again produced {gradient: Paint}, so the renderer found no stops
  // and painted nothing. This asserted a real gap that never existed.
  await s.fixture(`const r=E.makeRect(40,40,300,200,0,0,{fill:E.linearGradient()}); doc.layers[0].items.push(r); return [];`);
  await s.page.waitForTimeout(400);
  const st = await rasterStats();
  return { pass: !!st && st.opaque > 5000, detail: st };
});

await test("raster-hybrid-text-in-svg", async () => {
  await s.fixture(`doc.layers[0].items.push(E.makeText("Hybrid Text", 60, 200, {fontSize:40, fill:E.solid(E.BLACK)})); return [];`);
  await s.page.waitForTimeout(400);
  const ok = await s.page.evaluate(() =>
    [...document.querySelectorAll("svg.artisan-canvas text")].some((t) => (t.textContent || "").includes("Hybrid Text")),
  );
  return { pass: ok, detail: { svgText: ok } };
});

await test("raster-partition-plain-canvas-vs-effect-svg", async () => {
  const ids = await s.page.evaluate(() => {
    const E = window.__engine,
      store = window.__artisanStore;
    const doc = E.makeDocument("E2E", 900, 700);
    const plain = E.makeRect(40, 40, 120, 100, 0, 0, { fill: E.solid(E.rgba(220, 30, 40)) });
    const shadowed = E.makeRect(240, 40, 120, 100, 0, 0, { fill: E.solid(E.rgba(40, 80, 230)) });
    shadowed.effects = [{ type: "drop-shadow", dx: 6, dy: 6, blur: 6, color: E.rgba(0, 0, 0, 0.5) }];
    doc.layers[0].items.push(plain, shadowed);
    store.replaceDoc(doc, { markClean: true });
    store.setView({ zoom: 1, tx: 120, ty: 120, angle: 0 });
    return { plain: plain.id, shadowed: shadowed.id };
  });
  await s.page.waitForTimeout(400);
  const r = await s.page.evaluate((ids) => {
    const inSvg = (id) => !!document.querySelector(`svg.artisan-canvas [data-id="${id}"]`);
    return { plainInSvg: inSvg(ids.plain), shadowedInSvg: inSvg(ids.shadowed) };
  }, ids);
  // Plain rect is painted by the Rust canvas (not in SVG); the shadowed rect is
  // handed to the SVG fallback overlay (so the engine doesn't double-draw it).
  return { pass: r.plainInSvg === false && r.shadowedInSvg === true, detail: r };
});

await test("raster-view-zoom-repaints", async () => {
  await s.fixture(`doc.layers[0].items.push(E.makeRect(0,0,50,50,0,0,{fill:E.solid(E.rgba(220,30,40))})); return [];`);
  await s.page.waitForTimeout(300);
  const before = (await rasterStats())?.red ?? 0;
  await s.page.evaluate(() => window.__artisanStore.setView({ zoom: 4 }));
  await s.page.waitForTimeout(300);
  const after = (await rasterStats())?.red ?? 0;
  // 4× zoom → the 50×50 fill covers ~16× the device pixels.
  return { pass: after > before * 2 && before > 0, detail: { before, after } };
});

// ── wasm Engine ops API (the JS↔wasm boundary) ──────────────
// ── wasm Engine vector API (the JS↔wasm boundary) ───────────
// These used to drive a STANDALONE vector Engine (e.set_document / e.hit_test /
// e.translate / e.pathfinder / e.group / e.duplicate). Artisan and Vision now
// share ONE merged engine (docs/merged-engine-and-format.md), where a vector
// scene is a LAYER of a raster document and the API is `add_vector_layer` plus
// `vector_*` methods taking that layer id. The old surface simply does not
// exist, so every one of these scenes had been failing since the merge —
// silently, because `e2e:raster` is not part of `pnpm e2e`.
//
// Ported below to the real API. `group`/`ungroup`/`duplicate`/`set_fill`/
// `set_selection` have no wasm counterpart at all — those live in the TS engine
// (Ops.Group, commands.duplicate, the store's selection) and are covered by the
// unit suite and the tool e2e — so their scenes are gone rather than left red.

const VECTOR_SCENE = JSON.stringify({
  layers: [{
    items: [
      { type: "rect", id: "a", transform: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 10 }, fill: { type: "solid", color: { r: 200, g: 0, b: 0, a: 1 } }, width: 40, height: 30 },
      { type: "rect", id: "b", transform: { a: 1, b: 0, c: 0, d: 1, e: 100, f: 100 }, fill: { type: "solid", color: { r: 0, g: 0, b: 200, a: 1 } }, width: 40, height: 40 },
    ],
  }],
});

await test("engine-wasm-vector-hit-test", async () => {
  const r = await s.page.evaluate(async (scene) => {
    const w = window.__engineWasm;
    if (!w) return { error: "no __engineWasm hook" };
    await w.init();
    const e = new w.Engine(200, 200);
    const lid = e.add_vector_layer(scene, "vec");
    const out = {
      hitA: e.vector_hit_test(lid, 20, 20, 4) || null,
      hitB: e.vector_hit_test(lid, 110, 110, 4) || null,
      miss: e.vector_hit_test(lid, 75, 75, 4) || null,
    };
    e.free();
    return out;
  }, VECTOR_SCENE);
  return { pass: !!r && !r.error && r.hitA === "a" && r.hitB === "b" && r.miss === null, detail: r };
});

await test("engine-wasm-vector-translate-and-undo", async () => {
  const r = await s.page.evaluate(async (scene) => {
    const w = window.__engineWasm;
    if (!w) return { error: "no __engineWasm hook" };
    await w.init();
    const e = new w.Engine(200, 200);
    const lid = e.add_vector_layer(scene, "vec");
    // `vector_begin_edit` is what opens the undo step for a drag gesture, so the
    // repeated vector_translate_item calls collapse into one (mod.rs:12279).
    // Skipping it is what an app forgetting the contract would do — and then the
    // move is silently unundoable.
    e.vector_begin_edit(lid);
    const moved0 = e.vector_translate_item(lid, "a", 50, 0);
    const moved = e.vector_hit_test(lid, 70, 20, 4) || null;
    const canUndo = e.can_undo();
    e.undo();
    const back = e.vector_hit_test(lid, 20, 20, 4) || null;
    e.free();
    return { moved0, moved, canUndo, back };
  }, VECTOR_SCENE);
  return { pass: !!r && r.moved0 === true && r.moved === "a" && r.canUndo === true && r.back === "a", detail: r };
});

await test("engine-wasm-vector-boolean-unite", async () => {
  const r = await s.page.evaluate(async () => {
    const w = window.__engineWasm;
    if (!w) return { error: "no __engineWasm hook" };
    await w.init();
    const e = new w.Engine(200, 200);
    const rect = (id, x, y) => ({ type: "rect", id, transform: { a: 1, b: 0, c: 0, d: 1, e: x, f: y }, fill: { type: "solid", color: { r: 200, g: 0, b: 0, a: 1 } }, width: 50, height: 50 });
    const lid = e.add_vector_layer(JSON.stringify({ layers: [{ items: [rect("a", 0, 0), rect("b", 25, 25)] }] }), "vec");
    e.vector_boolean(lid, JSON.stringify(["a", "b"]), "unite");
    const items = JSON.parse(e.vector_scene_json(lid)).layers[0].items;
    e.free();
    return { count: items.length, kind: items[0] && items[0].type };
  });
  // Unite collapses the two overlapping rects into a single combined item.
  return { pass: !!r && !r.error && r.count === 1, detail: r };
});

const failed = results.filter((r) => !r.pass);
if (s.errors.length) console.log("page JS errors:", s.errors);
console.log(`\n${results.length - failed.length}/${results.length} raster e2e passed`);
await s.close();
if (typeof stop === "function") await stop();
process.exit(failed.length || s.errors.length ? 1 : 0);
