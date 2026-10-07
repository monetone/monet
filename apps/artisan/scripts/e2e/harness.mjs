// ─────────────────────────────────────────────────────────────
// e2e/harness — shared Playwright driver for Monet Artisan tools.
//
// Drives the REAL app in headless Chrome against the vite dev server
// (http://127.0.0.1:1421). Tool *interaction* is genuine pointer/keyboard
// input on <svg.artisan-canvas>; *activation* and *assertions* go through the
// dev hook `window.__artisanStore` / `window.__engine` for reliability.
//
// Coordinates: world↔client is computed from the LIVE view (zoom/tx/ty) read
// out of the store each time, so drags land correctly at any zoom/pan.
// ─────────────────────────────────────────────────────────────

import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.ARTISAN_URL || "http://127.0.0.1:1421/";

export async function launch({ headless = true } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; // real JS errors (page exceptions + non-resource console errors)
  const resourceErrors = []; // failed network requests (e.g. favicon) — non-fatal
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource/i.test(t)) resourceErrors.push(t);
    else errors.push(`console: ${t}`);
  });
  page.on("requestfailed", (r) => resourceErrors.push(`${r.url()} (${r.failure()?.errorText || "failed"})`));
  page.on("response", (r) => {
    if (r.status() >= 400) resourceErrors.push(`${r.url()} → ${r.status()}`);
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  // Wait for the dev hook + canvas to be live.
  await page.waitForFunction(
    () => !!window.__artisanStore && !!window.__engine && !!document.querySelector("svg.artisan-canvas"),
    { timeout: 15000 },
  );
  await page.waitForTimeout(250);
  return new Session(browser, page, errors, resourceErrors);
}

export class Session {
  constructor(browser, page, errors, resourceErrors) {
    this.browser = browser;
    this.page = page;
    this.errors = errors;
    this.resourceErrors = resourceErrors || [];
  }

  async close() {
    await this.browser.close();
  }

  /** Fresh empty doc + known view (zoom 1, world origin at canvas px 120,120). */
  async reset() {
    await this.page.evaluate(() => {
      const E = window.__engine;
      const doc = E.makeDocument("E2E", 900, 700);
      window.__artisanStore.replaceDoc(doc, { markClean: true });
      window.__artisanStore.setView({ zoom: 1, tx: 120, ty: 120, angle: 0 });
      window.__artisanStore.setTool("selection");
      window.__artisanStore.clearSelection();
    });
    await this.page.waitForTimeout(40);
  }

  /** Pick `value` in a Monet <Select>: click its trigger, then the option in the portalled listbox. */
  async chooseOption(trigger, value) {
    await this.page.locator(trigger).click();
    await this.page.locator(`.monet-listbox [role="option"][data-value="${value}"]`).click();
  }

  /** Activate a tool by id via the store hook (fires the React activate cycle). */
  async setTool(id) {
    await this.page.evaluate((t) => window.__artisanStore.setTool(t), id);
    await this.page.waitForTimeout(30);
  }

  /** Read a compact snapshot of editor state for assertions. */
  async snapshot() {
    return this.page.evaluate(() => {
      const s = window.__artisanStore.getState();
      const flat = [];
      const walk = (items) => {
        for (const it of items) {
          flat.push({ id: it.id, type: it.type, name: it.name });
          if (it.type === "group") walk(it.children);
        }
      };
      for (const l of s.doc.layers) walk(l.items);
      const top = [];
      for (const l of s.doc.layers)
        for (const it of l.items)
          top.push({ id: it.id, type: it.type, name: it.name, children: it.type === "group" ? it.children.length : undefined });
      return {
        tool: s.tool,
        selection: s.selection,
        anchorSelection: s.anchorSelection,
        items: flat,
        itemCount: flat.length,
        top,
        topCount: top.length,
        view: s.view,
        artboards: s.doc.artboards.length,
        slices: (s.doc.slices || []).length,
        editingTextId: s.editingTextId || null,
        perspectiveGrid: !!s.perspectiveGrid,
        selectedSlice: s.selectedSlice || null,
        revision: s.revision,
      };
    });
  }

  /** Geometry/transform detail for a given item id (for deep assertions). */
  async itemDetail(id) {
    return this.page.evaluate((iid) => {
      const s = window.__artisanStore.getState();
      const it = window.__Q.getItem(s.doc, iid);
      if (!it) return null;
      const r = (n) => Math.round(n * 100) / 100;
      const m = it.transform;
      const out = {
        id: it.id,
        type: it.type,
        transform: m,
        det: m ? r(m.a * m.d - m.b * m.c) : null,
        fill: it.fill,
        fillColor: it.fill && it.fill.type === "solid" ? it.fill.color : null,
        fillType: it.fill?.type,
        stroke: it.stroke,
        widthProfile: it.stroke?.widthProfile || null,
      };
      if (it.type === "path") {
        const a = it.geometry.anchors;
        out.anchors = a.length;
        out.closed = it.geometry.closed;
        out.anchorsHash = a.map((p) => `${r(p.point.x)},${r(p.point.y)}`).join("|");
        out.hasHandles = a.some(
          (p) => Math.abs(p.handleIn?.x || 0) + Math.abs(p.handleIn?.y || 0) + Math.abs(p.handleOut?.x || 0) + Math.abs(p.handleOut?.y || 0) > 0.01,
        );
      }
      if (it.type === "rect") (out.width = it.width), (out.height = it.height);
      if (it.type === "text") (out.text = it.text), (out.pathD = it.pathD || null), (out.boxWidth = it.boxWidth || null), (out.runs = it.runs ? it.runs.length : 0);
      if (it.type === "polygon") out.sides = it.sides;
      if (it.type === "star") out.points = it.points;
      if (it.type === "compound") {
        out.subpaths = it.subpaths.length;
        // Per-subpath world Y range (pathfinder output has identity transform).
        out.subpathY = it.subpaths.map((sp) => {
          const ys = sp.anchors.map((a) => a.point.y);
          return [r(Math.min(...ys)), r(Math.max(...ys))];
        });
      }
      if (it.type === "group") {
        // Signature per child: its transform PLUS the paint of every leaf beneath
        // it. A symbol instance is itself a group whose own fill is `none`, so a
        // depth-1 fill could never see the Stainer/Styler change anything.
        const leafFills = (n) => (n.children ? n.children.flatMap(leafFills) : [JSON.stringify(n.fill) + JSON.stringify(n.stroke?.paint ?? null)]);
        out.childTransforms = it.children.map((c) => JSON.stringify(c.transform) + "/" + leafFills(c).join("|"));
      }
      const b = window.__Q.worldBounds(s.doc, iid);
      out.bounds = b ? { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height) } : null;
      return out;
    }, id);
  }

  /** Lasso through a sequence of world points (down → moves → up). */
  async lasso(points) {
    const clients = [];
    for (const p of points) clients.push(await this._toClient(p));
    await this.page.mouse.move(clients[0].x, clients[0].y);
    await this.page.mouse.down();
    for (let i = 1; i < clients.length; i++) await this.page.mouse.move(clients[i].x, clients[i].y, { steps: 3 });
    await this.page.mouse.up();
    await this.page.waitForTimeout(60);
  }

  /** Build a fixture in the browser; `build` runs with (E=engine) and returns ids to select. */
  async fixture(buildFnString) {
    return this.page.evaluate((src) => {
      const E = window.__engine;
      const store = window.__artisanStore;
      const doc = E.makeDocument("E2E", 900, 700);
      // eslint-disable-next-line no-new-func
      const build = new Function("E", "doc", src);
      const ids = build(E, doc) || [];
      store.replaceDoc(doc, { markClean: true });
      store.clearGuides(); // guides are store-level, not in the doc — reset for per-spec isolation
      store.setView({ zoom: 1, tx: 120, ty: 120, angle: 0 });
      if (ids.length) store.setSelection(ids);
      return ids;
    }, buildFnString);
  }

  async _toClient(world) {
    return this.page.evaluate((w) => {
      const svg = document.querySelector("svg.artisan-canvas");
      const r = svg.getBoundingClientRect();
      const v = window.__artisanStore.getState().view;
      const sx = w.x * v.zoom + v.tx;
      const sy = w.y * v.zoom + v.ty;
      return { x: r.left + sx, y: r.top + sy };
    }, world);
  }

  async drag(a, b, { steps = 8, mod } = {}) {
    const ca = await this._toClient(a);
    const cb = await this._toClient(b);
    await this.page.mouse.move(ca.x, ca.y);
    await this.page.mouse.down();
    // Press the modifier AFTER mouse-down: constrain (Shift) / duplicate (Alt) are
    // read during the drag, not at the click — Shift-at-down would toggle selection.
    if (mod) await this.page.keyboard.down(mod);
    await this.page.mouse.move((ca.x + cb.x) / 2, (ca.y + cb.y) / 2, { steps: Math.ceil(steps / 2) });
    await this.page.mouse.move(cb.x, cb.y, { steps });
    await this.page.mouse.up();
    if (mod) await this.page.keyboard.up(mod);
    await this.page.waitForTimeout(60);
  }

  async click(world, { clickCount = 1, button = "left" } = {}) {
    const c = await this._toClient(world);
    await this.page.mouse.click(c.x, c.y, { clickCount, button });
    await this.page.waitForTimeout(50);
  }

  async dblclick(world) {
    const c = await this._toClient(world);
    await this.page.mouse.dblclick(c.x, c.y);
    await this.page.waitForTimeout(50);
  }

  async type(text) {
    await this.page.keyboard.type(text, { delay: 8 });
    await this.page.waitForTimeout(40);
  }

  async key(k) {
    await this.page.keyboard.press(k);
    await this.page.waitForTimeout(40);
  }

  async screenshot(path) {
    await this.page.screenshot({ path });
  }

  // ── Rail UI (tests the real flyout rail) ───────────────────────
  /** Click a directly-visible rail slot by its accessible name. */
  async clickRailSlot(name) {
    const btn = this.page.locator(`.monet-tool[aria-label="${name}"]`).first();
    await btn.click();
    await this.page.waitForTimeout(40);
  }

  /** Right-click each multi-tool slot until a flyout item named `toolName` appears, then click it. */
  async pickFromFlyout(toolName) {
    const slots = this.page.locator(".monet-tool[aria-haspopup='menu']");
    const n = await slots.count();
    for (let i = 0; i < n; i++) {
      await slots.nth(i).click({ button: "right" });
      await this.page.waitForTimeout(30);
      const item = this.page.getByRole("menuitemradio", { name: toolName, exact: true });
      if (await item.count()) {
        await item.first().click();
        await this.page.waitForTimeout(40);
        return true;
      }
      await this.page.keyboard.press("Escape");
    }
    return false;
  }
}
