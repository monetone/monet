// ─────────────────────────────────────────────────────────────
// e2e/svg-fixtures — import each SVG fixture into the real app, fit it, and
// screenshot the rendered result; report per-fixture import stats.
//   node scripts/e2e/svg-fixtures.mjs           # all
//   node scripts/e2e/svg-fixtures.mjs gradient   # filter by filename
// Screenshots → /tmp/artisan-svg/<fixture>.png
// ─────────────────────────────────────────────────────────────

import { launch } from "./harness.mjs";
import { ensureServer } from "./server.mjs";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FILTER = (process.argv[2] || "").toLowerCase();
const HERE = dirname(fileURLToPath(import.meta.url));
const FXDIR = join(HERE, "fixtures", "svg");
const OUT = "/tmp/artisan-svg";
mkdirSync(OUT, { recursive: true });

// gap-specific regression expectations (checked against per-import `sig`)
const EXPECT = {
  "03-gradients.svg": (g) => g.gradients >= 3,
  "13-gradients-advanced.svg": (g) => g.gradients >= 4 && g.rotatedGradient, // gradientTransform applied
  "14-use-symbol-defs.svg": (g) => g.flat >= 6, // <use> resolved (2 stars + 2 badges)
  "15-clippath-mask.svg": (g) => g.clipGroups >= 1 && g.masked >= 1,
  "16-pattern.svg": (g) => g.patternFills >= 1,
  "22-pattern-offset.svg": (g) => g.patternFills >= 1,
  "17-filters.svg": (g) => g.effects.includes("blur") && g.effects.includes("drop-shadow"),
  "18-text-advanced.svg": (g) => g.textAligns.includes("center") && g.textAligns.includes("right") && g.textRuns >= 1,
  "19-image-datauri.svg": (g) => g.images >= 2,
  "23-glow.svg": (g) => g.effects.includes("glow"),
  "24-mask-alpha.svg": (g) => g.masked >= 1 && g.alphaMasks >= 1,
  "25-pattern-obb.svg": (g) => g.patternFills >= 1,
};

const stop = await ensureServer();
const s = await launch();
const files = readdirSync(FXDIR).filter((f) => f.endsWith(".svg") && f.toLowerCase().includes(FILTER)).sort();
const results = [];

for (const f of files) {
  const svg = readFileSync(join(FXDIR, f), "utf8");
  const bytes = [...Buffer.from(svg, "utf8")]; // UTF-8, so non-ASCII (e.g. em dash) survives
  await s.page.evaluate(() => {
    const st = window.__artisanStore;
    st.setOutlineMode(false);
    st.setRulers(true);
    st.patchGrid({ show: false });
  });
  let stat;
  try {
    stat = await s.page.evaluate(async ({ name, data }) => {
      const st = window.__artisanStore;
      const E = window.__engine;
      const signals = (doc) => {
        const flat = [];
        const walk = (items) => { for (const it of items) { flat.push(it); if (it.type === "group") walk(it.children); } };
        for (const l of doc.layers) walk(l.items);
        const grads = flat.filter((it) => it.fill && it.fill.type === "gradient").map((it) => it.fill.gradient);
        return {
          flat: flat.length,
          effects: flat.flatMap((it) => it.effects || []).map((e) => e.type),
          gradients: grads.length,
          rotatedGradient: grads.some((gr) => Math.abs(gr.x1) > 0.01 && Math.abs(gr.y1) > 0.01),
          spreads: grads.filter((gr) => gr.spread).map((gr) => gr.spread),
          textAligns: flat.filter((it) => it.type === "text").map((it) => it.align),
          images: flat.filter((it) => it.type === "image").length,
          clipGroups: flat.filter((it) => it.type === "group" && it.clip).length,
          masked: flat.filter((it) => it.mask && it.mask.length).length,
          alphaMasks: flat.filter((it) => it.maskType === "alpha").length,
          patternFills: flat.filter((it) => it.fill && it.fill.type === "pattern").length,
          textRuns: flat.filter((it) => it.type === "text" && it.runs && it.runs.length).length,
        };
      };
      const r = await window.__doImport(name, data);
      const sig = signals(st.getState().doc);
      // round-trip: export the imported doc → re-import → recompute signals
      let sig2 = null;
      try {
        const svgOut = E.IO.exportSVG(st.getState().doc);
        await window.__doImport("roundtrip.svg", [...new TextEncoder().encode(svgOut)]);
        sig2 = signals(st.getState().doc);
      } catch (e) {
        sig2 = { error: String(e).slice(0, 120) };
      }
      // fit + screenshot the (round-tripped) doc
      const g = st.getState();
      const ab = g.doc.artboards[g.doc.activeArtboard] || g.doc.artboards[0];
      const vp = g.viewport;
      const z = Math.min((vp.width * 0.82) / ab.width, (vp.height * 0.82) / ab.height);
      st.setView({ zoom: z, tx: vp.width / 2 - (ab.x + ab.width / 2) * z, ty: vp.height / 2 - (ab.y + ab.height / 2) * z, angle: 0 });
      st.clearSelection();
      return { ...r, ab: { w: Math.round(ab.width), h: Math.round(ab.height) }, sig, sig2 };
    }, { name: f, data: bytes });
  } catch (e) {
    stat = { items: 0, types: [], warnings: [`threw: ${String(e).slice(0, 120)}`], ab: { w: 0, h: 0 } };
  }
  await s.page.waitForTimeout(140);
  await s.screenshot(`${OUT}/${f.replace(/\.svg$/, "")}.png`);
  results.push({ file: f, ...stat });
}

const errs = s.errors.slice();
await s.close();
stop();

console.log("\n=== SVG IMPORT FIXTURES ===");
let bad = 0;
// feature counts that must survive export → re-import
const RT_KEYS = ["effects", "gradients", "spreads", "clipGroups", "masked", "alphaMasks", "patternFills", "textRuns", "images"];
const rtNorm = (s) => RT_KEYS.map((k) => (Array.isArray(s[k]) ? s[k].length : s[k])).join(",");

let failedExpect = 0;
let failedRT = 0;
for (const r of results) {
  const uniq = [...new Set(r.types)].join(",");
  let flag = r.items === 0 ? "  ⚠ EMPTY" : r.warnings.length ? `  ⚠ ${r.warnings.length} warning(s)` : "";
  if (r.items === 0 || r.warnings.length) bad++;
  const check = EXPECT[r.file];
  if (check) {
    const ok = r.sig ? !!check(r.sig) : false;
    if (!ok) {
      failedExpect++;
      flag += `  ✗ EXPECT FAILED ${JSON.stringify(r.sig)}`;
    } else flag += "  ✓";
  }
  // round-trip: exported + re-imported feature counts must match the original
  if (r.sig && r.sig2 && !r.sig2.error) {
    if (rtNorm(r.sig) !== rtNorm(r.sig2)) {
      failedRT++;
      flag += `  ⟲ RT-DIFF [${RT_KEYS.join(",")}] orig=${rtNorm(r.sig)} rt=${rtNorm(r.sig2)}`;
    } else flag += " ⟲";
  } else if (r.sig2 && r.sig2.error) {
    failedRT++;
    flag += `  ⟲ RT-ERROR ${r.sig2.error}`;
  }
  console.log(`${r.file.padEnd(24)} ${String(r.items).padStart(2)} items  ab ${r.ab.w}x${r.ab.h}  [${uniq}]${flag}`);
  if (r.warnings.length) console.log("      warnings:", r.warnings.slice(0, 3));
}
console.log(`\n${results.length} fixtures, ${bad} with warnings/empty, ${failedExpect} expectation failure(s), ${failedRT} round-trip diff(s).`);
if (errs.length) console.log("PAGE ERRORS:", JSON.stringify(errs.slice(0, 5)));
console.log(`Screenshots in ${OUT}/`);
process.exit(errs.length || failedExpect || failedRT ? 1 : 0);
