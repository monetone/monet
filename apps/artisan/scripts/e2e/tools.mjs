// ─────────────────────────────────────────────────────────────
// e2e/tools — behavioral e2e for every Monet Artisan tool.
//
// Each spec drives the REAL app (headless Chrome) with genuine pointer/keyboard
// input on the canvas, then asserts the document model actually changed the way
// that tool should change it. Run all, or filter by id/group substring:
//   node scripts/e2e/tools.mjs                # all
//   node scripts/e2e/tools.mjs transform      # specs whose id/group matches
// Screenshots land in /tmp/artisan-e2e/<id>.png for visual review.
// ─────────────────────────────────────────────────────────────

import { launch } from "./harness.mjs";
import { mkdirSync } from "node:fs";

const FILTER = (process.argv[2] || "").toLowerCase();
const SHOTS = "/tmp/artisan-e2e";
mkdirSync(SHOTS, { recursive: true });

// ── fixtures (run in-browser; E = engine barrel, doc = fresh document) ──
const FX = {
  rect: `const r=E.makeRect(250,200,220,150,0,0,{fill:E.solid(E.rgba(220,90,90)),stroke:E.defaultStroke(E.solid(E.BLACK))});doc.layers[0].items.push(r);return[r.id];`,
  // 2 red + 1 blue for magic wand
  threeRects: `const a=E.makeRect(140,150,110,90,0,0,{fill:E.solid(E.rgba(220,90,90))});const b=E.makeRect(330,150,110,90,0,0,{fill:E.solid(E.rgba(220,90,90))});const c=E.makeRect(140,320,110,90,0,0,{fill:E.solid(E.rgba(80,120,220))});doc.layers[0].items.push(a,b,c);return[a.id,b.id,c.id];`,
  // closed square path, 4 anchors, filled+stroked
  square: `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:true,anchors:[A(250,200),A(470,200),A(470,360),A(250,360)]},{fill:E.solid(E.rgba(120,160,220)),stroke:E.defaultStroke(E.solid(E.BLACK),2)});doc.layers[0].items.push(p);return[p.id];`,
  // open jagged path for smooth/liquify
  jagged: `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:false,anchors:[A(250,300),A(300,250),A(350,330),A(400,255),A(450,320)]},{fill:E.noPaint(),stroke:E.defaultStroke(E.solid(E.BLACK),3)});doc.layers[0].items.push(p);return[p.id];`,
  // a group of two rects (for group-selection)
  group: `const a=E.makeRect(180,180,90,80,0,0,{fill:E.solid(E.rgba(220,90,90))});const b=E.makeRect(300,180,90,80,0,0,{fill:E.solid(E.rgba(80,120,220))});const g=E.makeGroup([a,b]);doc.layers[0].items.push(g);return[g.id];`,
  // pathfinder: two horizontally overlapping rects (A red bottom, B blue top), both selected
  pfPair: `const a=E.makeRect(140,150,140,140,0,0,{fill:E.solid(E.rgba(220,80,80))});const b=E.makeRect(210,150,140,140,0,0,{fill:E.solid(E.rgba(80,120,220))});doc.layers[0].items.push(a,b);return[a.id,b.id];`,
  // pathfinder: two overlapping rects with the SAME fill colour (for Merge)
  pfSame: `const a=E.makeRect(140,150,140,140,0,0,{fill:E.solid(E.rgba(220,80,80))});const b=E.makeRect(210,150,140,140,0,0,{fill:E.solid(E.rgba(220,80,80))});doc.layers[0].items.push(a,b);return[a.id,b.id];`,
  // pathfinder: diagonal overlap so the outlines genuinely cross (for Outline)
  pfDiag: `const a=E.makeRect(140,150,140,140,0,0,{fill:E.solid(E.rgba(220,80,80))});const b=E.makeRect(210,220,140,140,0,0,{fill:E.solid(E.rgba(80,120,220))});doc.layers[0].items.push(a,b);return[a.id,b.id];`,
  // align: three rects with distinct positions + sizes, all selected
  alignThree: `const a=E.makeRect(40,60,40,20,0,0,{fill:E.solid(E.rgba(220,90,90))});const b=E.makeRect(200,120,20,80,0,0,{fill:E.solid(E.rgba(90,140,220))});const c=E.makeRect(120,300,80,40,0,0,{fill:E.solid(E.rgba(120,200,120))});doc.layers[0].items.push(a,b,c);return[a.id,b.id,c.id];`,
  // align: three rects strung out horizontally (clean distribute case)
  alignRow: `const a=E.makeRect(40,200,20,20,0,0,{fill:E.solid(E.rgba(220,90,90))});const b=E.makeRect(140,200,40,20,0,0,{fill:E.solid(E.rgba(90,140,220))});const c=E.makeRect(400,200,20,20,0,0,{fill:E.solid(E.rgba(120,200,120))});doc.layers[0].items.push(a,b,c);return[a.id,b.id,c.id];`,
};

// Build a pathfinder fixture, activate the real Pathfinder dock tab, then CLICK
// the named shape-mode tile / operation chip — exercising the genuine UI path.
const pathfind = async (s, fxKey, buttonName) => {
  await s.fixture(FX[fxKey]);
  await s.page.locator('[data-dock-tab][data-tab-id="pathfinder"]').click();
  await s.page.waitForTimeout(80);
  const panel = s.page.locator(".monet-cv-pathfinder");
  await panel.getByRole("button", { name: buttonName, exact: true }).click();
  await s.page.waitForTimeout(90);
  return s.snapshot();
};

// Activate the Align dock tab, then click an AlignBar button by accessible name.
const alignClick = async (s, fxKey, buttonName) => {
  await s.fixture(FX[fxKey]);
  await s.page.locator('[data-dock-tab][data-tab-id="align"]').click();
  await s.page.waitForTimeout(80);
  const before = await geomReport(s);
  await s.page.locator('.monet-cv-alignbar').getByRole("button", { name: buttonName, exact: true }).click();
  await s.page.waitForTimeout(90);
  return { before, after: await geomReport(s) };
};

// Live world-bounds of the current selection + selection/artboard rects.
const geomReport = (s) =>
  s.page.evaluate(() => {
    const st = window.__artisanStore.getState();
    const Q = window.__Q;
    const r = (n) => Math.round(n * 1000) / 1000;
    const ids = st.selection;
    const items = ids.map((id) => {
      const b = Q.worldBounds(st.doc, id);
      return { id, x: r(b.x), y: r(b.y), w: r(b.width), h: r(b.height) };
    });
    const sb = Q.selectionBounds(st.doc, ids);
    const ab = st.doc.artboards[st.doc.activeArtboard] || st.doc.artboards[0];
    return {
      items,
      sel: sb ? { x: r(sb.x), y: r(sb.y), w: r(sb.width), h: r(sb.height) } : null,
      ab: { x: r(ab.x), y: r(ab.y), w: r(ab.width), h: r(ab.height) },
    };
  });

// Gaps between adjacent items along an axis ("x" → horizontal, "y" → vertical).
const gapsAlong = (items, axis) => {
  const k = axis;
  const sz = axis === "x" ? "w" : "h";
  const s = items.slice().sort((p, q) => p[k] - q[k]);
  const g = [];
  for (let i = 1; i < s.length; i++) g.push(s[i][k] - (s[i - 1][k] + s[i - 1][sz]));
  return g;
};
const allClose = (xs, eps = 0.5) => xs.length === 0 || Math.max(...xs) - Math.min(...xs) <= eps;

// Activate the Stroke dock tab, click an "Align Stroke" button, then read back
// the selected item's stroke.align AND the rendered canvas node's marker attr.
const setStrokeAlign = async (s, align) => {
  await s.page.locator('[data-dock-tab][data-tab-id="stroke"]').click();
  await s.page.waitForTimeout(70);
  await s.page.locator(`div.monet-iconbtn[data-stroke-align="${align}"]`).click();
  await s.page.waitForTimeout(90);
  return s.page.evaluate(() => {
    const st = window.__artisanStore.getState();
    const id = st.selection[0];
    const it = window.__Q.getItem(st.doc, id);
    const node = document.querySelector(`svg.artisan-canvas [data-id="${id}"]`);
    return { model: it ? it.stroke.align : null, rendered: node ? node.getAttribute("data-stroke-align") : null };
  });
};

// Apply an effect by clicking the real Effect menu (top bar → dropdown item).
const applyEffectMenu = async (s, label) => {
  await s.page.getByRole("menuitem", { name: "Effect", exact: true }).first().click();
  await s.page.waitForTimeout(70);
  await s.page.locator(".monet-menu-item", { hasText: label }).first().click();
  await s.page.waitForTimeout(100);
};
// Effect types currently on the selected item.
const effectTypes = (s) =>
  s.page.evaluate(() => {
    const st = window.__artisanStore.getState();
    const it = window.__Q.getItem(st.doc, st.selection[0]);
    return it && it.effects ? it.effects.map((e) => e.type) : [];
  });
// Does the selected item's rendered <filter> use a SourceAlpha pass? (feather/glow do; plain blur doesn't.)
const renderedFilterHasSourceAlpha = (s) =>
  s.page.evaluate(() => {
    const id = window.__artisanStore.getState().selection[0];
    const node = document.querySelector(`svg.artisan-canvas [data-id="${id}"]`);
    const filter = node ? node.querySelector("filter") : null;
    return filter ? /SourceAlpha/.test(filter.innerHTML) : null;
  });
// Export the doc to SVG and re-import it (real round-trip); return all effect
// types found anywhere in the re-imported tree (items may nest in groups).
const roundtripEffectTypes = (s) =>
  s.page.evaluate(async () => {
    const st = window.__artisanStore.getState();
    const svg = window.__engine.IO.exportSVG(st.doc, { background: true });
    await window.__doImport("roundtrip.svg", svg);
    const types = [];
    const walk = (items) => {
      for (const it of items) {
        if (it.effects) for (const e of it.effects) types.push(e.type);
        if (it.type === "group") walk(it.children);
      }
    };
    for (const l of window.__artisanStore.getState().doc.layers) walk(l.items);
    return types;
  });

// Inspect a result group's children in-browser (type / closed / fill / stroke).
const groupKids = (s, gid) =>
  s.page.evaluate((id) => {
    const st = window.__artisanStore.getState();
    const g = window.__Q.getItem(st.doc, id);
    if (!g || g.type !== "group") return null;
    return g.children.map((c) => ({
      type: c.type,
      closed: c.type === "path" ? c.geometry.closed : null,
      fill: c.fill.type,
      stroke: c.stroke.paint.type,
    }));
  }, gid);

// Click a two-level submenu command `<top> ▸ <parent> ▸ <item>` by name.
const menuSubmenu = async (s, top, parent, item) => {
  await s.page.getByRole("menuitem", { name: top, exact: true }).first().click();
  await s.page.waitForTimeout(150);
  await s.page.locator(".monet-menu-item", { hasText: parent }).first().hover();
  await s.page.waitForTimeout(200);
  const it = s.page.locator(".monet-menu-item", { hasText: item }).first();
  await it.hover();
  await s.page.waitForTimeout(80);
  await it.click();
  await s.page.waitForTimeout(120);
};
// Click a three-level submenu command `<top> ▸ <l2> ▸ <l3> ▸ <item>` by name.
// Submenu flyouts mount only while open (single open child per level), so each
// hovered label's children are the only ones in the DOM — `.first()` is safe.
const menuSubmenu4 = async (s, top, l2, l3, item) => {
  await s.page.getByRole("menuitem", { name: top, exact: true }).first().click();
  await s.page.waitForTimeout(150);
  await s.page.locator(".monet-menu-item", { hasText: l2 }).first().hover();
  await s.page.waitForTimeout(180);
  await s.page.locator(".monet-menu-item", { hasText: l3 }).first().hover();
  await s.page.waitForTimeout(180);
  const it = s.page.locator(".monet-menu-item", { hasText: item }).first();
  await it.hover();
  await s.page.waitForTimeout(80);
  await it.click();
  await s.page.waitForTimeout(120);
};
// Object ▸ <parent> ▸ <item> (Arrange/Transform/Path).
const objectSubmenu = (s, parent, item) => menuSubmenu(s, "Object", parent, item);

const changed = (a, b) => a && b && a.anchorsHash !== b.anchorsHash;

// generic "drag creates a top-level item of `type`"
const create = (id, A, B, type, minChildren) => async (s) => {
  await s.reset();
  await s.setTool(id);
  await s.drag(A, B);
  const snap = await s.snapshot();
  const t = snap.top[0];
  let pass = snap.topCount === 1 && t?.type === type;
  if (minChildren != null) pass = pass && (t?.children ?? 0) >= minChildren;
  return { pass, detail: { topCount: snap.topCount, type: t?.type, children: t?.children, name: t?.name } };
};

// transform: fixture rect (selected), drag, run `check(before,after)`
const xform = (id, down, to, check) => async (s) => {
  const [rid] = await s.fixture(FX.rect);
  await s.setTool(id);
  const before = await s.itemDetail(rid);
  await s.drag(down, to);
  const after = await s.itemDetail(rid);
  return check(before, after);
};

// ── minimal binary importer fixtures (mirror src/io/import/binary-import.test.ts) ──
const _u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const _u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n & 0xffff, true); return b; };
const _s4 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n | 0, true); return b; };
const _u8 = (n) => new Uint8Array([n & 0xff]);
const _ascii = (str) => new Uint8Array(Array.from(str, (c) => c.charCodeAt(0) & 0xff));
const _cat = (...a) => { const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const _chunk = (id, body) => _cat(_ascii(id), _u32(body.length), body, body.length & 1 ? new Uint8Array(1) : new Uint8Array(0));
const _lodaCurve = (pts) => {
  let coords = new Uint8Array(0);
  for (const p of pts) coords = _cat(coords, _s4(p.x), _s4(p.y));
  let types = new Uint8Array(0);
  for (const p of pts) types = _cat(types, _u8(p.t));
  const argData = _cat(_u32(pts.length), coords, types);
  const startOfArgs = 20 + argData.length;
  const startOfArgTypes = startOfArgs + 8;
  const total = startOfArgTypes + 4;
  return _cat(_cat(_u32(total), _u32(1), _u32(startOfArgs), _u32(startOfArgTypes), _u32(0x03)), argData, _cat(_u32(20), _u32(20 + argData.length)), _u32(30));
};
const cdrTriangle = () => {
  const loda = _lodaCurve([{ x: 0, y: 0, t: 0x00 }, { x: 254000, y: 0, t: 0x40 }, { x: 127000, y: 254000, t: 0x40 }, { x: 0, y: 0, t: 0x48 }]);
  const obj = _cat(_ascii("obj "), _chunk("loda", loda));
  return _chunk("RIFF", _cat(_ascii("CDR8"), _chunk("vrsn", _u16(800)), _chunk("LIST", obj)));
};

// Build [a,b,c] rects bottom→top and select `which` ("a"|"c") for arrange tests.
const arrangeFixture = (which) =>
  `const mk=(x,col)=>E.makeRect(x,200,50,50,0,0,{fill:E.solid(col)});` +
  `const a=mk(100,E.rgba(220,80,80)),b=mk(180,E.rgba(80,180,80)),c=mk(260,E.rgba(80,120,220));` +
  `doc.layers[0].items.push(a,b,c);return[${which}.id];`;
const order = (s) => s.page.evaluate(() => window.__artisanStore.getState().doc.layers[0].items.map((i) => i.id));
// Click a top-level menu `<top>` then its leaf `<item>` (single level).
const topMenu = async (s, top, item) => {
  await s.page.getByRole("menuitem", { name: top, exact: true }).first().click();
  await s.page.waitForTimeout(120);
  await s.page.locator(".monet-menu-item", { hasText: item }).first().click();
  await s.page.waitForTimeout(140);
};
const fileMenu = (s, item) => topMenu(s, "File", item);
// Open a right-rail panel tab by its label.
const openTab = async (s, name) => {
  await s.page
    .getByRole("tab", { name, exact: true })
    .first()
    .click({ timeout: 4000 })
    .catch(async () => {
      await s.page.locator(".monet-tab", { hasText: name }).first().click({ timeout: 4000 });
    });
  await s.page.waitForTimeout(150);
};
const layerTree = (s) => s.page.getByRole("tree", { name: "Artwork layers" });
const layerRows = (s) => layerTree(s).locator('[role="treeitem"][aria-level="1"]');
const itemRows = (s) => layerTree(s).locator('[role="treeitem"][aria-level="2"]');
// Click a View-menu checkbox item by ANCHORED label regex ("Snap" ⊂ "Snap to Grid").
const viewToggleClick = async (s, re) => {
  await s.page.getByRole("menuitem", { name: "View", exact: true }).first().click();
  await s.page.waitForTimeout(130);
  await s.page.locator(".monet-menu-label", { hasText: re }).first().click();
  await s.page.waitForTimeout(120);
};
// Toggle a View setting, assert it flips, then toggle back (restores — these are
// non-doc store settings that survive s.reset() and would leak into later specs).
const viewToggleSpec = (id, re, read) => ({
  g: "command", id,
  fn: async (s) => {
    await s.reset();
    const get = () => s.page.evaluate(read);
    const a = await get();
    await viewToggleClick(s, re);
    const b = await get();
    await viewToggleClick(s, re);
    const c = await get();
    return { pass: b === !a && c === a, detail: { a, b, c } };
  },
});

// ── spec table ──
const SPECS = [
  // ---- commands: Object ▸ Arrange (z-order via the real menu) ----
  {
    g: "command", id: "cmd-bring-to-front",
    fn: async (s) => {
      await s.fixture(arrangeFixture("a")); // select bottom-most
      const before = await order(s);
      await objectSubmenu(s, "Arrange", "Bring to Front");
      const after = await order(s);
      const pass = after[0] === before[1] && after[1] === before[2] && after[2] === before[0];
      return { pass, detail: { before, after } };
    },
  },
  {
    g: "command", id: "cmd-bring-forward",
    fn: async (s) => {
      await s.fixture(arrangeFixture("a")); // select bottom-most
      const before = await order(s);
      await objectSubmenu(s, "Arrange", "Bring Forward");
      const after = await order(s);
      const pass = after[0] === before[1] && after[1] === before[0] && after[2] === before[2]; // a moved up one
      return { pass, detail: { before, after } };
    },
  },
  {
    g: "command", id: "cmd-send-backward",
    fn: async (s) => {
      await s.fixture(arrangeFixture("c")); // select top-most
      const before = await order(s);
      await objectSubmenu(s, "Arrange", "Send Backward");
      const after = await order(s);
      const pass = after[0] === before[0] && after[1] === before[2] && after[2] === before[1]; // c moved down one
      return { pass, detail: { before, after } };
    },
  },
  {
    g: "command", id: "cmd-send-to-back",
    fn: async (s) => {
      await s.fixture(arrangeFixture("c")); // select top-most
      const before = await order(s);
      await objectSubmenu(s, "Arrange", "Send to Back");
      const after = await order(s);
      const pass = after[0] === before[2] && after[1] === before[0] && after[2] === before[1];
      return { pass, detail: { before, after } };
    },
  },
  // ---- distribute by centre (Object ▸ Distribute ▸ Horizontal Distribute Center) ----
  {
    g: "command", id: "cmd-distribute-center",
    fn: async (s) => {
      // a[150,20] c=160 · b[190,20] c=200 · c[250,80] c=290 (c wide). Even centres
      // ⇒ step 65, so b's centre → 225 (x=215); the extremes stay pinned. (Distribute
      // SPACING would instead put b at a different x — this verifies centre semantics.)
      const [a, b, c] = await s.fixture(
        `const r=(x,w)=>E.makeRect(x,300,w,20,0,0,{fill:E.solid(E.rgba(120,160,220))});` +
          `const a=r(150,20),b=r(190,20),c=r(250,80);doc.layers[0].items.push(a,b,c);return[a.id,b.id,c.id];`,
      );
      const centreX = (id) =>
        s.page.evaluate((iid) => {
          const bb = window.__Q.worldBounds(window.__artisanStore.getState().doc, iid);
          return bb.x + bb.width / 2;
        }, id);
      await objectSubmenu(s, "Distribute", "Horizontal Distribute Center");
      const [ca, cb, cc] = [await centreX(a), await centreX(b), await centreX(c)];
      const near = (x, t) => Math.abs(x - t) < 0.5;
      const pass = near(ca, 160) && near(cc, 290) && near(cb, 225);
      return { pass, detail: { ca, cb, cc } };
    },
  },
  // ---- distribute by edge (Object ▸ Distribute ▸ Horizontal Distribute Left) ----
  {
    g: "command", id: "cmd-distribute-left",
    fn: async (s) => {
      // a.left 150 · b.left 190 · c.left 250 (c wide). Even LEFT edges ⇒ step 50,
      // so b.left → 200; extremes pinned. (Distribute Center would land b at 215 —
      // this verifies edge semantics, distinct from centre.)
      const [a, b, c] = await s.fixture(
        `const r=(x,w)=>E.makeRect(x,300,w,20,0,0,{fill:E.solid(E.rgba(120,160,220))});` +
          `const a=r(150,20),b=r(190,20),c=r(250,80);doc.layers[0].items.push(a,b,c);return[a.id,b.id,c.id];`,
      );
      const leftX = (id) =>
        s.page.evaluate((iid) => window.__Q.worldBounds(window.__artisanStore.getState().doc, iid).x, id);
      await objectSubmenu(s, "Distribute", "Horizontal Distribute Left");
      const [la, lb, lc] = [await leftX(a), await leftX(b), await leftX(c)];
      const near = (x, t) => Math.abs(x - t) < 0.5;
      const pass = near(la, 150) && near(lc, 250) && near(lb, 200);
      return { pass, detail: { la, lb, lc } };
    },
  },
  // ---- commands: Object ▸ Transform (rotate ±90°) ----
  {
    g: "command", id: "cmd-rotate-90-cw",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      const before = await s.itemDetail(rid);
      await objectSubmenu(s, "Transform", "Rotate 90° CW");
      const after = await s.itemDetail(rid);
      // 90° rotation introduces off-diagonal terms; area (|det|) is preserved.
      const pass = Math.abs(before.transform.b) < 0.01 && Math.abs(after.transform.b) > 0.5 && Math.abs(after.det - before.det) < 0.01;
      return { pass, detail: { beforeB: before.transform.b, afterB: after.transform.b, det: after.det } };
    },
  },
  {
    g: "command", id: "cmd-rotate-90-ccw",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      const before = await s.itemDetail(rid);
      await objectSubmenu(s, "Transform", "Rotate 90° CCW");
      const after = await s.itemDetail(rid);
      // CCW vs CW → opposite sign on transform.b.
      const pass = Math.abs(after.transform.b) > 0.5 && Math.sign(after.transform.b) !== 0 && Math.abs(after.det - before.det) < 0.01;
      return { pass, detail: { afterB: after.transform.b, det: after.det } };
    },
  },
  // ---- Object ▸ Slice ▸ Create from Selection (via the real menu) ----
  {
    g: "command", id: "slice-from-selection",
    fn: async (s) => {
      await s.fixture(`const r=E.makeRect(150,150,160,120,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(r);return[r.id];`);
      await objectSubmenu(s, "Slice", "Create from Selection");
      const res = await s.page.evaluate(() => {
        const sl = window.__artisanStore.getState().doc.slices || [];
        return sl.length === 1 ? { n: 1, x: sl[0].x, y: sl[0].y, w: sl[0].width, h: sl[0].height } : { n: sl.length };
      });
      const near = (a, b) => Math.abs(a - b) < 1;
      const pass = res.n === 1 && near(res.x, 150) && near(res.y, 150) && near(res.w, 160) && near(res.h, 120);
      return { pass, detail: res };
    },
  },
  // ---- Object ▸ Slice ▸ Create from Guides (via the real menu) ----
  {
    g: "command", id: "slice-from-guides",
    fn: async (s) => {
      // a known 400×300 artboard + a guide cross at its centre → a 2×2 slice grid.
      await s.fixture(`doc.artboards=[E.makeArtboard("AB",0,0,400,300)];return[];`);
      await s.page.evaluate(() => {
        window.__artisanStore.addGuide("v", 200);
        window.__artisanStore.addGuide("h", 150);
      });
      await objectSubmenu(s, "Slice", "Create from Guides");
      const n = await s.page.evaluate(() => (window.__artisanStore.getState().doc.slices || []).length);
      return { pass: n === 4, detail: { slices: n } };
    },
  },
  // ---- Object ▸ Artboards ▸ Fit to Selected Art (via the real menu) ----
  {
    g: "command", id: "artboard-fit-selection",
    fn: async (s) => {
      await s.fixture(`const r=E.makeRect(200,150,160,120,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(r);return[r.id];`);
      await objectSubmenu(s, "Artboards", "Fit to Selected Art");
      const res = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const ab = st.doc.artboards[st.doc.activeArtboard] || st.doc.artboards[0];
        return { x: ab.x, y: ab.y, w: ab.width, h: ab.height };
      });
      const near = (a, b) => Math.abs(a - b) < 1;
      const pass = near(res.x, 200) && near(res.y, 150) && near(res.w, 160) && near(res.h, 120);
      return { pass, detail: res };
    },
  },
  // ---- Object ▸ Artboards ▸ Rearrange All Artboards (via the real menu) ----
  {
    g: "command", id: "artboard-rearrange",
    fn: async (s) => {
      await s.fixture(`doc.artboards=[E.makeArtboard("A",0,0,100,80),E.makeArtboard("B",500,200,120,90),E.makeArtboard("C",50,400,80,80)];return[];`);
      await objectSubmenu(s, "Artboards", "Rearrange All Artboards");
      const res = await s.page.evaluate(() => window.__artisanStore.getState().doc.artboards.map((a) => ({ x: a.x, y: a.y })));
      // single row, 20px gap: A(0,0), B(120,0), C(260,0)
      const pass =
        res.length === 3 &&
        res[0].x === 0 && res[0].y === 0 &&
        res[1].x === 120 && res[1].y === 0 &&
        res[2].x === 260 && res[2].y === 0;
      return { pass, detail: res };
    },
  },
  // ---- Object ▸ Artboards ▸ Convert to Artboards (via the real menu) ----
  {
    g: "command", id: "artboard-convert",
    fn: async (s) => {
      await s.fixture(
        `const a=E.makeRect(100,100,80,60,0,0,{fill:E.solid(E.rgba(220,90,90))});` +
          `const b=E.makeRect(250,50,60,90,0,0,{fill:E.solid(E.rgba(80,120,220))});` +
          `doc.layers[0].items.push(a,b);return[a.id,b.id];`,
      );
      const before = await s.page.evaluate(() => window.__artisanStore.getState().doc.artboards.length);
      await objectSubmenu(s, "Artboards", "Convert to Artboards");
      const res = await s.page.evaluate(() => {
        const abs = window.__artisanStore.getState().doc.artboards;
        return { n: abs.length, added: abs.slice(-2).map((a) => ({ x: a.x, y: a.y, w: a.width, h: a.height })) };
      });
      const has = (arr, o) => arr.some((x) => x.x === o.x && x.y === o.y && x.w === o.w && x.h === o.h);
      const pass = res.n === before + 2 && has(res.added, { x: 100, y: 100, w: 80, h: 60 }) && has(res.added, { x: 250, y: 50, w: 60, h: 90 });
      return { pass, detail: res };
    },
  },
  // ---- Object ▸ Artboards ▸ New / Delete Artboard (via the real menu) ----
  {
    g: "command", id: "artboard-crud",
    fn: async (s) => {
      await s.fixture(`return [];`); // doc with the one default artboard
      const ab = () =>
        s.page.evaluate(() => {
          const d = window.__artisanStore.getState().doc;
          return { n: d.artboards.length, active: d.activeArtboard };
        });
      const start = await ab();
      await objectSubmenu(s, "Artboards", "New Artboard");
      const afterNew = await ab();
      await objectSubmenu(s, "Artboards", "Delete Artboard");
      const afterDel = await ab();
      const pass =
        start.n === 1 && afterNew.n === 2 && afterNew.active === 1 && afterDel.n === 1 && afterDel.active === 0;
      return { pass, detail: { start, afterNew, afterDel } };
    },
  },
  // ---- Object ▸ Artboards ▸ Duplicate Artboard (via the real menu) ----
  {
    g: "command", id: "artboard-duplicate",
    fn: async (s) => {
      // a rect on the active 900-wide artboard → Duplicate copies artboard + rect,
      // offset by 900+20=920 (clone x = 100+920 = 1020).
      await s.fixture(`const r=E.makeRect(100,100,80,60,0,0,{fill:E.solid(E.rgba(220,90,90))});doc.layers[0].items.push(r);return[r.id];`);
      await objectSubmenu(s, "Artboards", "Duplicate Artboard");
      const res = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const cloneX = st.selection.length ? window.__Q.worldBounds(st.doc, st.selection[0]).x : null;
        return { boards: st.doc.artboards.length, active: st.doc.activeArtboard, items: st.doc.layers[0].items.length, selN: st.selection.length, cloneX };
      });
      const pass = res.boards === 2 && res.active === 1 && res.items === 2 && res.selN === 1 && res.cloneX === 1020;
      return { pass, detail: res };
    },
  },
  // ---- command: File ▸ Save (serializes + marks the document clean) ----
  {
    g: "command", id: "cmd-save-marks-clean",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // markClean → dirty=false
      await s.page.evaluate((id) => window.__artisanStore.transact("nudge", (d) => window.__engine.Ops.Transform.translateItems(d, [id], 5, 5)), rid);
      const dirtyBefore = await s.page.evaluate(() => window.__artisanStore.getState().dirty);
      await fileMenu(s, "Save");
      await s.page.waitForFunction(() => window.__artisanStore.getState().dirty === false, { timeout: 5000 });
      const dirtyAfter = await s.page.evaluate(() => window.__artisanStore.getState().dirty);
      return { pass: dirtyBefore === true && dirtyAfter === false, detail: { dirtyBefore, dirtyAfter } };
    },
  },
  // ---- commands: Select menu ----
  {
    g: "command", id: "cmd-select-all",
    fn: async (s) => {
      await s.fixture(`const mk=(x)=>E.makeRect(x,200,50,50,0,0,{fill:E.solid(E.rgba(200,80,80))});doc.layers[0].items.push(mk(100),mk(180),mk(260));return[];`);
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await topMenu(s, "Select", "Select All");
      const n = await s.page.evaluate(() => window.__artisanStore.getState().selection.length);
      return { pass: n === 3, detail: { selected: n } };
    },
  },
  {
    g: "command", id: "cmd-deselect-all",
    fn: async (s) => {
      await s.fixture(`const mk=(x)=>E.makeRect(x,200,50,50,0,0,{fill:E.solid(E.rgba(200,80,80))});const a=mk(100),b=mk(180);doc.layers[0].items.push(a,b);return[a.id,b.id];`);
      const before = await s.page.evaluate(() => window.__artisanStore.getState().selection.length);
      await topMenu(s, "Select", "Deselect");
      const after = await s.page.evaluate(() => window.__artisanStore.getState().selection.length);
      return { pass: before === 2 && after === 0, detail: { before, after } };
    },
  },
  // ---- Select ▸ Object ▸ All on Same Layers (via the real menu) ----
  {
    g: "command", id: "select-same-layers",
    fn: async (s) => {
      // L0 = [a, b], L1 = [c]. Select only `a`, then "All on Same Layers" should
      // grow the selection to {a, b} (everything on L0) and never reach c.
      const [aId] = await s.fixture(
        `const mk=(x,y)=>E.makeRect(x,y,50,50,0,0,{fill:E.solid(E.rgba(200,80,80))});` +
          `const a=mk(100,200),b=mk(180,200);doc.layers[0].items.push(a,b);` +
          `const c=mk(100,320);doc.layers.push(E.makeLayer("Layer 2",[c]));` +
          `window.__sslC=c.id;return[a.id];`,
      );
      // exact-match labels: the Select menu also has "Next Object Above/Below",
      // so a substring match on "Object" would grab the wrong row.
      await s.page.getByRole("menuitem", { name: "Select", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-label", { hasText: /^Object$/ }).first().hover();
      await s.page.waitForTimeout(200);
      const item = s.page.locator(".monet-menu-label", { hasText: /^All on Same Layers$/ }).first();
      await item.hover();
      await s.page.waitForTimeout(80);
      await item.click();
      await s.page.waitForTimeout(120);
      const res = await s.page.evaluate((a) => {
        const sel = window.__artisanStore.getState().selection;
        return { n: sel.length, hasA: sel.includes(a), hasC: sel.includes(window.__sslC) };
      }, aId);
      const pass = res.n === 2 && res.hasA && !res.hasC;
      return { pass, detail: res };
    },
  },
  // ---- Select ▸ Object ▸ Point / Area Text Objects (via the real menu) ----
  {
    g: "command", id: "select-point-area-text",
    fn: async (s) => {
      // one point-text + one area-text (boxWidth/Height). The two new menu items
      // must each select only their own kind.
      await s.fixture(
        `const t=E.makeText("point",100,200);const area=E.makeText("area",100,320);` +
          `area.boxWidth=200;area.boxHeight=80;doc.layers[0].items.push(t,area);` +
          `window.__ptT=t.id;window.__ptA=area.id;return[];`,
      );
      // exact labels: "Object", "Text Objects", "Point/Area Text Objects" all
      // share the substring "Object", so substring matching would pick wrong.
      const pickObject = async (leaf) => {
        await s.page.getByRole("menuitem", { name: "Select", exact: true }).first().click();
        await s.page.waitForTimeout(150);
        await s.page.locator(".monet-menu-label", { hasText: /^Object$/ }).first().hover();
        await s.page.waitForTimeout(200);
        const it = s.page.locator(".monet-menu-label", { hasText: leaf }).first();
        await it.hover();
        await s.page.waitForTimeout(80);
        await it.click();
        await s.page.waitForTimeout(120);
      };
      await pickObject(/^Point Text Objects$/);
      const afterPoint = await s.page.evaluate(() => {
        const sel = window.__artisanStore.getState().selection;
        return sel.length === 1 && sel[0] === window.__ptT;
      });
      await pickObject(/^Area Text Objects$/);
      const afterArea = await s.page.evaluate(() => {
        const sel = window.__artisanStore.getState().selection;
        return sel.length === 1 && sel[0] === window.__ptA;
      });
      const pass = afterPoint && afterArea;
      return { pass, detail: { afterPoint, afterArea } };
    },
  },
  // ---- View ▸ Show/Hide Bounding Box (via the real menu) ----
  {
    g: "command", id: "hide-bounding-box",
    fn: async (s) => {
      // a selected rect under the Selection tool draws one <g.artisan-handles>
      // transform box. Toggling Show Bounding Box hides it, then shows it again.
      await s.fixture(
        `const r=E.makeRect(200,180,160,120,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await s.setTool("selection");
      await s.page.waitForTimeout(120);
      const before = await s.page.locator(".artisan-handles").count();
      await topMenu(s, "View", "Show Bounding Box"); // hide
      const hidden = await s.page.locator(".artisan-handles").count();
      await topMenu(s, "View", "Show Bounding Box"); // show again
      const shown = await s.page.locator(".artisan-handles").count();
      const pass = before === 1 && hidden === 0 && shown === 1;
      return { pass, detail: { before, hidden, shown } };
    },
  },
  // ---- Select ▸ Save Selection + re-apply (via the real menu) ----
  {
    g: "command", id: "save-selection",
    fn: async (s) => {
      // select one of two rects, Save Selection, deselect, then re-apply it from
      // the named item that appears at the bottom of the Select menu.
      const [aId] = await s.fixture(
        `const mk=(x)=>E.makeRect(x,200,50,50,0,0,{fill:E.solid(E.rgba(200,80,80))});` +
          `const a=mk(120),b=mk(220);doc.layers[0].items.push(a,b);return[a.id];`,
      );
      await topMenu(s, "Select", "Save Selection");
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.page.waitForTimeout(60);
      const cleared = await s.page.evaluate(() => window.__artisanStore.getState().selection.length);
      await topMenu(s, "Select", "Selection 1"); // the saved item
      const restored = await s.page.evaluate(() => window.__artisanStore.getState().selection);
      const pass = cleared === 0 && restored.length === 1 && restored[0] === aId;
      return { pass, detail: { cleared, restored } };
    },
  },
  // ---- View ▸ Show/Hide Transparency Grid (via the real menu) ----
  {
    g: "command", id: "transparency-grid",
    fn: async (s) => {
      // the checkerboard <div.artisan-transparency-grid> appears only while on.
      await s.fixture(
        `const r=E.makeRect(200,180,160,120,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(r);return[r.id];`,
      );
      const before = await s.page.locator(".artisan-transparency-grid").count();
      await topMenu(s, "View", "Show Transparency Grid"); // on
      const on = await s.page.locator(".artisan-transparency-grid").count();
      await topMenu(s, "View", "Show Transparency Grid"); // off
      const off = await s.page.locator(".artisan-transparency-grid").count();
      const pass = before === 0 && on === 1 && off === 0;
      return { pass, detail: { before, on, off } };
    },
  },
  // ---- View ▸ Trim View (via the real menu) ----
  {
    // Trim View clips the artwork to the artboards and hides editing chrome — the
    // trim clip group appears while on, and ruler guides stop rendering.
    g: "command", id: "trim-view",
    fn: async (s) => {
      await s.fixture(`const r=E.makeRect(200,180,160,120,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(r);return[r.id];`);
      await s.page.evaluate(() => window.__artisanStore.addGuide("h", 100)); // a guide to confirm chrome is hidden
      await s.page.waitForTimeout(50);
      const before = await s.page.evaluate(() => ({
        trim: window.__artisanStore.getState().trimView,
        clip: document.querySelectorAll('[data-trim-clip="on"]').length,
        guides: document.querySelectorAll("[data-guide]").length,
      }));
      await topMenu(s, "View", "Trim View"); // on
      await s.page.waitForTimeout(80);
      const on = await s.page.evaluate(() => ({
        trim: window.__artisanStore.getState().trimView,
        clip: document.querySelectorAll('[data-trim-clip="on"]').length,
        guides: document.querySelectorAll("[data-guide]").length,
      }));
      await topMenu(s, "View", "Trim View"); // off
      await s.page.waitForTimeout(80);
      const off = await s.page.evaluate(() => ({
        trim: window.__artisanStore.getState().trimView,
        clip: document.querySelectorAll('[data-trim-clip="on"]').length,
        guides: document.querySelectorAll("[data-guide]").length,
      }));
      const pass =
        before.trim === false && before.clip === 0 && before.guides >= 1 &&
        on.trim === true && on.clip === 1 && on.guides === 0 &&
        off.trim === false && off.clip === 0 && off.guides >= 1;
      return { pass, detail: { before, on, off } };
    },
  },
  // ---- View ▸ Fit All in Window (via the real menu) ----
  {
    g: "command", id: "zoom-fit-all",
    fn: async (s) => {
      // two artboards far apart; Fit All must frame BOTH within the viewport.
      await s.fixture(`doc.artboards=[E.makeArtboard("A",0,0,400,300),E.makeArtboard("B",1400,0,400,300)];return[];`);
      await topMenu(s, "View", "Fit All in Window");
      const res = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const v = st.view;
        const vp = st.viewport;
        const abs = st.doc.artboards;
        let ok = abs.length === 2;
        for (const ab of abs) {
          // angle is 0 here, so screen = world·zoom + translate
          if (ab.x * v.zoom + v.tx < -1 || ab.y * v.zoom + v.ty < -1) ok = false;
          if ((ab.x + ab.width) * v.zoom + v.tx > vp.width + 1 || (ab.y + ab.height) * v.zoom + v.ty > vp.height + 1) ok = false;
        }
        return { ok, n: abs.length, zoom: v.zoom };
      });
      const pass = res.ok && res.n === 2 && res.zoom > 0;
      return { pass, detail: res };
    },
  },
  // ---- Select ▸ Same ▸ Font Family (via the real menu) ----
  {
    g: "command", id: "select-same-font",
    fn: async (s) => {
      // 3 text objects: 2 Helvetica + 1 Times. From a Helvetica selection,
      // "Font Family" grows it to both Helvetica objects (not the Times one).
      const [aId] = await s.fixture(
        `const tA=E.makeText("a",100,150,{fontFamily:"Helvetica",fontSize:24});` +
          `const tB=E.makeText("b",100,230,{fontFamily:"Helvetica",fontSize:48});` +
          `const tC=E.makeText("c",100,310,{fontFamily:"Times",fontSize:24});` +
          `doc.layers[0].items.push(tA,tB,tC);` +
          `window.__sfB=tB.id;window.__sfC=tC.id;return[tA.id];`,
      );
      await menuSubmenu(s, "Select", "Same", "Font Family");
      const res = await s.page.evaluate((a) => {
        const sel = window.__artisanStore.getState().selection;
        return { n: sel.length, hasA: sel.includes(a), hasB: sel.includes(window.__sfB), hasC: sel.includes(window.__sfC) };
      }, aId);
      const pass = res.n === 2 && res.hasA && res.hasB && !res.hasC;
      return { pass, detail: res };
    },
  },
  // ---- Select ▸ Same ▸ Text Fill Color (via the real menu) ----
  {
    g: "command", id: "select-same-text-fill",
    fn: async (s) => {
      // 2 red text + 1 blue text + a red RECT. From a red-text selection, "Text
      // Fill Color" selects only the red text objects (the rect is non-text).
      const [aId] = await s.fixture(
        `const tA=E.makeText("a",100,150,{fill:E.solid(E.rgba(220,0,0))});` +
          `const tB=E.makeText("b",100,230,{fill:E.solid(E.rgba(220,0,0))});` +
          `const tC=E.makeText("c",100,310,{fill:E.solid(E.rgba(0,0,220))});` +
          `const r=E.makeRect(320,150,80,80,0,0,{fill:E.solid(E.rgba(220,0,0))});` +
          `doc.layers[0].items.push(tA,tB,tC,r);` +
          `window.__stB=tB.id;window.__stC=tC.id;window.__stR=r.id;return[tA.id];`,
      );
      await menuSubmenu(s, "Select", "Same", "Text Fill Color");
      const res = await s.page.evaluate((a) => {
        const sel = window.__artisanStore.getState().selection;
        return { n: sel.length, hasA: sel.includes(a), hasB: sel.includes(window.__stB), hasC: sel.includes(window.__stC), hasR: sel.includes(window.__stR) };
      }, aId);
      const pass = res.n === 2 && res.hasA && res.hasB && !res.hasC && !res.hasR;
      return { pass, detail: res };
    },
  },
  // ---- command: Edit ▸ Duplicate (in-place duplicate command, ⌘D) ----
  {
    g: "command", id: "cmd-duplicate",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await topMenu(s, "Edit", "Duplicate");
      const r = await s.page.evaluate((id) => {
        const st = window.__artisanStore.getState();
        const items = st.doc.layers[0].items;
        return { count: items.length, selN: st.selection.length, selIsNew: !st.selection.includes(id) };
      }, rid);
      // duplicate adds one item and selects the copy (not the original)
      const pass = r.count === 2 && r.selN === 1 && r.selIsNew;
      return { pass, detail: r };
    },
  },
  // ---- command: Effect ▸ Clear Effects ----
  {
    g: "command", id: "cmd-clear-effects",
    fn: async (s) => {
      const [rid] = await s.fixture(`const r=E.makeRect(220,200,160,120,0,0,{fill:E.solid(E.rgba(80,120,220))});r.effects=[{type:"drop-shadow",dx:6,dy:6,blur:6,color:E.rgba(0,0,0,0.5)}];doc.layers[0].items.push(r);return[r.id];`);
      const before = await s.page.evaluate((id) => (window.__Q.getItem(window.__artisanStore.getState().doc, id).effects || []).length, rid);
      await topMenu(s, "Effect", "Clear Effects");
      const after = await s.page.evaluate((id) => (window.__Q.getItem(window.__artisanStore.getState().doc, id).effects || []).length, rid);
      return { pass: before === 1 && after === 0, detail: { before, after } };
    },
  },
  // ---- command: View ▸ Reset Rotation (resets the canvas view angle) ----
  {
    g: "command", id: "cmd-reset-rotation",
    fn: async (s) => {
      await s.fixture(FX.rect);
      await s.page.evaluate(() => window.__artisanStore.setView({ angle: Math.PI / 4 }));
      const before = await s.page.evaluate(() => window.__artisanStore.getState().view.angle);
      await topMenu(s, "View", "Reset Rotation");
      const after = await s.page.evaluate(() => window.__artisanStore.getState().view.angle);
      return { pass: Math.abs(before) > 0.1 && Math.abs(after) < 1e-6, detail: { before, after } };
    },
  },
  // ---- command: File ▸ New (replaces the document with a fresh one) ----
  {
    g: "command", id: "cmd-new-document",
    fn: async (s) => {
      await s.fixture(`const mk=(x)=>E.makeRect(x,200,50,50,0,0,{fill:E.solid(E.rgba(200,80,80))});doc.layers[0].items.push(mk(100),mk(180));return[];`);
      const before = await s.page.evaluate(() => window.__artisanStore.getState().doc.layers.flatMap((l) => l.items).length);
      await fileMenu(s, "New");
      const after = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        return { items: st.doc.layers.flatMap((l) => l.items).length, dirty: st.dirty };
      });
      return { pass: before === 2 && after.items === 0 && after.dirty === false, detail: { before, after } };
    },
  },
  // ---- command: File ▸ Export as PNG (rasterizes + triggers a .png download) ----
  {
    g: "command", id: "cmd-export-png",
    fn: async (s) => {
      await s.fixture(`const r=E.makeRect(40,40,200,140,0,0,{fill:E.solid(E.rgba(220,30,40))});doc.layers[0].items.push(r);return[];`);
      let name = null;
      try {
        const [download] = await Promise.all([s.page.waitForEvent("download", { timeout: 12000 }), fileMenu(s, "Export as PNG")]);
        name = download.suggestedFilename();
      } catch (e) {
        return { pass: false, detail: { error: String(e).slice(0, 160) } };
      }
      return { pass: !!name && name.endsWith(".png"), detail: { name } };
    },
  },
  // ---- command: File ▸ Export Slices (one SVG per slice region) ----
  {
    g: "command", id: "cmd-export-slices",
    fn: async (s) => {
      await s.fixture(`const r=E.makeRect(40,40,120,90,0,0,{fill:E.solid(E.rgba(200,50,50))});doc.layers[0].items.push(r);doc.slices=[{id:"sl1",name:"hero",x:20,y:20,width:160,height:130}];return[];`);
      let name = null;
      try {
        const [download] = await Promise.all([s.page.waitForEvent("download", { timeout: 12000 }), fileMenu(s, "Export Slices")]);
        name = download.suggestedFilename();
      } catch (e) {
        return { pass: false, detail: { error: String(e).slice(0, 160) } };
      }
      return { pass: !!name && /hero/.test(name) && name.endsWith(".svg"), detail: { name } };
    },
  },
  // ---- commands: View-menu toggles (flip + restore, no state leak) ----
  viewToggleSpec("cmd-toggle-rulers", /^Rulers$/, () => window.__artisanStore.getState().rulers),
  viewToggleSpec("cmd-toggle-grid", /^Grid$/, () => window.__artisanStore.getState().grid.show),
  viewToggleSpec("cmd-toggle-guides", /^Show Guides$/, () => window.__artisanStore.getState().showGuides),
  viewToggleSpec("cmd-toggle-snap", /^Snap$/, () => window.__artisanStore.getState().snap.enabled),
  // ---- runtime: slice-region SVG export (the core of Export Slices) ----
  {
    g: "build", id: "svg-export-slice-region",
    fn: async (s) => {
      await s.fixture(`const r=E.makeRect(40,40,120,90,0,0,{fill:E.solid(E.rgba(200,50,50))});doc.layers[0].items.push(r);return[];`);
      const vb = await s.page.evaluate(() => {
        const IO = window.__engine.IO;
        const doc = window.__artisanStore.getState().doc;
        const svg = IO.exportSVG(doc, { background: true, region: { x: 30, y: 25, width: 150, height: 120 } });
        return (/viewBox="([^"]+)"/.exec(svg) || [])[1];
      });
      return { pass: vb === "30 25 150 120", detail: { vb } };
    },
  },
  // ---- shapes: dimension/parameter assertions (strengthen) ----
  {
    g: "shape", id: "ellipse-dims",
    fn: async (s) => {
      await s.reset();
      await s.setTool("ellipse");
      await s.drag({ x: 80, y: 80 }, { x: 300, y: 240 }); // 220 × 160 in world (zoom 1)
      const t = (await s.snapshot()).top[0];
      const d = await s.page.evaluate((id) => { const it = window.__Q.getItem(window.__artisanStore.getState().doc, id); return { type: it.type, w: it.width, h: it.height }; }, t.id);
      const pass = d.type === "ellipse" && Math.abs(d.w - 220) < 30 && Math.abs(d.h - 160) < 30;
      return { pass, detail: d };
    },
  },
  {
    // Draw Inside: with a target selected, the toolbar's Draw Inside button +
    // drawing a shape clips the new art into the target (one clip group).
    g: "build", id: "draw-inside",
    fn: async (s) => {
      await s.fixture(
        `const t=E.makeRect(150,150,200,200,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(t);window.__diTgt=t.id;return[t.id];`,
      );
      await s.page.locator('[data-draw-mode="inside"]').click(); // captures the selected target
      await s.page.waitForTimeout(60);
      await s.setTool("rect");
      await s.drag({ x: 200, y: 200 }, { x: 280, y: 280 }); // a small rect inside the target
      const res = await s.page.evaluate(() => {
        const items = window.__artisanStore.getState().doc.layers[0].items;
        const g = items[0];
        return {
          topCount: items.length,
          isClip: !!g && g.type === "group" && g.clip === true,
          clipPathIsTarget: !!g && g.children?.[0]?.id === window.__diTgt,
          children: g && g.children ? g.children.length : 0,
        };
      });
      const pass = res.topCount === 1 && res.isClip && res.clipPathIsTarget && res.children === 2;
      return { pass, detail: res };
    },
  },
  {
    g: "shape", id: "polygon-sides",
    fn: async (s) => {
      await s.reset();
      await s.setTool("polygon");
      await s.drag({ x: 200, y: 200 }, { x: 300, y: 200 });
      const t = (await s.snapshot()).top[0];
      const d = await s.page.evaluate((id) => { const it = window.__Q.getItem(window.__artisanStore.getState().doc, id); return { type: it.type, sides: it.sides, radius: Math.round(it.radius) }; }, t.id);
      const pass = d.type === "polygon" && d.sides >= 3 && d.radius > 0;
      return { pass, detail: d };
    },
  },
  // ---- importers (binary): PDF / AI / CDR via the real __doImport dispatcher ----
  {
    g: "import", id: "import-pdf",
    fn: async (s) => {
      await s.reset();
      const pdf = "%PDF-1.4\n3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj\n4 0 obj<</Length 80>>stream\n1 0 0 rg 20 20 100 80 re f 0 0 1 rg 50 120 m 150 120 l 100 190 l f\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
      const r = await s.page.evaluate((data) => window.__doImport("test.pdf", data), pdf);
      const pass = !!r && r.items === 2 && r.types.every((t) => t === "path" || t === "compound");
      return { pass, detail: r };
    },
  },
  {
    g: "import", id: "import-ai",
    fn: async (s) => {
      await s.reset();
      const ai = "%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator\n0 0 0 1 k\n30 30 m 170 30 L 170 100 L 30 100 L f\n1 0 0 Xa\n60 120 m 140 180 L 60 180 L f\n%%EOF";
      const r = await s.page.evaluate((data) => window.__doImport("test.ai", data), ai);
      return { pass: !!r && r.items === 2, detail: r };
    },
  },
  {
    // .eps / .ps route through the same PostScript interpreter as .ai (extension dispatch).
    g: "import", id: "import-eps",
    fn: async (s) => {
      await s.reset();
      const eps = "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 200 200\n0 0 0 1 k\n30 30 m 170 30 L 170 100 L 30 100 L f\n%%EOF";
      const r = await s.page.evaluate((data) => window.__doImport("art.eps", data), eps);
      return { pass: !!r && r.items >= 1 && r.types.every((t) => t === "path" || t === "compound"), detail: r };
    },
  },
  {
    g: "import", id: "import-cdr",
    fn: async (s) => {
      await s.reset();
      const bytes = Array.from(cdrTriangle());
      const r = await s.page.evaluate((arr) => window.__doImport("test.cdr", arr), bytes);
      const pass = !!r && r.items >= 1 && r.types[0] === "path";
      return { pass, detail: r };
    },
  },
  {
    g: "import", id: "import-zip-graceful",
    fn: async (s) => {
      await s.reset();
      // CorelDRAW X4+ ships a zip container (PK\x03\x04). A truncated/garbage zip
      // must be handled gracefully — detected + rejected without crashing the app.
      const zip = [0x50, 0x4b, 0x03, 0x04, ...Array(48).fill(0)];
      let threw = false;
      let r = null;
      try {
        r = await s.page.evaluate((arr) => window.__doImport("test.zip", arr), zip);
      } catch {
        threw = true; // importFile rejected — that's graceful (no page crash)
      }
      // pass = handled (either imported, or rejected cleanly); page-error check is global.
      return { pass: threw || !!r, detail: { threw, r } };
    },
  },
  // ---- transform serialization round-trip (.artisan JSON fidelity) ----
  {
    g: "build", id: "transform-roundtrip",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.page.evaluate((id) => {
        const E = window.__engine;
        window.__artisanStore.transact("xform", (d) => {
          const b = E.Query.worldBounds(d, id);
          E.Ops.Transform.rotateItems(d, [id], (37 * Math.PI) / 180, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
        });
      }, rid);
      const before = await s.itemDetail(rid);
      const after = await s.page.evaluate((id) => {
        const E = window.__engine;
        const json = E.IO.serializeDocument(window.__artisanStore.getState().doc);
        const it = E.Query.getItem(E.IO.deserializeDocument(json), id);
        const m = it.transform;
        return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
      }, rid);
      const m = before.transform;
      const eq = (x, y) => Math.abs(x - y) < 1e-4;
      const pass = Math.abs(after.b) > 0.1 && eq(m.a, after.a) && eq(m.b, after.b) && eq(m.c, after.c) && eq(m.d, after.d) && eq(m.e, after.e) && eq(m.f, after.f);
      return { pass, detail: { before: m, after } };
    },
  },
  // ---- graph: assert the Column Graph really builds one bar per data point ----
  {
    g: "graph", id: "column-graph-bars",
    fn: async (s) => {
      await s.reset();
      await s.setTool("column-graph");
      await s.drag({ x: 80, y: 80 }, { x: 360, y: 300 });
      const t = (await s.snapshot()).top[0];
      const info = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        const kids = it.type === "group" ? it.children : [];
        return { type: it.type, name: it.name, total: kids.length, rects: kids.filter((c) => c.type === "rect").length };
      }, t.id);
      // generators.ts DATA has 6 values → 6 column rects (+ a baseline axis path).
      const pass = info.type === "group" && info.rects >= 6 && info.total >= 7;
      return { pass, detail: info };
    },
  },
  // ---- gradient panel: radial focal-point follows a tool drag ----
  {
    g: "build", id: "gradient-radial-focal",
    fn: async (s) => {
      const [rid] = await s.fixture(`const r=E.makeRect(200,200,200,100,0,0,{fill:E.radialGradient()});doc.layers[0].items.push(r);return[r.id];`);
      await s.setTool("gradient");
      await s.drag({ x: 220, y: 210 }, { x: 360, y: 280 }, { steps: 10 });
      const g = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return it.fill.type === "gradient" ? { type: it.fill.gradient.type, cx: it.fill.gradient.cx, cy: it.fill.gradient.cy, fx: it.fill.gradient.fx, fy: it.fill.gradient.fy } : null;
      }, rid);
      // The radial focal (fx/fy) is set by the drag and coincides with the centre origin.
      const pass = !!g && g.type === "radial" && g.fx != null && g.fy != null && Math.abs(g.fx - g.cx) < 0.001 && Math.abs(g.fy - g.cy) < 0.001;
      return { pass, detail: g };
    },
  },
  // ---- gradient panel: recolor the selected stop via the inline Color picker ----
  {
    g: "build", id: "gradient-stop-recolor",
    fn: async (s) => {
      const [rid] = await s.fixture(`const r=E.makeRect(250,200,220,150,0,0,{fill:E.linearGradient()});doc.layers[0].items.push(r);return[r.id];`);
      await s.page.locator('[data-dock-tab][data-tab-id="gradient"]').click();
      await s.page.waitForTimeout(100);
      const stopColors = (id) =>
        s.page.evaluate((iid) => {
          const it = window.__Q.getItem(window.__artisanStore.getState().doc, iid);
          return it.fill.type === "gradient" ? it.fill.gradient.stops.map((st) => st.color) : null;
        }, id);
      const before = await stopColors(rid);
      // select the rightmost stop (offset 1 = black by default)
      await s.page.locator(".monet-cv-gradient-stop").nth(1).click();
      await s.page.waitForTimeout(60);
      // drive the R channel up via the gradient panel's stop Color picker
      const panel = s.page.locator(".monet-cv-gradient").locator("xpath=..");
      const rInput = panel.locator('.monet-numfield-input[aria-label="R"]').first();
      await rInput.fill("230");
      await rInput.press("Enter");
      await s.page.waitForTimeout(120);
      await s.page.evaluate(() => window.__artisanStore.endTransaction?.());
      const after = await stopColors(rid);
      const last = after && after[after.length - 1];
      const pass = !!last && last.r > 150 && last.g < 90 && last.b < 90 && JSON.stringify(before) !== JSON.stringify(after);
      return { pass, detail: { before, after } };
    },
  },
  // ---- gradient panel: editing a stop must NOT reset a radial centre/radius ----
  {
    g: "build", id: "gradient-radial-edit-keeps-center",
    fn: async (s) => {
      const [rid] = await s.fixture(`const p=E.radialGradient();p.gradient.cx=0.2;p.gradient.cy=0.3;p.gradient.r=0.4;const r=E.makeRect(250,200,220,150,0,0,{fill:p});doc.layers[0].items.push(r);return[r.id];`);
      await s.page.locator('[data-dock-tab][data-tab-id="gradient"]').click();
      await s.page.waitForTimeout(100);
      await s.page.locator(".monet-cv-gradient-stop").nth(1).click();
      await s.page.waitForTimeout(60);
      const panel = s.page.locator(".monet-cv-gradient").locator("xpath=..");
      const rInput = panel.locator('.monet-numfield-input[aria-label="R"]').first();
      await rInput.fill("180");
      await rInput.press("Enter");
      await s.page.waitForTimeout(120);
      await s.page.evaluate(() => window.__artisanStore.endTransaction?.());
      const g = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return it.fill.type === "gradient" ? { cx: it.fill.gradient.cx, cy: it.fill.gradient.cy, r: it.fill.gradient.r, type: it.fill.gradient.type } : null;
      }, rid);
      const pass = !!g && g.type === "radial" && Math.abs(g.cx - 0.2) < 0.01 && Math.abs(g.cy - 0.3) < 0.01 && Math.abs(g.r - 0.4) < 0.01;
      return { pass, detail: g };
    },
  },

  // ---- shapes + lines ----
  { g: "shape", id: "rect", fn: create("rect", { x: 80, y: 80 }, { x: 300, y: 240 }, "rect") },
  {
    // Rounded Rectangle tool: draws a rect with the configured corner radius (rx/ry > 0
    // → rounded corners, 8 anchors). Real drag.
    g: "shape", id: "rounded-rect",
    fn: async (s) => {
      await s.reset();
      await s.setTool("rounded-rect");
      await s.drag({ x: 80, y: 80 }, { x: 300, y: 240 });
      const snap = await s.snapshot();
      const id = snap.selection[0] ?? snap.top[0]?.id;
      const r = await s.page.evaluate((i) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, i);
        return { type: it.type, rx: it.rx, ry: it.ry, anchors: window.__engine.Shapes.localPaths(it)[0].anchors.length };
      }, id);
      const pass = r.type === "rect" && r.rx > 0 && r.ry > 0 && r.anchors === 8;
      return { pass, detail: r };
    },
  },
  { g: "shape", id: "ellipse", fn: create("ellipse", { x: 80, y: 80 }, { x: 300, y: 240 }, "ellipse") },
  { g: "shape", id: "polygon", fn: create("polygon", { x: 190, y: 160 }, { x: 280, y: 160 }, "polygon") },
  {
    // Star tool: drag sets the OUTER radius; the inner radius follows the ratio;
    // the outline alternates outer/inner → 2×points vertices. Real mouse drag.
    g: "shape", id: "star",
    fn: async (s) => {
      await s.reset();
      await s.setTool("star");
      await s.drag({ x: 190, y: 160 }, { x: 280, y: 160 }); // 90px → radius1 ≈ 90
      const snap = await s.snapshot();
      const id = snap.selection[0] ?? snap.top[0]?.id;
      const r = await s.page.evaluate((i) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, i);
        if (it.type !== "star") return { type: it.type };
        const g = window.__engine.Shapes.localPaths(it)[0];
        return { type: "star", r1: it.radius1, r2: it.radius2, points: it.points, verts: g.anchors.length };
      }, id);
      const pass = r.type === "star" && r.r1 > 50 && r.r2 < r.r1 && Math.abs(r.r2 - r.r1 * 0.5) < r.r1 * 0.15 && r.verts === 2 * r.points && r.points >= 3;
      return { pass, detail: r };
    },
  },
  {
    // Line tool: drag draws a stroke-only line; local endpoint = the drag delta.
    g: "shape", id: "line",
    fn: async (s) => {
      await s.reset();
      await s.setTool("line");
      await s.drag({ x: 80, y: 80 }, { x: 300, y: 240 }); // delta (220,160)
      const snap = await s.snapshot();
      const id = snap.selection[0] ?? snap.top[0]?.id;
      const r = await s.page.evaluate((i) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, i);
        return { type: it.type, x2: it.x2, y2: it.y2, fill: it.fill.type };
      }, id);
      const pass = r.type === "line" && Math.abs(r.x2 - 220) < 6 && Math.abs(r.y2 - 160) < 6 && r.fill === "none";
      return { pass, detail: r };
    },
  },
  {
    // Line tool + SHIFT → constrain the angle to 45° increments (here: horizontal).
    g: "shape", id: "line-shift-constrain",
    fn: async (s) => {
      await s.reset();
      await s.setTool("line");
      await s.drag({ x: 120, y: 200 }, { x: 320, y: 210 }, { mod: "Shift" }); // shallow → 0°
      const snap = await s.snapshot();
      const id = snap.selection[0] ?? snap.top[0]?.id;
      const r = await s.page.evaluate((i) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, i);
        return { x2: it.x2, y2: it.y2 };
      }, id);
      const pass = Math.abs(r.y2) < 6 && Math.abs(r.x2) > 150; // snapped to horizontal
      return { pass, detail: r };
    },
  },
  { g: "shape", id: "flare", fn: create("flare", { x: 190, y: 160 }, { x: 270, y: 160 }, "group", 1) },
  // ---- lines/grids (path & compound) ----
  { g: "line", id: "arc", fn: create("arc", { x: 80, y: 240 }, { x: 300, y: 80 }, "path") },
  {
    // the Arc is an open 2-anchor quarter-ellipse with bezier handles (not a line).
    g: "line", id: "arc-curve",
    fn: async (s) => {
      await s.reset();
      await s.setTool("arc");
      await s.drag({ x: 80, y: 240 }, { x: 300, y: 80 });
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = t?.type === "path" && d?.anchors === 2 && d?.closed === false && d?.hasHandles === true;
      return { pass, detail: { type: t?.type, anchors: d?.anchors, closed: d?.closed, hasHandles: d?.hasHandles } };
    },
  },
  { g: "line", id: "spiral", fn: create("spiral", { x: 190, y: 160 }, { x: 300, y: 160 }, "path") },
  { g: "line", id: "rect-grid", fn: create("rect-grid", { x: 80, y: 80 }, { x: 320, y: 280 }, "compound") },
  {
    // a 5×5 rectangular grid = border + 4 vertical + 4 horizontal = 9 subpaths spanning the drag.
    g: "line", id: "rect-grid-cells",
    fn: async (s) => {
      await s.reset();
      await s.setTool("rect-grid");
      await s.drag({ x: 80, y: 80 }, { x: 320, y: 280 }); // 240 × 200
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = t?.type === "compound" && d?.subpaths === 9 && Math.round(d.bounds.width) === 240 && Math.round(d.bounds.height) === 200;
      return { pass, detail: { type: t?.type, subpaths: d?.subpaths, bounds: d?.bounds } };
    },
  },
  { g: "line", id: "polar-grid", fn: create("polar-grid", { x: 190, y: 160 }, { x: 300, y: 160 }, "compound") },
  // ---- freehand/brush ----
  {
    // Pencil: a freeform multi-point drag → on release a SMOOTHED open bezier path
    // (anchors gain handles), current stroke + no fill. Real freehand mouse drag.
    g: "brush", id: "pencil",
    fn: async (s) => {
      await s.reset();
      await s.setTool("pencil");
      await s.lasso([{ x: 100, y: 220 }, { x: 160, y: 140 }, { x: 240, y: 240 }, { x: 320, y: 150 }]);
      const snap = await s.snapshot();
      const id = snap.selection[0] ?? snap.top[0]?.id;
      const r = id ? await s.page.evaluate((iid) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, iid);
        const a = it.geometry.anchors;
        const hasHandles = a.some((an) => Math.abs(an.handleOut.x) + Math.abs(an.handleOut.y) + Math.abs(an.handleIn.x) + Math.abs(an.handleIn.y) > 0.01);
        return { type: it.type, closed: it.geometry.closed, count: a.length, hasHandles, fill: it.fill.type };
      }, id) : null;
      const pass = snap.topCount === 1 && !!r && r.type === "path" && !r.closed && r.count >= 2 && r.hasHandles && r.fill === "none";
      return { pass, detail: { topCount: snap.topCount, ...r } };
    },
  },
  {
    // Paintbrush (calligraphic): a freehand drag → a CLOSED filled ribbon in the
    // brush (stroke) color, no stroke, with real area. Real freehand mouse drag.
    g: "brush", id: "paintbrush",
    fn: async (s) => {
      await s.reset();
      await s.setTool("paintbrush");
      await s.lasso([{ x: 120, y: 180 }, { x: 200, y: 180 }, { x: 280, y: 210 }]);
      const snap = await s.snapshot();
      const id = snap.selection[0] ?? snap.top[0]?.id;
      const r = id ? await s.page.evaluate((iid) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, iid);
        const a = it.geometry.anchors.map((an) => an.point);
        let area = 0;
        for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; area += a[i].x * a[j].y - a[j].x * a[i].y; }
        return { type: it.type, closed: it.geometry.closed, fill: it.fill.type, stroke: it.stroke.paint.type, count: a.length, area: Math.abs(area) / 2 };
      }, id) : null;
      const pass = snap.topCount === 1 && !!r && r.type === "path" && r.closed && r.fill === "solid" && r.stroke === "none" && r.count >= 4 && r.count % 2 === 0 && r.area > 50;
      return { pass, detail: { topCount: snap.topCount, ...r } };
    },
  },
  { g: "brush", id: "blob-brush", fn: create("blob-brush", { x: 100, y: 160 }, { x: 320, y: 300 }, "compound") },
  {
    g: "brush", id: "blob-brush-merge",
    fn: async (s) => {
      // a red, NO-STROKE rect; paint a same-red, no-stroke blob over it → they merge
      await s.fixture(`const r=E.makeRect(200,200,160,120,0,0,{fill:E.solid(E.rgba(220,0,0)),stroke:E.defaultStroke(E.noPaint())});doc.layers[0].items.push(r);return[];`);
      await s.page.evaluate(() => {
        const E = window.__engine, st = window.__artisanStore;
        st.setFill(E.solid(E.rgba(220, 0, 0)));
        st.setStroke({ ...st.getState().stroke, paint: { type: "none" } });
      });
      const before = await s.snapshot();
      await s.setTool("blob-brush");
      await s.drag({ x: 240, y: 260 }, { x: 320, y: 260 }, { steps: 12 }); // paint across the red rect
      const after = await s.snapshot();
      // merged INTO the rect → still ONE shape (old behaviour produced two)
      const pass = before.topCount === 1 && after.topCount === 1 && (after.top[0].type === "compound" || after.top[0].type === "path");
      return { pass, detail: { before: before.topCount, after: after.topCount, types: after.top.map((t) => t.type) } };
    },
  },

  // ---- pen ----
  {
    g: "pen", id: "pen",
    fn: async (s) => {
      await s.reset();
      await s.setTool("pen");
      await s.click({ x: 140, y: 160 });
      await s.click({ x: 300, y: 150 });
      await s.click({ x: 250, y: 300 });
      await s.key("Enter");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      return { pass: snap.topCount === 1 && t?.type === "path" && d?.anchors === 3, detail: { topCount: snap.topCount, type: t?.type, anchors: d?.anchors } };
    },
  },
  {
    // Pen: clicking the FIRST anchor closes the path (Illustrator parity).
    g: "pen", id: "pen-close",
    fn: async (s) => {
      await s.reset();
      await s.setTool("pen");
      await s.click({ x: 140, y: 160 });
      await s.click({ x: 300, y: 150 });
      await s.click({ x: 250, y: 300 });
      await s.click({ x: 140, y: 160 }); // back on the first anchor → close
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && t?.type === "path" && d?.anchors === 3 && d?.closed === true;
      return { pass, detail: { topCount: snap.topCount, anchors: d?.anchors, closed: d?.closed } };
    },
  },
  {
    // Pen: click-DRAG makes a smooth point (the anchor gains bezier handles).
    g: "pen", id: "pen-smooth",
    fn: async (s) => {
      await s.reset();
      await s.setTool("pen");
      await s.drag({ x: 150, y: 220 }, { x: 210, y: 220 }); // click-drag first point
      await s.click({ x: 320, y: 220 });
      await s.key("Enter");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.anchors === 2 && d?.hasHandles === true;
      return { pass, detail: { anchors: d?.anchors, hasHandles: d?.hasHandles } };
    },
  },

  // ---- selection ----
  {
    g: "select", id: "selection",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.setTool("selection");
      await s.click({ x: 360, y: 275 });
      const snap = await s.snapshot();
      return { pass: snap.selection.includes(rid), detail: { selection: snap.selection } };
    },
  },
  {
    g: "select", id: "selection-move",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.setTool("selection");
      const before = await s.itemDetail(rid);
      await s.drag({ x: 360, y: 275 }, { x: 460, y: 345 });
      const after = await s.itemDetail(rid);
      return { pass: !!before && !!after && (before.transform.e !== after.transform.e || before.transform.f !== after.transform.f), detail: { be: before?.transform, af: after?.transform } };
    },
  },
  {
    // Selection: Shift-click ADDS a second object to the selection (real clicks).
    g: "select", id: "selection-shift-add",
    fn: async (s) => {
      await s.fixture(`const a=E.makeRect(150,150,80,80,0,0,{fill:E.solid(E.rgba(200,80,80))});const b=E.makeRect(320,150,80,80,0,0,{fill:E.solid(E.rgba(80,120,200))});doc.layers[0].items.push(a,b);return[];`);
      await s.setTool("selection");
      await s.click({ x: 190, y: 190 }); // rect A center
      const n1 = (await s.snapshot()).selection.length;
      await s.page.keyboard.down("Shift");
      await s.click({ x: 360, y: 190 }); // shift-click rect B center
      await s.page.keyboard.up("Shift");
      const n2 = (await s.snapshot()).selection.length;
      return { pass: n1 === 1 && n2 === 2, detail: { n1, n2 } };
    },
  },
  {
    // Selection: a rubber-band marquee from empty canvas selects every crossed object.
    g: "select", id: "selection-marquee",
    fn: async (s) => {
      await s.fixture(`const a=E.makeRect(150,150,80,80,0,0,{fill:E.solid(E.rgba(200,80,80))});const b=E.makeRect(320,150,80,80,0,0,{fill:E.solid(E.rgba(80,120,200))});doc.layers[0].items.push(a,b);return[];`);
      await s.setTool("selection");
      await s.drag({ x: 110, y: 110 }, { x: 420, y: 250 }); // band over both rects (starts on empty)
      const snap = await s.snapshot();
      return { pass: snap.selection.length === 2, detail: { selection: snap.selection.length } };
    },
  },
  {
    // Selection: ALT-drag an object → moves a COPY, original stays put, copy selected.
    g: "select", id: "selection-alt-duplicate",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // one rect at (250,200), selected
      await s.setTool("selection");
      await s.drag({ x: 360, y: 275 }, { x: 470, y: 345 }, { mod: "Alt" }); // alt-drag from the center
      const r = await s.page.evaluate((origId) => {
        const items = window.__artisanStore.getState().doc.layers.flatMap((l) => l.items);
        const orig = items.find((i) => i.id === origId);
        const copy = items.find((i) => i.id !== origId);
        const sel = window.__artisanStore.getState().selection;
        return {
          count: items.length,
          origInPlace: orig ? orig.transform.e === 250 && orig.transform.f === 200 : false,
          copyMoved: copy ? copy.transform.e !== 250 || copy.transform.f !== 200 : false,
          selectedCopy: !!copy && sel.length === 1 && sel[0] === copy.id,
        };
      }, rid);
      const pass = r.count === 2 && r.origInPlace && r.copyMoved && r.selectedCopy;
      return { pass, detail: r };
    },
  },
  {
    // Selection bounding box: drag the SE corner handle outward → scales the object.
    g: "select", id: "selection-scale-handle",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // 220×150 at (250,200); SE corner (470,350)
      await s.setTool("selection");
      const wb = (id) => s.page.evaluate((i) => { const b = window.__Q.worldBounds(window.__artisanStore.getState().doc, i); return { w: b.width, h: b.height }; }, id);
      const before = await wb(rid);
      await s.drag({ x: 470, y: 350 }, { x: 545, y: 425 }); // pull SE handle out from NW pivot
      const after = await wb(rid);
      const pass = after.w > before.w + 20 && after.h > before.h + 20;
      return { pass, detail: { before, after } };
    },
  },
  {
    // Selection bounding box: drag the rotate handle (≈22px above top-center) → rotates.
    g: "select", id: "selection-rotate-handle",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // top-center n=(360,200) → rot handle world (360,178) @zoom1
      await s.setTool("selection");
      await s.drag({ x: 360, y: 178 }, { x: 460, y: 240 });
      const t = await s.page.evaluate((id) => {
        const m = window.__Q.getItem(window.__artisanStore.getState().doc, id).transform;
        return { b: m.b, c: m.c };
      }, rid);
      // a rotation introduces non-zero off-diagonal matrix terms
      const pass = Math.abs(t.b) > 0.05 || Math.abs(t.c) > 0.05;
      return { pass, detail: t };
    },
  },
  {
    g: "select", id: "direct-selection",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square); // corners [0]=(250,200),[1]=(470,200),…
      await s.setTool("direct-selection");
      const before = await s.itemDetail(pid);
      await s.drag({ x: 250, y: 200 }, { x: 205, y: 165 }); // grab corner 0, move −45,−35
      const after = await s.itemDetail(pid);
      const snap = await s.snapshot();
      const a0 = await s.page.evaluate((id) => {
        const p = window.__Q.getItem(window.__artisanStore.getState().doc, id).geometry.anchors[0].point;
        return { x: p.x, y: p.y };
      }, pid);
      const moved = changed(before, after);
      const exact = Math.abs(a0.x - 205) < 6 && Math.abs(a0.y - 165) < 6; // corner 0 → drag end
      const pickedZero = (snap.anchorSelection[pid] || []).includes(0);
      return { pass: moved && exact && pickedZero, detail: { a0, anchorSel: snap.anchorSelection[pid] } };
    },
  },
  {
    // Direct Selection: CLICK an anchor (no drag) → selects just that anchor.
    g: "select", id: "direct-selection-pick-anchor",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square);
      await s.setTool("direct-selection");
      await s.click({ x: 470, y: 200 }); // corner index 1
      const snap = await s.snapshot();
      const sel = snap.anchorSelection[pid] || [];
      return { pass: sel.length === 1 && sel.includes(1), detail: { anchorSel: sel } };
    },
  },
  {
    // Arrow-key nudge with an anchor selected → moves the ANCHOR, not the object.
    g: "select", id: "nudge-anchor",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square); // corner 0 = (250,200)
      await s.setTool("direct-selection");
      await s.click({ x: 250, y: 200 }); // pick corner 0
      const read = () => s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return { x: it.geometry.anchors[0].point.x, y: it.geometry.anchors[0].point.y, a1x: it.geometry.anchors[1].point.x, te: it.transform.e };
      }, pid);
      const before = await read();
      await s.page.keyboard.press("ArrowRight");
      await s.page.waitForTimeout(30);
      await s.page.keyboard.press("ArrowDown");
      await s.page.waitForTimeout(30);
      const after = await read();
      const near = (a, b) => Math.abs(a - b) < 0.01;
      const pass = near(after.x, before.x + 1) && near(after.y, before.y + 1) && near(after.a1x, before.a1x) && near(after.te, before.te);
      return { pass, detail: { before, after } };
    },
  },
  {
    g: "select", id: "group-selection",
    fn: async (s) => {
      const [gid] = await s.fixture(FX.group);
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.setTool("group-selection");
      await s.click({ x: 225, y: 220 });
      const snap = await s.snapshot();
      const sel = snap.selection[0];
      const isLeaf = sel && sel !== gid;
      return { pass: snap.selection.length === 1 && isLeaf, detail: { selection: snap.selection, gid } };
    },
  },
  {
    // Selection tool: single-click a grouped object → the GROUP; double-click → the
    // object inside (Illustrator's enter-group dive-in). Real click + double-click.
    g: "select", id: "selection-double-click-group",
    fn: async (s) => {
      const [gid] = await s.fixture(FX.group); // group of rect A (centre 225,220) + B
      await s.setTool("selection");
      await s.click({ x: 225, y: 220 }); // single-click rect A
      const sel1 = (await s.snapshot()).selection.slice();
      await s.dblclick({ x: 225, y: 220 }); // double-click rect A → dive in
      const sel2 = (await s.snapshot()).selection.slice();
      const childA = await s.page.evaluate((g) => window.__Q.getItem(window.__artisanStore.getState().doc, g).children[0].id, gid);
      const pass = sel1.length === 1 && sel1[0] === gid && sel2.length === 1 && sel2[0] === childA;
      return { pass, detail: { sel1, sel2, gid, childA } };
    },
  },
  {
    g: "select", id: "lasso",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.setTool("lasso");
      await s.lasso([{ x: 300, y: 180 }, { x: 470, y: 180 }, { x: 470, y: 360 }, { x: 300, y: 360 }, { x: 300, y: 180 }]);
      const snap = await s.snapshot();
      return { pass: snap.selection.includes(rid), detail: { selection: snap.selection } };
    },
  },
  {
    g: "select", id: "lasso-touch",
    fn: async (s) => {
      // FX.rect = [250,470]×[200,350], centre (360,275). Lasso a band over its
      // LEFT edge only (x 230–300) — centre is OUTSIDE, so a centre-test would
      // miss it; touch-select must still pick it up.
      const [rid] = await s.fixture(FX.rect);
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.setTool("lasso");
      await s.lasso([{ x: 230, y: 180 }, { x: 300, y: 180 }, { x: 300, y: 370 }, { x: 230, y: 370 }, { x: 230, y: 180 }]);
      const snap = await s.snapshot();
      return { pass: snap.selection.includes(rid) && snap.selection.length === 1, detail: { selection: snap.selection } };
    },
  },
  {
    g: "select", id: "magic-wand",
    fn: async (s) => {
      await s.fixture(FX.threeRects);
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.setTool("magic-wand");
      await s.click({ x: 195, y: 195 });
      const snap = await s.snapshot();
      return { pass: snap.selection.length === 2, detail: { selection: snap.selection } };
    },
  },
  {
    g: "select", id: "magic-wand-tolerance",
    fn: async (s) => {
      // r1 exact red (click target), r2 NEAR red (Δ within 32), r3 FAR red (Δ>32)
      await s.fixture(
        `const r1=E.makeRect(140,200,90,90,0,0,{fill:E.solid(E.rgba(220,90,90))});` +
          `const r2=E.makeRect(280,200,90,90,0,0,{fill:E.solid(E.rgba(200,80,100))});` +
          `const r3=E.makeRect(420,200,90,90,0,0,{fill:E.solid(E.rgba(150,90,90))});doc.layers[0].items.push(r1,r2,r3);return[];`,
      );
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.setTool("magic-wand");
      await s.click({ x: 185, y: 245 }); // centre of r1
      const res = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const sel = new Set(st.selection);
        const items = st.doc.layers[0].items;
        const find = (r, g, b) => items.find((it) => it.fill.type === "solid" && it.fill.color.r === r && it.fill.color.g === g && it.fill.color.b === b);
        return {
          count: st.selection.length,
          exact: sel.has(find(220, 90, 90).id),
          near: sel.has(find(200, 80, 100).id),
          far: sel.has(find(150, 90, 90).id),
        };
      });
      // exact + near selected (within tolerance), far excluded
      return { pass: res.count === 2 && res.exact && res.near && !res.far, detail: res };
    },
  },
  {
    // Magic Wand ▸ Match = Stroke: selects by STROKE colour (set via the options
    // bar), proving it is no longer fill-only. r1+r2 share a blue stroke (diff
    // fills); r3 shares r1's red FILL but has a yellow stroke → excluded.
    g: "select", id: "magic-wand-stroke",
    fn: async (s) => {
      await s.fixture(
        `const mk=(x,fill,stroke)=>{const r=E.makeRect(x,200,90,90,0,0,{fill:E.solid(fill)});r.stroke={...r.stroke,paint:E.solid(stroke)};return r;};` +
          `const r1=mk(140,E.rgba(220,90,90),E.rgba(0,0,220));` +
          `const r2=mk(280,E.rgba(0,180,0),E.rgba(0,0,220));` +
          `const r3=mk(420,E.rgba(220,90,90),E.rgba(220,220,0));doc.layers[0].items.push(r1,r2,r3);return[];`,
      );
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.setTool("magic-wand");
      await s.page.waitForTimeout(60);
      await s.page.locator('[data-mw-match="stroke"]').click(); // match on stroke colour
      await s.page.waitForTimeout(40);
      await s.click({ x: 185, y: 245 }); // centre of r1
      const res = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const sel = new Set(st.selection);
        const items = st.doc.layers[0].items;
        const stroke = (it) => (it.stroke.paint.type === "solid" ? it.stroke.paint.color : null);
        const blueIds = items.filter((it) => { const c = stroke(it); return c && c.r === 0 && c.b === 220; }).map((it) => it.id);
        const yellow = items.find((it) => { const c = stroke(it); return c && c.r === 220 && c.g === 220; });
        return { count: st.selection.length, allBlue: blueIds.every((id) => sel.has(id)), yellow: sel.has(yellow.id) };
      });
      // both blue-stroke rects selected, the yellow-stroke (same-fill) rect excluded
      const pass = res.count === 2 && res.allBlue && !res.yellow;
      return { pass, detail: res };
    },
  },

  // ---- anchor edit ----
  {
    g: "anchor", id: "add-anchor",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square);
      await s.setTool("add-anchor");
      const before = await s.itemDetail(pid);
      await s.click({ x: 360, y: 200 }); // click the top edge of the square
      const after = await s.itemDetail(pid);
      // +1 anchor AND the path's shape (bounds) is unchanged — Add Anchor preserves the curve
      const b0 = before.bounds, b1 = after.bounds;
      const boundsSame =
        !!b0 && !!b1 &&
        Math.abs(b0.x - b1.x) < 0.5 && Math.abs(b0.y - b1.y) < 0.5 &&
        Math.abs(b0.width - b1.width) < 0.5 && Math.abs(b0.height - b1.height) < 0.5;
      return { pass: after?.anchors === 5 && boundsSame, detail: { anchors: after?.anchors, before: b0, after: b1 } };
    },
  },
  {
    g: "anchor", id: "delete-anchor",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square);
      await s.setTool("delete-anchor");
      await s.click({ x: 250, y: 200 });
      const d = await s.itemDetail(pid);
      return { pass: d?.anchors === 3, detail: { anchors: d?.anchors } };
    },
  },
  {
    g: "anchor", id: "convert-anchor",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square);
      await s.setTool("convert-anchor");
      const before = await s.itemDetail(pid);
      await s.drag({ x: 250, y: 200 }, { x: 200, y: 150 }); // DRAG a corner → smooth
      const after = await s.itemDetail(pid);
      return { pass: !before.hasHandles && !!after?.hasHandles, detail: { beforeHandles: before.hasHandles, afterHandles: after?.hasHandles } };
    },
  },
  {
    g: "anchor", id: "convert-anchor-click-corner",
    fn: async (s) => {
      // CLICK a corner anchor → it stays a corner (Illustrator: click only does smooth→corner)
      const [pid] = await s.fixture(FX.square);
      await s.setTool("convert-anchor");
      await s.click({ x: 250, y: 200 }); // click a corner of the square (no drag)
      const after = await s.itemDetail(pid);
      return { pass: after && after.hasHandles === false, detail: { afterHandles: after?.hasHandles } };
    },
  },
  {
    g: "anchor", id: "convert-anchor-click-smooth",
    fn: async (s) => {
      // CLICK a smooth anchor → it becomes a corner (handles removed)
      const [pid] = await s.fixture(
        `const A=E.makeAnchor;const p=E.makePath({closed:false,anchors:[A({x:200,y:300}),A({x:300,y:250},{x:-30,y:0},{x:30,y:0}),A({x:400,y:300})]},{fill:E.noPaint(),stroke:E.defaultStroke(E.solid(E.BLACK))});doc.layers[0].items.push(p);return[p.id];`,
      );
      await s.setTool("convert-anchor");
      const before = await s.itemDetail(pid);
      await s.click({ x: 300, y: 250 }); // click the smooth middle anchor
      const after = await s.itemDetail(pid);
      return { pass: before.hasHandles === true && after.hasHandles === false, detail: { before: before.hasHandles, after: after?.hasHandles } };
    },
  },
  {
    g: "anchor", id: "scissors",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square);
      await s.setTool("scissors");
      const before = await s.itemDetail(pid);
      await s.click({ x: 360, y: 200 });
      const after = await s.itemDetail(pid);
      const pass = !!after && (after.closed === false || after.anchors !== before.anchors || after.type !== "path");
      return { pass, detail: { beforeClosed: before.closed, after: after && { type: after.type, closed: after.closed, anchors: after.anchors } } };
    },
  },
  {
    g: "anchor", id: "smooth",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.jagged);
      await s.setTool("smooth");
      const before = await s.itemDetail(pid);
      await s.drag({ x: 250, y: 295 }, { x: 450, y: 295 });
      const after = await s.itemDetail(pid);
      return { pass: changed(before, after), detail: { moved: changed(before, after) } };
    },
  },

  // ---- transforms ----
  { g: "transform", id: "rotate", fn: xform("rotate", { x: 480, y: 275 }, { x: 360, y: 150 }, (b, a) => ({ pass: Math.abs(a.transform.b) > 0.05, detail: { b: a.transform.b } })) },
  { g: "transform", id: "scale", fn: xform("scale", { x: 480, y: 275 }, { x: 600, y: 275 }, (b, a) => ({ pass: Math.abs(a.transform.a) > Math.abs(b.transform.a) * 1.3, detail: { a0: b.transform.a, a1: a.transform.a } })) },
  { g: "transform", id: "reflect", fn: xform("reflect", { x: 480, y: 275 }, { x: 360, y: 150 }, (b, a) => ({ pass: a.det < 0, detail: { det: a.det } })) },
  { g: "transform", id: "shear", fn: xform("shear", { x: 480, y: 275 }, { x: 480, y: 410 }, (b, a) => ({ pass: Math.abs(a.transform.c) > 0.05, detail: { c: a.transform.c } })) },
  // a horizontal shear must visibly WIDEN the bbox while keeping its height.
  { g: "transform", id: "shear-bbox", fn: xform("shear", { x: 480, y: 275 }, { x: 480, y: 410 }, (b, a) => ({
    pass: a.bounds.width > b.bounds.width + 20 && Math.abs(a.bounds.height - b.bounds.height) < 3,
    detail: { bw: Math.round(b.bounds.width), aw: Math.round(a.bounds.width), bh: Math.round(b.bounds.height), ah: Math.round(a.bounds.height) },
  })) },
  {
    g: "transform", id: "reshape",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square);
      await s.setTool("reshape");
      const before = await s.itemDetail(pid);
      await s.drag({ x: 250, y: 200 }, { x: 200, y: 150 });
      const after = await s.itemDetail(pid);
      return { pass: after?.type === "path" && changed(before, after), detail: { type: after?.type, moved: changed(before, after) } };
    },
  },
  {
    g: "transform", id: "width",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square);
      await s.setTool("width");
      await s.drag({ x: 250, y: 200 }, { x: 250, y: 235 });
      const after = await s.itemDetail(pid);
      return { pass: !!after?.widthProfile, detail: { widthProfile: after?.widthProfile } };
    },
  },
  {
    // the dragged anchor widens (multiplier > 1); the other anchors stay 1.
    g: "transform", id: "width-value",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square); // 4-anchor square, stroke width 2
      await s.setTool("width");
      await s.drag({ x: 250, y: 200 }, { x: 250, y: 240 }); // drag corner 0 down 40
      const after = await s.itemDetail(pid);
      const wp = after?.widthProfile;
      const pass = !!wp && wp.length === 4 && wp[0] > 2 && wp.slice(1).every((m) => Math.abs(m - 1) < 0.01);
      return { pass, detail: { widthProfile: wp } };
    },
  },
  {
    g: "transform", id: "puppet-warp",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square);
      await s.setTool("puppet-warp");
      const before = await s.itemDetail(pid);
      await s.click({ x: 360, y: 280 }); // bind + drop pin
      await s.drag({ x: 360, y: 280 }, { x: 420, y: 330 }); // drag the pin
      const after = await s.itemDetail(pid);
      return { pass: after?.type === "path" && changed(before, after), detail: { type: after?.type, moved: changed(before, after) } };
    },
  },
  {
    // Puppet Warp: a second pin HOLDS its region while the dragged pin deforms.
    g: "transform", id: "puppet-warp-anchors",
    fn: async (s) => {
      const [pid] = await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:false,anchors:[A(150,250),A(300,250),A(450,250)]},{fill:E.noPaint(),stroke:E.defaultStroke(E.solid(E.BLACK),3)});doc.layers[0].items.push(p);return[p.id];`,
      );
      await s.setTool("puppet-warp");
      await s.click({ x: 150, y: 250 }); // pin A (left anchor)
      await s.click({ x: 450, y: 250 }); // pin B (right anchor)
      await s.drag({ x: 150, y: 250 }, { x: 150, y: 320 }); // drag pin A down 70
      const a = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return it.geometry.anchors.map((an) => ({ x: Math.round(an.point.x), y: Math.round(an.point.y) }));
      }, pid);
      const pass = a[0].y > 290 && Math.abs(a[2].y - 250) < 12; // left pulled, right held
      return { pass, detail: { left: a[0], right: a[2] } };
    },
  },

  // ---- liquify (fixture jagged path, sweep brush across it) ----
  ...["warp", "twirl", "pucker", "bloat", "crystallize", "scallop", "wrinkle"].map((id) => ({
    g: "liquify", id,
    fn: async (s) => {
      const [pid] = await s.fixture(FX.jagged);
      await s.setTool(id);
      const before = await s.itemDetail(pid);
      await s.drag({ x: 250, y: 295 }, { x: 450, y: 305 }, { steps: 14 });
      const after = await s.itemDetail(pid);
      return { pass: after?.type === "path" && changed(before, after), detail: { moved: changed(before, after) } };
    },
  })),

  // ---- build / cut / paint ----
  {
    g: "build", id: "shape-builder",
    fn: async (s) => {
      // two overlapping rects (overlap x[300,350]); SELECT both
      await s.fixture(`const a=E.makeRect(200,220,150,140,0,0,{fill:E.solid(E.rgba(220,90,90))});const b=E.makeRect(300,220,150,140,0,0,{fill:E.solid(E.rgba(80,120,220))});doc.layers[0].items.push(a,b);return[a.id,b.id];`);
      const before = await s.snapshot();
      await s.setTool("shape-builder");
      await s.drag({ x: 240, y: 290 }, { x: 410, y: 290 }, { steps: 16 }); // across ALL faces → unite
      const after = await s.snapshot();
      const pass = before.topCount === 2 && after.topCount === 1 && (after.top[0].type === "path" || after.top[0].type === "compound");
      return { pass, detail: { before: before.topCount, after: after.topCount, types: after.top.map((t) => t.type) } };
    },
  },
  {
    g: "build", id: "shape-builder-region",
    fn: async (s) => {
      // SELECT both; drag ONLY inside the overlap → extract it; the two outer faces survive
      await s.fixture(`const a=E.makeRect(200,220,150,140,0,0,{fill:E.solid(E.rgba(220,90,90))});const b=E.makeRect(300,220,150,140,0,0,{fill:E.solid(E.rgba(80,120,220))});doc.layers[0].items.push(a,b);return[a.id,b.id];`);
      await s.setTool("shape-builder");
      await s.drag({ x: 320, y: 250 }, { x: 330, y: 330 }, { steps: 8 }); // a stroke wholly within the overlap
      const after = await s.snapshot();
      const pass = after.topCount === 3; // overlap + A-only + B-only
      return { pass, detail: { topCount: after.topCount, types: after.top.map((t) => t.type) } };
    },
  },
  {
    g: "build", id: "eraser",
    fn: async (s) => {
      await s.fixture(FX.square); // filled square, corners (250,200)…(470,360) → area 35200
      await s.setTool("eraser");
      // dense horizontal sweep through the middle so the 12px brush squares overlap
      // into a continuous channel → splits the square into a top + bottom piece.
      const pts = [];
      for (let x = 240; x <= 480; x += 8) pts.push({ x, y: 280 });
      await s.lasso(pts);
      const r = await s.page.evaluate(() => {
        const all = window.__artisanStore.getState().doc.layers.flatMap((l) => l.items);
        const c = all.find((i) => i.type === "compound");
        const ring = (an) => { let a = 0; for (let i = 0; i < an.length; i++) { const p = an[i].point, q = an[(i + 1) % an.length].point; a += p.x * q.y - q.x * p.y; } return Math.abs(a / 2); };
        const area = c ? c.subpaths.reduce((acc, sp) => acc + ring(sp.anchors), 0) : null;
        return { count: all.length, type: all[0]?.type, subpaths: c ? c.subpaths.length : 0, area };
      });
      const pass = r.type === "compound" && r.subpaths >= 2 && r.area > 0 && r.area < 35200;
      return { pass, detail: r };
    },
  },
  {
    g: "build", id: "knife",
    fn: async (s) => {
      await s.fixture(FX.square);
      const before = await s.snapshot();
      await s.setTool("knife");
      await s.drag({ x: 360, y: 170 }, { x: 360, y: 390 }, { steps: 16 }); // vertical cut through square
      const after = await s.snapshot();
      // A real cut splits the one shape into TWO separate filled pieces (no slit/compound).
      const pieces = after.top.filter((t) => t.type === "path" || t.type === "compound");
      const pass = before.topCount === 1 && after.topCount === 2 && pieces.length === 2;
      return { pass, detail: { beforeTop: before.topCount, afterTop: after.top.map((t) => t.type) } };
    },
  },
  {
    // Scissors on a CLOSED path → opens it into ONE path (Illustrator parity).
    g: "build", id: "scissors-open-closed",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square);
      const before = await s.itemDetail(pid);
      await s.setTool("scissors");
      await s.click({ x: 360, y: 205 }); // just inside the top edge
      const after = await s.itemDetail(pid);
      const snap = await s.snapshot();
      const pass = before.closed === true && after.closed === false && snap.topCount === 1 && after.anchors > before.anchors;
      return { pass, detail: { beforeClosed: before.closed, afterClosed: after.closed, topCount: snap.topCount, anchors: [before.anchors, after.anchors] } };
    },
  },
  {
    // Scissors on an OPEN path → splits it into TWO paths (Illustrator parity).
    g: "build", id: "scissors-split-open",
    fn: async (s) => {
      await s.fixture(FX.jagged);
      const before = await s.snapshot();
      await s.setTool("scissors");
      await s.click({ x: 325, y: 290 }); // on the 2nd segment (300,250)→(350,330)
      const after = await s.snapshot();
      const paths = after.top.filter((t) => t.type === "path");
      const pass = before.topCount === 1 && after.topCount === 2 && paths.length === 2;
      return { pass, detail: { beforeTop: before.topCount, afterTop: after.top.map((t) => t.type) } };
    },
  },
  {
    // Rotate tool: drag 90° around the selection centre → bbox dims swap.
    g: "build", id: "transform-rotate-drag",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.rect); // 220×150 at centre (360,275)
      const before = await s.itemDetail(pid);
      await s.setTool("rotate");
      await s.drag({ x: 480, y: 275 }, { x: 360, y: 395 }, { steps: 14 }); // angle 0 → +90°
      const after = await s.itemDetail(pid);
      const pass =
        Math.round(before.bounds.width) === 220 &&
        Math.round(after.bounds.width) === 150 &&
        Math.round(after.bounds.height) === 220;
      return { pass, detail: { before: before.bounds, after: after.bounds } };
    },
  },
  {
    // Alt-drag a transform tool → transforms a COPY, leaving the original.
    g: "build", id: "transform-alt-duplicate",
    fn: async (s) => {
      await s.fixture(FX.rect);
      const before = await s.snapshot();
      await s.setTool("rotate");
      await s.drag({ x: 480, y: 275 }, { x: 360, y: 395 }, { steps: 14, mod: "Alt" });
      const after = await s.snapshot();
      const pass = before.topCount === 1 && after.topCount === 2;
      return { pass, detail: { beforeTop: before.topCount, afterTop: after.topCount } };
    },
  },
  {
    // Rectangle tool + SHIFT → constrain to a square (real drag with modifier).
    g: "build", id: "shape-rect-shift-square",
    fn: async (s) => {
      await s.reset();
      await s.setTool("rect");
      await s.drag({ x: 200, y: 200 }, { x: 340, y: 260 }, { mod: "Shift" }); // 140×60 → square 140
      const snap = await s.snapshot();
      const id = snap.selection[0] ?? snap.top[0]?.id;
      const r = await s.page.evaluate((i) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, i);
        return { w: it.width, h: it.height };
      }, id);
      const pass = Math.abs(r.w - r.h) < 1 && r.w > 100; // square, sized by the larger side
      return { pass, detail: r };
    },
  },
  {
    // Rectangle tool + ALT → draw from the center (real drag with modifier).
    g: "build", id: "shape-rect-alt-center",
    fn: async (s) => {
      await s.reset();
      await s.setTool("rect");
      await s.drag({ x: 300, y: 250 }, { x: 380, y: 300 }, { mod: "Alt" }); // center stays (300,250)
      const snap = await s.snapshot();
      const id = snap.selection[0] ?? snap.top[0]?.id;
      const b = await s.page.evaluate((i) => {
        const r = window.__Q.worldBounds(window.__artisanStore.getState().doc, i);
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height };
      }, id);
      // from-center: the shape is centered on the down point, not anchored at a corner
      const pass = Math.abs(b.cx - 300) < 5 && Math.abs(b.cy - 250) < 5 && b.w > 100 && b.h > 50;
      return { pass, detail: b };
    },
  },
  {
    // Properties/Transform panel: X moves the left edge; W resizes anchored at the left.
    g: "build", id: "transform-xywh",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // bounds (250,200,220,150)
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(60);
      const wb = () => s.page.evaluate((id) => {
        const b = window.__Q.worldBounds(window.__artisanStore.getState().doc, id);
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      }, rid);
      const xInput = s.page.locator('[data-transform-prop="x"] input');
      await xInput.fill("300");
      await xInput.press("Enter");
      await s.page.waitForTimeout(90);
      const afterX = await wb(); // left edge → 300, width unchanged
      const wInput = s.page.locator('[data-transform-prop="width"] input');
      await wInput.fill("300");
      await wInput.press("Enter");
      await s.page.waitForTimeout(90);
      const afterW = await wb(); // width → 300, anchored at the (new) left edge
      const near = (a, b) => Math.abs(a - b) < 1;
      const pass = near(afterX.x, 300) && near(afterX.w, 220) && near(afterW.w, 300) && near(afterW.x, 300);
      return { pass, detail: { afterX, afterW } };
    },
  },
  {
    // Properties panel: the Underline button toggles the text item's underline flag
    // and the rendered <text> picks up text-decoration.
    g: "build", id: "text-decoration",
    fn: async (s) => {
      const [tid] = await s.fixture(`const t=E.makeText("Underline me",160,200,{fontSize:24});doc.layers[0].items.push(t);return[t.id];`);
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(80);
      const read = () =>
        s.page.evaluate((id) => {
          const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
          const el = document.querySelector("svg.artisan-canvas text");
          return { underline: !!(it && it.type === "text" && it.underline), style: el ? el.getAttribute("style") || "" : "" };
        }, tid);
      const before = await read();
      await s.page.locator("[data-type-underline]").first().click();
      await s.page.waitForTimeout(80);
      const after = await read();
      const pass = before.underline === false && after.underline === true && after.style.includes("underline");
      return { pass, detail: { before, after } };
    },
  },
  {
    // Properties panel: All Caps toggles the text item's caps style and the rendered
    // <text> picks up text-transform:uppercase; clicking again clears it.
    g: "build", id: "type-caps",
    fn: async (s) => {
      const [tid] = await s.fixture(`const t=E.makeText("caps me",160,200,{fontSize:24});doc.layers[0].items.push(t);return[t.id];`);
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(80);
      const read = () =>
        s.page.evaluate((id) => {
          const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
          const el = document.querySelector("svg.artisan-canvas text");
          return { caps: (it && it.type === "text" && it.caps) || null, style: el ? el.getAttribute("style") || "" : "" };
        }, tid);
      const before = await read();
      await s.page.locator("[data-type-allcaps]").first().click();
      await s.page.waitForTimeout(80);
      const on = await read();
      await s.page.locator("[data-type-allcaps]").first().click();
      await s.page.waitForTimeout(80);
      const off = await read();
      const pass = before.caps === null && on.caps === "all" && on.style.includes("uppercase") && off.caps === null;
      return { pass, detail: { before, on, off } };
    },
  },
  {
    // Properties/Transform panel: with the CENTRE reference point chosen, growing W
    // scales the object symmetrically (centre held) instead of from the left edge.
    g: "build", id: "transform-ref-point",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // bounds (250,200,220,150) → centre x=360
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(60);
      const wb = () => s.page.evaluate((id) => {
        const b = window.__Q.worldBounds(window.__artisanStore.getState().doc, id);
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      }, rid);
      // pick the centre reference dot, then double the width
      await s.page.locator('[data-ref-point="mc"]').click();
      await s.page.waitForTimeout(40);
      const wInput = s.page.locator('[data-transform-prop="width"] input');
      await wInput.fill("440");
      await wInput.press("Enter");
      await s.page.waitForTimeout(90);
      const after = await wb();
      const near = (a, b) => Math.abs(a - b) < 1;
      // 220 → 440 around centre 360: x → 140, centre stays 360 (not anchored left)
      const pass = near(after.w, 440) && near(after.x, 140) && near(after.x + after.w / 2, 360);
      return { pass, detail: { after } };
    },
  },
  {
    // Properties/Transform panel: the Shear (▱) field sets the object's skew absolutely.
    g: "build", id: "transform-shear",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(60);
      const skew = () =>
        s.page.evaluate((id) => {
          const t = window.__Q.getItem(window.__artisanStore.getState().doc, id).transform;
          return (window.__engine.Mat.decompose(t).skewX * 180) / Math.PI;
        }, rid);
      const before = await skew();
      const input = s.page.locator('[data-transform-prop="shear"] input');
      await input.fill("30");
      await input.press("Enter");
      await s.page.waitForTimeout(90);
      const after = await skew();
      const pass = Math.abs(before) < 0.5 && Math.abs(after - 30) < 0.5;
      return { pass, detail: { before, after } };
    },
  },
  {
    // Properties panel: edit a live POLYGON's "Sides" field (Illustrator parity).
    g: "build", id: "shape-polygon-sides",
    fn: async (s) => {
      const [pid] = await s.fixture(
        `const p=E.makePolygon(300,260,80,3,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(p);return[p.id];`,
      );
      const before = await s.page.evaluate((id) => window.__Q.getItem(window.__artisanStore.getState().doc, id).sides, pid);
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(60);
      const input = s.page.locator('[data-shape-prop="sides"] input');
      await input.fill("6");
      await input.press("Enter");
      await s.page.waitForTimeout(90);
      const after = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return { sides: it.sides, anchors: window.__engine.Shapes.localPaths(it)[0].anchors.length };
      }, pid);
      const pass = before === 3 && after.sides === 6 && after.anchors === 6;
      return { pass, detail: { before, after } };
    },
  },
  {
    // Properties panel: edit a live RECT's "Corner Radius" → rounds it (8 anchors).
    g: "build", id: "shape-rect-corner-radius",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // sharp rect (rx=0)
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(60);
      const input = s.page.locator('[data-shape-prop="corner-radius"] input');
      await input.fill("20");
      await input.press("Enter");
      await s.page.waitForTimeout(90);
      const after = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return { rx: it.rx, ry: it.ry, anchors: window.__engine.Shapes.localPaths(it)[0].anchors.length };
      }, rid);
      const pass = after.rx === 20 && after.ry === 20 && after.anchors === 8;
      return { pass, detail: after };
    },
  },
  {
    // Properties panel: change a rounded RECT's Corner Style → Chamfer (straight cut).
    g: "build", id: "shape-rect-corner-style",
    fn: async (s) => {
      const [rid] = await s.fixture(
        `const r=E.makeRect(250,200,120,90,16,16,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(60);
      await s.chooseOption('[data-shape-prop="corner-style"] [role="combobox"]', "chamfer");
      await s.page.waitForTimeout(90);
      const after = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        const g = window.__engine.Shapes.localPaths(it)[0];
        return { style: it.cornerStyle, custom: window.__engine.Shapes.isRectCustomCorner(it.rx, it.ry, it.cornerStyle), handleOut: g.anchors[1].handleOut.x };
      }, rid);
      // chamfer → custom-corner path, with the corner bezier handle zeroed (straight)
      const pass = after.style === "chamfer" && after.custom === true && after.handleOut === 0;
      return { pass, detail: after };
    },
  },
  {
    // Properties panel: edit a live STAR's "Inner Radius" (Radius 2 / spikiness).
    g: "build", id: "shape-star-inner",
    fn: async (s) => {
      const [sid] = await s.fixture(
        `const st=E.makeStar(300,260,80,40,5,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(st);return[st.id];`,
      );
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(60);
      const input = s.page.locator('[data-shape-prop="star-inner"] input');
      await input.fill("25"); // 25% of the 80 outer radius → inner 20
      await input.press("Enter");
      await s.page.waitForTimeout(90);
      const after = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return { r1: it.radius1, r2: it.radius2, points: it.points, anchors: window.__engine.Shapes.localPaths(it)[0].anchors.length };
      }, sid);
      // radius2 → 20 (80×0.25); outer radius + point count preserved; still a 5-point star
      const pass = after.r2 === 20 && after.r1 === 80 && after.points === 5 && after.anchors === 10;
      return { pass, detail: after };
    },
  },
  {
    // Properties panel: edit a live ELLIPSE's "Pie End" → it becomes a wedge.
    g: "build", id: "shape-ellipse-pie",
    fn: async (s) => {
      const [eid] = await s.fixture(
        `const e=E.makeEllipse(150,150,120,80,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(e);return[e.id];`,
      );
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(60);
      const input = s.page.locator('[data-shape-prop="pie-end"] input');
      await input.fill("90"); // pie 0→90 wedge
      await input.press("Enter");
      await s.page.waitForTimeout(90);
      const after = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        const g = window.__engine.Shapes.localPaths(it)[0];
        return {
          pie: [it.pieStart, it.pieEnd],
          isPie: window.__engine.Shapes.isEllipsePie(it.pieStart, it.pieEnd),
          closed: g.closed,
          anchors: g.anchors.length,
          apex: g.anchors[0].point, // wedge apex = ellipse centre (60,40)
        };
      }, eid);
      // 0→90 wedge: closed, 3 anchors, apex at the ellipse centre
      const pass =
        JSON.stringify(after.pie) === JSON.stringify([0, 90]) && after.isPie === true &&
        after.closed === true && after.anchors === 3 &&
        after.apex.x === 60 && after.apex.y === 40;
      return { pass, detail: after };
    },
  },
  {
    // Properties panel: edit a live LINE's Length + Angle (start point fixed).
    g: "build", id: "shape-line-length-angle",
    fn: async (s) => {
      const [lid] = await s.fixture(`const l=E.makeLine(150,200,250,200);doc.layers[0].items.push(l);return[l.id];`); // length 100, angle 0
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(60);
      const ln = () => s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return { x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2 };
      }, lid);
      const lenIn = s.page.locator('[data-shape-prop="line-length"] input');
      await lenIn.fill("60");
      await lenIn.press("Enter");
      await s.page.waitForTimeout(80);
      const afterLen = await ln(); // end → (210,200), start fixed
      const angIn = s.page.locator('[data-shape-prop="line-angle"] input');
      await angIn.fill("90");
      await angIn.press("Enter");
      await s.page.waitForTimeout(80);
      const afterAng = await ln(); // 90° up → end (150,140), length still 60
      const near = (a, b) => Math.abs(a - b) < 0.5;
      const pass =
        near(afterLen.x2, 210) && near(afterLen.y2, 200) && afterLen.x1 === 150 && afterLen.y1 === 200 &&
        near(afterAng.x2, 150) && near(afterAng.y2, 140) && afterAng.x1 === 150 && afterAng.y1 === 200;
      return { pass, detail: { afterLen, afterAng } };
    },
  },
  {
    // Layers panel: clicking an object's eye HIDES it AND deselects it (Illustrator).
    g: "build", id: "layers-hide-deselects",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      const before = await s.page.evaluate((id) => ({
        sel: window.__artisanStore.getState().selection.length,
        vis: window.__Q.getItem(window.__artisanStore.getState().doc, id).visible,
      }), rid);
      await itemRows(s).first().getByRole("switch", { name: "Hide layer" }).click();
      await s.page.waitForTimeout(80);
      const after = await s.page.evaluate((id) => ({
        sel: window.__artisanStore.getState().selection.length,
        vis: window.__Q.getItem(window.__artisanStore.getState().doc, id).visible,
        node: !!document.querySelector(`svg.artisan-canvas [data-id="${id}"]`),
      }), rid);
      const pass = before.sel === 1 && before.vis === true && after.sel === 0 && after.vis === false && after.node === false;
      return { pass, detail: { before, after } };
    },
  },
  {
    // Layers panel: locking the layer deselects the object but KEEPS it drawn.
    g: "build", id: "layers-lock-deselects",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await layerRows(s).first().getByRole("switch", { name: "Lock layer" }).click();
      await s.page.waitForTimeout(80);
      const after = await s.page.evaluate((id) => ({
        sel: window.__artisanStore.getState().selection.length,
        locked: window.__artisanStore.getState().doc.layers[0].locked,
        node: !!document.querySelector(`svg.artisan-canvas [data-id="${id}"]`),
      }), rid);
      const pass = after.sel === 0 && after.locked === true && after.node === true;
      return { pass, detail: after };
    },
  },
  {
    // Layers panel: clicking an OBJECT's padlock locks it — deselects but KEEPS it drawn (Illustrator).
    g: "build", id: "layers-object-lock",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      const before = await s.page.evaluate((id) => ({
        sel: window.__artisanStore.getState().selection.length,
        locked: window.__Q.getItem(window.__artisanStore.getState().doc, id).locked,
      }), rid);
      await itemRows(s).first().getByRole("switch", { name: "Lock layer" }).click();
      await s.page.waitForTimeout(80);
      const after = await s.page.evaluate((id) => ({
        sel: window.__artisanStore.getState().selection.length,
        locked: window.__Q.getItem(window.__artisanStore.getState().doc, id).locked,
        node: !!document.querySelector(`svg.artisan-canvas [data-id="${id}"]`),
      }), rid);
      const pass = before.sel === 1 && !before.locked && after.sel === 0 && after.locked === true && after.node === true;
      return { pass, detail: { before, after } };
    },
  },
  {
    // Layers panel: clicking a layer makes it the ACTIVE/target layer — new art lands there.
    g: "build", id: "layers-active-layer",
    fn: async (s) => {
      await s.fixture(`const r=E.makeRect(100,100,50,50,0,0,{fill:E.solid(E.rgba(200,80,80))});doc.layers[0].items.push(r);doc.layers.push(E.makeLayer("Layer 2"));return[];`);
      const L2 = await s.page.evaluate(() => window.__artisanStore.getState().doc.layers[1].id);
      await layerRows(s).filter({ hasText: "Layer 2" }).click(); // make Layer 2 active
      await s.page.waitForTimeout(50);
      const active = await s.page.evaluate(() => window.__artisanStore.getState().activeLayerId);
      await s.setTool("rect");
      await s.drag({ x: 300, y: 300 }, { x: 360, y: 360 }); // draw on the active layer
      const place = await s.page.evaluate((l2) => {
        const layers = window.__artisanStore.getState().doc.layers;
        return { l1: layers[0].items.length, l2: layers.find((l) => l.id === l2).items.length };
      }, L2);
      const pass = active === L2 && place.l1 === 1 && place.l2 === 1; // original on L1, new on L2
      return { pass, detail: { active, ...place } };
    },
  },
  {
    // Layers panel: clicking an object's row selects it; Shift-click adds another.
    g: "build", id: "layers-select-item",
    fn: async (s) => {
      await s.fixture(`const a=E.makeRect(120,120,60,60,0,0,{fill:E.solid(E.rgba(200,80,80))});const b=E.makeRect(260,120,60,60,0,0,{fill:E.solid(E.rgba(80,120,200))});doc.layers[0].items.push(a,b);return[];`);
      const [A, B] = await s.page.evaluate(() => window.__artisanStore.getState().doc.layers[0].items.map((i) => i.id));
      await itemRows(s).first().click(); // rows are top-first, so select B
      await s.page.waitForTimeout(40);
      const sel1 = await s.page.evaluate(() => window.__artisanStore.getState().selection.slice());
      await itemRows(s).nth(1).click({ modifiers: ["Shift"] }); // +A
      await s.page.waitForTimeout(40);
      const sel2 = await s.page.evaluate(() => window.__artisanStore.getState().selection.slice());
      const pass = sel1.length === 1 && sel1[0] === B && sel2.length === 2 && sel2.includes(A) && sel2.includes(B);
      return { pass, detail: { sel1: sel1.length, sel2: sel2.length } };
    },
  },
  {
    // Shift-drag a selected object → movement constrains to the nearest 45° axis.
    g: "build", id: "selection-shift-constrain",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.rect); // at (250,200)
      const before = await s.itemDetail(pid);
      await s.setTool("selection");
      // drag the centre ~38° off horizontal with Shift → snaps to the 45° diagonal
      await s.drag({ x: 360, y: 275 }, { x: 470, y: 360 }, { steps: 12, mod: "Shift" });
      const after = await s.itemDetail(pid);
      const ddx = after.bounds.x - before.bounds.x;
      const ddy = after.bounds.y - before.bounds.y;
      const pass = ddx > 10 && ddy > 10 && Math.abs(ddx - ddy) < 1.5; // equal Δ ⇒ exact diagonal
      return { pass, detail: { ddx, ddy } };
    },
  },
  {
    // View ▸ Snap to Grid: a drawn shape lands on the grid (Illustrator parity).
    g: "build", id: "snap-to-grid",
    fn: async (s) => {
      await s.reset();
      // toggle View ▸ Snap to Grid (exact label so it doesn't hit the "Snap" item)
      await s.page.getByRole("menuitem", { name: "View", exact: true }).first().click();
      await s.page.waitForTimeout(130);
      await s.page.locator(".monet-menu-label", { hasText: /^Snap to Grid$/ }).first().click();
      await s.page.waitForTimeout(120);
      const { on, gridSize } = await s.page.evaluate(() => ({
        on: window.__artisanStore.getState().snap.toGrid,
        gridSize: window.__artisanStore.getState().grid.size,
      }));
      await s.setTool("rect");
      await s.drag({ x: 137, y: 162 }, { x: 343, y: 311 }); // off-grid endpoints
      const snap = await s.snapshot();
      const d = snap.top[0] ? await s.itemDetail(snap.top[0].id) : null;
      const b = d?.bounds;
      const onGrid = (v) => Math.abs(v - Math.round(v / gridSize) * gridSize) < 1.5;
      const pass = on === true && !!b && onGrid(b.x) && onGrid(b.y) && onGrid(b.width) && onGrid(b.height);
      // restore: snap.toGrid is GLOBAL store state (survives s.reset) — don't leak it
      // into later specs (their pointer coords would snap to the grid too).
      await s.page.evaluate(() => window.__artisanStore.patchSnap({ toGrid: false }));
      return { pass, detail: { on, gridSize, bounds: b } };
    },
  },
  {
    // Smart Guides: drawing near another object's anchor snaps the point to it.
    g: "build", id: "smart-guides-snap-point",
    fn: async (s) => {
      const [aid] = await s.fixture(
        `const a=E.makeRect(200,200,100,100,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(a);return[a.id];`,
      );
      // deselect so A is a valid snap target (the selection is excluded from snapping)
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.setTool("rect");
      await s.drag({ x: 302, y: 302 }, { x: 400, y: 400 }); // start ~2px off A's (300,300) corner
      const snap = await s.snapshot();
      const newItem = snap.top.find((t) => t.id !== aid);
      const d = newItem ? await s.itemDetail(newItem.id) : null;
      const b = d?.bounds;
      const pass = !!b && Math.abs(b.x - 300) < 1 && Math.abs(b.y - 300) < 1; // snapped to A's corner
      return { pass, detail: { bounds: b } };
    },
  },
  {
    // Smart Guides snap-to-OBJECT: drawing near the middle of an edge snaps to it.
    g: "build", id: "smart-guides-snap-edge",
    fn: async (s) => {
      const [aid] = await s.fixture(
        `const a=E.makeRect(200,200,100,100,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(a);return[a.id];`,
      );
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.setTool("rect");
      // start ~3px off the MIDDLE of A's right edge (300,250) — far from any corner
      await s.drag({ x: 303, y: 250 }, { x: 420, y: 360 });
      const snap = await s.snapshot();
      const newItem = snap.top.find((t) => t.id !== aid);
      const d = newItem ? await s.itemDetail(newItem.id) : null;
      const b = d?.bounds;
      const pass = !!b && Math.abs(b.x - 300) < 1.5; // x snapped onto the edge (x=300)
      return { pass, detail: { bounds: b } };
    },
  },
  {
    // View ▸ Smart Guides toggles snap-to-point (on by default, ⌘U).
    g: "build", id: "smart-guides-toggle",
    fn: async (s) => {
      await s.reset();
      const before = await s.page.evaluate(() => window.__artisanStore.getState().snap.toPoint);
      await s.page.getByRole("menuitem", { name: "View", exact: true }).first().click();
      await s.page.waitForTimeout(130);
      await s.page.locator(".monet-menu-label", { hasText: /^Smart Guides$/ }).first().click();
      await s.page.waitForTimeout(100);
      const after = await s.page.evaluate(() => window.__artisanStore.getState().snap.toPoint);
      await s.page.evaluate(() => window.__artisanStore.patchSnap({ toPoint: true, toObject: true })); // restore defaults
      const pass = before === true && after === false;
      return { pass, detail: { before, after } };
    },
  },
  {
    // Object ▸ Lock Selection: locks + deselects, but stays DRAWN (Illustrator).
    g: "build", id: "object-lock",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(130);
      await s.page.locator(".monet-menu-label", { hasText: /^Lock Selection$/ }).first().click();
      await s.page.waitForTimeout(100);
      const r = await s.page.evaluate((id) => ({
        locked: window.__Q.getItem(window.__artisanStore.getState().doc, id).locked,
        sel: window.__artisanStore.getState().selection.length,
        node: !!document.querySelector(`svg.artisan-canvas [data-id="${id}"]`),
      }), rid);
      const pass = r.locked === true && r.sel === 0 && r.node === true;
      return { pass, detail: r };
    },
  },
  {
    // Object ▸ Hide Selection then Show All round-trips visibility.
    g: "build", id: "object-hide-show",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      const menu = async (label) => {
        await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
        await s.page.waitForTimeout(130);
        await s.page.locator(".monet-menu-label", { hasText: label }).first().click();
        await s.page.waitForTimeout(100);
      };
      const read = (id) => s.page.evaluate((x) => ({
        vis: window.__Q.getItem(window.__artisanStore.getState().doc, x).visible,
        node: !!document.querySelector(`svg.artisan-canvas [data-id="${x}"]`),
      }), id);
      await menu(/^Hide Selection$/);
      const hidden = await read(rid);
      await menu(/^Show All$/);
      const shown = await read(rid);
      const pass = hidden.vis === false && hidden.node === false && shown.vis === true && shown.node === true;
      return { pass, detail: { hidden, shown } };
    },
  },
  {
    // Select ▸ Inverse: select 1 of 3 → Inverse selects the other 2.
    g: "build", id: "select-inverse",
    fn: async (s) => {
      const [aid, bid, cid] = await s.fixture(FX.threeRects);
      await s.page.evaluate((id) => window.__artisanStore.setSelection([id]), aid);
      await s.page.getByRole("menuitem", { name: "Select", exact: true }).first().click();
      await s.page.waitForTimeout(130);
      await s.page.locator(".monet-menu-label", { hasText: /^Inverse$/ }).first().click();
      await s.page.waitForTimeout(100);
      const sel = await s.page.evaluate(() => window.__artisanStore.getState().selection);
      const pass = sel.length === 2 && sel.includes(bid) && sel.includes(cid) && !sel.includes(aid);
      return { pass, detail: { sel, aid } };
    },
  },
  {
    // Select ▸ Next Object Above / Below: from the MIDDLE of 3 stacked objects,
    // Above → the front object, Below → the back object (paint order).
    g: "build", id: "select-next-object",
    fn: async (s) => {
      await s.fixture(FX.threeRects);
      const midId = await s.page.evaluate(() => window.__artisanStore.getState().doc.layers[0].items[1].id);

      await s.page.evaluate((id) => window.__artisanStore.setSelection([id]), midId);
      await s.page.getByRole("menuitem", { name: "Select", exact: true }).first().click();
      await s.page.waitForTimeout(130);
      await s.page.locator(".monet-menu-label", { hasText: /^Next Object Above$/ }).first().click();
      await s.page.waitForTimeout(100);
      const above = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        return { sel: st.selection, frontId: st.doc.layers[0].items[2].id };
      });

      await s.page.evaluate((id) => window.__artisanStore.setSelection([id]), midId);
      await s.page.getByRole("menuitem", { name: "Select", exact: true }).first().click();
      await s.page.waitForTimeout(130);
      await s.page.locator(".monet-menu-label", { hasText: /^Next Object Below$/ }).first().click();
      await s.page.waitForTimeout(100);
      const below = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        return { sel: st.selection, backId: st.doc.layers[0].items[0].id };
      });

      const aboveOk = above.sel.length === 1 && above.sel[0] === above.frontId;
      const belowOk = below.sel.length === 1 && below.sel[0] === below.backId;
      return { pass: aboveOk && belowOk, detail: { aboveOk, belowOk, above, below } };
    },
  },
  {
    // Select ▸ All on Active Artboard: an object inside the artboard + one far
    // outside it (x=2000). The command selects only the one within the artboard.
    g: "build", id: "select-all-artboard",
    fn: async (s) => {
      await s.fixture(
        `const a=E.makeRect(100,100,80,80,0,0,{fill:E.solid(E.rgba(120,160,220))});` +
          `const b=E.makeRect(2000,100,80,80,0,0,{fill:E.solid(E.rgba(220,120,120))});` +
          `doc.layers[0].items.push(a,b);return[];`,
      );
      await s.page.getByRole("menuitem", { name: "Select", exact: true }).first().click();
      await s.page.waitForTimeout(130);
      await s.page.locator(".monet-menu-label", { hasText: /^All on Active Artboard$/ }).first().click();
      await s.page.waitForTimeout(100);
      const res = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const items = st.doc.layers[0].items;
        const bx = (it) => window.__Q.worldBounds(st.doc, it.id).x;
        const inside = items.find((it) => bx(it) < 1000);
        const outside = items.find((it) => bx(it) > 1000);
        const sel = new Set(st.selection);
        return { selCount: st.selection.length, insideSelected: !!inside && sel.has(inside.id), outsideSelected: !!outside && sel.has(outside.id) };
      });
      const pass = res.selCount === 1 && res.insideSelected && !res.outsideSelected;
      return { pass, detail: res };
    },
  },
  {
    // Object ▸ Path ▸ Clean Up: deletes a stray point, keeps the real shape.
    g: "build", id: "clean-up",
    fn: async (s) => {
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const stray=E.makePath({closed:false,anchors:[A(120,120)]},{fill:E.solid(E.rgba(220,0,0))});` +
          `const r=E.makeRect(200,200,80,80,0,0,{fill:E.solid(E.rgba(0,120,220))});` +
          `doc.layers[0].items.push(stray,r);return[];`,
      );
      const before = await s.snapshot();
      await objectSubmenu(s, "Path", "Clean Up");
      const after = await s.snapshot();
      const pass = before.topCount === 2 && after.topCount === 1 && after.top[0]?.type === "rect";
      return { pass, detail: { before: before.topCount, after: after.topCount, type: after.top[0]?.type } };
    },
  },
  {
    // Group Selection: repeated clicks on one spot walk leaf → inner → outer group.
    g: "build", id: "group-selection-progressive",
    fn: async (s) => {
      const [rid, innerId, outerId] = await s.fixture(
        `const r=E.makeRect(250,250,80,80,0,0,{fill:E.solid(E.rgba(120,160,220))});` +
          `const inner=E.makeGroup([r]);const outer=E.makeGroup([inner]);` +
          `doc.layers[0].items.push(outer);return[r.id,inner.id,outer.id];`,
      );
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.setTool("group-selection");
      const sel = () => s.page.evaluate(() => window.__artisanStore.getState().selection);
      await s.click({ x: 290, y: 290 }); // centre of the rect
      const s1 = await sel();
      await s.click({ x: 290, y: 290 });
      const s2 = await sel();
      await s.click({ x: 290, y: 290 });
      const s3 = await sel();
      const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const pass = eq(s1, [rid]) && eq(s2, [innerId]) && eq(s3, [outerId]);
      return { pass, detail: { s1, s2, s3, want: [rid, innerId, outerId] } };
    },
  },
  {
    // Swatches panel: clicking a swatch applies it to the selection's fill.
    g: "build", id: "swatches-apply",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // red rect, selected
      await s.page.evaluate(() => window.__artisanStore.setActivePaint("fill"));
      await s.page.locator('[data-dock-tab][data-tab-id="swatches"]').click();
      await s.page.waitForTimeout(70);
      const before = await s.page.evaluate((id) => window.__Q.getItem(window.__artisanStore.getState().doc, id).fill, rid);
      await s.page.locator(".artisan-swatch-cell").nth(3).click(); // 4th default swatch = black
      await s.page.waitForTimeout(90);
      const after = await s.page.evaluate((id) => window.__Q.getItem(window.__artisanStore.getState().doc, id).fill, rid);
      const black = after?.type === "solid" && after.color.r === 0 && after.color.g === 0 && after.color.b === 0;
      const pass = before?.type === "solid" && before.color.r !== 0 && black;
      return { pass, detail: { before: before?.color, after: after?.color } };
    },
  },
  {
    // Swatches panel ▸ Add Used Colors: a distinctive artwork colour becomes a
    // swatch (absent before, present after) via the real toolbar button.
    g: "build", id: "swatches-add-used",
    fn: async (s) => {
      await s.fixture(
        `const r=E.makeRect(150,150,80,80,0,0,{fill:E.solid(E.rgba(123,45,67))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await s.page.locator('[data-dock-tab][data-tab-id="swatches"]').click();
      await s.page.waitForTimeout(60);
      const has = () => s.page.evaluate(() =>
        window.__artisanStore.getState().doc.swatches.some((p) => p.type === "solid" && p.color.r === 123 && p.color.g === 45 && p.color.b === 67));
      const count = () => s.page.evaluate(() => window.__artisanStore.getState().doc.swatches.length);
      const before = await has();
      const beforeN = await count();
      await s.page.locator('[data-swatch-action="add-used"]').click();
      await s.page.waitForTimeout(90);
      const after = await has();
      const afterN = await count();
      const pass = before === false && after === true && afterN > beforeN;
      return { pass, detail: { before, after, beforeN, afterN } };
    },
  },
  {
    // Color panel: typing a hex recolors the selection's fill. Real keyboard entry.
    g: "build", id: "color-panel-apply",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // red rect, selected, active paint = fill
      await s.page.locator('[data-dock-tab][data-tab-id="color"]').click();
      await s.page.waitForTimeout(60);
      const hex = s.page.locator("input.monet-cv-hexinput").first();
      await hex.fill("#00ff00");
      await hex.press("Enter");
      await s.page.waitForTimeout(100);
      const fill = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return it.fill.type === "solid" ? { r: Math.round(it.fill.color.r), g: Math.round(it.fill.color.g), b: Math.round(it.fill.color.b) } : null;
      }, rid);
      const near = (a, b) => Math.abs(a - b) < 3;
      const pass = !!fill && near(fill.r, 0) && near(fill.g, 255) && near(fill.b, 0); // pure green
      return { pass, detail: fill };
    },
  },
  {
    // Color panel: the Complement button replaces the fill with its colour-wheel complement.
    g: "build", id: "color-complement",
    fn: async (s) => {
      const [rid] = await s.fixture(`const r=E.makeRect(250,200,120,90,0,0,{fill:E.solid(E.rgba(220,0,0))});doc.layers[0].items.push(r);return[r.id];`);
      await s.page.locator('[data-dock-tab][data-tab-id="color"]').click();
      await s.page.waitForTimeout(60);
      await s.page.locator("[data-fill-complement]").first().click();
      await s.page.waitForTimeout(80);
      const c = await s.page.evaluate((id) => {
        const f = window.__Q.getItem(window.__artisanStore.getState().doc, id).fill;
        return f.type === "solid" ? { r: Math.round(f.color.r), g: Math.round(f.color.g), b: Math.round(f.color.b) } : null;
      }, rid);
      const pass = !!c && c.r === 0 && c.g === 220 && c.b === 220; // red → cyan
      return { pass, detail: c };
    },
  },
  {
    // Color panel: the Invert button replaces the fill with its photographic negative.
    g: "build", id: "color-invert",
    fn: async (s) => {
      const [rid] = await s.fixture(`const r=E.makeRect(250,200,120,90,0,0,{fill:E.solid(E.rgba(220,0,0))});doc.layers[0].items.push(r);return[r.id];`);
      await s.page.locator('[data-dock-tab][data-tab-id="color"]').click();
      await s.page.waitForTimeout(60);
      await s.page.locator("[data-fill-invert]").first().click();
      await s.page.waitForTimeout(80);
      const c = await s.page.evaluate((id) => {
        const f = window.__Q.getItem(window.__artisanStore.getState().doc, id).fill;
        return f.type === "solid" ? { r: Math.round(f.color.r), g: Math.round(f.color.g), b: Math.round(f.color.b) } : null;
      }, rid);
      const pass = !!c && c.r === 35 && c.g === 255 && c.b === 255; // red → its negative
      return { pass, detail: c };
    },
  },
  {
    // Color Guide: a pure-red base → complementary rule yields [red, cyan]; clicking
    // the complement swatch fills the selection cyan. Switching the rule to Triad
    // grows the palette to 3 swatches.
    g: "build", id: "color-guide",
    fn: async (s) => {
      const [rid] = await s.fixture(`const r=E.makeRect(250,200,120,90,0,0,{fill:E.solid(E.rgba(255,0,0))});doc.layers[0].items.push(r);return[r.id];`);
      await s.page.evaluate(() => window.__artisanStore.setActivePaint("fill"));
      await s.page.locator('[data-dock-tab][data-tab-id="color-guide"]').click();
      await s.page.waitForTimeout(70);
      const count = () => s.page.locator("[data-harmony-swatch]").count();
      const before = await count(); // complementary → 2
      await s.page.locator('[data-harmony-swatch="1"]').click(); // the complement (cyan)
      await s.page.waitForTimeout(90);
      const fill = await s.page.evaluate((id) => {
        const f = window.__Q.getItem(window.__artisanStore.getState().doc, id).fill;
        return f.type === "solid" ? { r: Math.round(f.color.r), g: Math.round(f.color.g), b: Math.round(f.color.b) } : null;
      }, rid);
      await s.chooseOption("[data-harmony-rule]", "triadic");
      await s.page.waitForTimeout(60);
      const after = await count(); // triad → 3
      const cyan = !!fill && fill.r === 0 && fill.g === 255 && fill.b === 255;
      const pass = before === 2 && cyan && after === 3;
      return { pass, detail: { before, fill, after } };
    },
  },
  {
    // Color panel: the Swap button exchanges the selection's fill ↔ stroke.
    g: "build", id: "fill-stroke-swap",
    fn: async (s) => {
      const [rid] = await s.fixture(
        `const r=E.makeRect(250,200,120,90,0,0,{fill:E.solid(E.rgba(220,90,90)),stroke:E.defaultStroke(E.solid(E.rgba(40,40,200)))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await s.page.locator('[data-dock-tab][data-tab-id="color"]').click();
      await s.page.waitForTimeout(60);
      const read = (id) => s.page.evaluate((x) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, x);
        return { fill: it.fill.color, stroke: it.stroke.paint.color };
      }, id);
      const before = await read(rid);
      await s.page.locator("[data-fill-swap]").click();
      await s.page.waitForTimeout(80);
      const after = await read(rid);
      const pass = before.fill.r === 220 && after.fill.b === before.stroke.b && after.stroke.r === before.fill.r;
      return { pass, detail: { before, after } };
    },
  },
  {
    // Color panel: the Default button sets white fill + black stroke (D).
    g: "build", id: "fill-stroke-default",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // red fill
      await s.page.locator('[data-dock-tab][data-tab-id="color"]').click();
      await s.page.waitForTimeout(60);
      await s.page.locator("[data-fill-default]").click();
      await s.page.waitForTimeout(80);
      const after = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return { fill: it.fill.color, stroke: it.stroke.paint.color };
      }, rid);
      const pass =
        after.fill.r === 255 && after.fill.g === 255 && after.fill.b === 255 &&
        after.stroke.r === 0 && after.stroke.g === 0 && after.stroke.b === 0;
      return { pass, detail: after };
    },
  },
  {
    // Color panel: the None button clears the active fill (the "/" control).
    g: "build", id: "fill-stroke-none",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // red fill
      await s.page.evaluate(() => window.__artisanStore.setActivePaint("fill"));
      await s.page.locator('[data-dock-tab][data-tab-id="color"]').click();
      await s.page.waitForTimeout(60);
      await s.page.locator("[data-fill-none]").click();
      await s.page.waitForTimeout(80);
      const fillType = await s.page.evaluate((id) => window.__Q.getItem(window.__artisanStore.getState().doc, id).fill.type, rid);
      return { pass: fillType === "none", detail: { fillType } };
    },
  },
  {
    // Swatches panel: the Gradient chip applies a gradient fill.
    g: "build", id: "swatches-gradient",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.page.evaluate(() => window.__artisanStore.setActivePaint("fill"));
      await s.page.locator('[data-dock-tab][data-tab-id="swatches"]').click();
      await s.page.waitForTimeout(60);
      await s.page.locator(".monet-chip", { hasText: "Gradient" }).first().click();
      await s.page.waitForTimeout(80);
      const fillType = await s.page.evaluate((id) => window.__Q.getItem(window.__artisanStore.getState().doc, id).fill.type, rid);
      return { pass: fillType === "gradient", detail: { fillType } };
    },
  },
  {
    // Slice tool: drag → a normalized export region (doc.slices) that renders dashed.
    g: "build", id: "slice-create",
    fn: async (s) => {
      await s.reset();
      await s.setTool("slice");
      await s.drag({ x: 100, y: 100 }, { x: 280, y: 220 });
      const slice = await s.page.evaluate(() => {
        const sl = window.__artisanStore.getState().doc.slices;
        return sl && sl.length ? { count: sl.length, x: Math.round(sl[0].x), y: Math.round(sl[0].y), w: Math.round(sl[0].width), h: Math.round(sl[0].height) } : null;
      });
      const rendered = await s.page.evaluate(() => !!document.querySelector('svg.artisan-canvas rect[stroke-dasharray="4 3"]'));
      const pass = !!slice && slice.count === 1 && slice.x === 100 && slice.y === 100 && slice.w === 180 && slice.h === 120 && rendered;
      return { pass, detail: { slice, rendered } };
    },
  },
  {
    // Artboard tool: dragging inside the artboard moves it (Illustrator Shift+O).
    g: "build", id: "artboard-move",
    fn: async (s) => {
      await s.reset();
      await s.setTool("artboard");
      const ab = await s.page.evaluate(() => {
        const a = window.__artisanStore.getState().doc.artboards[0];
        return { x: a.x, y: a.y, w: a.width, h: a.height };
      });
      const cx = ab.x + ab.w / 2, cy = ab.y + ab.h / 2;
      await s.drag({ x: cx, y: cy }, { x: cx + 100, y: cy + 80 });
      const after = await s.page.evaluate(() => {
        const d = window.__artisanStore.getState().doc;
        return { x: Math.round(d.artboards[0].x), y: Math.round(d.artboards[0].y), count: d.artboards.length };
      });
      const pass = after.count === 1 && Math.abs(after.x - (ab.x + 100)) < 2 && Math.abs(after.y - (ab.y + 80)) < 2;
      return { pass, detail: { ab, after } };
    },
  },
  {
    // View ▸ Zoom: Actual Size → 100%, Zoom In → larger (via the real menu).
    g: "build", id: "zoom-commands",
    fn: async (s) => {
      await s.reset();
      const zoom = () => s.page.evaluate(() => window.__artisanStore.getState().view.zoom);
      const viewItem = async (label) => {
        await s.page.getByRole("menuitem", { name: "View", exact: true }).first().click();
        await s.page.waitForTimeout(120);
        await s.page.locator(".monet-menu-label", { hasText: label }).first().click();
        await s.page.waitForTimeout(80);
      };
      await viewItem(/^Actual Size$/);
      const actual = await zoom();
      await viewItem(/^Zoom In$/);
      const zoomedIn = await zoom();
      const pass = Math.abs(actual - 1) < 0.001 && zoomedIn > actual + 0.1;
      return { pass, detail: { actual, zoomedIn } };
    },
  },
  {
    // Smooth tool: brushing along a jagged path softens it (anchors move, count kept).
    g: "build", id: "smooth-path",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.jagged);
      const before = await s.itemDetail(pid);
      await s.setTool("smooth");
      await s.drag({ x: 300, y: 250 }, { x: 400, y: 290 }, { steps: 14 }); // brush along the path
      const after = await s.itemDetail(pid);
      const pass = after?.type === "path" && after.anchors === before.anchors && after.anchorsHash !== before.anchorsHash;
      return { pass, detail: { anchors: after?.anchors, changed: after?.anchorsHash !== before?.anchorsHash } };
    },
  },
  {
    // Liquify Bloat pushes anchors outward → the shape's bbox GROWS.
    g: "build", id: "liquify-bloat-grows",
    fn: async (s) => {
      const [rid] = await s.fixture(
        `const r=E.makeRect(300,250,40,40,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(r);return[r.id];`,
      );
      const before = await s.itemDetail(rid);
      await s.setTool("bloat");
      await s.drag({ x: 320, y: 270 }, { x: 323, y: 273 }, { steps: 10 }); // brush the centre
      const after = await s.itemDetail(rid);
      const pass = after.bounds.width > before.bounds.width + 2 && after.bounds.height > before.bounds.height + 2;
      return { pass, detail: { before: Math.round(before.bounds.width), after: Math.round(after.bounds.width) } };
    },
  },
  {
    // Liquify Pucker pulls anchors inward → the shape's bbox SHRINKS.
    g: "build", id: "liquify-pucker-shrinks",
    fn: async (s) => {
      const [rid] = await s.fixture(
        `const r=E.makeRect(300,250,40,40,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(r);return[r.id];`,
      );
      const before = await s.itemDetail(rid);
      await s.setTool("pucker");
      await s.drag({ x: 320, y: 270 }, { x: 323, y: 273 }, { steps: 10 });
      const after = await s.itemDetail(rid);
      const pass = after.bounds.width < before.bounds.width - 2 && after.bounds.height < before.bounds.height - 2;
      return { pass, detail: { before: Math.round(before.bounds.width), after: Math.round(after.bounds.width) } };
    },
  },
  {
    // Properties panel: the Blend dropdown sets mix-blend-mode (renders + round-trips).
    g: "build", id: "blend-mode",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(60);
      await s.chooseOption("[data-blend-mode]", "multiply");
      await s.page.waitForTimeout(80);
      const r = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        const node = document.querySelector(`svg.artisan-canvas [data-id="${id}"]`);
        return { mode: it.blendMode, style: node ? node.getAttribute("style") : null };
      }, rid);
      const rtMode = await s.page.evaluate(async () => {
        const svg = window.__engine.IO.exportSVG(window.__artisanStore.getState().doc, { background: true });
        await window.__doImport("rt.svg", svg);
        const find = (items) => {
          for (const it of items) {
            if (it.blendMode && it.blendMode !== "normal") return it.blendMode; // groups carry it on export
            if (it.type === "group") { const f = find(it.children); if (f) return f; }
          }
          return null;
        };
        const doc = window.__artisanStore.getState().doc;
        for (const l of doc.layers) { const f = find(l.items); if (f) return f; }
        return null;
      });
      const pass = r.mode === "multiply" && /mix-blend-mode:\s*multiply/.test(r.style || "") && rtMode === "multiply";
      return { pass, detail: { ...r, rtMode } };
    },
  },
  {
    // Properties panel: drag the Opacity Slider with the MOUSE → object opacity.
    // Illustrator Transparency: opacity is one 0..100% value on the whole object,
    // a slider drag is ONE undo step, and it maps 1:1 to SVG element opacity.
    g: "build", id: "opacity-slider",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.page.locator('[data-dock-tab][data-tab-id="properties"]').click();
      await s.page.waitForTimeout(60);
      // Drive the real Monet Slider's pointer path with a press-drag-release at the
      // track coordinate. We dispatch genuine PointerEvents (carrying clientX/Y at
      // 5% → 30% of the track) rather than Playwright's hit-tested mouse, because at
      // the e2e's stacked-dock layout the 4px-tall slider sits beneath a panel tab
      // strip (elementFromPoint → .monet-tab), so an OS-level click lands on the tab.
      // This exercises onPointerDown → commit → onChange (begin+mutate "Opacity") →
      // pointerup → onChangeEnd (endTransaction) end-to-end.
      const r = await s.page.evaluate((id) => {
        const el = document.querySelector('[data-prop-opacity] [role="slider"]');
        const rect = el.getBoundingClientRect();
        const ev = (type, fx) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + rect.width * fx, clientY: rect.top + rect.height / 2, button: 0, pointerId: 1 });
        el.dispatchEvent(ev("pointerdown", 0.05)); // grab near the left edge
        window.dispatchEvent(ev("pointermove", 0.3)); // drag to ~30%
        window.dispatchEvent(ev("pointerup", 0.3)); // release → commits the transaction
        return { opacity: window.__Q.getItem(window.__artisanStore.getState().doc, id).opacity };
      }, rid);
      await s.page.waitForTimeout(90); // let React re-render the canvas
      r.attr = await s.page.evaluate((id) => {
        const node = document.querySelector(`svg.artisan-canvas [data-id="${id}"]`);
        return node ? node.getAttribute("opacity") : null;
      }, rid);
      // ONE undoable transaction: a single undo restores full opacity.
      const undone = await s.page.evaluate((id) => {
        window.__artisanStore.undo();
        return window.__Q.getItem(window.__artisanStore.getState().doc, id).opacity;
      }, rid);
      // round-trip: re-export + re-import preserves opacity (on the wrapping <g>).
      const rt = await s.page.evaluate(async (id) => {
        window.__artisanStore.redo(); // restore the 0.3
        const svg = window.__engine.IO.exportSVG(window.__artisanStore.getState().doc, { background: true });
        await window.__doImport("rt.svg", svg);
        const find = (items) => {
          for (const it of items) {
            if (it.opacity != null && it.opacity < 1) return it.opacity;
            if (it.type === "group") { const f = find(it.children); if (f != null) return f; }
          }
          return null;
        };
        const doc = window.__artisanStore.getState().doc;
        for (const l of doc.layers) { const f = find(l.items); if (f != null) return f; }
        return null;
      }, rid);
      const near = (a, b) => a != null && Math.abs(a - b) < 0.06;
      const pass = near(r.opacity, 0.3) && near(parseFloat(r.attr), 0.3) && undone === 1 && near(rt, 0.3);
      return { pass, detail: { ...r, undone, rt } };
    },
  },
  {
    // Type (T) tool: click empty canvas → point-type object, TYPE into the inline
    // editor, finish → a <text> with the typed content. Real mouse + keyboard.
    g: "build", id: "type-tool",
    fn: async (s) => {
      await s.fixture("return [];"); // empty doc
      await s.setTool("type");
      await s.click({ x: 320, y: 260 }); // place + autofocus the inline <textarea>
      await s.page.waitForTimeout(80);
      await s.page.locator("textarea.artisan-text-edit").waitFor({ state: "visible", timeout: 2000 });
      await s.page.keyboard.type("Hello");
      await s.page.waitForTimeout(60);
      await s.page.keyboard.press("Escape"); // finish editing + switch to selection
      await s.page.waitForTimeout(90);
      const r = await s.page.evaluate(() => {
        const texts = [];
        for (const l of window.__artisanStore.getState().doc.layers) for (const it of l.items) if (it.type === "text") texts.push(it);
        const id = texts[0]?.id;
        const node = id ? document.querySelector(`svg.artisan-canvas [data-id="${id}"] text`) : null;
        return { count: texts.length, text: texts[0]?.text, rendered: !!node, content: node ? node.textContent : null };
      });
      const pass = r.count === 1 && r.text === "Hello" && r.rendered && (r.content || "").includes("Hello");
      return { pass, detail: r };
    },
  },
  {
    // Type tool: an EMPTY type object is DISCARDED on finish (Illustrator parity).
    g: "build", id: "type-empty-discard",
    fn: async (s) => {
      await s.fixture("return [];");
      await s.setTool("type");
      await s.click({ x: 300, y: 240 }); // place an empty type object
      await s.page.waitForTimeout(80);
      await s.page.locator("textarea.artisan-text-edit").waitFor({ state: "visible", timeout: 2000 });
      await s.page.keyboard.press("Escape"); // finish WITHOUT typing
      await s.page.waitForTimeout(90);
      const count = await s.page.evaluate(() => {
        let n = 0;
        for (const l of window.__artisanStore.getState().doc.layers) for (const it of l.items) if (it.type === "text") n++;
        return n;
      });
      return { pass: count === 0, detail: { count } };
    },
  },
  {
    // Object ▸ Make Pattern: select art → a pattern swatch tiled by its bounds is
    // added to the doc + becomes the active fill. Real menu mouse-click.
    g: "build", id: "make-pattern",
    fn: async (s) => {
      await s.fixture(FX.rect); // a rect, selected
      const before = await s.page.evaluate(() => window.__artisanStore.getState().doc.swatches.length);
      // "Make Pattern" is a flat Object-menu item (not a submenu); its label is not
      // a substring of "Make Clipping/Opacity Mask", so hasText is unambiguous.
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(130);
      await s.page.locator(".monet-menu-item", { hasText: "Make Pattern" }).first().click();
      await s.page.waitForTimeout(130);
      const r = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const sw = st.doc.swatches;
        const last = sw[sw.length - 1];
        const isPat = last && last.type === "pattern";
        return { count: sw.length, lastType: last?.type, tile: isPat ? last.pattern.tile.length : 0, w: isPat ? last.pattern.width : 0, h: isPat ? last.pattern.height : 0, fillType: st.fill.type };
      });
      const pass = r.count === before + 1 && r.lastType === "pattern" && r.tile >= 1 && r.w > 0 && r.h > 0 && r.fillType === "pattern";
      return { pass, detail: { before, ...r } };
    },
  },
  {
    // Keyboard nudge: arrow keys move the selection by 1 (Shift = 10), in the right
    // direction (Right=+x, Down=+y, Up=−y, Left=−x). Real key presses.
    g: "build", id: "nudge-arrows",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect); // selected
      const pos = () => s.page.evaluate((id) => {
        const t = window.__Q.getItem(window.__artisanStore.getState().doc, id).transform;
        return { x: t.e, y: t.f };
      }, rid);
      const p0 = await pos();
      await s.page.keyboard.press("ArrowRight");
      await s.page.waitForTimeout(30);
      const p1 = await pos(); // +1 x
      await s.page.keyboard.press("ArrowDown");
      await s.page.waitForTimeout(30);
      const p2 = await pos(); // +1 y
      await s.page.keyboard.down("Shift");
      await s.page.keyboard.press("ArrowRight");
      await s.page.keyboard.up("Shift");
      await s.page.waitForTimeout(30);
      const p3 = await pos(); // +10 x
      const near = (a, b) => Math.abs(a - b) < 0.01;
      const pass =
        near(p1.x, p0.x + 1) && near(p1.y, p0.y) &&
        near(p2.x, p1.x) && near(p2.y, p1.y + 1) &&
        near(p3.x, p2.x + 10) && near(p3.y, p2.y);
      return { pass, detail: { p0, p1, p2, p3 } };
    },
  },
  {
    // .artisan Save → Open: serialize a rich doc, re-import it through the real
    // import path (deserializeDocument) → identical bytes (lossless save/reopen).
    g: "build", id: "artisan-roundtrip",
    fn: async (s) => {
      await s.fixture(`
        const r=E.makeRect(60,80,120,90,12,12,{fill:E.solid(E.rgba(220,30,40)),stroke:E.defaultStroke(E.solid(E.BLACK))});
        r.opacity=0.5; r.blendMode="multiply";
        r.effects=[{type:"drop-shadow",dx:6,dy:6,blur:6,color:E.rgba(0,0,0,0.5)}];
        const e=E.makeEllipse(220,80,100,70,{fill:E.linearGradient()});
        if(e.fill.type==="gradient") e.fill.gradient.spread="reflect";
        doc.layers[0].items.push(r,e);
        return[];
      `);
      const before = await s.page.evaluate(() => window.__engine.IO.serializeDocument(window.__artisanStore.getState().doc));
      await s.page.evaluate(async (text) => { await window.__doImport("saved.artisan", text); }, before);
      await s.page.waitForTimeout(60);
      const after = await s.page.evaluate(() => window.__engine.IO.serializeDocument(window.__artisanStore.getState().doc));
      // also confirm the rich attrs survived the reopen
      const ok = await s.page.evaluate(() => {
        const items = window.__artisanStore.getState().doc.layers[0].items;
        const r = items.find((i) => i.type === "rect");
        const e = items.find((i) => i.type === "ellipse");
        return !!r && r.opacity === 0.5 && r.blendMode === "multiply" && (r.effects || [])[0]?.type === "drop-shadow"
          && !!e && e.fill.type === "gradient" && e.fill.gradient.spread === "reflect";
      });
      const pass = after === before && ok;
      return { pass, detail: { equal: after === before, ok, len: after.length } };
    },
  },
  {
    // SVG export options at runtime: active-artboard viewBox, white background,
    // per-artboard crop (the real exportSVG the File ▸ Export path calls).
    g: "build", id: "svg-export-options",
    fn: async (s) => {
      await s.fixture(`
        const r=E.makeRect(20,20,60,40,0,0,{fill:E.solid(E.rgba(200,50,50))});
        doc.layers[0].items.push(r);
        doc.artboards.push(E.makeArtboard("Artboard 2", 1000, 0, 400, 300));
        return[];
      `);
      const r = await s.page.evaluate(() => {
        const IO = window.__engine.IO;
        const doc = window.__artisanStore.getState().doc;
        const def = IO.exportSVG(doc);
        const vb = (svg) => (/viewBox="([^"]+)"/.exec(svg) || [])[1];
        return {
          defViewBox: vb(def), // active artboard (0,0,900,700)
          noBg: !def.includes('fill="#ffffff"'),
          hasBg: IO.exportSVG(doc, { background: true }).includes('fill="#ffffff"'),
          ab2ViewBox: vb(IO.exportSVG(doc, { artboardIndex: 1 })),
        };
      });
      const pass = r.defViewBox === "0 0 900 700" && r.noBg && r.hasBg && r.ab2ViewBox === "1000 0 400 300";
      return { pass, detail: r };
    },
  },
  {
    // Ruler guides: drag from the top ruler down onto the canvas → a horizontal guide
    // is created (and rendered). Then Clear Guides removes it. Real mouse drag + menu.
    g: "build", id: "guides-ruler-drag",
    fn: async (s) => {
      await s.fixture("return [];");
      const before = await s.page.evaluate(() => window.__artisanStore.getState().guides.length);
      const ruler = await s.page.locator(".artisan-ruler-top").boundingBox();
      const canvas = await s.page.locator("svg.artisan-canvas").boundingBox();
      // press the ruler, release inside the canvas (pointer capture keeps the up on the ruler)
      await s.page.mouse.move(ruler.x + ruler.width / 2, ruler.y + ruler.height / 2);
      await s.page.mouse.down();
      await s.page.mouse.move(canvas.x + canvas.width / 2, canvas.y + 140, { steps: 6 });
      await s.page.mouse.up();
      await s.page.waitForTimeout(80);
      const made = await s.page.evaluate(() => ({
        count: window.__artisanStore.getState().guides.length,
        orientation: window.__artisanStore.getState().guides[0]?.orientation,
        rendered: document.querySelectorAll('.artisan-guides [data-guide="h"]').length,
      }));
      // Clear Guides via the View menu
      await s.page.getByRole("menuitem", { name: "View", exact: true }).first().click();
      await s.page.waitForTimeout(120);
      await s.page.locator(".monet-menu-label", { hasText: /^Clear Guides$/ }).first().click();
      await s.page.waitForTimeout(80);
      const cleared = await s.page.evaluate(() => window.__artisanStore.getState().guides.length);
      const pass = before === 0 && made.count === 1 && made.orientation === "h" && made.rendered === 1 && cleared === 0;
      return { pass, detail: { before, ...made, cleared } };
    },
  },
  {
    g: "build", id: "make-guides",
    fn: async (s) => {
      // a selected rect → View ▸ Make Guides adds H/V guides at its bounding edges
      // (v@200/280, h@150/210).
      await s.fixture(
        `const r=E.makeRect(200,150,80,60,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await topMenu(s, "View", "Make Guides");
      const guides = await s.page.evaluate(() =>
        window.__artisanStore.getState().guides.map((g) => `${g.orientation}:${g.pos}`).sort(),
      );
      const pass = JSON.stringify(guides) === JSON.stringify(["h:150", "h:210", "v:200", "v:280"]);
      return { pass, detail: { guides } };
    },
  },
  {
    g: "build", id: "live-paint-bucket",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.page.evaluate(() => window.__artisanStore.setFill(window.__engine.solid(window.__engine.rgba(40, 200, 120))));
      await s.setTool("live-paint-bucket");
      await s.click({ x: 360, y: 275 });
      const d = await s.itemDetail(rid);
      const pass = d?.fillType === "solid" && Math.round(d.fillColor.g) === 200 && Math.round(d.fillColor.r) === 40;
      return { pass, detail: { fillColor: d?.fillColor } };
    },
  },
  {
    g: "build", id: "live-paint-selection",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.setTool("live-paint-selection");
      await s.click({ x: 360, y: 275 });
      const snap = await s.snapshot();
      return { pass: snap.selection.includes(rid), detail: { selection: snap.selection } };
    },
  },
  {
    g: "build", id: "gradient",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.setTool("gradient");
      await s.drag({ x: 260, y: 275 }, { x: 460, y: 275 });
      const d = await s.itemDetail(rid);
      return { pass: d?.fillType === "gradient", detail: { fillType: d?.fillType } };
    },
  },
  {
    g: "build", id: "gradient-radial",
    fn: async (s) => {
      // a rect with a RADIAL gradient (default cx/cy/r = 0.5/0.5/0.5), selected
      const [rid] = await s.fixture(`const r=E.makeRect(200,200,200,100,0,0,{fill:E.radialGradient()});doc.layers[0].items.push(r);return[r.id];`);
      await s.setTool("gradient");
      await s.drag({ x: 200, y: 200 }, { x: 300, y: 250 }, { steps: 10 }); // top-left corner → centre of the rect
      const g = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return it.fill.type === "gradient" ? { type: it.fill.gradient.type, cx: it.fill.gradient.cx, cy: it.fill.gradient.cy, r: it.fill.gradient.r } : null;
      }, rid);
      // the radial centre moved to the drag start (≈0,0) and the radius = drag length (≈0.707)
      const pass = !!g && g.type === "radial" && Math.abs(g.cx) < 0.06 && Math.abs(g.cy) < 0.06 && Math.abs(g.r - Math.SQRT1_2) < 0.06;
      return { pass, detail: g };
    },
  },
  {
    // Gradient panel: clicking the "Reflect" Spread segment sets the gradient's spread.
    g: "build", id: "gradient-spread",
    fn: async (s) => {
      const [rid] = await s.fixture(`const r=E.makeRect(250,200,220,150,0,0,{fill:E.linearGradient()});doc.layers[0].items.push(r);return[r.id];`);
      await s.page.locator('[data-dock-tab][data-tab-id="gradient"]').click();
      await s.page.waitForTimeout(80);
      await s.page.getByText("Reflect", { exact: true }).click(); // the Spread SegmentedControl
      await s.page.waitForTimeout(90);
      const spread = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return it.fill.type === "gradient" ? it.fill.gradient.spread : null;
      }, rid);
      return { pass: spread === "reflect", detail: { spread } };
    },
  },
  {
    // Gradient panel ▸ Stroke target: editing the gradient (Spread) affects the
    // STROKE's gradient, leaving a solid fill untouched.
    g: "build", id: "gradient-stroke",
    fn: async (s) => {
      const [rid] = await s.fixture(
        `const r=E.makeRect(250,200,220,150,0,0,{fill:E.solid(E.rgba(220,0,0)),stroke:{...E.defaultStroke(E.linearGradient()),width:8}});doc.layers[0].items.push(r);return[r.id];`,
      );
      await s.page.locator('[data-dock-tab][data-tab-id="gradient"]').click();
      await s.page.waitForTimeout(80);
      await s.page.locator('[data-gradient-target="stroke"]').click(); // target the stroke
      await s.page.waitForTimeout(60);
      await s.page.getByText("Repeat", { exact: true }).click(); // Spread → Repeat
      await s.page.waitForTimeout(90);
      const info = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return {
          strokeSpread: it.stroke.paint.type === "gradient" ? it.stroke.paint.gradient.spread : null,
          fillType: it.fill.type,
        };
      }, rid);
      const pass = info.strokeSpread === "repeat" && info.fillType === "solid";
      return { pass, detail: info };
    },
  },
  {
    g: "build", id: "mesh",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.setTool("mesh");
      await s.click({ x: 360, y: 275 });
      const snap = await s.snapshot();
      const g = snap.top.find((t) => t.type === "group"); // the mesh group ("Gradient Mesh"); do not pin the label
      return { pass: !!g && g.children >= 9, detail: { top: snap.top.map((t) => ({ type: t.type, name: t.name, children: t.children })) } };
    },
  },
  {
    g: "build", id: "eyedropper",
    fn: async (s) => {
      // source A: red, thick stroke (8), 40% opacity. target B: blue, thin, opaque.
      const ids = await s.fixture(`const a=E.makeRect(150,200,120,110,0,0,{fill:E.solid(E.rgba(220,80,80)),stroke:{...E.defaultStroke(E.solid(E.BLACK)),width:8},opacity:0.4});const b=E.makeRect(360,200,120,110,0,0,{fill:E.solid(E.rgba(60,110,220))});doc.layers[0].items.push(a,b);return[b.id];`);
      const bId = ids[0];
      await s.setTool("eyedropper");
      await s.click({ x: 210, y: 255 }); // click red A; copies its appearance to selected B
      const t = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return { fillR: it.fill.type === "solid" ? Math.round(it.fill.color.r) : null, strokeW: it.stroke.width, opacity: it.opacity };
      }, bId);
      // Illustrator default: colour + stroke weight + transparency all copied.
      const pass = t.fillR === 220 && t.strokeW === 8 && Math.abs(t.opacity - 0.4) < 1e-6;
      return { pass, detail: t };
    },
  },

  // ---- join (Object ▸ Path ▸ Join, via the real menu) ----
  {
    g: "build", id: "join-paths",
    fn: async (s) => {
      // two open paths that SHARE the endpoint (260,200) → Join merges it.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const a=E.makePath({closed:false,anchors:[A(150,200),A(260,200)]},{fill:E.noPaint(),stroke:E.defaultStroke(E.solid(E.BLACK))});` +
          `const b=E.makePath({closed:false,anchors:[A(260,200),A(370,260)]},{fill:E.noPaint(),stroke:E.defaultStroke(E.solid(E.BLACK))});` +
          `doc.layers[0].items.push(a,b);return[a.id,b.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Path" }).first().hover();
      await s.page.waitForTimeout(200); // let the submenu open
      const joinItem = s.page.locator(".monet-menu-item", { hasText: "Join" }).first();
      await joinItem.hover(); // move into the submenu (keeps it open), then click
      await s.page.waitForTimeout(80);
      await joinItem.click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      // one open path; the shared endpoint merged → 3 anchors (not 4)
      const pass = snap.topCount === 1 && t?.type === "path" && d?.anchors === 3 && d?.closed === false;
      return { pass, detail: { topCount: snap.topCount, type: t?.type, anchors: d?.anchors, closed: d?.closed } };
    },
  },

  // ---- add anchor points (Object ▸ Path ▸ Add Anchor Points, via the menu) ----
  {
    g: "build", id: "add-anchor-points",
    fn: async (s) => {
      // a closed square path → adds a midpoint on every edge (4 → 8 anchors),
      // shape (bounds) unchanged.
      const [pid] = await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const p=E.makePath({closed:true,anchors:[A(150,160),A(270,160),A(270,280),A(150,280)]},{fill:E.solid(E.rgba(200,120,60))});` +
          `doc.layers[0].items.push(p);return[p.id];`,
      );
      const before = await s.itemDetail(pid);
      await objectSubmenu(s, "Path", "Add Anchor Points");
      const after = await s.itemDetail(pid);
      const pass =
        before.anchors === 4 &&
        after.anchors === 8 &&
        after.closed === true &&
        Math.round(after.bounds.width) === Math.round(before.bounds.width) &&
        Math.round(after.bounds.height) === Math.round(before.bounds.height);
      return { pass, detail: { before: before.anchors, after: after.anchors, closed: after.closed, bounds: after.bounds } };
    },
  },

  // ---- average anchors (Object ▸ Path ▸ Average, via the real menu) ----
  {
    g: "build", id: "average-anchors",
    fn: async (s) => {
      // an open 2-anchor path; select BOTH anchors → Average (Both) collapses them
      // onto the midpoint (225,210).
      const [pid] = await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const p=E.makePath({closed:false,anchors:[A(150,160),A(300,260)]},{fill:E.noPaint(),stroke:E.defaultStroke(E.solid(E.BLACK))});` +
          `doc.layers[0].items.push(p);return[p.id];`,
      );
      // Direct-Selection would set this; drive it via the store hook (setSelection
      // clears anchorSelection, so set anchors AFTER the fixture's selection).
      await s.page.evaluate((id) => window.__artisanStore.setAnchorSelection({ [id]: [0, 1] }), pid);
      await s.page.waitForTimeout(60); // let the menu rebuild (item enables)
      // "Average" is a substring of "Average Horizontal/Vertical" → click exact label.
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Path" }).first().hover();
      await s.page.waitForTimeout(200);
      const avg = s.page.locator(".monet-menu-label", { hasText: /^Average$/ }).first();
      await avg.hover();
      await s.page.waitForTimeout(80);
      await avg.click();
      await s.page.waitForTimeout(120);
      const d = await s.itemDetail(pid);
      const pass = d.anchors === 2 && d.anchorsHash === "225,210|225,210";
      return { pass, detail: { anchors: d.anchors, anchorsHash: d.anchorsHash } };
    },
  },

  // ---- convert anchor points to smooth (Object ▸ Path ▸ Convert to Smooth) ----
  {
    g: "build", id: "convert-anchor-smooth",
    fn: async (s) => {
      // a closed corner square; select all 4 anchors → Convert to Smooth gives each
      // handles tangent to its neighbours ((next−prev)/6). Anchor 1 (220,100): prev
      // (100,100), next (220,220) ⇒ handleOut (20,20).
      const [pid] = await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const p=E.makePath({closed:true,anchors:[A(100,100),A(220,100),A(220,220),A(100,220)]},{fill:E.noPaint(),stroke:E.defaultStroke(E.solid(E.BLACK),2)});` +
          `doc.layers[0].items.push(p);return[p.id];`,
      );
      await s.page.evaluate((id) => window.__artisanStore.setAnchorSelection({ [id]: [0, 1, 2, 3] }), pid);
      await s.page.waitForTimeout(60); // let the menu rebuild (items enable)
      await objectSubmenu(s, "Path", "Convert to Smooth");
      const h = await s.page.evaluate((id) => {
        const p = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        if (!p || p.type !== "path") return null;
        const a = p.geometry.anchors;
        return {
          allSmooth: a.every((an) => !!(an.handleIn.x || an.handleIn.y || an.handleOut.x || an.handleOut.y)),
          a1: `${a[1].handleOut.x},${a[1].handleOut.y}`,
        };
      }, pid);
      const pass = !!h && h.allSmooth === true && h.a1 === "20,20";
      return { pass, detail: h };
    },
  },

  // ---- convert anchor points to corner (Object ▸ Path ▸ Convert to Corner) ----
  {
    g: "build", id: "convert-anchor-corner",
    fn: async (s) => {
      // a closed square whose anchors already carry handles (smooth); select all 4 →
      // Convert to Corner strips every handle back to (0,0).
      const [pid] = await s.fixture(
        `const A=(x,y,hi,ho)=>E.makeAnchor({x,y},hi,ho);` +
          `const p=E.makePath({closed:true,anchors:[` +
          `A(100,100,{x:-20,y:20},{x:20,y:-20}),A(220,100,{x:-20,y:-20},{x:20,y:20}),` +
          `A(220,220,{x:20,y:-20},{x:-20,y:20}),A(100,220,{x:20,y:20},{x:-20,y:-20})]},` +
          `{fill:E.noPaint(),stroke:E.defaultStroke(E.solid(E.BLACK),2)});doc.layers[0].items.push(p);return[p.id];`,
      );
      await s.page.evaluate((id) => window.__artisanStore.setAnchorSelection({ [id]: [0, 1, 2, 3] }), pid);
      await s.page.waitForTimeout(60); // let the menu rebuild (items enable)
      await objectSubmenu(s, "Path", "Convert to Corner");
      const allCorner = await s.page.evaluate((id) => {
        const p = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        if (!p || p.type !== "path") return null;
        return p.geometry.anchors.every((a) => !a.handleIn.x && !a.handleIn.y && !a.handleOut.x && !a.handleOut.y);
      }, pid);
      const pass = allCorner === true;
      return { pass, detail: { allCorner } };
    },
  },

  // ---- transform again (Object ▸ Transform ▸ Transform Again, via the real menu) ----
  {
    g: "build", id: "transform-again",
    fn: async (s) => {
      // a non-square 120×60 rect; Rotate 90° CW swaps its bounds to 60×120, then
      // Transform Again rotates another 90° (180° total) → back to 120×60.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const p=E.makePath({closed:true,anchors:[A(200,200),A(320,200),A(320,260),A(200,260)]},{fill:E.solid(E.rgba(120,160,220)),stroke:E.defaultStroke(E.solid(E.BLACK),2)});` +
          `doc.layers[0].items.push(p);return[p.id];`,
      );
      const r0 = (await geomReport(s)).sel;
      await objectSubmenu(s, "Transform", "Rotate 90° CW");
      const r1 = (await geomReport(s)).sel;
      await objectSubmenu(s, "Transform", "Transform Again");
      const r2 = (await geomReport(s)).sel;
      const near = (a, b) => Math.abs(a - b) < 0.5;
      const pass =
        near(r0.w, 120) && near(r0.h, 60) &&
        near(r1.w, 60) && near(r1.h, 120) && // one 90° rotation: bounds swapped
        near(r2.w, 120) && near(r2.h, 60); // Transform Again ran ⇒ 180° ⇒ bounds restored
      return { pass, detail: { r0, r1, r2 } };
    },
  },

  // ---- outline stroke (Object ▸ Path ▸ Outline Stroke, via the real menu) ----
  {
    g: "build", id: "outline-stroke",
    fn: async (s) => {
      // a black-stroked, NO-FILL open line → Outline Stroke turns the stroke
      // into one filled compound (filled with the stroke colour, no stroke).
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const a=E.makePath({closed:false,anchors:[A(150,200),A(370,200)]},{fill:E.noPaint(),stroke:{...E.defaultStroke(E.solid(E.BLACK)),width:12}});` +
          `doc.layers[0].items.push(a);return[a.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Path" }).first().hover();
      await s.page.waitForTimeout(200); // let the submenu open
      const item = s.page.locator(".monet-menu-item", { hasText: "Outline Stroke" }).first();
      await item.hover();
      await s.page.waitForTimeout(80);
      await item.click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      // one filled compound: fill = stroke colour (black), stroke = none, area ≈ 220×12
      const c = d?.fillColor;
      const isBlack = c && c.r === 0 && c.g === 0 && c.b === 0;
      const pass =
        snap.topCount === 1 &&
        t?.type === "compound" &&
        d?.fillType === "solid" &&
        isBlack &&
        d?.stroke?.paint?.type === "none" &&
        d?.subpaths === 1;
      return { pass, detail: { topCount: snap.topCount, type: t?.type, fillType: d?.fillType, fillColor: c, strokePaint: d?.stroke?.paint?.type, subpaths: d?.subpaths } };
    },
  },

  // ---- offset path (Object ▸ Path ▸ Offset Path, via the real menu) ----
  {
    g: "build", id: "offset-path",
    fn: async (s) => {
      // a closed 100×100 square at world (150,150)→(250,250). Offset Path with
      // the default +10 miter adds a NEW 120×120 path and KEEPS the original.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(80,140,220))});` +
          `doc.layers[0].items.push(sq);return[sq.id];`,
      );
      await objectSubmenu(s, "Path", "Offset Path");
      const snap = await s.snapshot();
      // the offset copy is selected; the original is kept → 2 top-level items
      const sel = snap.selection[0];
      const d = sel ? await s.itemDetail(sel) : null;
      const b = d?.bounds;
      const grew = !!b && b.x === 140 && b.y === 140 && b.width === 120 && b.height === 120;
      const pass = snap.topCount === 2 && d?.type === "path" && d?.closed === true && d?.anchors === 4 && grew;
      return { pass, detail: { topCount: snap.topCount, type: d?.type, anchors: d?.anchors, closed: d?.closed, bounds: b } };
    },
  },

  // ---- round corners (Object ▸ Path ▸ Round Corners, via the real menu) ----
  {
    g: "build", id: "round-corners",
    fn: async (s) => {
      // a closed 100×100 square. Round Corners (default radius 10) rounds each
      // corner into an arc → 8 anchors, bounds unchanged (corners round inward).
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(80,140,220))});` +
          `doc.layers[0].items.push(sq);return[sq.id];`,
      );
      await objectSubmenu(s, "Path", "Round Corners");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const b = d?.bounds;
      const same = !!b && b.x === 150 && b.y === 150 && b.width === 100 && b.height === 100;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchors === 8 && d?.closed === true && d?.hasHandles === true && same;
      return { pass, detail: { topCount: snap.topCount, type: d?.type, anchors: d?.anchors, hasHandles: d?.hasHandles, bounds: b } };
    },
  },
  {
    g: "build", id: "round-corners-effect",
    fn: async (s) => {
      // same square, but via Effect ▸ Round Corners (Illustrator's home for it) —
      // identical result: each corner rounds into an arc → 8 anchors, bounds unchanged.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(80,140,220))});` +
          `doc.layers[0].items.push(sq);return[sq.id];`,
      );
      await topMenu(s, "Effect", "Round Corners");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const b = d?.bounds;
      const same = !!b && b.x === 150 && b.y === 150 && b.width === 100 && b.height === 100;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchors === 8 && d?.closed === true && d?.hasHandles === true && same;
      return { pass, detail: { topCount: snap.topCount, type: d?.type, anchors: d?.anchors, hasHandles: d?.hasHandles, bounds: b } };
    },
  },

  // ---- zig zag (Object ▸ Path ▸ Zig Zag, via the real menu) ----
  {
    g: "build", id: "zigzag",
    fn: async (s) => {
      // a closed 100×100 square → Zig Zag (default size 10, 4 ridges per segment)
      // → 4 segments × (corner node + 4 ridges) = 20 anchors.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(80,140,220))});` +
          `doc.layers[0].items.push(sq);return[sq.id];`,
      );
      await objectSubmenu(s, "Path", "Zig Zag");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchors === 20 && d?.closed === true;
      return { pass, detail: { topCount: snap.topCount, type: d?.type, anchors: d?.anchors, closed: d?.closed } };
    },
  },
  {
    g: "build", id: "zigzag-effect",
    fn: async (s) => {
      // same square, but via Effect ▸ Distort & Transform ▸ Zig Zag (Illustrator's home
      // for Zig Zag) — identical result: 4 segments × (corner + 4 ridges) = 20 anchors.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(80,140,220))});` +
          `doc.layers[0].items.push(sq);return[sq.id];`,
      );
      await menuSubmenu(s, "Effect", "Distort & Transform", "Zig Zag");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchors === 20 && d?.closed === true;
      return { pass, detail: { topCount: snap.topCount, type: d?.type, anchors: d?.anchors, closed: d?.closed } };
    },
  },

  // ---- transform each (Object ▸ Transform ▸ Transform Each, via the real menu) ----
  {
    g: "build", id: "transform-each",
    fn: async (s) => {
      // two 80×80 squares at different positions. Transform Each (default 50%)
      // shrinks EACH around its OWN centre → 40×40, each centre unchanged.
      await s.fixture(
        `const a=E.makeRect(120,150,80,80,0,0,{fill:E.solid(E.rgba(220,90,90))});` +
          `const b=E.makeRect(320,150,80,80,0,0,{fill:E.solid(E.rgba(80,120,220))});` +
          `doc.layers[0].items.push(a,b);return[a.id,b.id];`,
      );
      await objectSubmenu(s, "Transform", "Transform Each");
      const snap = await s.snapshot();
      const ds = await Promise.all(snap.top.map((t) => s.itemDetail(t.id)));
      const bounds = ds.map((d) => d?.bounds).filter(Boolean);
      const hasBox = (x, y, w, h) =>
        bounds.some((b) => Math.abs(b.x - x) < 0.5 && Math.abs(b.y - y) < 0.5 && Math.abs(b.width - w) < 0.5 && Math.abs(b.height - h) < 0.5);
      // A centre (160,190) → (140,170,40,40); B centre (360,190) → (340,170,40,40)
      const pass = snap.topCount === 2 && hasBox(140, 170, 40, 40) && hasBox(340, 170, 40, 40);
      return { pass, detail: { topCount: snap.topCount, bounds } };
    },
  },

  // ---- split into grid (Object ▸ Path ▸ Split Into Grid, via the real menu) ----
  {
    g: "build", id: "split-grid",
    fn: async (s) => {
      // a 100×100 square → Split Into Grid (default 2×2) → one group of 4 cells,
      // replacing the original.
      await s.fixture(
        `const r=E.makeRect(150,150,100,100,0,0,{fill:E.solid(E.rgba(80,140,220))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await objectSubmenu(s, "Path", "Split Into Grid");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const pass = snap.topCount === 1 && t?.type === "group" && t?.children === 4;
      return { pass, detail: { topCount: snap.topCount, type: t?.type, children: t?.children } };
    },
  },

  // ---- divide objects below (Object ▸ Path ▸ Divide Objects Below) ----
  {
    g: "build", id: "divide-below",
    fn: async (s) => {
      // a red target + a blue cutter covering its right half; SELECT the cutter.
      // Divide Objects Below → 2 red pieces (target's paint), the blue cutter gone.
      await s.fixture(
        `const t=E.makeRect(150,150,120,120,0,0,{fill:E.solid(E.rgba(220,80,80))});` +
          `const c=E.makeRect(210,140,120,140,0,0,{fill:E.solid(E.rgba(80,120,220))});` +
          `doc.layers[0].items.push(t,c);return[c.id];`,
      );
      await objectSubmenu(s, "Path", "Divide Objects Below");
      const res = await s.page.evaluate(() => {
        const items = window.__artisanStore.getState().doc.layers[0].items;
        const isSolid = (it) => it.fill && it.fill.type === "solid";
        return {
          count: items.length,
          reds: items.filter((it) => isSolid(it) && it.fill.color.r === 220).length,
          blues: items.filter((it) => isSolid(it) && it.fill.color.b === 220 && it.fill.color.r === 80).length,
        };
      });
      const pass = res.count === 2 && res.reds === 2 && res.blues === 0;
      return { pass, detail: res };
    },
  },

  // ---- expand (Object ▸ Expand, via the real menu) ----
  {
    g: "build", id: "expand-object",
    fn: async (s) => {
      // an un-stroked live rect → Expand → a plain editable path (same item).
      const [rid] = await s.fixture(
        `const r=E.makeRect(150,150,120,90,0,0,{fill:E.solid(E.rgba(120,160,220)),stroke:E.defaultStroke(E.noPaint())});doc.layers[0].items.push(r);return[r.id];`,
      );
      const before = await s.itemDetail(rid);
      await topMenu(s, "Object", "Expand");
      const after = await s.itemDetail(rid);
      const pass = before?.type === "rect" && after?.type === "path";
      return { pass, detail: { before: before?.type, after: after?.type } };
    },
  },

  // ---- lock all artwork above (Object ▸ Lock All Artwork Above, via the real menu) ----
  {
    g: "build", id: "lock-above",
    fn: async (s) => {
      // 4 stacked rects a/b/c/d; SELECT b. Lock All Artwork Above → c,d locked.
      await s.fixture(
        `const r=()=>E.makeRect(150,150,60,60,0,0,{fill:E.solid(E.rgba(120,160,220))});` +
          `const a=r(),b=r(),c=r(),d=r();doc.layers[0].items.push(a,b,c,d);return[b.id];`,
      );
      await topMenu(s, "Object", "Lock All Artwork Above");
      const flags = await s.page.evaluate(() => window.__artisanStore.getState().doc.layers[0].items.map((it) => !!it.locked));
      // items [a,b,c,d] → only c,d (above b) locked.
      const pass = JSON.stringify(flags) === JSON.stringify([false, false, true, true]);
      return { pass, detail: { flags } };
    },
  },
  {
    g: "build", id: "hide-above",
    fn: async (s) => {
      // 4 stacked rects a/b/c/d; SELECT b. Hide All Artwork Above → c,d invisible,
      // a + b stay visible and b stays selected (it sits below the hidden art).
      await s.fixture(
        `const r=()=>E.makeRect(150,150,60,60,0,0,{fill:E.solid(E.rgba(120,160,220))});` +
          `const a=r(),b=r(),c=r(),d=r();doc.layers[0].items.push(a,b,c,d);return[b.id];`,
      );
      const bId = await s.page.evaluate(() => window.__artisanStore.getState().selection[0]);
      await topMenu(s, "Object", "Hide All Artwork Above");
      const res = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        return { vis: st.doc.layers[0].items.map((it) => it.visible !== false), sel: st.selection };
      });
      // items [a,b,c,d] → only c,d (above b) hidden; selection preserved.
      const pass = JSON.stringify(res.vis) === JSON.stringify([true, true, false, false]) && JSON.stringify(res.sel) === JSON.stringify([bId]);
      return { pass, detail: res };
    },
  },

  // ---- lock other layers (Object ▸ Lock Other Layers, via the real menu) ----
  {
    g: "build", id: "lock-other-layers",
    fn: async (s) => {
      // 3 layers L0/L1/L2; the selected object lives on L1. Lock Other Layers
      // locks L0 + L2, keeping L1 (the selection's layer) unlocked.
      await s.fixture(
        `const L1=E.makeLayer("L1"),L2=E.makeLayer("L2");` +
          `const r=E.makeRect(150,150,80,80,0,0,{fill:E.solid(E.rgba(120,160,220))});L1.items.push(r);` +
          `doc.layers.push(L1,L2);return[r.id];`,
      );
      await topMenu(s, "Object", "Lock Other Layers");
      const flags = await s.page.evaluate(() => window.__artisanStore.getState().doc.layers.map((l) => !!l.locked));
      // [L0, L1, L2] → only L1 (selection's layer) stays unlocked.
      const pass = JSON.stringify(flags) === JSON.stringify([true, false, true]);
      return { pass, detail: { flags } };
    },
  },

  // ---- trim marks (Object ▸ Create Trim Marks, via the real menu) ----
  {
    g: "build", id: "trim-marks",
    fn: async (s) => {
      // a rect → Create Trim Marks adds a "Trim Marks" group of 8 line marks,
      // keeping the artwork → 2 top-level items.
      await s.fixture(
        `const r=E.makeRect(150,150,200,150,0,0,{fill:E.solid(E.rgba(80,140,220))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Create Trim Marks" }).first().click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const grp = snap.top.find((t) => t.type === "group");
      const pass = snap.topCount === 2 && !!grp && grp.name === "Trim Marks" && grp.children === 8;
      return { pass, detail: { topCount: snap.topCount, group: grp } };
    },
  },

  // ---- simplify (Object ▸ Path ▸ Simplify, via the real menu) ----
  {
    g: "build", id: "simplify",
    fn: async (s) => {
      // an open polyline of 5 collinear points → Simplify (default tolerance 2)
      // reduces it to just the two endpoints.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const p=E.makePath({closed:false,anchors:[A(150,200),A(200,200),A(250,200),A(300,200),A(350,200)]},{fill:E.noPaint(),stroke:{...E.defaultStroke(E.solid(E.BLACK)),width:3}});` +
          `doc.layers[0].items.push(p);return[p.id];`,
      );
      await objectSubmenu(s, "Path", "Simplify");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchors === 2;
      return { pass, detail: { topCount: snap.topCount, type: d?.type, anchors: d?.anchors } };
    },
  },

  // ---- tweak (Effect ▸ Distort & Transform ▸ Tweak, via the real menu) ----
  {
    g: "build", id: "tweak",
    fn: async (s) => {
      // a closed square → Tweak (default h/v 10, anchor points only): the 4
      // anchors stay (no points added) but their positions jitter.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(80,140,220))});` +
          `doc.layers[0].items.push(sq);return[sq.id];`,
      );
      await menuSubmenu(s, "Effect", "Distort & Transform", "Tweak");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const moved = !!d?.anchorsHash && d.anchorsHash !== "150,150|250,150|250,250|150,250";
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchors === 4 && moved;
      return { pass, detail: { topCount: snap.topCount, anchors: d?.anchors, hash: d?.anchorsHash } };
    },
  },

  // ---- roughen (Effect ▸ Distort & Transform ▸ Roughen, via the real menu) ----
  {
    g: "build", id: "roughen",
    fn: async (s) => {
      // a closed 100×100 square → Roughen (default size 10, detail 2 per segment)
      // → 4 segments × (node + 2) = 12 jittered anchors.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(80,140,220))});` +
          `doc.layers[0].items.push(sq);return[sq.id];`,
      );
      await menuSubmenu(s, "Effect", "Distort & Transform", "Roughen");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchors === 12 && d?.closed === true;
      return { pass, detail: { topCount: snap.topCount, type: d?.type, anchors: d?.anchors } };
    },
  },

  // ---- saturate (Edit ▸ Edit Colors ▸ Saturate, via the real menu) ----
  {
    g: "build", id: "saturate",
    fn: async (s) => {
      // a rect with fill rgb(100,150,200) → Saturate (+50% about luma) → (80,155,230).
      await s.fixture(
        `const r=E.makeRect(150,150,120,90,0,0,{fill:E.solid(E.rgba(100,150,200))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Edit", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Edit Colors" }).first().hover();
      await s.page.waitForTimeout(200);
      const sat = s.page.locator(".monet-menu-label", { hasText: /^Saturate$/ }).first();
      await sat.hover();
      await s.page.waitForTimeout(80);
      await sat.click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const c = d?.fillColor;
      const pass = snap.topCount === 1 && d?.type === "rect" && !!c && c.r === 80 && c.g === 155 && c.b === 230;
      return { pass, detail: { topCount: snap.topCount, fillColor: c } };
    },
  },

  // ---- blend colors (Edit ▸ Edit Colors ▸ Blend Front to Back, via the real menu) ----
  {
    g: "build", id: "blend-colors",
    fn: async (s) => {
      // 3 stacked rects red(back)/green(mid)/blue(front) → Blend Front to Back
      // recolours the middle to the 50/50 mix (110,0,110), keeping the ends.
      await s.fixture(
        `const a=E.makeRect(150,150,40,40,0,0,{fill:E.solid(E.rgba(220,0,0))});` +
          `const b=E.makeRect(200,150,40,40,0,0,{fill:E.solid(E.rgba(0,255,0))});` +
          `const c=E.makeRect(250,150,40,40,0,0,{fill:E.solid(E.rgba(0,0,220))});` +
          `doc.layers[0].items.push(a,b,c);return[a.id,b.id,c.id];`,
      );
      await menuSubmenu(s, "Edit", "Edit Colors", "Blend Front to Back");
      const snap = await s.snapshot();
      const colors = [];
      for (const it of snap.top) {
        const d = await s.itemDetail(it.id);
        colors.push(d?.fillColor);
      }
      const has = (r, g, b) => colors.some((c) => c && c.r === r && c.g === g && c.b === b);
      const pass = snap.topCount === 3 && has(220, 0, 0) && has(110, 0, 110) && has(0, 0, 220);
      return { pass, detail: { colors } };
    },
  },

  // ---- pucker & bloat (Effect ▸ Distort & Transform ▸ Pucker & Bloat, via the real menu) ----
  {
    g: "build", id: "pucker-bloat",
    fn: async (s) => {
      // a closed 100×100 square → Bloat (default +50%): corners get radial handles
      // and the tight bounds grow past the box.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(80,140,220))});` +
          `doc.layers[0].items.push(sq);return[sq.id];`,
      );
      await menuSubmenu(s, "Effect", "Distort & Transform", "Pucker & Bloat");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const b = d?.bounds;
      const grew = !!b && b.x < 149.9 && b.width > 100;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.hasHandles === true && grew;
      return { pass, detail: { topCount: snap.topCount, type: d?.type, hasHandles: d?.hasHandles, bounds: b } };
    },
  },

  // ---- transform effect (Effect ▸ Distort & Transform ▸ Transform, via the real menu) ----
  {
    g: "build", id: "transform-copies",
    fn: async (s) => {
      // a rect → Transform with the default step-and-repeat (move 20,20 × 5
      // copies) → one group of 6 (original + 5 copies).
      await s.fixture(
        `const r=E.makeRect(150,150,60,60,0,0,{fill:E.solid(E.rgba(80,140,220))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Effect", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Distort & Transform" }).first().hover();
      await s.page.waitForTimeout(200);
      const fx = s.page.locator(".monet-menu-label", { hasText: /^Transform$/ }).first();
      await fx.hover();
      await s.page.waitForTimeout(80);
      await fx.click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const t = snap.top[0];
      const pass = snap.topCount === 1 && t?.type === "group" && t?.children === 6;
      return { pass, detail: { topCount: snap.topCount, type: t?.type, children: t?.children } };
    },
  },

  // ---- twist (Effect ▸ Distort & Transform ▸ Twist, via the real menu) ----
  {
    g: "build", id: "twist",
    fn: async (s) => {
      // a square (rim) + an interior anchor at (75,75) = r 0.5 about centre (50,50).
      // Twist spins the interior point (keeping its radius) and pins the rim corner.
      const [pid] = await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:true,anchors:[A(0,0),A(100,0),A(100,100),A(0,100),A(75,75)]},{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(p);return[p.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Effect", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Distort & Transform" }).first().hover();
      await s.page.waitForTimeout(200);
      const fx = s.page.locator(".monet-menu-label", { hasText: /^Twist$/ }).first();
      await fx.hover();
      await s.page.waitForTimeout(80);
      await fx.click();
      await s.page.waitForTimeout(120);
      const res = await s.page.evaluate((id) => {
        const g = window.__Q.getItem(window.__artisanStore.getState().doc, id).geometry;
        const c = g.anchors[4].point; // the interior point
        return {
          interiorMoved: Math.abs(c.x - 75) > 0.5 || Math.abs(c.y - 75) > 0.5,
          radius: Math.hypot(c.x - 50, c.y - 50),
          corner: g.anchors[0].point, // rim corner
        };
      }, pid);
      const pass = res.interiorMoved && Math.abs(res.radius - Math.hypot(25, 25)) < 0.5 && Math.abs(res.corner.x) < 0.5 && Math.abs(res.corner.y) < 0.5;
      return { pass, detail: res };
    },
  },

  // ---- free distort (Effect ▸ Distort & Transform ▸ Free Distort, via the real menu) ----
  {
    g: "build", id: "free-distort",
    fn: async (s) => {
      // a 100×100 square (bbox [150,150]→[250,250]). The default perspective quad
      // pulls the TOP corners in 20% each side and pins the BOTTOM corners.
      const [pid] = await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(p);return[p.id];`,
      );
      await menuSubmenu(s, "Effect", "Distort & Transform", "Free Distort");
      const res = await s.page.evaluate((id) => {
        const g = window.__Q.getItem(window.__artisanStore.getState().doc, id).geometry;
        return { tl: g.anchors[0].point, tr: g.anchors[1].point, br: g.anchors[2].point, bl: g.anchors[3].point };
      }, pid);
      const near = (p, x, y) => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5;
      const pass = near(res.tl, 170, 150) && near(res.tr, 230, 150) && near(res.br, 250, 250) && near(res.bl, 150, 250);
      return { pass, detail: res };
    },
  },

  // ---- warp arc (Effect ▸ Warp ▸ Arc, via the real menu) ----
  {
    g: "build", id: "warp-arc",
    fn: async (s) => {
      // a diamond (bbox {200,200}×{200,200}, cx=300, h/2=100). Arc bend 0.5 ⇒ the
      // top & bottom centre vertices (u=0) shift +50; the side vertices (u=±1) pin.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:true,anchors:[A(300,200),A(400,300),A(300,400),A(200,300)]},{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(p);return[p.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Effect", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Warp" }).first().hover();
      await s.page.waitForTimeout(200);
      const arc = s.page.locator(".monet-menu-label", { hasText: /^Arc$/ }).first();
      await arc.hover();
      await s.page.waitForTimeout(80);
      await arc.click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchorsHash === "300,250|400,300|300,450|200,300";
      return { pass, detail: { topCount: snap.topCount, type: d?.type, anchorsHash: d?.anchorsHash } };
    },
  },

  // ---- warp bulge (Effect ▸ Warp ▸ Bulge, via the real menu) ----
  {
    g: "build", id: "warp-bulge",
    fn: async (s) => {
      // same diamond (bbox 200×200, cy=300). Bulge bend 0.5 scales the height
      // about the centre by 1+0.5·(1−u²): the centre vertices (u=0) swell ±150,
      // the side vertices (u=±1) pin.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:true,anchors:[A(300,200),A(400,300),A(300,400),A(200,300)]},{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(p);return[p.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Effect", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Warp" }).first().hover();
      await s.page.waitForTimeout(200);
      const bulge = s.page.locator(".monet-menu-label", { hasText: /^Bulge$/ }).first();
      await bulge.hover();
      await s.page.waitForTimeout(80);
      await bulge.click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchorsHash === "300,150|400,300|300,450|200,300";
      return { pass, detail: { topCount: snap.topCount, type: d?.type, anchorsHash: d?.anchorsHash } };
    },
  },

  // ---- warp wave (Effect ▸ Warp ▸ Wave, via the real menu) ----
  {
    g: "build", id: "warp-wave",
    fn: async (s) => {
      // a hexagon (bbox {200,200}×{200,200}, width 200, h/2=100) sampling both a
      // wave trough (s=0.375, x=275 ⇒ −50) and a crest (s=0.625, x=325 ⇒ +50);
      // Wave bend 0.5 ⇒ dy = 50·sin(4π·s), uniform top-to-bottom.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:true,anchors:[A(200,300),A(275,200),A(325,200),A(400,300),A(325,400),A(275,400)]},{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(p);return[p.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Effect", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Warp" }).first().hover();
      await s.page.waitForTimeout(200);
      const wave = s.page.locator(".monet-menu-label", { hasText: /^Wave$/ }).first();
      await wave.hover();
      await s.page.waitForTimeout(80);
      await wave.click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchorsHash === "200,300|275,150|325,250|400,300|325,450|275,350";
      return { pass, detail: { topCount: snap.topCount, type: d?.type, anchorsHash: d?.anchorsHash } };
    },
  },

  // ---- warp rise (Effect ▸ Warp ▸ Rise, via the real menu) ----
  {
    g: "build", id: "warp-rise",
    fn: async (s) => {
      // a diamond (bbox {200,200}×{200,200}, width 200, h/2=100). Rise bend 0.5 ⇒
      // dy = −100·s: the left vertex (s=0) pins, the right vertex (s=1) rises 100,
      // and the two centre vertices (s=0.5) rise 50 — a rising-ramp shear.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:true,anchors:[A(300,200),A(400,300),A(300,400),A(200,300)]},{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(p);return[p.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Effect", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Warp" }).first().hover();
      await s.page.waitForTimeout(200);
      const rise = s.page.locator(".monet-menu-label", { hasText: /^Rise$/ }).first();
      await rise.hover();
      await s.page.waitForTimeout(80);
      await rise.click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchorsHash === "300,150|400,200|300,350|200,300";
      return { pass, detail: { topCount: snap.topCount, type: d?.type, anchorsHash: d?.anchorsHash } };
    },
  },

  // ---- add arrowheads (Effect ▸ Add Arrowheads ▸ End, via the real menu) ----
  {
    g: "build", id: "add-arrowheads",
    fn: async (s) => {
      // a horizontal stroked open line (width 12). "End" bakes a filled triangle
      // arrowhead onto the end, wrapping line + head in an "Arrowheads" group.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:false,anchors:[A(200,300),A(400,300)]},{stroke:{...E.defaultStroke(E.solid(E.rgba(220,40,40))),width:12}});doc.layers[0].items.push(p);return[p.id];`,
      );
      await menuSubmenu4(s, "Effect", "Add Arrowheads", "Triangle", "End");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const kids = t ? await groupKids(s, t.id) : null;
      // Read the head child's actual anchors so the e2e is geometry-aware, not just
      // structural: end tip (400,300), base 48 back ±24 ⇒ (352,324),(352,276).
      const headHash = t
        ? await s.page.evaluate((id) => {
            const g = window.__Q.getItem(window.__artisanStore.getState().doc, id);
            const h = g && g.type === "group" && g.children[1];
            return h && h.type === "path" ? h.geometry.anchors.map((a) => `${a.point.x},${a.point.y}`).join("|") : null;
          }, t.id)
        : null;
      const pass =
        snap.topCount === 1 &&
        t?.type === "group" &&
        Array.isArray(kids) &&
        kids.length === 2 &&
        kids[0].type === "path" && kids[0].closed === false && kids[0].stroke === "solid" && // original line
        kids[1].type === "path" && kids[1].closed === true && kids[1].fill === "solid" && kids[1].stroke === "none" && // head
        headHash === "400,300|352,324|352,276"; // head points outward, correct size
      return { pass, detail: { topCount: snap.topCount, type: t?.type, kids, headHash } };
    },
  },
  {
    g: "build", id: "add-arrowheads-square",
    fn: async (s) => {
      // Same line; Effect ▸ Add Arrowheads ▸ Square ▸ End bakes a filled SQUARE
      // head centred on the end tip (400,300): half-side HALF·w = 24 ⇒ a 48×48 box.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:false,anchors:[A(200,300),A(400,300)]},{stroke:{...E.defaultStroke(E.solid(E.rgba(220,40,40))),width:12}});doc.layers[0].items.push(p);return[p.id];`,
      );
      await menuSubmenu4(s, "Effect", "Add Arrowheads", "Square", "End");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const kids = t ? await groupKids(s, t.id) : null;
      const headHash = t
        ? await s.page.evaluate((id) => {
            const g = window.__Q.getItem(window.__artisanStore.getState().doc, id);
            const h = g && g.type === "group" && g.children[1];
            return h && h.type === "path" ? h.geometry.anchors.map((a) => `${a.point.x},${a.point.y}`).join("|") : null;
          }, t.id)
        : null;
      const pass =
        snap.topCount === 1 &&
        t?.type === "group" &&
        Array.isArray(kids) &&
        kids.length === 2 &&
        kids[1].type === "path" && kids[1].closed === true && kids[1].fill === "solid" && kids[1].stroke === "none" &&
        headHash === "424,324|376,324|376,276|424,276"; // 4-corner square around the tip
      return { pass, detail: { topCount: snap.topCount, type: t?.type, kids, headHash } };
    },
  },
  {
    g: "build", id: "add-arrowheads-bar",
    fn: async (s) => {
      // Effect ▸ Add Arrowheads ▸ Bar ▸ End bakes a thin perpendicular tick centred
      // on the tip (400,300): half-thickness BAR_HALF·w = 6 along the line, half-length
      // HALF·w = 24 across ⇒ a 12×48 bar.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:false,anchors:[A(200,300),A(400,300)]},{stroke:{...E.defaultStroke(E.solid(E.rgba(220,40,40))),width:12}});doc.layers[0].items.push(p);return[p.id];`,
      );
      await menuSubmenu4(s, "Effect", "Add Arrowheads", "Bar", "End");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const kids = t ? await groupKids(s, t.id) : null;
      const headHash = t
        ? await s.page.evaluate((id) => {
            const g = window.__Q.getItem(window.__artisanStore.getState().doc, id);
            const h = g && g.type === "group" && g.children[1];
            return h && h.type === "path" ? h.geometry.anchors.map((a) => `${a.point.x},${a.point.y}`).join("|") : null;
          }, t.id)
        : null;
      const pass =
        snap.topCount === 1 &&
        t?.type === "group" &&
        Array.isArray(kids) &&
        kids.length === 2 &&
        kids[1].type === "path" && kids[1].closed === true && kids[1].fill === "solid" && kids[1].stroke === "none" &&
        headHash === "406,324|394,324|394,276|406,276"; // thin tick across the tip
      return { pass, detail: { topCount: snap.topCount, type: t?.type, kids, headHash } };
    },
  },
  {
    g: "build", id: "add-arrowheads-circle",
    fn: async (s) => {
      // Effect ▸ Add Arrowheads ▸ Circle ▸ End bakes a round dot centred on the
      // end tip (400,300): radius HALF·w = 24, four cardinal anchors + curved
      // (non-zero) bezier handles, so it renders round rather than as a diamond.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:false,anchors:[A(200,300),A(400,300)]},{stroke:{...E.defaultStroke(E.solid(E.rgba(220,40,40))),width:12}});doc.layers[0].items.push(p);return[p.id];`,
      );
      await menuSubmenu4(s, "Effect", "Add Arrowheads", "Circle", "End");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const kids = t ? await groupKids(s, t.id) : null;
      const head = t
        ? await s.page.evaluate((id) => {
            const g = window.__Q.getItem(window.__artisanStore.getState().doc, id);
            const h = g && g.type === "group" && g.children[1];
            if (!h || h.type !== "path") return null;
            const a = h.geometry.anchors;
            return {
              hash: a.map((an) => `${an.point.x},${an.point.y}`).join("|"),
              count: a.length,
              curved: a.some((an) => an.handleIn.x || an.handleIn.y || an.handleOut.x || an.handleOut.y),
            };
          }, t.id)
        : null;
      const pass =
        snap.topCount === 1 &&
        t?.type === "group" &&
        Array.isArray(kids) &&
        kids.length === 2 &&
        kids[1].type === "path" && kids[1].closed === true && kids[1].fill === "solid" && kids[1].stroke === "none" &&
        head?.count === 4 &&
        head.curved === true &&
        head.hash === "424,300|400,324|376,300|400,276"; // E / S / W / N around the tip
      return { pass, detail: { topCount: snap.topCount, type: t?.type, kids, head } };
    },
  },

  // ---- paste on all artboards (Edit ▸ Copy → Paste on All Artboards) ----
  {
    g: "build", id: "paste-all-artboards",
    fn: async (s) => {
      // two artboards (AB1 at 0,0; AB2 at +1000) with a rect at (100,100) on AB1.
      // Copy then Paste on All Artboards drops a copy at the same relative spot on
      // each board ⇒ 3 items total, copies at x=100 (AB1) and x=1100 (AB2).
      await s.fixture(
        `doc.artboards.push(E.makeArtboard("AB2",1000,0,900,700));const r=E.makeRect(100,100,80,80,0,0,{fill:E.solid(E.rgba(80,140,220))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await topMenu(s, "Edit", "Copy");
      await topMenu(s, "Edit", "Paste on All Artboards");
      const res = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const total = st.doc.layers.reduce((n, l) => n + l.items.length, 0);
        const xs = st.selection
          .map((id) => window.__Q.selectionBounds(st.doc, [id]))
          .filter(Boolean)
          .map((b) => Math.round(b.x))
          .sort((a, b) => a - b);
        return { total, xs };
      });
      const pass = res.total === 3 && res.xs.length === 2 && res.xs[0] === 100 && res.xs[1] === 1100;
      return { pass, detail: res };
    },
  },

  // ---- transform panel rotate field (Properties ▸ ∠) ----
  {
    g: "build", id: "transform-panel-rotate",
    fn: async (s) => {
      // a selected rect; typing 45 into the Transform panel's ∠ (rotate) field
      // rotates it to 45° (its transform's atan2(b,a)).
      const [rid] = await s.fixture(
        `const r=E.makeRect(200,200,120,80,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await openTab(s, "Properties");
      const field = s.page.locator('[data-transform-prop="rotate"] input').first();
      await field.fill("45");
      await field.press("Enter");
      await s.page.waitForTimeout(120);
      const rot = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        if (!it) return null;
        const m = it.transform;
        return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI);
      }, rid);
      return { pass: rot === 45, detail: { rot } };
    },
  },

  // ---- layers panel CRUD (New / Duplicate / Delete buttons) ----
  {
    g: "build", id: "layers-crud",
    fn: async (s) => {
      await s.fixture(`const r=E.makeRect(200,200,80,80,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(r);return[r.id];`);
      await openTab(s, "Layers");
      const count = () => s.page.evaluate(() => window.__artisanStore.getState().doc.layers.length);
      const start = await count();
      await s.page.locator('[data-layer-action="new"]').first().click();
      await s.page.waitForTimeout(80);
      const afterNew = await count();
      await s.page.locator('[data-layer-action="duplicate"]').first().click();
      await s.page.waitForTimeout(80);
      const afterDup = await count();
      await s.page.locator('[data-layer-action="delete"]').first().click();
      await s.page.waitForTimeout(80);
      const afterDel = await count();
      const pass = start === 1 && afterNew === 2 && afterDup === 3 && afterDel === 2;
      return { pass, detail: { start, afterNew, afterDup, afterDel } };
    },
  },

  // ---- reverse layer order (Layers panel ▸ Reverse button) ----
  {
    g: "build", id: "layers-reverse",
    fn: async (s) => {
      await s.fixture(`doc.layers=[E.makeLayer("A"),E.makeLayer("B"),E.makeLayer("C")];return[];`);
      await openTab(s, "Layers");
      const order = () => s.page.evaluate(() => window.__artisanStore.getState().doc.layers.map((l) => l.name));
      const before = await order();
      await s.page.locator('[data-layer-action="reverse"]').first().click();
      await s.page.waitForTimeout(80);
      const after = await order();
      const pass = before.length === 3 && JSON.stringify(after) === JSON.stringify([...before].reverse());
      return { pass, detail: { before, after } };
    },
  },

  // ---- collect in new layer (Layers panel ▸ Collect button) ----
  {
    g: "build", id: "layers-collect",
    fn: async (s) => {
      // two rects on layer 0, both selected → Collect in New Layer moves them into
      // a fresh top layer, emptying layer 0.
      await s.fixture(
        `const a=E.makeRect(200,200,60,60,0,0,{fill:E.solid(E.rgba(220,80,80))});` +
          `const b=E.makeRect(300,200,60,60,0,0,{fill:E.solid(E.rgba(80,120,220))});` +
          `doc.layers[0].items.push(a,b);return[a.id,b.id];`,
      );
      await openTab(s, "Layers");
      const stat = () =>
        s.page.evaluate(() => {
          const ls = window.__artisanStore.getState().doc.layers;
          return { n: ls.length, top: ls[ls.length - 1].items.length, bottom: ls[0].items.length };
        });
      const before = await stat();
      await s.page.locator('[data-layer-action="collect"]').first().click();
      await s.page.waitForTimeout(80);
      const after = await stat();
      const pass = before.n === 1 && before.bottom === 2 && after.n === 2 && after.top === 2 && after.bottom === 0;
      return { pass, detail: { before, after } };
    },
  },

  // ---- flatten artwork (Layers panel ▸ Flatten button) ----
  {
    g: "build", id: "layers-flatten",
    fn: async (s) => {
      // two layers, one item each; Flatten Artwork collapses them into a single
      // layer keeping both items.
      await s.fixture(
        `const a=E.makeRect(150,150,80,80,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(a);const L=E.makeLayer("Layer 2");const b=E.makeRect(300,150,80,80,0,0,{fill:E.solid(E.rgba(220,120,120))});L.items.push(b);doc.layers.push(L);return[a.id];`,
      );
      await openTab(s, "Layers");
      const stat = () => s.page.evaluate(() => {
        const d = window.__artisanStore.getState().doc;
        return { layers: d.layers.length, items: d.layers.reduce((n, l) => n + l.items.length, 0) };
      });
      const before = await stat();
      await s.page.locator('[data-layer-action="flatten"]').first().click();
      await s.page.waitForTimeout(80);
      const after = await stat();
      const pass = before.layers === 2 && before.items === 2 && after.layers === 1 && after.items === 2;
      return { pass, detail: { before, after } };
    },
  },

  // ---- release to layers (Layers panel ▸ Release to Layers button) ----
  {
    g: "build", id: "release-to-layers",
    fn: async (s) => {
      // one layer with three rects; Release to Layers distributes each onto its
      // own new layer (source kept, emptied) → 4 layers, items split 0/1/1/1.
      await s.fixture(
        `const r=(x)=>E.makeRect(x,150,60,60,0,0,{fill:E.solid(E.rgba(120,160,220))});` +
          `doc.layers[0].items.push(r(80),r(200),r(320));return[];`,
      );
      await openTab(s, "Layers");
      const counts = () => s.page.evaluate(() => window.__artisanStore.getState().doc.layers.map((l) => l.items.length));
      const before = await counts();
      await s.page.locator('[data-layer-action="release"]').first().click();
      await s.page.waitForTimeout(80);
      const after = await counts();
      // before: [3]; after: [0,1,1,1] (source emptied + one item per new layer)
      const pass = JSON.stringify(before) === JSON.stringify([3]) && JSON.stringify(after) === JSON.stringify([0, 1, 1, 1]);
      return { pass, detail: { before, after } };
    },
  },
  {
    // Template layer (Layers panel ▸ Template button): toggles the active layer's
    // template flag on (dimmed, non-printing) then off via the real button.
    g: "build", id: "layers-template",
    fn: async (s) => {
      await s.fixture(
        `const a=E.makeRect(140,150,80,80,0,0,{fill:E.solid(E.rgba(120,160,220))});` +
          `const b=E.makeRect(260,150,80,80,0,0,{fill:E.solid(E.rgba(220,120,120))});` +
          `doc.layers=[E.makeLayer("Art",[a]),E.makeLayer("Ref",[b])];return[];`,
      );
      await openTab(s, "Layers");
      const tmpl = () => s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const active = st.doc.layers.find((l) => l.id === st.activeLayerId);
        return active ? active.template : null;
      });
      const before = await tmpl();
      await s.page.locator('[data-layer-action="template"]').click();
      await s.page.waitForTimeout(80);
      const after = await tmpl();
      await s.page.locator('[data-layer-action="template"]').click(); // toggle back off
      await s.page.waitForTimeout(80);
      const back = await tmpl();
      const pass = before === false && after === true && back === false;
      return { pass, detail: { before, after, back } };
    },
  },

  // ---- send to current layer (Object ▸ Arrange ▸ Send to Current Layer) ----
  {
    g: "build", id: "send-to-current-layer",
    fn: async (s) => {
      // a rect on Layer 1 (bottom); a second empty Layer 2 is the active layer
      // (fixture makes the last-added layer active). The command moves the rect up.
      const [rid] = await s.fixture(
        `const a=E.makeRect(200,200,80,80,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(a);doc.layers.push(E.makeLayer("Layer 2"));return[a.id];`,
      );
      await objectSubmenu(s, "Arrange", "Send to Current Layer");
      const res = await s.page.evaluate((id) => {
        const ls = window.__artisanStore.getState().doc.layers;
        return { bottom: ls[0].items.length, top: ls[1].items.map((i) => i.id), sel: window.__artisanStore.getState().selection };
      }, rid);
      const pass = res.bottom === 0 && res.top.length === 1 && res.top[0] === rid && res.sel[0] === rid;
      return { pass, detail: res };
    },
  },

  // ---- hide edges (View ▸ Hide Edges toggles the selection chrome) ----
  {
    g: "build", id: "hide-edges",
    fn: async (s) => {
      // a selected rect under the selection tool shows bbox handles; Hide Edges
      // removes them (and the outline) without deselecting, and restores them.
      await s.fixture(`const a=E.makeRect(200,200,120,90,0,0,{fill:E.solid(E.rgba(120,160,220))});doc.layers[0].items.push(a);return[a.id];`);
      await s.setTool("selection");
      await s.page.waitForTimeout(80);
      // Count BOTH gates: the bbox handles and the dashed selection outline.
      const chrome = () =>
        s.page.evaluate(() => ({
          handles: document.querySelectorAll(".artisan-handles").length,
          outline: document.querySelectorAll(".artisan-sel-outline").length,
        }));
      const before = await chrome();
      await topMenu(s, "View", "Hide Edges"); // toggle ON
      await s.page.waitForTimeout(80);
      const hidden = await chrome();
      const stillSelected = await s.page.evaluate(() => window.__artisanStore.getState().selection.length);
      await topMenu(s, "View", "Hide Edges"); // toggle OFF
      await s.page.waitForTimeout(80);
      const restored = await chrome();
      const pass =
        before.handles >= 1 && before.outline >= 1 &&
        hidden.handles === 0 && hidden.outline === 0 && // both gates fire
        stillSelected === 1 &&
        restored.handles >= 1 && restored.outline >= 1;
      return { pass, detail: { before, hidden, stillSelected, restored } };
    },
  },

  // ---- remove anchor points (Object ▸ Path ▸ Remove Anchor Points) ----
  {
    g: "build", id: "remove-anchor-points",
    fn: async (s) => {
      // a 5-anchor open zig-zag; select the middle anchor (index 2) and remove it
      // via the menu ⇒ a 4-anchor path that stays connected.
      const [rid] = await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:false,anchors:[A(200,300),A(250,250),A(300,300),A(350,250),A(400,300)]});doc.layers[0].items.push(p);return[p.id];`,
      );
      await s.page.evaluate((id) => window.__artisanStore.setAnchorSelection({ [id]: [2] }), rid);
      await s.page.waitForTimeout(80);
      await objectSubmenu(s, "Path", "Remove Anchor Points");
      const xs = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return it && it.type === "path" ? it.geometry.anchors.map((a) => a.point.x) : null;
      }, rid);
      // index 2 (x=300) removed, neighbours bridged ⇒ the right anchors survive.
      const pass = Array.isArray(xs) && xs.join(",") === "200,250,350,400";
      return { pass, detail: { xs } };
    },
  },

  // ---- reselect (Select ▸ Same ▸ Fill Color, then Select ▸ Reselect) ----
  {
    g: "build", id: "reselect",
    fn: async (s) => {
      // 2 red + 2 blue rects. Select Same Fill on a red selects both reds and
      // remembers the query; switching the basis to a blue and Reselect re-runs it.
      const ids = await s.fixture(
        `const R=E.solid(E.rgba(220,0,0));const B=E.solid(E.rgba(0,0,220));const r1=E.makeRect(150,150,40,40,0,0,{fill:R});const r2=E.makeRect(220,150,40,40,0,0,{fill:R});const b1=E.makeRect(290,150,40,40,0,0,{fill:B});const b2=E.makeRect(360,150,40,40,0,0,{fill:B});doc.layers[0].items.push(r1,r2,b1,b2);return[r1.id,r2.id,b1.id,b2.id];`,
      );
      const [r1, , b1, b2] = ids;
      await s.page.evaluate((id) => window.__artisanStore.setSelection([id]), r1);
      await menuSubmenu(s, "Select", "Same", "Fill Color"); // selects both reds, remembers {same,fill}
      await s.page.evaluate((id) => window.__artisanStore.setSelection([id]), b1); // new basis: a blue
      await topMenu(s, "Select", "Reselect"); // re-runs Same Fill on the blue
      const sel = await s.page.evaluate(() => window.__artisanStore.getState().selection);
      const pass = sel.length === 2 && sel.includes(b1) && sel.includes(b2);
      return { pass, detail: { sel } };
    },
  },

  // ---- swatches panel New / Delete buttons ----
  {
    g: "build", id: "swatches-crud",
    fn: async (s) => {
      await s.fixture(`return[];`); // empty doc → default swatch library
      await openTab(s, "Swatches");
      // a distinctive active fill so the new swatch is identifiable end-to-end.
      // The Swatches "New" button saves the ACTIVE paint, and `activePaint` is
      // ephemeral editor state that survives a doc swap — an earlier scene
      // (gradient-stroke) leaves it on "stroke", so this must claim it back or
      // the new swatch is the default black stroke. Siblings all do the same.
      await s.page.evaluate(() => {
        window.__artisanStore.setActivePaint("fill");
        window.__artisanStore.setFill(window.__engine.solid(window.__engine.rgba(7, 11, 13)));
      });
      await s.page.waitForTimeout(50);
      const colors = () =>
        s.page.evaluate(() =>
          window.__artisanStore.getState().doc.swatches.map((sw) => (sw.type === "solid" ? `${sw.color.r},${sw.color.g},${sw.color.b}` : sw.type)),
        );
      const start = (await colors()).length;
      await s.page.locator('[data-swatch-action="new"]').first().click(); // save the active colour
      await s.page.waitForTimeout(80);
      const afterNew = await colors();
      await s.page.locator(".artisan-swatch-cell").last().click(); // select the new swatch
      await s.page.waitForTimeout(50);
      await s.page.locator('[data-swatch-action="delete"]').first().click();
      await s.page.waitForTimeout(80);
      const afterDel = await colors();
      const pass =
        afterNew.length === start + 1 && afterNew.includes("7,11,13") && // the unique swatch was added
        afterDel.length === start && !afterDel.includes("7,11,13"); // and exactly that one was removed
      return { pass, detail: { start, afterNewLen: afterNew.length, afterDelLen: afterDel.length, hadUnique: afterNew.includes("7,11,13"), goneUnique: !afterDel.includes("7,11,13") } };
    },
  },

  // ---- swatches panel Sort by Hue button ----
  {
    g: "build", id: "swatches-sort-hue",
    fn: async (s) => {
      // hue-scrambled swatches [blue, red, green] → Sort by Hue → red, green, blue.
      await s.fixture(`doc.swatches=[E.solid(E.rgba(0,0,255)),E.solid(E.rgba(255,0,0)),E.solid(E.rgba(0,255,0))];return[];`);
      await openTab(s, "Swatches");
      const colors = () =>
        s.page.evaluate(() =>
          window.__artisanStore.getState().doc.swatches.map((sw) => (sw.type === "solid" ? `${sw.color.r},${sw.color.g},${sw.color.b}` : sw.type)),
        );
      const before = await colors();
      await s.page.locator('[data-swatch-action="sort-hue"]').first().click();
      await s.page.waitForTimeout(80);
      const after = await colors();
      const pass =
        JSON.stringify(before) === JSON.stringify(["0,0,255", "255,0,0", "0,255,0"]) &&
        JSON.stringify(after) === JSON.stringify(["255,0,0", "0,255,0", "0,0,255"]);
      return { pass, detail: { before, after } };
    },
  },

  // ---- swatches panel Delete Unused button (Illustrator "Select All Unused") ----
  {
    g: "build", id: "swatches-delete-unused",
    fn: async (s) => {
      // one rect filled rgb(123,45,67); swatches = [that used colour, an unused one].
      await s.fixture(
        `const used=E.solid(E.rgba(123,45,67));const r=E.makeRect(150,150,120,90,0,0,{fill:used});` +
          `doc.layers[0].items.push(r);doc.swatches=[used,E.solid(E.rgba(9,8,7))];return[];`,
      );
      await openTab(s, "Swatches");
      const colors = () =>
        s.page.evaluate(() =>
          window.__artisanStore.getState().doc.swatches.map((sw) => (sw.type === "solid" ? `${sw.color.r},${sw.color.g},${sw.color.b}` : sw.type)),
        );
      const before = await colors();
      await s.page.locator('[data-swatch-action="delete-unused"]').first().click();
      await s.page.waitForTimeout(80);
      const after = await colors();
      const pass = before.length === 2 && after.length === 1 && after.includes("123,45,67") && !after.includes("9,8,7");
      return { pass, detail: { before, after } };
    },
  },

  // ---- width profile (Stroke panel ▸ Profile dropdown) ----
  {
    g: "build", id: "width-profile",
    fn: async (s) => {
      // a 4-anchor stroked path; picking Width Profile 1 sets a non-uniform
      // per-anchor widthProfile (the renderer draws a tapering ribbon); Uniform clears it.
      const [rid] = await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:false,anchors:[A(150,300),A(250,250),A(350,300),A(450,250)]},{stroke:{...E.defaultStroke(E.solid(E.rgba(40,40,40))),width:14}});doc.layers[0].items.push(p);return[p.id];`,
      );
      await openTab(s, "Stroke");
      const wp = () =>
        s.page.evaluate((id) => {
          const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
          return it && it.type === "path" ? (it.stroke.widthProfile ?? null) : null;
        }, rid);
      await s.chooseOption("[data-stroke-profile]", "profile-1");
      await s.page.waitForTimeout(80);
      const applied = await wp();
      await s.chooseOption("[data-stroke-profile]", "uniform");
      await s.page.waitForTimeout(80);
      const cleared = await wp();
      const pass = Array.isArray(applied) && applied.length === 4 && applied.some((w) => w !== 1) && cleared === null;
      return { pass, detail: { applied, cleared } };
    },
  },

  // ---- drawing modes (Draw Behind / Draw Normal toolbar cluster) ----
  {
    g: "build", id: "draw-behind",
    fn: async (s) => {
      // an existing rect; with Draw Behind the new rect lands at the BACK, with
      // Draw Normal the next one lands on top.
      const [existing] = await s.fixture(
        `const r=E.makeRect(200,200,140,140,0,0,{fill:E.solid(E.rgba(200,120,120))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await s.setTool("rect");
      await s.page.locator('[data-draw-mode="behind"]').click();
      await s.page.waitForTimeout(50);
      await s.drag({ x: 240, y: 240 }, { x: 360, y: 360 });
      await s.page.waitForTimeout(80);
      const behind = await s.page.evaluate((id) => {
        const it = window.__artisanStore.getState().doc.layers[0].items;
        return { count: it.length, backIsExisting: it[0].id === id, topIsExisting: it[it.length - 1].id === id };
      }, existing);
      await s.page.locator('[data-draw-mode="normal"]').click();
      await s.setTool("rect"); // tools auto-switch to selection after a draw
      await s.page.waitForTimeout(50);
      await s.drag({ x: 260, y: 260 }, { x: 320, y: 320 });
      await s.page.waitForTimeout(80);
      const normal = await s.page.evaluate((id) => {
        const it = window.__artisanStore.getState().doc.layers[0].items;
        return { count: it.length, topIsExisting: it[it.length - 1].id === id };
      }, existing);
      const pass =
        behind.count === 2 && !behind.backIsExisting && behind.topIsExisting && // new rect went behind the existing
        normal.count === 3 && !normal.topIsExisting; // next rect went on top
      return { pass, detail: { behind, normal } };
    },
  },

  // ---- select object (Select ▸ Object ▸ Text Objects, via the real menu) ----
  {
    g: "build", id: "select-object",
    fn: async (s) => {
      // a text + a rect, nothing selected; Select ▸ Object ▸ Text Objects picks
      // only the text object.
      await s.fixture(
        `const t=E.makeText("hello",160,200);const r=E.makeRect(260,160,80,80,0,0,{fill:E.solid(E.rgba(80,140,220))});` +
          `doc.layers[0].items.push(t,r);return[];`,
      );
      await menuSubmenu(s, "Select", /^Object$/, "Text Objects");
      const snap = await s.snapshot();
      const sel = snap.selection;
      const selTypes = sel.map((id) => snap.items.find((it) => it.id === id)?.type);
      const pass = sel.length === 1 && selTypes[0] === "text";
      return { pass, detail: { selection: sel.length, types: selTypes } };
    },
  },

  // ---- reverse path (Object ▸ Path ▸ Reverse Path Direction, via the real menu) ----
  {
    g: "build", id: "reverse-path",
    fn: async (s) => {
      // an open polyline (150,200)(250,150)(350,200) → reversed starts at (350,200).
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const p=E.makePath({closed:false,anchors:[A(150,200),A(250,150),A(350,200)]},{fill:E.noPaint(),stroke:{...E.defaultStroke(E.solid(E.BLACK)),width:3}});` +
          `doc.layers[0].items.push(p);return[p.id];`,
      );
      await objectSubmenu(s, "Path", "Reverse Path Direction");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.type === "path" && d?.anchorsHash === "350,200|250,150|150,200";
      return { pass, detail: { topCount: snap.topCount, anchorsHash: d?.anchorsHash } };
    },
  },

  // ---- smart punctuation (Type ▸ Smart Punctuation, via the real menu) ----
  {
    g: "build", id: "smart-punctuation",
    fn: async (s) => {
      // a text object with straight quotes → curly typographic quotes.
      await s.fixture(
        `const t=E.makeText('say "hi"',180,220);doc.layers[0].items.push(t);return[t.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Type", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Smart Punctuation" }).first().click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.type === "text" && d?.text === "say “hi”";
      return { pass, detail: { topCount: snap.topCount, type: d?.type, text: d?.text } };
    },
  },

  // ---- change case (Type ▸ Change Case ▸ UPPERCASE, via the real menu) ----
  {
    g: "build", id: "change-case",
    fn: async (s) => {
      // a text object "hello world" → Change Case ▸ UPPERCASE.
      await s.fixture(
        `const t=E.makeText("hello world",180,220);doc.layers[0].items.push(t);return[t.id];`,
      );
      await menuSubmenu(s, "Type", "Change Case", "UPPERCASE");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const pass = snap.topCount === 1 && d?.type === "text" && d?.text === "HELLO WORLD";
      return { pass, detail: { topCount: snap.topCount, type: d?.type, text: d?.text } };
    },
  },

  // ---- convert text type (Type ▸ Convert to Area / Point Type, via the real menu) ----
  {
    g: "build", id: "convert-text-type",
    fn: async (s) => {
      const [tid] = await s.fixture(`const t=E.makeText("Hello world",180,220);doc.layers[0].items.push(t);return[t.id];`); // point text
      const box = () => s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return { w: it.boxWidth ?? null, h: it.boxHeight ?? null };
      }, tid);
      const before = await box(); // point → no box
      await s.page.getByRole("menuitem", { name: "Type", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Convert to Area Type" }).first().click();
      await s.page.waitForTimeout(120);
      const area = await box(); // boxed
      await s.page.getByRole("menuitem", { name: "Type", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Convert to Point Type" }).first().click();
      await s.page.waitForTimeout(120);
      const point = await box(); // box removed
      const pass = before.w === null && area.w !== null && area.w > 0 && area.h !== null && point.w === null && point.h === null;
      return { pass, detail: { before, area, point } };
    },
  },

  // ---- edit colors (Edit ▸ Edit Colors ▸ Invert Colors, via the real menu) ----
  {
    g: "build", id: "edit-colors",
    fn: async (s) => {
      // a rect with fill rgb(100,150,200) → Invert Colors → rgb(155,105,55).
      await s.fixture(
        `const r=E.makeRect(150,150,120,90,0,0,{fill:E.solid(E.rgba(100,150,200))});doc.layers[0].items.push(r);return[r.id];`,
      );
      await menuSubmenu(s, "Edit", "Edit Colors", "Invert Colors");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const c = d?.fillColor;
      const inverted = !!c && c.r === 155 && c.g === 105 && c.b === 55;
      const pass = snap.topCount === 1 && d?.type === "rect" && inverted;
      return { pass, detail: { topCount: snap.topCount, type: d?.type, fillColor: c } };
    },
  },

  // ---- convert to shape (Object ▸ Convert to Shape ▸ Ellipse, via the real menu) ----
  {
    g: "build", id: "convert-shape",
    fn: async (s) => {
      // a 100×100 square path → Convert to Shape ▸ Ellipse → an ellipse at the
      // same bounds, replacing the path.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(80,140,220))});` +
          `doc.layers[0].items.push(sq);return[sq.id];`,
      );
      await objectSubmenu(s, "Convert to Shape", "Ellipse");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const b = d?.bounds;
      const same = !!b && b.x === 150 && b.y === 150 && b.width === 100 && b.height === 100;
      const pass = snap.topCount === 1 && d?.type === "ellipse" && same;
      return { pass, detail: { topCount: snap.topCount, type: d?.type, bounds: b } };
    },
  },
  {
    g: "build", id: "convert-shape-effect",
    fn: async (s) => {
      // same square, but via Effect ▸ Convert to Shape ▸ Ellipse (Illustrator's home
      // for the live Convert to Shape) — identical result: an ellipse at the bounds.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(80,140,220))});` +
          `doc.layers[0].items.push(sq);return[sq.id];`,
      );
      await menuSubmenu(s, "Effect", "Convert to Shape", "Ellipse");
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const b = d?.bounds;
      const same = !!b && b.x === 150 && b.y === 150 && b.width === 100 && b.height === 100;
      const pass = snap.topCount === 1 && d?.type === "ellipse" && same;
      return { pass, detail: { topCount: snap.topCount, type: d?.type, bounds: b } };
    },
  },

  // ---- blend (Object ▸ Blend ▸ Make, via the real menu) ----
  {
    g: "build", id: "blend",
    fn: async (s) => {
      // two 40×40 squares (red left, blue right) → Blend ▸ Make wraps them plus
      // the 8 default interpolated steps into one "Blend" group (10 children).
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=(x,c)=>E.makePath({closed:true,anchors:[A(x,150),A(x+40,150),A(x+40,190),A(x,190)]},{fill:E.solid(c)});` +
          `const a=sq(120,E.rgba(220,0,0)),b=sq(360,E.rgba(0,0,220));` +
          `doc.layers[0].items.push(a,b);return[a.id,b.id];`,
      );
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Blend" }).first().hover();
      await s.page.waitForTimeout(200);
      const make = s.page.locator(".monet-menu-label", { hasText: /^Make$/ }).first();
      await make.hover();
      await s.page.waitForTimeout(80);
      await make.click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const t = snap.top[0];
      // one Blend group replaces the two squares; 2 ends + 8 default steps = 10 kids
      const pass = snap.topCount === 1 && t?.type === "group" && t?.name === "Blend" && t?.children === 10;
      return { pass, detail: { topCount: snap.topCount, type: t?.type, name: t?.name, children: t?.children } };
    },
  },
  {
    g: "build", id: "blend-release",
    fn: async (s) => {
      // Build a blend of two squares directly, then Object ▸ Blend ▸ Release →
      // the blend group is gone and the two original key squares are restored.
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=(x,c)=>E.makePath({closed:true,anchors:[A(x,150),A(x+40,150),A(x+40,190),A(x,190)]},{fill:E.solid(c)});` +
          `const a=sq(120,E.rgba(220,0,0)),b=sq(360,E.rgba(0,0,220));doc.layers[0].items.push(a,b);` +
          `const gid=E.Ops.Blend.blend(doc,[a.id,b.id],{steps:4});return[gid];`,
      );
      // sanity: one Blend group is selected before release
      const before = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        return { count: st.doc.layers[0].items.length, type: st.doc.layers[0].items[0]?.type };
      });
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Blend" }).first().hover();
      await s.page.waitForTimeout(200);
      const release = s.page.locator(".monet-menu-label", { hasText: /^Release$/ }).first();
      await release.hover();
      await s.page.waitForTimeout(80);
      await release.click();
      await s.page.waitForTimeout(120);
      const after = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        return { items: st.doc.layers[0].items.map((i) => i.type), sel: st.selection.length };
      });
      // before: 1 group; after: 2 non-group paths restored + both selected
      const pass =
        before.count === 1 && before.type === "group" &&
        after.items.length === 2 && after.items.every((t) => t !== "group") && after.sel === 2;
      return { pass, detail: { before, after } };
    },
  },
  {
    g: "build", id: "blend-reverse",
    fn: async (s) => {
      // Build a blend of two squares (4 ordered children), then Object ▸ Blend ▸
      // Reverse Front to Back → the group's child paint order is reversed.
      const [gid] = await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=(x,c)=>E.makePath({closed:true,anchors:[A(x,150),A(x+40,150),A(x+40,190),A(x,190)]},{fill:E.solid(c)});` +
          `const a=sq(120,E.rgba(220,0,0)),b=sq(360,E.rgba(0,0,220));doc.layers[0].items.push(a,b);` +
          `const gid=E.Ops.Blend.blend(doc,[a.id,b.id],{steps:2});return[gid];`,
      );
      const childIds = (id) =>
        s.page.evaluate((g) => {
          const it = window.__Q.getItem(window.__artisanStore.getState().doc, g);
          return it && it.type === "group" ? it.children.map((c) => c.id) : null;
        }, id);
      const before = await childIds(gid);
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Blend" }).first().hover();
      await s.page.waitForTimeout(200);
      const rev = s.page.locator(".monet-menu-label", { hasText: /^Reverse Front to Back$/ }).first();
      await rev.hover();
      await s.page.waitForTimeout(80);
      await rev.click();
      await s.page.waitForTimeout(120);
      const after = await childIds(gid);
      const pass =
        Array.isArray(before) && Array.isArray(after) && before.length === 4 &&
        JSON.stringify(after) === JSON.stringify([...before].reverse());
      return { pass, detail: { before, after } };
    },
  },
  {
    // Build a blend (4 children), then Object ▸ Blend ▸ Blend Options ▸ Specified Steps: 16
    // → the blend is re-spaced to 18 children (2 keys + 16 steps).
    g: "build", id: "blend-options",
    fn: async (s) => {
      const [gid] = await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const sq=(x,c)=>E.makePath({closed:true,anchors:[A(x,150),A(x+40,150),A(x+40,190),A(x,190)]},{fill:E.solid(c)});` +
          `const a=sq(120,E.rgba(220,0,0)),b=sq(360,E.rgba(0,0,220));doc.layers[0].items.push(a,b);` +
          `const gid=E.Ops.Blend.blend(doc,[a.id,b.id],{steps:2});return[gid];`,
      );
      const count = (id) =>
        s.page.evaluate((g) => {
          const it = window.__Q.getItem(window.__artisanStore.getState().doc, g);
          return it && it.type === "group" ? it.children.length : null;
        }, id);
      const before = await count(gid);
      await menuSubmenu4(s, "Object", "Blend", "Blend Options", "Specified Steps: 16");
      const after = await count(gid);
      const pass = before === 4 && after === 18;
      return { pass, detail: { before, after } };
    },
  },

  {
    // Object ▸ Rasterize: a vector rect becomes one embedded PNG image at its bounds.
    g: "build", id: "rasterize",
    fn: async (s) => {
      await s.fixture(FX.rect); // one selected rect at (250,200,220,150)
      await topMenu(s, "Object", "Rasterize");
      // Rasterization renders via canvas asynchronously — wait for the swap.
      await s.page
        .waitForFunction(
          () => {
            const items = window.__artisanStore.getState().doc.layers.flatMap((l) => l.items);
            return items.length === 1 && items[0].type === "image";
          },
          { timeout: 5000 },
        )
        .catch(() => {});
      const info = await s.page.evaluate(() => {
        const items = window.__artisanStore.getState().doc.layers.flatMap((l) => l.items);
        const top = items[items.length - 1];
        return {
          count: items.length,
          type: top?.type,
          png: top?.type === "image" ? top.href.startsWith("data:image/png") : false,
          w: top?.type === "image" ? Math.round(top.width) : null,
          h: top?.type === "image" ? Math.round(top.height) : null,
        };
      });
      const pass = info.count === 1 && info.type === "image" && info.png === true && info.w === 220 && info.h === 150;
      return { pass, detail: info };
    },
  },

  {
    // Graphic Styles panel: save a red object's appearance, then apply it to a blue
    // object via the real panel — the blue object becomes red.
    g: "build", id: "graphic-styles",
    fn: async (s) => {
      await s.fixture(
        `const a=E.makeRect(150,150,80,80,0,0,{fill:E.solid(E.rgba(220,0,0))});` +
          `const b=E.makeRect(300,150,80,80,0,0,{fill:E.solid(E.rgba(0,0,220))});` +
          `doc.layers[0].items.push(a,b);return[a.id,b.id];`,
      );
      const [A, B] = await s.page.evaluate(() => window.__artisanStore.getState().doc.layers[0].items.map((i) => i.id));
      await openTab(s, "Graphic Styles");
      await s.page.evaluate((id) => window.__artisanStore.setSelection([id]), A); // select red
      await s.page.waitForTimeout(50);
      await s.page.locator('[data-graphic-style-action="new"]').click(); // save its style
      await s.page.waitForTimeout(60);
      await s.page.evaluate((id) => window.__artisanStore.setSelection([id]), B); // select blue
      await s.page.waitForTimeout(50);
      await s.page.locator("[data-graphic-style]").first().click(); // apply the saved style
      await s.page.waitForTimeout(80);
      const styleCount = await s.page.evaluate(() => (window.__artisanStore.getState().doc.graphicStyles ?? []).length);
      const d = await s.itemDetail(B);
      const c = d?.fillColor;
      const pass = styleCount === 1 && !!c && c.r === 220 && c.g === 0 && c.b === 0; // blue is now red
      return { pass, detail: { styleCount, fill: c } };
    },
  },

  {
    // Document Info panel reports object + selection counts, updating live.
    g: "build", id: "document-info",
    fn: async (s) => {
      await s.fixture(
        `const a=E.makeRect(100,100,60,60,0,0,{fill:E.solid(E.rgba(220,0,0))});` +
          `const b=E.makeRect(200,100,60,60,0,0,{fill:E.solid(E.rgba(0,0,220))});` +
          `doc.layers[0].items.push(a,b);return[a.id,b.id];`,
      );
      const [A] = await s.page.evaluate(() => window.__artisanStore.getState().doc.layers[0].items.map((i) => i.id));
      await openTab(s, "Document Info");
      await s.page.waitForTimeout(60);
      const read = (k) => s.page.locator(`[data-docinfo="${k}"]`).innerText();
      const objects = (await read("objects")).trim();
      const selInit = (await read("selected")).trim(); // fixture selects both → "2"
      await s.page.evaluate((id) => window.__artisanStore.setSelection([id]), A);
      await s.page.waitForTimeout(50);
      const selOne = (await read("selected")).trim();
      await s.page.evaluate(() => window.__artisanStore.clearSelection());
      await s.page.waitForTimeout(50);
      const selNone = (await read("selected")).trim();
      const pass = objects === "2" && selInit === "2" && selOne === "1" && selNone === "0";
      return { pass, detail: { objects, selInit, selOne, selNone } };
    },
  },

  {
    // Stroke panel arrowheads: choosing End=Triangle sets stroke.endArrow and the
    // canvas renders an SVG <marker> referenced by the path.
    g: "build", id: "arrowheads",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.jagged); // an open path, selected
      await openTab(s, "Stroke");
      await s.chooseOption("[data-arrow-end]", "triangle");
      await s.page.waitForTimeout(90);
      const info = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return {
          endArrow: it?.stroke?.endArrow ?? null,
          markerDef: !!document.querySelector("svg.artisan-canvas marker"),
          markerRef: !!document.querySelector("svg.artisan-canvas [marker-end]"),
        };
      }, pid);
      const pass = info.endArrow === "triangle" && info.markerDef === true && info.markerRef === true;
      return { pass, detail: info };
    },
  },

  // ---- compound path MAKE (Object ▸ Compound Path ▸ Make, via the real menu) ----
  {
    g: "build", id: "compound-path-make",
    fn: async (s) => {
      // red (back, big) + blue (front, small) overlapping → one even-odd compound
      // that adopts the BACKMOST (red) paint.
      await s.fixture(
        `const r1=E.makeRect(150,160,120,120,0,0,{fill:E.solid(E.rgba(220,0,0))});` +
          `const r2=E.makeRect(190,200,40,40,0,0,{fill:E.solid(E.rgba(0,0,220))});` +
          `doc.layers[0].items.push(r1,r2);return[r1.id,r2.id];`,
      );
      // "Make" collides with Make Clipping/Opacity/Pattern → click the exact label.
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Compound Path" }).first().hover();
      await s.page.waitForTimeout(200);
      const make = s.page.locator(".monet-menu-label", { hasText: /^Make$/ }).first();
      await make.hover();
      await s.page.waitForTimeout(80);
      await make.click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const t = snap.top[0];
      const d = t ? await s.itemDetail(t.id) : null;
      const c = d?.fillColor;
      const isRed = c && c.r === 220 && c.g === 0 && c.b === 0;
      const pass = snap.topCount === 1 && t?.type === "compound" && d?.subpaths === 2 && isRed;
      return { pass, detail: { topCount: snap.topCount, type: t?.type, subpaths: d?.subpaths, fillColor: c } };
    },
  },

  // ---- compound path RELEASE (Object ▸ Compound Path ▸ Release, via the menu) ----
  {
    g: "build", id: "compound-path-release",
    fn: async (s) => {
      // a 2-subpath compound → Release breaks it into two separate paths.
      await s.fixture(
        `const ring=(cx)=>({closed:true,anchors:[{point:{x:cx,y:160},handleIn:{x:0,y:0},handleOut:{x:0,y:0}},` +
          `{point:{x:cx+60,y:160},handleIn:{x:0,y:0},handleOut:{x:0,y:0}},` +
          `{point:{x:cx+60,y:220},handleIn:{x:0,y:0},handleOut:{x:0,y:0}},` +
          `{point:{x:cx,y:220},handleIn:{x:0,y:0},handleOut:{x:0,y:0}}]});` +
          `const c=E.makeCompound([ring(150),ring(250)],{fill:E.solid(E.rgba(0,150,0))});doc.layers[0].items.push(c);return[c.id];`,
      );
      // "Release" collides with Release Clipping/Opacity Mask → click the exact label.
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Compound Path" }).first().hover();
      await s.page.waitForTimeout(200);
      const rel = s.page.locator(".monet-menu-label", { hasText: /^Release$/ }).first();
      await rel.hover();
      await s.page.waitForTimeout(80);
      await rel.click();
      await s.page.waitForTimeout(120);
      const snap = await s.snapshot();
      const pass = snap.topCount === 2 && snap.top.every((it) => it.type === "path");
      return { pass, detail: { topCount: snap.topCount, types: snap.top.map((it) => it.type) } };
    },
  },

  // ---- nested submenu commands reachable by MOUSE (Monet dismiss fix) ----
  {
    g: "build", id: "menu-submenu-action",
    fn: async (s) => {
      const [rid] = await s.fixture(`const r=E.makeRect(200,200,160,80,0,0,{fill:E.solid(E.rgba(200,80,80))});doc.layers[0].items.push(r);return[r.id];`);
      const before = await s.itemDetail(rid);
      // Object ▸ Transform ▸ Rotate 90° CW — a two-level submenu command.
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(150);
      await s.page.locator(".monet-menu-item", { hasText: "Transform" }).first().hover();
      await s.page.waitForTimeout(200);
      const rot = s.page.locator(".monet-menu-item", { hasText: "Rotate 90° CW" }).first();
      await rot.hover();
      await s.page.waitForTimeout(80);
      await rot.click();
      await s.page.waitForTimeout(120);
      const after = await s.itemDetail(rid);
      // a quarter turn swaps the bbox: 160×80 → 80×160
      const pass =
        Math.round(before.bounds.width) === 160 &&
        Math.round(after.bounds.width) === 80 &&
        Math.round(after.bounds.height) === 160;
      return { pass, detail: { before: before.bounds, after: after.bounds } };
    },
  },

  // ---- clipping mask (Object ▸ Make / Release Clipping Mask, via the menu) ----
  {
    g: "build", id: "clipping-mask",
    fn: async (s) => {
      // a (bottom, red, big) + b (top, blue, small); both selected
      await s.fixture(
        `const a=E.makeRect(150,180,180,160,0,0,{fill:E.solid(E.rgba(220,80,80))});` +
          `const b=E.makeRect(190,210,100,100,0,0,{fill:E.solid(E.rgba(60,110,220))});` +
          `doc.layers[0].items.push(a,b);return[a.id,b.id];`,
      );
      const clickObject = async (label) => {
        await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
        await s.page.waitForTimeout(130);
        await s.page.locator(".monet-menu-item", { hasText: label }).first().click();
        await s.page.waitForTimeout(130);
      };
      await clickObject("Make Clipping Mask");
      const made = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const gid = st.selection[0];
        const g = window.__Q.getItem(st.doc, gid);
        const node = document.querySelector(`svg.artisan-canvas [data-id="${gid}"]`);
        return {
          type: g ? g.type : null,
          clip: g && g.type === "group" ? g.clip : null,
          children: g && g.type === "group" ? g.children.length : null,
          clipFill: g && g.type === "group" ? g.children[0].fill.type : null, // clip path = children[0]
          hasClipPath: node ? !!node.querySelector("clipPath") : false, // actually clips
        };
      });
      const makePass =
        made.type === "group" && made.clip === true && made.children === 2 &&
        made.clipFill === "none" && made.hasClipPath;
      await clickObject("Release Clipping Mask");
      const released = await s.page.evaluate(() => {
        const items = window.__artisanStore.getState().doc.layers.flatMap((l) => l.items);
        return {
          topCount: items.length,
          anyGroup: items.some((it) => it.type === "group"),
          anyUnpainted: items.some((it) => it.fill && it.fill.type === "none"), // former clip stays unpainted
        };
      });
      const releasePass = released.topCount === 2 && !released.anyGroup && released.anyUnpainted;
      return { pass: makePass && releasePass, detail: { made, released } };
    },
  },

  // ---- group z-order (Object ▸ Group via the menu) ----
  {
    g: "build", id: "group-zorder",
    fn: async (s) => {
      // four rects bottom→top [a,b,c,d]; SELECT a non-top subset (a + c)
      await s.fixture(
        `const mk=(x,col)=>E.makeRect(x,200,60,60,0,0,{fill:E.solid(col)});` +
          `const a=mk(120,E.rgba(220,80,80)),b=mk(200,E.rgba(80,180,80)),c=mk(280,E.rgba(80,120,220)),d=mk(360,E.rgba(200,200,80));` +
          `doc.layers[0].items.push(a,b,c,d);return[a.id,c.id];`,
      );
      const before = await s.page.evaluate(() => window.__artisanStore.getState().doc.layers[0].items.map((it) => it.id));
      // Object ▸ Group — click the label exactly so it doesn't hit "Ungroup".
      await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
      await s.page.waitForTimeout(130);
      await s.page.locator(".monet-menu-label", { hasText: /^Group$/ }).first().click();
      await s.page.waitForTimeout(130);
      const after = await s.page.evaluate(() =>
        window.__artisanStore.getState().doc.layers[0].items.map((it) => (it.type === "group" ? "G" : it.id)),
      );
      // expect [B, G, D]: group lands at C's (frontmost selected) spot; D stays above.
      const pass = after.length === 3 && after[0] === before[1] && after[1] === "G" && after[2] === before[3];
      return { pass, detail: { before, after } };
    },
  },

  // ---- Paste in Front / Back (Edit menu; exact position + z-order) ----
  {
    g: "build", id: "paste-in-front",
    fn: async (s) => {
      const [rid] = await s.fixture(`const r=E.makeRect(180,200,90,90,0,0,{fill:E.solid(E.rgba(220,90,90))});doc.layers[0].items.push(r);return[r.id];`);
      const edit = async (label) => {
        await s.page.getByRole("menuitem", { name: "Edit", exact: true }).first().click();
        await s.page.waitForTimeout(120);
        await s.page.locator(".monet-menu-item", { hasText: label }).first().click();
        await s.page.waitForTimeout(120);
      };
      await edit("Copy");
      await edit("Paste in Front");
      const res = await s.page.evaluate((origId) => {
        const st = window.__artisanStore.getState();
        const items = st.doc.layers[0].items;
        const wb = (id) => { const b = window.__Q.worldBounds(st.doc, id); return [Math.round(b.x), Math.round(b.y)]; };
        return {
          count: items.length,
          topIsPaste: items[items.length - 1].id !== origId, // paste on TOP
          samePos: JSON.stringify(wb(items[0].id)) === JSON.stringify(wb(items[1].id)),
        };
      }, rid);
      return { pass: res.count === 2 && res.topIsPaste && res.samePos, detail: res };
    },
  },
  {
    g: "build", id: "paste-in-back",
    fn: async (s) => {
      const [rid] = await s.fixture(`const r=E.makeRect(180,200,90,90,0,0,{fill:E.solid(E.rgba(90,140,220))});doc.layers[0].items.push(r);return[r.id];`);
      const edit = async (label) => {
        await s.page.getByRole("menuitem", { name: "Edit", exact: true }).first().click();
        await s.page.waitForTimeout(120);
        await s.page.locator(".monet-menu-item", { hasText: label }).first().click();
        await s.page.waitForTimeout(120);
      };
      await edit("Copy");
      await edit("Paste in Back");
      const res = await s.page.evaluate((origId) => {
        const st = window.__artisanStore.getState();
        const items = st.doc.layers[0].items;
        const wb = (id) => { const b = window.__Q.worldBounds(st.doc, id); return [Math.round(b.x), Math.round(b.y)]; };
        return {
          count: items.length,
          bottomIsPaste: items[0].id !== origId, // paste at the BACK
          origStaysOnTop: items[1].id === origId,
          samePos: JSON.stringify(wb(items[0].id)) === JSON.stringify(wb(items[1].id)),
        };
      }, rid);
      return { pass: res.count === 2 && res.bottomIsPaste && res.origStaysOnTop && res.samePos, detail: res };
    },
  },

  // ---- plain Paste (⌘V) centres in the view ----
  {
    g: "build", id: "paste-center",
    fn: async (s) => {
      // a small rect in the top-left corner, far from the view centre
      const [rid] = await s.fixture(`const r=E.makeRect(60,80,40,30,0,0,{fill:E.solid(E.rgba(120,200,120))});doc.layers[0].items.push(r);return[r.id];`);
      // click an Edit-menu item by EXACT label (so "Paste" ≠ "Paste in Front/Back")
      const editExact = async (re) => {
        await s.page.getByRole("menuitem", { name: "Edit", exact: true }).first().click();
        await s.page.waitForTimeout(120);
        await s.page.locator(".monet-menu-label", { hasText: re }).first().click();
        await s.page.waitForTimeout(120);
      };
      await editExact(/^Copy$/);
      await editExact(/^Paste$/);
      const res = await s.page.evaluate((origId) => {
        const st = window.__artisanStore.getState();
        const items = st.doc.layers[0].items;
        const v = st.view, vp = st.viewport;
        const expected = [(vp.width / 2 - v.tx) / v.zoom, (vp.height / 2 - v.ty) / v.zoom];
        const pasted = items.find((it) => it.id !== origId);
        const b = pasted ? window.__Q.worldBounds(st.doc, pasted.id) : null;
        return { count: items.length, expected, center: b ? [b.x + b.width / 2, b.y + b.height / 2] : null };
      }, rid);
      const ok =
        res.count === 2 && res.center &&
        Math.abs(res.center[0] - res.expected[0]) < 1 &&
        Math.abs(res.center[1] - res.expected[1]) < 1;
      return { pass: !!ok, detail: res };
    },
  },
  {
    // Edit ▸ Cut removes the selection; Edit ▸ Paste brings a clone back. Menu clicks.
    g: "build", id: "cut-paste",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      const editExact = async (re) => {
        await s.page.getByRole("menuitem", { name: "Edit", exact: true }).first().click();
        await s.page.waitForTimeout(120);
        await s.page.locator(".monet-menu-label", { hasText: re }).first().click();
        await s.page.waitForTimeout(120);
      };
      await editExact(/^Cut$/);
      const afterCut = await s.snapshot();
      await editExact(/^Paste$/);
      const afterPaste = await s.snapshot();
      const pass =
        afterCut.topCount === 0 && // original removed by Cut
        afterPaste.topCount === 1 && // a clone pasted back
        !afterPaste.top.some((t) => t.id === rid); // not the original id
      return { pass, detail: { afterCut: afterCut.topCount, afterPaste: afterPaste.topCount } };
    },
  },

  // ---- Arrange z-order (Object ▸ Arrange ▸ … via the submenu) ----
  {
    g: "build", id: "arrange-bring-to-front",
    fn: async (s) => {
      // four rects bottom→top [a,b,c,d]; select B (a middle object)
      const [bId] = await s.fixture(
        `const mk=(x)=>E.makeRect(x,200,40,40,0,0,{fill:E.solid(E.rgba(180,180,180))});` +
          `const a=mk(120),b=mk(180),c=mk(240),d=mk(300);doc.layers[0].items.push(a,b,c,d);return[b.id];`,
      );
      await objectSubmenu(s, "Arrange", "Bring to Front");
      const res = await s.page.evaluate((sel) => {
        const items = window.__artisanStore.getState().doc.layers[0].items;
        return { count: items.length, topId: items[items.length - 1].id, sel };
      }, bId);
      return { pass: res.count === 4 && res.topId === res.sel, detail: res };
    },
  },
  {
    g: "build", id: "arrange-send-backward",
    fn: async (s) => {
      // select C (index 2); Send Backward should drop it to index 1
      const [cId] = await s.fixture(
        `const mk=(x)=>E.makeRect(x,200,40,40,0,0,{fill:E.solid(E.rgba(180,180,180))});` +
          `const a=mk(120),b=mk(180),c=mk(240),d=mk(300);doc.layers[0].items.push(a,b,c,d);return[c.id];`,
      );
      await objectSubmenu(s, "Arrange", "Send Backward");
      const res = await s.page.evaluate((sel) => {
        const items = window.__artisanStore.getState().doc.layers[0].items;
        return { count: items.length, idxOfSel: items.findIndex((it) => it.id === sel) };
      }, cId);
      return { pass: res.count === 4 && res.idxOfSel === 1, detail: res };
    },
  },

  // ---- Transform on MULTIPLE objects (Object ▸ Transform submenu) ----
  {
    g: "build", id: "transform-rotate-multi",
    fn: async (s) => {
      // two rects → a 40×80 selection (taller than wide), both selected
      await s.fixture(
        `const a=E.makeRect(200,150,40,20,0,0,{fill:E.solid(E.rgba(180,180,180))});` +
          `const b=E.makeRect(200,190,20,40,0,0,{fill:E.solid(E.rgba(180,180,180))});doc.layers[0].items.push(a,b);return[a.id,b.id];`,
      );
      const sb = () =>
        s.page.evaluate(() => {
          const st = window.__artisanStore.getState();
          const b = window.__Q.selectionBounds(st.doc, st.selection);
          const r = Math.round;
          return { cx: r(b.x + b.width / 2), cy: r(b.y + b.height / 2), w: r(b.width), h: r(b.height) };
        });
      const before = await sb();
      await objectSubmenu(s, "Transform", "Rotate 90° CW");
      const after = await sb();
      // a quarter turn swaps the selection bbox dims; its centre is fixed
      const pass = after.cx === before.cx && after.cy === before.cy && after.w === before.h && after.h === before.w;
      return { pass, detail: { before, after } };
    },
  },
  {
    g: "build", id: "transform-reflect-h",
    fn: async (s) => {
      // A left (x=120), B right (x=280), symmetric about x=220
      const [aId, bId] = await s.fixture(
        `const a=E.makeRect(120,200,40,40,0,0,{fill:E.solid(E.rgba(220,90,90))});` +
          `const b=E.makeRect(280,200,40,40,0,0,{fill:E.solid(E.rgba(90,140,220))});doc.layers[0].items.push(a,b);return[a.id,b.id];`,
      );
      const x = (id) => s.page.evaluate((i) => Math.round(window.__Q.worldBounds(window.__artisanStore.getState().doc, i).x), id);
      await objectSubmenu(s, "Transform", "Reflect Horizontal");
      const ax = await x(aId), bx = await x(bId);
      return { pass: ax === 280 && bx === 120, detail: { ax, bx } }; // A↔B swapped horizontally
    },
  },
  {
    g: "build", id: "transform-reflect-v",
    fn: async (s) => {
      // A top (y=120), B bottom (y=280), symmetric about y=220
      const [aId, bId] = await s.fixture(
        `const a=E.makeRect(200,120,40,40,0,0,{fill:E.solid(E.rgba(220,90,90))});` +
          `const b=E.makeRect(200,280,40,40,0,0,{fill:E.solid(E.rgba(90,140,220))});doc.layers[0].items.push(a,b);return[a.id,b.id];`,
      );
      const y = (id) => s.page.evaluate((i) => Math.round(window.__Q.worldBounds(window.__artisanStore.getState().doc, i).y), id);
      await objectSubmenu(s, "Transform", "Reflect Vertical");
      const ay = await y(aId), by = await y(bId);
      return { pass: ay === 280 && by === 120, detail: { ay, by } }; // A↔B swapped vertically
    },
  },

  // ---- Select ▸ Same ▸ Fill Color (Select submenu) ----
  {
    g: "build", id: "select-same-fill",
    fn: async (s) => {
      // two red rects + one blue; SELECT a single red one
      const [r1] = await s.fixture(
        `const r1=E.makeRect(120,200,50,50,0,0,{fill:E.solid(E.rgba(220,80,80))});` +
          `const r2=E.makeRect(200,200,50,50,0,0,{fill:E.solid(E.rgba(220,80,80))});` +
          `const b=E.makeRect(280,200,50,50,0,0,{fill:E.solid(E.rgba(80,120,220))});doc.layers[0].items.push(r1,r2,b);return[r1.id];`,
      );
      await menuSubmenu(s, "Select", "Same", "Fill Color");
      const res = await s.page.evaluate((ref) => {
        const st = window.__artisanStore.getState();
        const sel = new Set(st.selection);
        const items = st.doc.layers[0].items;
        const reds = items.filter((it) => it.fill.type === "solid" && it.fill.color.r === 220).map((it) => it.id);
        const blue = items.find((it) => it.fill.type === "solid" && it.fill.color.b === 220 && it.fill.color.r === 80);
        return {
          selCount: st.selection.length,
          includesRef: sel.has(ref),
          allRedsSelected: reds.every((id) => sel.has(id)),
          blueSelected: blue ? sel.has(blue.id) : false,
        };
      }, r1);
      const pass = res.selCount === 2 && res.includesRef && res.allRedsSelected && !res.blueSelected;
      return { pass, detail: res };
    },
  },

  // ---- Select ▸ Same ▸ Blending Mode (Select submenu) ----
  {
    g: "build", id: "select-same-blend-mode",
    fn: async (s) => {
      // two multiply rects (different colours) + one normal; SELECT one multiply.
      const [r1] = await s.fixture(
        `const r1=E.makeRect(120,200,50,50,0,0,{fill:E.solid(E.rgba(220,80,80))});r1.blendMode="multiply";` +
          `const r2=E.makeRect(200,200,50,50,0,0,{fill:E.solid(E.rgba(80,180,120))});r2.blendMode="multiply";` +
          `const n=E.makeRect(280,200,50,50,0,0,{fill:E.solid(E.rgba(80,120,220))});doc.layers[0].items.push(r1,r2,n);return[r1.id];`,
      );
      await menuSubmenu(s, "Select", "Same", "Blending Mode");
      const res = await s.page.evaluate((ref) => {
        const st = window.__artisanStore.getState();
        const sel = new Set(st.selection);
        const items = st.doc.layers[0].items;
        const multiplyIds = items.filter((it) => it.blendMode === "multiply").map((it) => it.id);
        const normal = items.find((it) => it.blendMode === "normal");
        return {
          selCount: st.selection.length,
          includesRef: sel.has(ref),
          allMultiplySelected: multiplyIds.every((id) => sel.has(id)),
          normalSelected: normal ? sel.has(normal.id) : false,
        };
      }, r1);
      const pass = res.selCount === 2 && res.includesRef && res.allMultiplySelected && !res.normalSelected;
      return { pass, detail: res };
    },
  },

  // ---- opacity mask over MULTIPLE objects (Object ▸ Make/Release) ----
  {
    g: "build", id: "opacity-mask-multi",
    fn: async (s) => {
      // two rects + a white ellipse mask on top; select all three
      await s.fixture(
        `const t1=E.makeRect(140,200,80,80,0,0,{fill:E.solid(E.rgba(220,90,90))});` +
          `const t2=E.makeRect(240,200,80,80,0,0,{fill:E.solid(E.rgba(90,140,220))});` +
          `const m=E.makeEllipse(140,200,180,80,{fill:E.solid(E.rgba(255,255,255))});` +
          `doc.layers[0].items.push(t1,t2,m);return[t1.id,t2.id,m.id];`,
      );
      const clickObject = async (label) => {
        await s.page.getByRole("menuitem", { name: "Object", exact: true }).first().click();
        await s.page.waitForTimeout(130);
        await s.page.locator(".monet-menu-item", { hasText: label }).first().click();
        await s.page.waitForTimeout(130);
      };
      await clickObject("Make Opacity Mask");
      const made = await s.page.evaluate(() => {
        const items = window.__artisanStore.getState().doc.layers[0].items;
        const g = items.find((it) => it.type === "group");
        return { topCount: items.length, isGroup: !!g, children: g ? g.children.length : null, hasMask: g ? !!(g.mask && g.mask.length) : false };
      });
      const makePass = made.topCount === 1 && made.isGroup && made.children === 2 && made.hasMask;
      await clickObject("Release Opacity Mask");
      const released = await s.page.evaluate(() => {
        const items = window.__artisanStore.getState().doc.layers[0].items;
        const g = items.find((it) => it.type === "group");
        return { groupHasMask: g ? !!(g.mask && g.mask.length) : null, maskRestored: items.some((it) => it.type === "ellipse") };
      });
      const releasePass = released.groupHasMask === false && released.maskRestored;
      return { pass: makePass && releasePass, detail: { made, released } };
    },
  },

  // ---- Outline view toggle (View ▸ Outline) ----
  {
    g: "build", id: "outline-mode",
    fn: async (s) => {
      const [rid] = await s.fixture(`const r=E.makeRect(200,200,120,100,0,0,{fill:E.solid(E.rgba(220,80,80))});doc.layers[0].items.push(r);return[r.id];`);
      const viewToggle = async () => {
        await s.page.getByRole("menuitem", { name: "View", exact: true }).first().click();
        await s.page.waitForTimeout(130);
        await s.page.locator(".monet-menu-item", { hasText: "Outline" }).first().click();
        await s.page.waitForTimeout(150);
      };
      const fillOf = () =>
        s.page.evaluate((id) => {
          const node = document.querySelector(`svg.artisan-canvas [data-id="${id}"]`);
          const shape = node ? node.querySelector("rect") : null;
          return shape ? shape.getAttribute("fill") : null;
        }, rid);
      const normal = await fillOf(); // a colour
      await viewToggle();
      const outline = await fillOf(); // "none"
      await viewToggle();
      const restored = await fillOf();
      const pass = normal !== "none" && outline === "none" && restored === normal && restored !== "none";
      return { pass, detail: { normal, outline, restored } };
    },
  },

  // ---- type ----
  {
    g: "type", id: "type",
    fn: async (s) => {
      await s.reset();
      await s.setTool("type");
      await s.click({ x: 160, y: 220 });
      const ta = s.page.locator(".artisan-html-overlay textarea");
      await ta.waitFor({ timeout: 2000 }).catch(() => {});
      await ta.fill("Hi");
      await s.key("Escape");
      const snap = await s.snapshot();
      const t = snap.top.find((x) => x.type === "text");
      const d = t ? await s.itemDetail(t.id) : null;
      return { pass: !!t && d?.text === "Hi", detail: { topCount: snap.topCount, text: d?.text } };
    },
  },
  {
    g: "type", id: "area-type",
    fn: async (s) => {
      const [rid] = await s.fixture(FX.rect);
      await s.setTool("area-type");
      await s.click({ x: 360, y: 275 });
      await s.page.waitForTimeout(80);
      const snap = await s.snapshot();
      const gone = !snap.top.some((t) => t.id === rid);
      const txt = snap.top.find((t) => t.type === "text");
      // a wrapping text box of the shape's bounds → rendered as <foreignObject>
      const r = txt ? await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        const node = document.querySelector(`svg.artisan-canvas [data-id="${id}"] foreignObject`);
        return { box: it?.boxWidth ?? 0, rendered: !!node };
      }, txt.id) : { box: 0, rendered: false };
      return { pass: gone && !!txt && r.box > 0 && r.rendered, detail: { gone, hasText: !!txt, ...r } };
    },
  },
  {
    g: "type", id: "type-on-path",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square);
      await s.setTool("type-on-path");
      await s.click({ x: 360, y: 280 });
      await s.page.waitForTimeout(80);
      const snap = await s.snapshot();
      const gone = !snap.top.some((t) => t.id === pid);
      const txt = snap.top.find((t) => t.type === "text");
      const d = txt ? await s.itemDetail(txt.id) : null;
      // text flows along the baked path → rendered as <textPath> carrying the text
      const r = txt ? await s.page.evaluate((id) => {
        const node = document.querySelector(`svg.artisan-canvas [data-id="${id}"] textPath`);
        return { rendered: !!node, content: node ? node.textContent : null };
      }, txt.id) : { rendered: false, content: null };
      const pass = gone && !!txt && !!d?.pathD && r.rendered && (r.content || "").includes("Type on a path");
      return { pass, detail: { gone, pathD: !!d?.pathD, ...r } };
    },
  },
  {
    // Editing a multi-run (imported rich) text flattens it to single-run so the
    // canvas reflects the edit (the renderer otherwise prefers runs over .text).
    g: "type", id: "type-edit-runs",
    fn: async (s) => {
      await s.reset();
      await s.page.evaluate(() => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><text x="40" y="150" font-size="40"><tspan fill="#e0573a">Hel</tspan><tspan fill="#3ac06a">lo</tspan></text></svg>';
        return window.__doImport("runs.svg", [...new TextEncoder().encode(svg)]);
      });
      let snap = await s.snapshot();
      const t = snap.top.find((x) => x.type === "text");
      const before = t ? await s.itemDetail(t.id) : null;
      await s.page.evaluate((tid) => {
        const st = window.__artisanStore;
        st.setTool("type");
        st.setSelection([tid]);
        st.beginTransaction("Edit Text");
        st.setEditingText(tid);
      }, t.id);
      const ta = s.page.locator(".artisan-html-overlay textarea");
      await ta.waitFor({ timeout: 2000 }).catch(() => {});
      await ta.fill("Edited");
      await s.key("Escape");
      const after = t ? await s.itemDetail(t.id) : null;
      const pass = before?.runs >= 2 && after?.runs === 0 && after?.text === "Edited";
      return { pass, detail: { beforeRuns: before?.runs, afterRuns: after?.runs, text: after?.text } };
    },
  },

  // ---- symbols ----
  {
    g: "symbol", id: "symbol-sprayer",
    fn: async (s) => {
      await s.fixture(FX.rect); // selected
      await s.setTool("symbol-sprayer");
      await s.drag({ x: 220, y: 240 }, { x: 420, y: 320 }, { steps: 16 });
      const snap = await s.snapshot();
      const g = snap.top.find((t) => t.type === "group" && t.name === "Symbol Set");
      return { pass: !!g && g.children >= 1, detail: { group: g } };
    },
  },
  ...["symbol-shifter", "symbol-scruncher", "symbol-sizer", "symbol-spinner", "symbol-stainer", "symbol-styler"].map((id) => ({
    g: "symbol", id,
    fn: async (s) => {
      await s.fixture(FX.rect);
      await s.page.evaluate(() => window.__artisanStore.setFill(window.__engine.solid(window.__engine.rgba(40, 200, 120))));
      await s.setTool("symbol-sprayer");
      await s.drag({ x: 200, y: 250 }, { x: 430, y: 250 }, { steps: 20 });
      let snap = await s.snapshot();
      const g = snap.top.find((t) => t.type === "group" && t.name === "Symbol Set");
      if (!g) return { pass: false, detail: { reason: "spray produced no group" } };
      const before = await s.itemDetail(g.id);
      await s.setTool(id);
      // sweep slowly across the sprayed instances
      await s.drag({ x: 200, y: 250 }, { x: 430, y: 250 }, { steps: 24 });
      const after = await s.itemDetail(g.id);
      const pass = JSON.stringify(before.childTransforms) !== JSON.stringify(after.childTransforms);
      return { pass, detail: { children: before.childTransforms?.length, changed: pass } };
    },
  })),

  // ---- graphs ----
  { g: "graph", id: "column-graph", fn: create("column-graph", { x: 80, y: 80 }, { x: 320, y: 290 }, "group", 1) },
  { g: "graph", id: "bar-graph", fn: create("bar-graph", { x: 80, y: 80 }, { x: 320, y: 290 }, "group", 1) },
  { g: "graph", id: "pie-graph", fn: create("pie-graph", { x: 190, y: 180 }, { x: 300, y: 180 }, "group", 1) },
  { g: "graph", id: "line-graph", fn: create("line-graph", { x: 80, y: 80 }, { x: 320, y: 290 }, "group", 1) },
  { g: "graph", id: "area-graph", fn: create("area-graph", { x: 80, y: 80 }, { x: 320, y: 290 }, "group", 1) },
  { g: "graph", id: "scatter-graph", fn: create("scatter-graph", { x: 80, y: 80 }, { x: 320, y: 290 }, "group", 1) },
  { g: "graph", id: "radar-graph", fn: create("radar-graph", { x: 190, y: 180 }, { x: 300, y: 180 }, "group", 1) },

  // ---- canvas / view / perspective ----
  {
    g: "canvas", id: "artboard",
    fn: async (s) => {
      await s.reset();
      await s.page.evaluate(() => window.__artisanStore.setView({ zoom: 0.5, tx: 120, ty: 120, angle: 0 }));
      await s.setTool("artboard");
      await s.drag({ x: 1050, y: 250 }, { x: 1350, y: 520 }); // empty area right of the artboard
      const snap = await s.snapshot();
      return { pass: snap.artboards === 2, detail: { artboards: snap.artboards } };
    },
  },
  {
    g: "canvas", id: "slice",
    fn: async (s) => {
      await s.reset();
      await s.setTool("slice");
      await s.drag({ x: 200, y: 200 }, { x: 380, y: 330 });
      const snap = await s.snapshot();
      return { pass: snap.slices >= 1, detail: { slices: snap.slices } };
    },
  },
  {
    g: "canvas", id: "slice-selection",
    fn: async (s) => {
      await s.reset();
      await s.setTool("slice");
      await s.drag({ x: 200, y: 200 }, { x: 380, y: 330 });
      await s.setTool("slice-selection");
      await s.click({ x: 290, y: 265 });
      const snap = await s.snapshot();
      return { pass: !!snap.selectedSlice, detail: { selectedSlice: snap.selectedSlice } };
    },
  },
  {
    g: "canvas", id: "hand",
    fn: async (s) => {
      await s.reset();
      const before = (await s.snapshot()).view;
      await s.setTool("hand");
      await s.drag({ x: 300, y: 300 }, { x: 420, y: 380 });
      const after = (await s.snapshot()).view;
      return { pass: before.tx !== after.tx || before.ty !== after.ty, detail: { before, after } };
    },
  },
  {
    g: "canvas", id: "rotate-view",
    fn: async (s) => {
      await s.reset();
      const before = (await s.snapshot()).view;
      await s.setTool("rotate-view");
      await s.drag({ x: 600, y: 150 }, { x: 700, y: 450 });
      const after = (await s.snapshot()).view;
      return { pass: Math.abs(after.angle - before.angle) > 0.01, detail: { a0: before.angle, a1: after.angle } };
    },
  },
  {
    g: "canvas", id: "zoom",
    fn: async (s) => {
      await s.reset();
      const before = (await s.snapshot()).view;
      await s.setTool("zoom");
      await s.click({ x: 300, y: 300 });
      const after = (await s.snapshot()).view;
      return { pass: after.zoom > before.zoom * 1.5, detail: { z0: before.zoom, z1: after.zoom } };
    },
  },
  {
    g: "canvas", id: "perspective-grid",
    fn: async (s) => {
      await s.reset();
      await s.setTool("perspective-grid");
      await s.click({ x: 300, y: 300 });
      const snap = await s.snapshot();
      return { pass: snap.perspectiveGrid === true, detail: { perspectiveGrid: snap.perspectiveGrid } };
    },
  },
  {
    g: "canvas", id: "perspective-selection",
    fn: async (s) => {
      const [pid] = await s.fixture(FX.square);
      await s.setTool("perspective-selection");
      const before = await s.itemDetail(pid);
      await s.drag({ x: 250, y: 280 }, { x: 450, y: 280 }, { steps: 12 }); // horizontal
      const after = await s.itemDetail(pid);
      return { pass: after?.type === "path" && changed(before, after), detail: { type: after?.type, moved: changed(before, after) } };
    },
  },

  // ---- regression guards for the three cosmetic fixes ----
  {
    g: "fixes", id: "scallop-distinct-from-pucker",
    fn: async (s) => {
      // identical fixture + drag through each tool → results must differ now
      const run = async (tool) => {
        const [pid] = await s.fixture(FX.jagged);
        await s.setTool(tool);
        await s.drag({ x: 250, y: 295 }, { x: 450, y: 305 }, { steps: 14 });
        return (await s.itemDetail(pid)).anchorsHash;
      };
      const pucker = await run("pucker");
      const scallop = await run("scallop");
      return { pass: !!pucker && pucker !== scallop, detail: { identical: pucker === scallop } };
    },
  },
  {
    g: "fixes", id: "perspective-distorts-group",
    fn: async (s) => {
      await s.fixture(FX.group); // selects the group
      const pre = await s.snapshot();
      const childIds = pre.items.filter((i) => i.type === "rect").map((i) => i.id); // group's 2 leaves
      await s.setTool("perspective-selection");
      await s.drag({ x: 200, y: 250 }, { x: 380, y: 250 }, { steps: 12 }); // horizontal
      const after = await Promise.all(childIds.map((id) => s.itemDetail(id)));
      // before the fix the group was a no-op and children stayed rects
      const pass = childIds.length === 2 && after.every((d) => d?.type === "path");
      return { pass, detail: { childTypes: after.map((d) => d?.type) } };
    },
  },
  {
    g: "fixes", id: "eraser-swath-matches-brush",
    fn: async (s) => {
      // tall rect, erase a horizontal swath edge-to-edge → splits into 2 pieces;
      // the gap between them ≈ the 12px brush (was ~24px before the fix).
      await s.fixture(`const r=E.makeRect(220,200,160,200,0,0,{fill:E.solid(E.rgba(200,120,120))});doc.layers[0].items.push(r);return[];`);
      await s.setTool("eraser");
      await s.drag({ x: 205, y: 300 }, { x: 395, y: 300 }, { steps: 20 });
      const snap = await s.snapshot();
      const comp = snap.top.find((t) => t.type === "compound");
      const d = comp ? await s.itemDetail(comp.id) : null;
      let gap = null;
      if (d?.subpathY?.length >= 2) {
        const ranges = d.subpathY.slice().sort((a, b) => a[0] - b[0]);
        gap = ranges[1][0] - ranges[0][1]; // bottom-of-top → top-of-bottom
      }
      const pass = gap != null && gap >= 8 && gap <= 16; // ≈12, not ≈24
      return { pass, detail: { gap, subpaths: d?.subpaths } };
    },
  },

  // ---- Pathfinder panel: click the REAL shape-mode tiles + operation chips ----
  // Illustrator parity — 4 shape modes (→ one compound) + 6 pathfinders (→ a group).
  {
    g: "pathfinder", id: "pf-unite",
    fn: async (s) => {
      const snap = await pathfind(s, "pfPair", "Unite");
      const t = snap.top[0];
      return { pass: snap.topCount === 1 && (t?.type === "compound" || t?.type === "path"), detail: { topCount: snap.topCount, type: t?.type } };
    },
  },
  {
    g: "pathfinder", id: "pf-minus-front",
    fn: async (s) => {
      const snap = await pathfind(s, "pfPair", "Minus front");
      const t = snap.top[0];
      return { pass: snap.topCount === 1 && (t?.type === "compound" || t?.type === "path"), detail: { topCount: snap.topCount, type: t?.type } };
    },
  },
  {
    g: "pathfinder", id: "pf-divide",
    fn: async (s) => {
      const snap = await pathfind(s, "pfPair", "Divide");
      const t = snap.top[0];
      return { pass: snap.topCount === 1 && t?.type === "group" && t?.children === 3, detail: { type: t?.type, children: t?.children } };
    },
  },
  {
    g: "pathfinder", id: "pf-trim",
    fn: async (s) => {
      const snap = await pathfind(s, "pfPair", "Trim");
      const t = snap.top[0];
      const kids = t?.type === "group" ? await groupKids(s, t.id) : null;
      const pass = snap.topCount === 1 && t?.type === "group" && t?.children === 2 && !!kids && kids.every((k) => k.stroke === "none");
      return { pass, detail: { children: t?.children, kids } };
    },
  },
  {
    g: "pathfinder", id: "pf-merge",
    fn: async (s) => {
      // same-colour overlap → Merge unions the visible regions into ONE piece.
      const snap = await pathfind(s, "pfSame", "Merge");
      const t = snap.top[0];
      return { pass: snap.topCount === 1 && t?.type === "group" && t?.children === 1, detail: { type: t?.type, children: t?.children } };
    },
  },
  {
    g: "pathfinder", id: "pf-crop",
    fn: async (s) => {
      const snap = await pathfind(s, "pfPair", "Crop");
      const t = snap.top[0];
      const kids = t?.type === "group" ? await groupKids(s, t.id) : null;
      const pass = snap.topCount === 1 && t?.type === "group" && (t?.children ?? 0) >= 1 && !!kids && kids.every((k) => k.stroke === "none");
      return { pass, detail: { children: t?.children, kids } };
    },
  },
  {
    g: "pathfinder", id: "pf-outline",
    fn: async (s) => {
      const snap = await pathfind(s, "pfDiag", "Outline");
      const t = snap.top[0];
      const kids = t?.type === "group" ? await groupKids(s, t.id) : null;
      const pass =
        snap.topCount === 1 &&
        t?.type === "group" &&
        (t?.children ?? 0) >= 4 &&
        !!kids &&
        kids.every((k) => k.type === "path" && k.closed === false && k.fill === "none" && k.stroke === "solid");
      return { pass, detail: { children: t?.children, sample: kids?.[0] } };
    },
  },
  {
    g: "pathfinder", id: "pf-minus-back",
    fn: async (s) => {
      const snap = await pathfind(s, "pfPair", "Minus Back");
      const t = snap.top[0];
      return { pass: snap.topCount === 1 && (t?.type === "compound" || t?.type === "path"), detail: { topCount: snap.topCount, type: t?.type } };
    },
  },

  // ---- Align panel: click the REAL AlignBar buttons + "Align to" Select ----
  // Illustrator parity — 6 align + 2 distribute-spacing, relative to selection / artboard.
  {
    g: "align", id: "align-left",
    fn: async (s) => {
      const { after } = await alignClick(s, "alignThree", "Align left");
      const pass = !!after.sel && after.items.every((it) => Math.abs(it.x - after.sel.x) < 0.5);
      return { pass, detail: { xs: after.items.map((i) => i.x), selX: after.sel?.x } };
    },
  },
  {
    g: "align", id: "align-center-h",
    fn: async (s) => {
      const { after } = await alignClick(s, "alignThree", "Align center");
      const cx = after.sel.x + after.sel.w / 2;
      const pass = after.items.every((it) => Math.abs(it.x + it.w / 2 - cx) < 0.5);
      return { pass, detail: { centers: after.items.map((i) => i.x + i.w / 2), cx } };
    },
  },
  {
    g: "align", id: "align-right",
    fn: async (s) => {
      const { after } = await alignClick(s, "alignThree", "Align right");
      const rx = after.sel.x + after.sel.w;
      const pass = after.items.every((it) => Math.abs(it.x + it.w - rx) < 0.5);
      return { pass, detail: { rights: after.items.map((i) => i.x + i.w), rx } };
    },
  },
  {
    g: "align", id: "align-top",
    fn: async (s) => {
      const { after } = await alignClick(s, "alignThree", "Align top");
      const pass = after.items.every((it) => Math.abs(it.y - after.sel.y) < 0.5);
      return { pass, detail: { ys: after.items.map((i) => i.y), selY: after.sel?.y } };
    },
  },
  {
    g: "align", id: "align-middle-v",
    fn: async (s) => {
      const { after } = await alignClick(s, "alignThree", "Align middle");
      const cy = after.sel.y + after.sel.h / 2;
      const pass = after.items.every((it) => Math.abs(it.y + it.h / 2 - cy) < 0.5);
      return { pass, detail: { centers: after.items.map((i) => i.y + i.h / 2), cy } };
    },
  },
  {
    g: "align", id: "align-bottom",
    fn: async (s) => {
      const { after } = await alignClick(s, "alignThree", "Align bottom");
      const by = after.sel.y + after.sel.h;
      const pass = after.items.every((it) => Math.abs(it.y + it.h - by) < 0.5);
      return { pass, detail: { bottoms: after.items.map((i) => i.y + i.h), by } };
    },
  },
  {
    g: "align", id: "distribute-h",
    fn: async (s) => {
      const { before, after } = await alignClick(s, "alignRow", "Distribute horizontally");
      const gaps = gapsAlong(after.items, "x");
      const beforeExtent = [Math.min(...before.items.map((i) => i.x)), Math.max(...before.items.map((i) => i.x + i.w))];
      const afterExtent = [Math.min(...after.items.map((i) => i.x)), Math.max(...after.items.map((i) => i.x + i.w))];
      const pass =
        allClose(gaps) &&
        Math.abs(beforeExtent[0] - afterExtent[0]) < 0.5 &&
        Math.abs(beforeExtent[1] - afterExtent[1]) < 0.5;
      return { pass, detail: { gaps, beforeExtent, afterExtent } };
    },
  },
  {
    g: "align", id: "distribute-artboard",
    fn: async (s) => {
      // Set "Align to" → Artboard via the real Select, then distribute across it.
      await s.fixture(FX.alignRow);
      await s.page.locator('[data-dock-tab][data-tab-id="align"]').click();
      await s.page.waitForTimeout(80);
      await s.page.locator('.monet-cv-alignbar [aria-label="Align to"]').click();
      await s.page.waitForTimeout(50);
      await s.page.getByRole("option", { name: "Align to Artboard", exact: true }).click();
      await s.page.waitForTimeout(50);
      await s.page.locator('.monet-cv-alignbar').getByRole("button", { name: "Distribute horizontally", exact: true }).click();
      await s.page.waitForTimeout(90);
      const rep = await geomReport(s);
      const gaps = gapsAlong(rep.items, "x");
      const left = Math.min(...rep.items.map((i) => i.x));
      const right = Math.max(...rep.items.map((i) => i.x + i.w));
      const pass = allClose(gaps) && Math.abs(left - rep.ab.x) < 1 && Math.abs(right - (rep.ab.x + rep.ab.w)) < 1;
      return { pass, detail: { gaps, left, right, ab: rep.ab } };
    },
  },
  {
    // Align to Key Object: designate the middle rect (B) as the key, pick the
    // real "Align to Key Object" option, then Align left → every item snaps to
    // the key's left edge and the key itself does NOT move (Illustrator parity).
    g: "align", id: "align-key-object",
    fn: async (s) => {
      const [, bId] = await s.fixture(FX.alignThree); // a, b(key), c — all selected
      await s.page.locator('[data-dock-tab][data-tab-id="align"]').click();
      await s.page.waitForTimeout(80);
      const before = await geomReport(s);
      const keyBefore = before.items.find((it) => it.id === bId);
      // Designate B as the key object (Illustrator: re-click an already-selected obj).
      await s.page.evaluate((id) => window.__artisanStore.setKeyObject(id), bId);
      await s.page.waitForTimeout(90); // panel auto-switches "Align to" → Key Object
      // The "Align to Key Object" option must now exist + be selectable in the Select.
      await s.page.locator('.monet-cv-alignbar [aria-label="Align to"]').click();
      await s.page.waitForTimeout(50);
      await s.page.getByRole("option", { name: "Align to Key Object", exact: true }).click();
      await s.page.waitForTimeout(50);
      await s.page.locator('.monet-cv-alignbar').getByRole("button", { name: "Align left", exact: true }).click();
      await s.page.waitForTimeout(90);
      const after = await geomReport(s);
      const keyAfter = after.items.find((it) => it.id === bId);
      const allAtKey = after.items.every((it) => Math.abs(it.x - keyBefore.x) < 0.5);
      const keyUnmoved = !!keyAfter && Math.abs(keyAfter.x - keyBefore.x) < 0.5 && Math.abs(keyAfter.y - keyBefore.y) < 0.5;
      // the key object renders with the heavier highlight (exactly one marked node)
      const keyMarked = await s.page.evaluate(() => document.querySelectorAll('[data-key-object="true"]').length);
      const pass = allAtKey && keyUnmoved && keyMarked === 1;
      return { pass, detail: { keyX: keyBefore?.x, xs: after.items.map((i) => i.x), keyUnmoved, keyMarked } };
    },
  },
  {
    // Distribute Spacing (value): set a 12px gap, click Distribute H → the three
    // rects lay out with an exact 12px gap between each adjacent pair.
    g: "align", id: "distribute-spacing",
    fn: async (s) => {
      await s.fixture(FX.alignThree); // a, b, c selected (irregular x + widths)
      await s.page.locator('[data-dock-tab][data-tab-id="align"]').click();
      await s.page.waitForTimeout(80);
      const before = await geomReport(s);
      const sp = s.page.locator("[data-distribute-spacing] input");
      await sp.fill("12");
      await sp.press("Enter");
      await s.page.waitForTimeout(50);
      await s.page.locator("[data-distribute-h]").click();
      await s.page.waitForTimeout(90);
      const after = await geomReport(s);
      const gaps = gapsAlong(after.items, "x");
      const byId = (rep, id) => rep.items.find((it) => it.id === id);
      const anchorId = [...before.items].sort((p, q) => p.x - q.x)[0].id; // leftmost stays put
      const anchored = Math.abs(byId(after, anchorId).x - byId(before, anchorId).x) < 0.5;
      const yKept = after.items.every((it) => Math.abs(it.y - byId(before, it.id).y) < 0.5); // axis isolation
      const pass = gaps.length === 2 && allClose(gaps) && Math.abs(gaps[0] - 12) < 0.5 && anchored && yKept;
      return { pass, detail: { gaps, anchored, yKept } };
    },
  },

  // ---- Stroke panel: click the REAL "Align Stroke" buttons (Illustrator parity) ----
  // SVG strokes are centred; inside/outside are emulated in the renderer, so we
  // assert BOTH the model (stroke.align) and the rendered node's marker change.
  {
    g: "stroke", id: "stroke-align-inside",
    fn: async (s) => {
      await s.fixture(FX.rect);
      const r = await setStrokeAlign(s, "inside");
      return { pass: r.model === "inside" && r.rendered === "inside", detail: r };
    },
  },
  {
    g: "stroke", id: "stroke-align-outside",
    fn: async (s) => {
      await s.fixture(FX.rect);
      const r = await setStrokeAlign(s, "outside");
      return { pass: r.model === "outside" && r.rendered === "outside", detail: r };
    },
  },
  {
    g: "stroke", id: "stroke-align-center",
    fn: async (s) => {
      await s.fixture(FX.rect);
      await setStrokeAlign(s, "inside"); // move off-centre first …
      const r = await setStrokeAlign(s, "center"); // … then back to centre
      // centre renders as a normal node (no emulation marker)
      return { pass: r.model === "center" && r.rendered === null, detail: r };
    },
  },

  // ---- Stroke panel: click the REAL Cap / Corner / Dashed controls ----
  // Each maps 1:1 to SVG; assert BOTH the model and the rendered node attributes.
  {
    g: "stroke", id: "stroke-cap-join-dash",
    fn: async (s) => {
      await s.fixture(FX.rect);
      await s.page.locator('[data-dock-tab][data-tab-id="stroke"]').click();
      await s.page.waitForTimeout(70);
      await s.page.locator('[data-stroke-cap="round"]').click();
      await s.page.waitForTimeout(60);
      await s.page.locator('[data-stroke-join="bevel"]').click();
      await s.page.waitForTimeout(60);
      await s.page.locator('[data-stroke-dash="off"]').click(); // toggle dashes ON
      await s.page.waitForTimeout(90);
      const r = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const id = st.selection[0];
        const it = window.__Q.getItem(st.doc, id);
        const g = document.querySelector(`svg.artisan-canvas [data-id="${id}"]`);
        const shape = g ? g.querySelector("[stroke-linecap]") : null;
        return {
          cap: it.stroke.cap, join: it.stroke.join, dashed: it.stroke.dash.length > 0,
          rCap: shape ? shape.getAttribute("stroke-linecap") : null,
          rJoin: shape ? shape.getAttribute("stroke-linejoin") : null,
          rDash: shape ? shape.getAttribute("stroke-dasharray") : null,
        };
      });
      const pass = r.cap === "round" && r.join === "bevel" && r.dashed && r.rCap === "round" && r.rJoin === "bevel" && !!r.rDash;
      return { pass, detail: r };
    },
  },

  // ---- Stroke panel second dash-gap pair (long/short dash pattern) ----
  {
    g: "stroke", id: "stroke-dash-second-pair",
    fn: async (s) => {
      await s.fixture(FX.rect);
      await s.page.locator('[data-dock-tab][data-tab-id="stroke"]').click();
      await s.page.waitForTimeout(70);
      await s.page.locator('[data-stroke-dash="off"]').click(); // dashes ON → [6,4]
      await s.page.waitForTimeout(80);
      const setField = async (field, value) => {
        const input = s.page.locator(`[data-dash-field="${field}"] input`);
        await input.fill(String(value));
        await input.press("Enter");
        await s.page.waitForTimeout(70);
      };
      await setField("dash2", 3);
      await setField("gap2", 2);
      const r = await s.page.evaluate(() => {
        const st = window.__artisanStore.getState();
        const it = window.__Q.getItem(st.doc, st.selection[0]);
        const g = document.querySelector(`svg.artisan-canvas [data-id="${st.selection[0]}"]`);
        const shape = g ? g.querySelector("[stroke-dasharray]") : null;
        return { dash: it.stroke.dash, rDash: shape ? shape.getAttribute("stroke-dasharray") : null };
      });
      const pass = JSON.stringify(r.dash) === JSON.stringify([6, 4, 3, 2]) && !!r.rDash && r.rDash.replace(/\s/g, "").includes("3");
      return { pass, detail: r };
    },
  },

  // ---- Stroke cap/join/MITER/dash survive an SVG export → import round-trip ----
  // (the importer needs a real DOM, so this runs in the browser, not the node test.)
  {
    g: "stroke", id: "stroke-roundtrip",
    fn: async (s) => {
      await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});` +
          `const st={...E.defaultStroke(E.solid(E.BLACK)),width:4,cap:"round",join:"bevel",miterLimit:8,dash:[5,3],dashOffset:2};` +
          `const p=E.makePath({closed:true,anchors:[A(150,160),A(300,160),A(300,300),A(150,300)]},{fill:E.solid(E.rgba(200,120,60)),stroke:st});` +
          `doc.layers[0].items.push(p);return[p.id];`,
      );
      const r = await s.page.evaluate(async () => {
        const svg = window.__engine.IO.exportSVG(window.__artisanStore.getState().doc);
        await window.__doImport("rt.svg", svg);
        const find = (items) => {
          for (const it of items) {
            if (it.type === "group") { const f = find(it.children); if (f) return f; }
            else if (it.stroke && it.stroke.paint.type !== "none") return it.stroke;
          }
          return null;
        };
        const doc2 = window.__artisanStore.getState().doc;
        const st = doc2.layers.flatMap((l) => find(l.items) ?? [])[0];
        return st ? { cap: st.cap, join: st.join, miterLimit: st.miterLimit, dash: st.dash, dashOffset: st.dashOffset, svgMiter: svg.includes('stroke-miterlimit="8"') } : null;
      });
      const pass =
        !!r && r.cap === "round" && r.join === "bevel" && r.miterLimit === 8 &&
        JSON.stringify(r.dash) === "[5,3]" && r.dashOffset === 2 && r.svgMiter;
      return { pass, detail: r };
    },
  },

  // ---- Effect menu: Feather must differ from Gaussian Blur (Illustrator parity) ----
  // Apply via the real menu, then assert the model, the rendered filter, AND that
  // the effect survives an SVG export → re-import round-trip as the SAME type.
  {
    g: "effect", id: "effect-feather",
    fn: async (s) => {
      await s.fixture(FX.rect);
      await applyEffectMenu(s, "Feather");
      const types = await effectTypes(s);
      const hasSA = await renderedFilterHasSourceAlpha(s); // feather fades the alpha
      const rt = await roundtripEffectTypes(s);
      return { pass: types.includes("feather") && hasSA === true && rt.includes("feather"), detail: { types, hasSA, rt } };
    },
  },
  {
    g: "effect", id: "effect-blur",
    fn: async (s) => {
      await s.fixture(FX.rect);
      await applyEffectMenu(s, "Gaussian Blur");
      const types = await effectTypes(s);
      const hasSA = await renderedFilterHasSourceAlpha(s); // plain blur: no SourceAlpha pass
      const rt = await roundtripEffectTypes(s);
      const pass =
        types.includes("blur") && !types.includes("feather") && hasSA === false &&
        rt.includes("blur") && !rt.includes("feather");
      return { pass, detail: { types, hasSA, rt } };
    },
  },
  {
    g: "effect", id: "effect-glow",
    fn: async (s) => {
      // Regression: the new feather detection must not steal glow on round-trip.
      await s.fixture(FX.rect);
      await applyEffectMenu(s, "Outer Glow");
      const types = await effectTypes(s);
      const rt = await roundtripEffectTypes(s);
      return { pass: types.includes("glow") && rt.includes("glow") && !rt.includes("feather"), detail: { types, rt } };
    },
  },
  {
    g: "effect", id: "effect-drop-shadow",
    fn: async (s) => {
      // Effect ▸ Drop Shadow → model + a rendered feDropShadow + survives a round-trip.
      await s.fixture(FX.rect);
      await applyEffectMenu(s, "Drop Shadow");
      const types = await effectTypes(s);
      const hasShadow = await s.page.evaluate(() => {
        const id = window.__artisanStore.getState().selection[0];
        const node = document.querySelector(`svg.artisan-canvas [data-id="${id}"]`);
        const filter = node ? node.querySelector("filter") : null;
        return filter ? /feDropShadow/.test(filter.innerHTML) : false;
      });
      const rt = await roundtripEffectTypes(s);
      return { pass: types.includes("drop-shadow") && hasShadow && rt.includes("drop-shadow"), detail: { types, hasShadow, rt } };
    },
  },
  {
    g: "effect", id: "effect-inner-glow",
    fn: async (s) => {
      // Effect ▸ Inner Glow → model + a rendered filter with the distinctive
      // operator="out" pass (unique to inner glow), and a round-trip that
      // re-detects it as inner-glow (not a plain blur and not outer glow).
      await s.fixture(FX.rect);
      await applyEffectMenu(s, "Inner Glow");
      const types = await effectTypes(s);
      const hasSA = await renderedFilterHasSourceAlpha(s); // inner glow composites against the alpha
      const hasOut = await s.page.evaluate(() => {
        const id = window.__artisanStore.getState().selection[0];
        const node = document.querySelector(`svg.artisan-canvas [data-id="${id}"]`);
        const filter = node ? node.querySelector("filter") : null;
        return filter ? /operator="out"/.test(filter.innerHTML) : false;
      });
      const rt = await roundtripEffectTypes(s);
      const pass =
        types.includes("inner-glow") && hasSA === true && hasOut === true &&
        rt.includes("inner-glow") && !rt.includes("blur") && !rt.includes("glow");
      return { pass, detail: { types, hasSA, hasOut, rt } };
    },
  },
  {
    // Effect ▸ Stylize ▸ Scribble: a filled square becomes an open path stroked
    // in its former fill colour (the fill is replaced by the scribble line).
    g: "effect", id: "effect-scribble",
    fn: async (s) => {
      const [rid] = await s.fixture(
        `const A=(x,y)=>E.makeAnchor({x,y});const p=E.makePath({closed:true,anchors:[A(150,150),A(250,150),A(250,250),A(150,250)]},{fill:E.solid(E.rgba(220,80,80))});doc.layers[0].items.push(p);return[p.id];`,
      );
      await applyEffectMenu(s, "Scribble");
      const res = await s.page.evaluate((id) => {
        const it = window.__Q.getItem(window.__artisanStore.getState().doc, id);
        return {
          type: it.type,
          closed: it.geometry ? it.geometry.closed : null,
          fill: it.fill ? it.fill.type : null,
          strokeR: it.stroke && it.stroke.paint && it.stroke.paint.type === "solid" ? it.stroke.paint.color.r : null,
          anchors: it.geometry && it.geometry.anchors ? it.geometry.anchors.length : 0,
        };
      }, rid);
      const pass = res.type === "path" && res.closed === false && res.fill === "none" && res.strokeR === 220 && res.anchors > 2;
      return { pass, detail: res };
    },
  },

  // ---- reverse gradient (Gradient panel "Reverse" button) ----
  {
    g: "build", id: "reverse-gradient",
    fn: async (s) => {
      // a rect with a red→blue gradient; the Gradient panel's Reverse button
      // flips the stop order so blue leads.
      const [rid] = await s.fixture(
        `const g=E.linearGradient([{offset:0,color:E.rgba(220,80,80)},{offset:1,color:E.rgba(80,120,220)}]);` +
          `const r=E.makeRect(150,150,120,90,0,0,{fill:g});doc.layers[0].items.push(r);return[r.id];`,
      );
      const stop0r = (id) =>
        s.page.evaluate((iid) => {
          const f = window.__Q.getItem(window.__artisanStore.getState().doc, iid).fill;
          return f.type === "gradient" ? f.gradient.stops[0].color.r : null;
        }, id);
      const before = await stop0r(rid); // 220 (red leads)
      await openTab(s, "Gradient");
      await s.page.locator('[data-testid="gradient-reverse"]').first().click();
      await s.page.waitForTimeout(120);
      const after = await stop0r(rid); // 80 (blue leads)
      const pass = before === 220 && after === 80;
      return { pass, detail: { before, after } };
    },
  },

  // ---- rail reachability: every flyout group opens + selects via the real UI ----
  ...[
    ["group-selection", "Group Selection"], ["add-anchor", "Add Anchor Point"], ["convert-anchor", "Anchor Point"],
    ["area-type", "Area Type"], ["polar-grid", "Polar Grid"], ["star", "Star"], ["flare", "Flare"],
    ["blob-brush", "Blob Brush"], ["smooth", "Smooth"], ["live-paint-bucket", "Live Paint Bucket"], ["knife", "Knife"],
    ["reflect", "Reflect"], ["reshape", "Reshape"], ["wrinkle", "Wrinkle"], ["symbol-styler", "Symbol Styler"],
    ["radar-graph", "Radar Graph"], ["perspective-selection", "Perspective Selection"], ["slice-selection", "Slice Selection"],
    ["rotate-view", "Rotate View"],
    // first-of-group members reached via their flyout (order-independent: the rail
    // remembers each slot's last pick, so don't assume the pristine default label).
    ["pen", "Pen"], ["type", "Type"], ["rect", "Rectangle"],
  ].map(([id, name]) => ({
    g: "rail", id: `rail-${id}`,
    fn: async (s) => {
      await s.reset();
      const found = await s.pickFromFlyout(name);
      const snap = await s.snapshot();
      return { pass: found && snap.tool === id, detail: { found, tool: snap.tool } };
    },
  })),
  // ---- rail reachability: single-slot tools (direct click) ----
  ...[
    ["selection", "Selection (V)"], ["gradient", "Gradient (G)"], ["mesh", "Mesh (U)"],
    ["eyedropper", "Eyedropper (I)"], ["zoom", "Zoom (Z)"],
  ].map(([id, name]) => ({
    g: "rail", id: `rail-${id}`,
    fn: async (s) => {
      await s.reset();
      await s.clickRailSlot(name);
      const snap = await s.snapshot();
      return { pass: snap.tool === id, detail: { tool: snap.tool } };
    },
  })),
];

// ── runner ──
const run = async () => {
  const specs = SPECS.filter((sp) => !FILTER || sp.id.toLowerCase().includes(FILTER) || sp.g.includes(FILTER));
  const s = await launch();
  const results = [];
  for (const sp of specs) {
    let r;
    try {
      r = await sp.fn(s);
    } catch (e) {
      r = { pass: false, detail: { error: String(e).slice(0, 300) } };
    }
    await s.screenshot(`${SHOTS}/${sp.id}.png`).catch(() => {});
    results.push({ id: sp.id, group: sp.g, pass: r.pass, detail: r.detail });
  }
  const errs = s.errors.slice();
  await s.close();

  const passed = results.filter((r) => r.pass);
  const failed = results.filter((r) => !r.pass);
  console.log("\n=== TOOL E2E RESULTS ===");
  for (const r of results) console.log(`${r.pass ? "✅" : "❌"} ${r.id.padEnd(22)} ${r.pass ? "" : JSON.stringify(r.detail)}`);
  console.log(`\n${passed.length}/${results.length} passed`);
  if (failed.length) console.log("FAILED:", failed.map((f) => f.id).join(", "));
  if (errs.length) console.log("PAGE ERRORS:", JSON.stringify(errs.slice(0, 10), null, 2));
  process.exit(failed.length || errs.length ? 1 : 0);
};

run();
