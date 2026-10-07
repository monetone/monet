// shared-core-develop-proof — resurrected native↔wasm develop equivalence gate.
//
// The old shared-core-wasm-proof.mjs targeted the galerie-fork engine API
// (canonicalizeDevelopRecipe / fromDevelopRgba16 / developRecipe) that the
// engine merge removed; it has been dead since. The current shared develop ABI
// is `Engine.camera_raw_develop(recipeToParams(recipe, scale))`. This proof
// pins that BOTH engines — the native monet-photo-core (Galerie's full-res
// export path) and the wasm monet-render-engine (the browser preview) — produce
// byte-identical develop output for the same recipe. It is the gate every
// Phase-6b tail-feature port must keep green.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = resolve(import.meta.dirname, "..");
const engineRoot = resolve(app, "../../packages/engine");

// Named recipe cases. Each pins native develop_in_place == wasm
// camera_raw_develop byte-for-byte. "basic" exercises the 1086 prefix with a
// neutral advanced tail; "calibration" drives the source-profile +
// camera-calibration stage (the tail's first stage) so it must diverge from
// "basic" — proving the stage actually ran.
const fixture = JSON.parse(
  readFileSync(resolve(engineRoot, "../monet-ui/packages/monet-photo/fixtures/canonical-recipe-v2.json"), "utf8"),
);

function basicRecipe() {
  const recipe = structuredClone(fixture.recipe);
  recipe.basic.exposure = 0.3;
  recipe.basic.texture = 0.4;
  recipe.basic.dehaze = 0.2;
  return recipe;
}

function calibrationRecipe() {
  const recipe = basicRecipe();
  recipe.profile.id = "adobe-color";
  recipe.profile.amount = 1;
  recipe.calibration.shadowTint = 0.5;
  recipe.calibration.redHue = 0.3;
  recipe.calibration.greenSat = -0.2;
  recipe.calibration.blueHue = 0.25;
  return recipe;
}

function healRecipe() {
  const recipe = basicRecipe();
  // Two non-neutral spots on the 6x4 proof image: one "heal", one "clone".
  // recipeToParams(recipe, 1) serializes these into the advanced heal tail.
  recipe.heal = {
    spots: [
      { mode: "heal", x: 0.75, y: 0.5, sourceX: 0.25, sourceY: 0.5, radius: 0.45, feather: 0.3, opacity: 1 },
      { mode: "clone", x: 0.35, y: 0.25, sourceX: 0.7, sourceY: 0.75, radius: 0.4, feather: 0.2, opacity: 0.9 },
    ],
  };
  return recipe;
}

function pointColorRecipe() {
  const recipe = basicRecipe();
  // Non-neutral sockets, geometry neutral. recipeToParams(recipe, 1) serializes
  // these into the V3 socket block (step 12.5, before geometry).
  recipe.pointColor = {
    samples: [
      { srcHue: 210, srcSat: 0.6, srcLum: 0.45, hue: 0.4, sat: 0.5, lum: -0.2, range: 0.5 },
      { srcHue: 30, srcSat: 0.8, srcLum: 0.55, hue: -0.3, sat: 0.6, lum: 0.25, range: 0.4 },
    ],
  };
  return recipe;
}

function geometryRecipe() {
  const recipe = basicRecipe();
  // Non-neutral transform, no point color — proves the geometry split (zero it
  // in apply_bounded, run it after) preserves the basic develop bit-for-bit.
  recipe.transform.vertical = 0.3;
  recipe.transform.horizontal = -0.2;
  recipe.transform.rotate = 0.4;
  return recipe;
}

function pointColorGeometryRecipe() {
  const recipe = pointColorRecipe();
  // BOTH non-neutral — proves the interleave order (Point Color on un-warped
  // pixels, THEN geometry) matches wasm develop_buf.
  recipe.transform.vertical = 0.3;
  recipe.transform.horizontal = -0.2;
  recipe.transform.rotate = 0.4;
  return recipe;
}

function allFeaturesRecipe() {
  // Every engine-applied tail feature non-neutral at once — proves they compose
  // in the wasm pipeline order (profile/calibration → basic → point color →
  // geometry → heal) without native drift.
  const recipe = calibrationRecipe();
  recipe.heal = healRecipe().heal;
  recipe.pointColor = pointColorRecipe().pointColor;
  recipe.transform.vertical = 0.25;
  recipe.transform.horizontal = 0.15;
  recipe.transform.rotate = -0.3;
  return recipe;
}

function monochromeRecipe() {
  // profile.id "monochrome" = engine code 3 (the desaturating luma path), a
  // profile arm the other cases don't exercise.
  const recipe = basicRecipe();
  recipe.profile.id = "monochrome";
  recipe.profile.amount = 0.8;
  return recipe;
}

function healCapRecipe() {
  // 60 spots — near the recipe's checked limit (DEV_MAX_HEALS=64). Exercises the
  // develop with many overlapping heal/clone spots; native==wasm must still hold.
  const recipe = basicRecipe();
  const spots = [];
  for (let i = 0; i < 60; i++) {
    spots.push({
      mode: i % 2 ? "clone" : "heal",
      x: (i % 6) / 6 + 0.02, y: (i % 4) / 4 + 0.02,
      sourceX: ((i + 2) % 6) / 6 + 0.02, sourceY: ((i + 1) % 4) / 4 + 0.02,
      radius: 0.08 + (i % 5) * 0.02, feather: 0.2, opacity: 0.85,
    });
  }
  recipe.heal = { spots };
  return recipe;
}

function pointColorCapRecipe() {
  // 8 sockets — the develop cap DEV_MAX_POINT_COLORS. Exercises the full socket
  // block; native point_colors_from_recipe and the wasm parser both take 8.
  const recipe = basicRecipe();
  const samples = [];
  for (let i = 0; i < 8; i++) {
    samples.push({ srcHue: (i * 36) % 360, srcSat: 0.5, srcLum: 0.5, hue: ((i % 3) - 1) * 0.3, sat: 0.4, lum: 0.1, range: 0.4 });
  }
  recipe.pointColor = { samples };
  return recipe;
}

function extremeCalibrationRecipe() {
  // Clamp-edge profile/calibration values — proves native clamps match wasm.
  const recipe = basicRecipe();
  recipe.profile.id = "camera-neutral";
  recipe.profile.amount = 1;
  recipe.calibration.shadowTint = -1;
  recipe.calibration.redHue = 1; recipe.calibration.redSat = 1;
  recipe.calibration.greenHue = -1; recipe.calibration.greenSat = -1;
  recipe.calibration.blueHue = 1; recipe.calibration.blueSat = -1;
  return recipe;
}

const cases = [
  { name: "basic", recipe: basicRecipe() },
  { name: "calibration", recipe: calibrationRecipe() },
  { name: "heal", recipe: healRecipe() },
  { name: "pointColor", recipe: pointColorRecipe() },
  { name: "geometry", recipe: geometryRecipe() },
  { name: "pointColorGeometry", recipe: pointColorGeometryRecipe() },
  { name: "allFeatures", recipe: allFeaturesRecipe() },
  { name: "monochrome", recipe: monochromeRecipe() },
  { name: "healCap", recipe: healCapRecipe() },
  { name: "pointColorCap", recipe: pointColorCapRecipe() },
  { name: "extremeCalibration", recipe: extremeCalibrationRecipe() },
];

// --- Wasm side: the current camera_raw_develop(params) ABI.
const { default: init, Engine } = await import(resolve(app, "engine/pkg/monet_render_engine.js"));
await init({ module_or_path: readFileSync(resolve(app, "engine/pkg/monet_render_engine_bg.wasm")) });
const { recipeToParams } = await import("@monet-ui/monet-photo");

const mismatch = (a, b) => {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `index ${i}: ${a[i]} vs ${b[i]}`;
  return null;
};

const outputs = {};
for (const { name, recipe } of cases) {
  // --- Native golden: monet-photo-core develop_in_place, via wasm_golden example.
  const native = spawnSync("cargo", ["run", "--quiet", "-p", "monet-photo-core", "--example", "wasm_golden"], {
    cwd: engineRoot,
    input: JSON.stringify(recipe),
    encoding: "utf8",
  });
  if (native.status !== 0) throw new Error(`native golden failed (${name}):\n${native.stderr || native.stdout}`);
  const golden = JSON.parse(native.stdout);

  const params = Float32Array.from(recipeToParams(recipe, 1));
  function wasmDevelop(input, linear) {
    const engine = Engine.fromRgba16(golden.width, golden.height, Uint16Array.from(input), linear);
    engine.camera_raw_develop(params);
    const out = Array.from(engine.export_composite_rgba16());
    engine.free();
    return out;
  }

  const linearOutput = wasmDevelop(golden.linearInput, true);
  const encodedOutput = wasmDevelop(golden.encodedInput, false);

  const lin = mismatch(linearOutput, golden.linearOutput);
  const enc = mismatch(encodedOutput, golden.encodedOutput);
  if (lin || enc) {
    throw new Error(
      `wasm camera_raw_develop output differs from native shared-core develop_in_place (${name})\n` +
        (lin ? `  linear: ${lin}\n` : "") +
        (enc ? `  encoded: ${enc}\n` : ""),
    );
  }
  outputs[name] = { linearOutput, dimensions: [golden.width, golden.height], samples: linearOutput.length };
}

// The calibration case must actually change the pixels vs basic — otherwise the
// profile/calibration stage silently did nothing and the equivalence above is
// vacuous.
if (mismatch(outputs.basic.linearOutput, outputs.calibration.linearOutput) === null) {
  throw new Error("calibration case output is identical to basic — profile/calibration stage did not run");
}

// Likewise, the heal case must actually change pixels vs basic — otherwise the
// heal/clone tail did nothing (either recipeToParams dropped the spots, or the
// native heal stage is a no-op) and the byte-equality above is vacuous.
if (mismatch(outputs.basic.linearOutput, outputs.heal.linearOutput) === null) {
  throw new Error("heal case output is identical to basic — heal/clone-spot stage did not run");
}

// Point Color must change pixels vs basic — else recipeToParams dropped the
// sockets or the native point_color stage is a no-op.
if (mismatch(outputs.basic.linearOutput, outputs.pointColor.linearOutput) === null) {
  throw new Error("pointColor case output is identical to basic — Point Color stage did not run");
}

// Geometry must change pixels vs basic — else the split dropped the geometry
// stage (proving the interleave preserves geometry, not just skips it).
if (mismatch(outputs.basic.linearOutput, outputs.geometry.linearOutput) === null) {
  throw new Error("geometry case output is identical to basic — geometry stage did not run");
}

// Composite / edge cases must each move the pixels vs basic too — otherwise the
// added coverage is vacuous even though native==wasm held trivially.
for (const name of ["allFeatures", "monochrome", "healCap", "pointColorCap", "extremeCalibration"]) {
  if (mismatch(outputs.basic.linearOutput, outputs[name].linearOutput) === null) {
    throw new Error(`${name} case output is identical to basic — its stage(s) did not run`);
  }
}

console.log(
  JSON.stringify({
    pass: true,
    engine: "camera_raw_develop",
    cases: cases.map((c) => c.name),
    dimensions: outputs.basic.dimensions,
    samples: outputs.basic.samples,
  }),
);
