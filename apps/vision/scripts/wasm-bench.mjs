// Release-WASM benchmark for the issue #3 fixtures.
//
// Fresh process per fixture. Separates full-frame composite, a 256×128 region
// composite, the RGBA output copy, and one small default brush stroke. Timings
// are hardware-specific; pixel checksums are the deterministic contract.
//
//   node scripts/wasm-bench.mjs [--out result.json] [--fixture NAME]
//
// Build the engine first: pnpm run engine:build:release

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, hostname } from "node:os";
import { fileURLToPath } from "node:url";

const WARMUPS = 12;
const SAMPLES = 25;
const REGION = { x: 0, y: 0, w: 256, h: 128 };
const FIXTURES = [
  { name: "1920x1080-1L", width: 1920, height: 1080, layers: 1 },
  { name: "3840x2160-1L", width: 3840, height: 2160, layers: 1 },
  { name: "3840x2160-4L", width: 3840, height: 2160, layers: 4 },
  { name: "6000x4000-1L", width: 6000, height: 4000, layers: 1 },
];
const LAYER_COLORS = [
  [80, 120, 200],
  [200, 80, 40],
  [40, 180, 90],
];

const args = process.argv.slice(2);
const worker = args.includes("--worker");
const fixtureArg = valueOf("--fixture");
const outArg = valueOf("--out");

if (worker) {
  const kind = valueOf("--kind");
  const fixture = FIXTURES.find((item) => item.name === fixtureArg);
  if (!fixture || (kind !== "composite" && kind !== "stroke")) {
    throw new Error(`unknown worker job ${fixtureArg} ${kind}`);
  }
  const result = kind === "composite" ? await benchComposite(fixture) : await benchStroke(fixture);
  process.stdout.write(JSON.stringify(result));
} else {
  const selected = fixtureArg ? FIXTURES.filter((item) => item.name === fixtureArg) : FIXTURES;
  if (selected.length === 0) throw new Error(`unknown fixture ${fixtureArg}`);
  const fixtures = [];
  for (const fixture of selected) {
    const composite = runWorker("composite", fixture.name);
    const stroke = runWorker("stroke", fixture.name);
    fixtures.push({ ...fixture, ...composite, stroke });
  }
  const report = {
    benchmark: "monet-release-wasm",
    capturedAt: new Date().toISOString(),
    machine: machineInfo(),
    settings: {
      profile: "release",
      optLevel: 3,
      lto: true,
      codegenUnits: 1,
      wasmOpt: false,
      target: "wasm32-unknown-unknown",
      warmups: WARMUPS,
      samples: SAMPLES,
    },
    fixtures,
  };
  const json = JSON.stringify(report, null, 2);
  if (outArg) await writeFile(outArg, json + "\n");
  process.stdout.write(json + "\n");
}

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function machineInfo() {
  const cpu = cpus()[0];
  return {
    hostname: hostname(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpuModel: cpu?.model ?? "",
    cpuCount: availableParallelism(),
  };
}

function runWorker(kind, name) {
  const script = fileURLToPath(import.meta.url);
  const result = spawnSync(process.execPath, [script, "--worker", "--kind", kind, "--fixture", name], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${kind} ${name} failed\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

async function loadEngine() {
  const initModule = await import("../engine/pkg/monet_render_engine.js");
  const bytes = await readFile(new URL("../engine/pkg/monet_render_engine_bg.wasm", import.meta.url));
  const wasm = await initModule.default({ module_or_path: bytes });
  return { Engine: initModule.Engine, memory: wasm.memory, version: initModule.engine_version() };
}

function makeDocument(Engine, fixture) {
  const engine = new Engine(fixture.width, fixture.height);
  for (let i = 1; i < fixture.layers; i++) {
    engine.add_layer(`Layer ${i + 1}`);
    const [r, g, b] = LAYER_COLORS[(i - 1) % LAYER_COLORS.length];
    engine.fill_selection(r, g, b, 128);
  }
  engine.purge();
  engine.composite();
  if (engine.layer_count() !== fixture.layers) {
    throw new Error(`${fixture.name} built ${engine.layer_count()} layers`);
  }
  if (engine.undo_depth() !== 0) {
    throw new Error(`${fixture.name} kept ${engine.undo_depth()} setup undo entries`);
  }
  return engine;
}

function outputBytes(engine, memory, pixels) {
  const ptr = engine.output_ptr();
  const view = new Uint8Array(memory.buffer, ptr, pixels * 4);
  const copy = new Uint8Array(view.length);
  copy.set(view);
  return copy;
}

function checksum(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function summarize(samples) {
  const walls = samples.map((sample) => sample.wallMs).sort((a, b) => a - b);
  const cpus = samples.map((sample) => sample.cpuMs).sort((a, b) => a - b);
  return {
    medianMs: median(walls),
    p95Ms: quantile(walls, 0.95),
    minMs: walls[0],
    maxMs: walls[walls.length - 1],
    cpuMedianMs: median(cpus),
    cpuP95Ms: quantile(cpus, 0.95),
  };
}

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function quantile(sorted, q) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

function timeCall(fn) {
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  fn();
  return {
    wallMs: performance.now() - wallStart,
    cpuMs: cpuOf(process.cpuUsage(cpuStart)),
  };
}

function cpuOf(usage) {
  return (usage.user + usage.system) / 1000;
}

function sampleLoop(fn) {
  const cold = timeCall(fn);
  for (let i = 0; i < WARMUPS; i++) fn();
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) samples.push(timeCall(fn));
  return { coldMs: cold.wallMs, coldCpuMs: cold.cpuMs, ...summarize(samples) };
}

async function benchComposite(fixture) {
  const { Engine, memory, version } = await loadEngine();
  const engine = makeDocument(Engine, fixture);
  const pixels = fixture.width * fixture.height;
  const full = sampleLoop(() => engine.composite());
  const fullBytes = outputBytes(engine, memory, pixels);
  const fullChecksum = checksum(fullBytes);
  const region = sampleLoop(() => engine.composite_region(REGION.x, REGION.y, REGION.x + REGION.w, REGION.y + REGION.h));
  const regionBytes = outputBytes(engine, memory, pixels);
  if (checksum(regionBytes) !== fullChecksum) {
    throw new Error(`${fixture.name} region composite changed pixels outside the full-frame checksum`);
  }
  const copy = sampleLoop(() => outputBytes(engine, memory, pixels));
  const mem = process.memoryUsage();
  return {
    engineVersion: version,
    fullComposite: full,
    regionComposite: { ...REGION, ...region },
    rgbaCopy: { bytes: pixels * 4, ...copy },
    checksum: fullChecksum,
    memory: memoryFields(memory, mem, liveEstimate(fixture)),
  };
}

async function benchStroke(fixture) {
  const { Engine, memory } = await loadEngine();
  const engine = makeDocument(Engine, fixture);
  const before = memory.buffer.byteLength;
  if (!engine.stroke_begin()) throw new Error(`${fixture.name} stroke_begin refused`);
  const dirty = Array.from(engine.stroke_to(150, 150, 1));
  const afterFirstDab = memory.buffer.byteLength;
  engine.stroke_end();
  const afterEnd = memory.buffer.byteLength;
  if (!engine.stroke_begin()) throw new Error(`${fixture.name} second stroke_begin refused`);
  engine.stroke_to(150, 150, 1);
  const afterSecond = memory.buffer.byteLength;
  engine.stroke_end();
  if (dirty.length !== 4 || dirty.some((value, index) => value !== [138, 138, 25, 25][index])) {
    throw new Error(`${fixture.name} dirty rect ${dirty.join(",")} is not 138,138,25,25`);
  }
  const mem = process.memoryUsage();
  return {
    dirtyRect: dirty,
    wasmCapacityBeforeBytes: before,
    wasmCapacityAfterFirstDabBytes: afterFirstDab,
    wasmCapacityAfterStrokeEndBytes: afterEnd,
    wasmCapacityAfterSecondStrokeBytes: afterSecond,
    firstDabDeltaBytes: afterFirstDab - before,
    secondStrokeDeltaBytes: afterSecond - afterFirstDab,
    repeatedStrokePlateau: afterSecond <= afterFirstDab,
    liveBufferEstimateBytes: liveEstimate(fixture),
    jsHeapUsedBytes: mem.heapUsed,
    processRssBytes: mem.rss,
    wasmCapacityBytes: afterFirstDab,
  };
}

function liveEstimate(fixture) {
  const pixels = fixture.width * fixture.height;
  // Display RGBA8 + one u16 plane per layer + the History Brush source plane.
  return pixels * 4 + fixture.layers * pixels * 8 + pixels * 8;
}

function memoryFields(memory, mem, live) {
  const fields = {
    wasmCapacityBytes: memory.buffer.byteLength,
    jsHeapUsedBytes: mem.heapUsed,
    processRssBytes: mem.rss,
    liveBufferEstimateBytes: live,
  };
  const values = Object.values(fields);
  if (new Set(values).size !== values.length) {
    throw new Error(`memory fields are not distinct: ${JSON.stringify(fields)}`);
  }
  return fields;
}
