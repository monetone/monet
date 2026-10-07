// Headless proof that the Rust/WASM engine renders the live document.
// Loads the app with ?renderer=rust, seeds a red rect on the (white) artboard,
// then reads the <canvas.artisan-raster> pixels back and asserts the engine
// actually painted. Run against a dev server:
//   ARTISAN_URL="http://127.0.0.1:1421/?renderer=rust" node scripts/verify-rust-render.mjs

import { launch } from "./e2e/harness.mjs";

const s = await launch({});
await s.fixture(`
  const r = E.makeRect(40, 40, 320, 220, 0, 0, { fill: E.solid(E.rgba(220, 30, 40)) });
  const t = E.makeText("Hello Rust", 60, 320, { fontSize: 48, fill: E.solid(E.BLACK) });
  doc.layers[0].items.push(r, t);
  return [];
`);
await s.page.waitForTimeout(500); // let the wasm module boot + render the frame

// Hybrid: text must be present in the SVG overlay (browser font engine).
const hasText = await s.page.evaluate(() => {
  const texts = Array.from(document.querySelectorAll("svg.artisan-canvas text"));
  return texts.some((t) => (t.textContent || "").includes("Hello Rust"));
});

const stats = await s.page.evaluate(() => {
  const c = document.querySelector("canvas.artisan-raster");
  if (!c || !c.width) return { error: "no raster canvas — is ?renderer=rust active?" };
  const ctx = c.getContext("2d");
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let opaque = 0;
  let red = 0;
  let white = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 10) continue;
    opaque++;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 150 && r > g + 50 && r > b + 50) red++;
    if (r > 230 && g > 230 && b > 230) white++;
  }
  return { w: c.width, h: c.height, opaque, red, white };
});

console.log("raster stats:", JSON.stringify(stats), "hasText:", hasText);
if (s.errors.length) console.log("page JS errors:", s.errors);
await s.close();

const ok = !!stats && !stats.error && stats.opaque > 5000 && stats.red > 1000 && stats.white > 1000 && hasText;
console.log(ok ? "OK: hybrid render — Rust canvas (white artboard + red rect) + SVG text" : "FAIL: raster output not as expected");
process.exit(ok ? 0 : 1);
