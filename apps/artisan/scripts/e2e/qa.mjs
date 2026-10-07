// ─────────────────────────────────────────────────────────────
// e2e/qa — extensive VISUAL QA of the whole app surface.
//
// Drives the real UI (menus, panels, workflows, view) and screenshots each
// scene to /tmp/artisan-qa for human review. Records any console/page error
// per scene as a QA signal. Not a pass/fail suite — it produces evidence.
//   node scripts/e2e/qa.mjs           # all scenes
//   node scripts/e2e/qa.mjs panel     # filter scenes by name
// ─────────────────────────────────────────────────────────────

import { launch } from "./harness.mjs";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";

const FILTER = (process.argv[2] || "").toLowerCase();
const DIR = "/tmp/artisan-qa";
mkdirSync(DIR, { recursive: true });

// Keep a vite dev server alive for the whole run (as a child of THIS process,
// so it isn't reaped between steps). Returns a teardown fn.
const PORT = 1421;
const portUp = () =>
  new Promise((res) => {
    const sock = net.connect(PORT, "127.0.0.1");
    sock.on("connect", () => (sock.end(), res(true)));
    sock.on("error", () => res(false));
  });
async function ensureServer() {
  if (await portUp()) return () => {};
  const vite = spawn("pnpm", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  for (let i = 0; i < 60 && !(await portUp()); i++) await new Promise((r) => setTimeout(r, 500));
  return () => vite.kill("SIGTERM");
}

// fixtures
const FX = {
  three: `
    const a=E.makeRect(120,150,120,90,0,0,{fill:E.solid(E.rgba(220,90,90))});
    const b=E.makeEllipse(300,170,130,100,{fill:E.solid(E.rgba(80,170,120))});
    const c=E.makeStar(230,370,62,30,5,{fill:E.solid(E.rgba(90,120,220))});
    doc.layers[0].items.push(a,b,c); return [a.id,b.id,c.id];`,
  one: `const r=E.makeRect(220,180,200,150,0,0,{fill:E.solid(E.rgba(220,120,80)),stroke:E.defaultStroke(E.solid(E.BLACK),3)});doc.layers[0].items.push(r);return[r.id];`,
  overlap: `
    const a=E.makeRect(180,180,170,150,0,0,{fill:E.solid(E.rgba(220,90,90))});
    const b=E.makeEllipse(300,230,170,150,{fill:E.solid(E.rgba(80,120,220))});
    doc.layers[0].items.push(a,b); return [a.id,b.id];`,
  layers: `
    const a=E.makeRect(150,160,130,100,0,0,{fill:E.solid(E.rgba(220,90,90))});
    const b=E.makeEllipse(300,200,120,100,{fill:E.solid(E.rgba(80,170,120))});
    const l2=E.makeLayer("Background",[E.makeRect(120,120,360,300,0,0,{fill:E.solid(E.rgba(230,230,235))})]);
    doc.layers.unshift(l2);
    doc.layers[doc.layers.length-1].items.push(a,b);
    return [a.id];`,
};

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220" viewBox="0 0 300 220">
  <rect x="20" y="20" width="120" height="90" rx="12" fill="#e0573a"/>
  <circle cx="220" cy="80" r="55" fill="#3ac06a"/>
  <path d="M40 180 L150 120 L260 190 Z" fill="#4a9eff" stroke="#222" stroke-width="3"/>
  <text x="30" y="210" font-size="20" fill="#333">SVG import</text>
</svg>`;

const findings = [];
let S;

const note = (scene, issue, extra) => findings.push({ scene, issue, ...(extra || {}) });

async function scene(name, fn) {
  if (FILTER && !name.toLowerCase().includes(FILTER)) return;
  // reset ephemeral view toggles so scenes don't inherit each other's state
  await S.page
    .evaluate(() => {
      const st = window.__artisanStore;
      st.setOutlineMode(false);
      st.setRulers(true);
      st.patchGrid({ show: false });
      st.setPerspectiveGrid(false);
    })
    .catch(() => {});
  const before = S.errors.length;
  try {
    await fn();
  } catch (e) {
    note(name, `threw during setup: ${String(e).slice(0, 160)}`);
  }
  const errs = S.errors.slice(before);
  if (errs.length) note(name, "console/page error", { errors: errs.slice(0, 4) });
  await S.screenshot(`${DIR}/${name}.png`).catch(() => {});
  process.stdout.write(`· ${name}\n`);
}

// ── UI helpers ──
const page = () => S.page;
const tab = async (name) => {
  await page().getByRole("tab", { name, exact: true }).first().click({ timeout: 4000 }).catch(async () => {
    await page().locator(".monet-tab", { hasText: name }).first().click({ timeout: 4000 });
  });
  await page().waitForTimeout(150);
};
const openMenu = async (name) => {
  await page().getByRole("menuitem", { name, exact: true }).first().click({ timeout: 4000 });
  await page().waitForTimeout(180);
};
const menuItem = async (top, label, parent) => {
  await openMenu(top);
  if (parent) {
    await page().locator(".monet-menu-item", { hasText: parent }).first().hover();
    await page().waitForTimeout(160);
  }
  await page().locator(".monet-menu-item", { hasText: label }).first().click({ timeout: 4000 });
  await page().waitForTimeout(160);
};
const btn = async (name) => {
  await page().getByRole("button", { name, exact: true }).first().click({ timeout: 4000 });
  await page().waitForTimeout(150);
};
const esc = async () => (await page().keyboard.press("Escape"), page().waitForTimeout(80));

async function run() {
  const stopServer = await ensureServer();
  S = await launch();

  // ── shell ──
  await scene("01-load-empty", async () => {
    await S.reset();
  });
  await scene("02-populated", async () => {
    await S.fixture(FX.three);
    await page().evaluate(() => window.__artisanStore.clearSelection());
  });

  // ── panels (with relevant selection) ──
  await scene("10-panel-properties", async () => {
    await S.fixture(FX.one);
    await tab("Properties");
  });
  await scene("11-panel-stroke", async () => {
    await S.fixture(FX.one);
    await tab("Stroke");
  });
  await scene("12-panel-color", async () => {
    await S.fixture(FX.one);
    await tab("Color");
  });
  await scene("13-panel-gradient", async () => {
    const [id] = await S.fixture(FX.one);
    await S.setTool("gradient");
    await S.drag({ x: 240, y: 255 }, { x: 400, y: 255 });
    await page().evaluate((i) => window.__artisanStore.setSelection([i]), id);
    await tab("Gradient");
  });
  await scene("14-panel-swatches", async () => {
    await S.fixture(FX.one);
    await tab("Swatches");
  });
  await scene("15-panel-align", async () => {
    await S.fixture(FX.three);
    await tab("Align");
  });
  await scene("16-panel-pathfinder", async () => {
    await S.fixture(FX.overlap);
    await tab("Pathfinder");
  });
  await scene("17-panel-layers", async () => {
    await S.fixture(FX.layers);
    await tab("Layers");
  });

  // ── menus (rendering) ──
  for (const m of ["File", "Edit", "Object", "Effect", "Select", "View", "Help"]) {
    await scene(`2x-menu-${m.toLowerCase()}`, async () => {
      await S.fixture(FX.three);
      await openMenu(m);
    });
    await esc();
  }
  await scene("2y-menu-object-transform", async () => {
    await S.fixture(FX.one);
    await openMenu("Object");
    await page().locator(".monet-menu-item", { hasText: "Transform" }).first().hover();
    await page().waitForTimeout(200);
  });
  await esc();

  // ── workflows ──
  await scene("30-align-center-middle", async () => {
    await S.fixture(FX.three);
    await tab("Align");
    await btn("Align center");
    await btn("Align middle");
  });
  await scene("31-pathfinder-unite", async () => {
    await S.fixture(FX.overlap);
    await tab("Pathfinder");
    await btn("Unite");
  });
  await scene("32-pathfinder-minus-front", async () => {
    await S.fixture(FX.overlap);
    await tab("Pathfinder");
    await btn("Minus front");
  });
  await scene("33-group-bring-front", async () => {
    await S.fixture(FX.overlap);
    await menuItem("Object", "Group");
    await menuItem("Object", "Bring to Front", "Arrange");
  });
  await scene("34-transform-rotate90", async () => {
    await S.fixture(FX.one);
    await menuItem("Object", "Rotate 90° CW", "Transform");
  });
  await scene("35-effect-drop-shadow", async () => {
    await S.fixture(FX.one);
    await menuItem("Effect", "Drop Shadow");
  });
  await scene("36-effect-blur", async () => {
    await S.fixture(FX.one);
    await menuItem("Effect", "Gaussian Blur");
  });
  await scene("37-effect-glow", async () => {
    await S.fixture(FX.one);
    await menuItem("Effect", "Outer Glow");
  });
  await scene("38-swatch-apply", async () => {
    await S.fixture(FX.one);
    await tab("Swatches");
    await btn("#24F224");
  });
  await scene("39-duplicate", async () => {
    await S.fixture(FX.one);
    await menuItem("Edit", "Duplicate");
  });
  await scene("40-select-all", async () => {
    await S.fixture(FX.three);
    await page().evaluate(() => window.__artisanStore.clearSelection());
    await menuItem("Select", "Select All");
  });
  await scene("41-undo-after-delete", async () => {
    await S.fixture(FX.three);
    await menuItem("Edit", "Delete");
    await menuItem("Edit", "Undo");
  });

  // ── view ──
  await scene("50-rulers-off", async () => {
    await S.fixture(FX.three);
    await menuItem("View", "Rulers");
  });
  await scene("51-grid-on", async () => {
    await S.fixture(FX.three);
    await menuItem("View", "Grid");
  });
  await scene("52-outline-mode", async () => {
    await S.fixture(FX.three);
    await menuItem("View", "Outline");
  });
  await scene("53-zoom-actual", async () => {
    await S.fixture(FX.three);
    await menuItem("View", "Actual Size");
  });
  await scene("54-multi-artboard", async () => {
    await S.reset();
    await page().evaluate(() => window.__artisanStore.setView({ zoom: 0.5, tx: 120, ty: 120, angle: 0 }));
    await S.setTool("artboard");
    await S.drag({ x: 1050, y: 250 }, { x: 1360, y: 540 });
  });

  // ── import ──
  await scene("60-import-svg", async () => {
    await page().evaluate((svg) => window.__doImport("sample.svg", svg), SAMPLE_SVG);
    await page().waitForTimeout(250);
  });

  const errs = S.errors.slice();
  await S.close();
  stopServer();

  console.log("\n=== QA FINDINGS ===");
  if (!findings.length) console.log("No console errors or setup failures recorded across scenes.");
  for (const f of findings) console.log(JSON.stringify(f));
  if (errs.length) console.log(`\nTotal page errors: ${errs.length}`);
  console.log(`\nScreenshots in ${DIR}/`);
}

run();
