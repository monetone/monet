// Scripting read channel (V-SCRIPT-1): the console used to be write-only —
// every `vision.*` leaf recorded `[path, args]` and returned undefined, so a
// script could not size an op to the canvas, loop over layers, or test whether
// a selection exists. `await vision.read.*` closes that: the worker flushes its
// recorded ops, the main thread executes them and answers with live state.
//
// app.ts and scriptWorker.ts can't be imported in node (the first pulls the
// WASM engine, the second deletes half of globalThis on load — that is its
// whole job), so, like actionRecording.test.ts and photoshopAppWiring.test.ts,
// this pins the contract in source. End-to-end behaviour lives in
// e2e/scripting-read.spec.ts, which runs the real worker.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCRIPT_LIMIT_ERROR, SCRIPT_MAX_OPS } from "./scriptLimits";

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
const appSource = read("./app.ts");
const workerSource = read("./scriptWorker.ts");

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

const readsBlock = section(appSource, "function visionReads()", "\n// The curated `vision` API");
const runScript = section(appSource, "export function runScript(", "\nexport const smart");

/** The read names visionReads() returns, parsed back out of app.ts. */
const readNames = [...readsBlock.matchAll(/^ {4}([a-zA-Z]\w*)[:,]/gm)].map((m) => m[1]);

describe("script read allowlist", () => {
  it("exposes the document facts a script has to branch on", () => {
    // Photoshop's DOM lets a script ask for the canvas, the layer stack and the
    // selection before deciding what to do. These are the equivalents.
    for (const name of [
      "doc", "width", "height", "documents",
      "layers", "layerCount", "activeLayerId", "activeLayer", "selectedLayerIds",
      "hasSelection", "selectionBounds", "foreground", "background",
    ]) expect(readNames, `vision.read.${name} is missing`).toContain(name);
  });

  it("keeps reads side-effect free — a read must not widen what a script can change", () => {
    // The sandbox's guarantee is that a script only mutates through the op
    // allowlist. A read that committed, filled or set state would smuggle a
    // write past that, so nothing in this block may mutate.
    expect(readsBlock).not.toMatch(/engine\.commit\(|\.set\(|store\.(?!state)[a-z]/);
    expect(readsBlock).not.toMatch(/E\(\)\.(?!selection_bounds)/); // reads touch one engine getter
  });

  it("strips layer thumbnails — every read is structured-cloned to the worker", () => {
    expect(readsBlock).toContain("({ thumb: _thumb, ...rest })");
  });

  it("hands the read allowlist to the worker and re-checks it on arrival", () => {
    expect(runScript).toContain("reads: Object.keys(reads)");
    // A tampered worker message naming an unknown read must not reach a
    // function — the allowlist is authoritative here, not in the worker.
    expect(runScript).toContain("const read = reads[data.path ?? \"\"];");
    expect(runScript).toContain("if (!read) { finish(`Disallowed read: ${data.path}`); return; }");
    expect(runScript).toContain("if (!fn) throw new Error(`Disallowed op: ${path}`);");
  });
});

describe("read/write interleaving (main thread)", () => {
  it("replays the flushed ops and composites before evaluating the read", () => {
    expect(runScript).toContain("try { const ops = data.ops ?? []; await replay(ops); if (ops.length) engine.commit(); }");
    expect(runScript.indexOf("await replay(ops); if (ops.length) engine.commit();"))
      .toBeLessThan(runScript.indexOf("read(...((data.args ?? []) as never[]))"));
  });

  it("answers a throwing read to the script instead of killing the run", () => {
    // No open document / a value the structured clone rejects is the script's
    // error to catch; only budget and allowlist failures end the run.
    expect(runScript).toContain("catch (err) { worker.postMessage({ id: data.id, ok: false, error: errText(err) }); }");
  });

  it("counts ops for the whole run, not per flush", () => {
    // The ceiling is cumulative on BOTH sides: flushing for a read empties the
    // sink, so a per-batch check would let `read, 256 ops, read, …` run forever.
    expect(runScript).toContain("executed += ops.length;");
    expect(runScript).toContain("if (executed > SCRIPT_MAX_OPS) throw new Error(SCRIPT_LIMIT_ERROR);");
    expect(SCRIPT_MAX_OPS).toBeGreaterThan(0);
  });

  it("keeps the 2 s idle timeout and adds a total runtime cap", () => {
    // A script that keeps awaiting reads makes progress, so the idle timer is
    // rearmed per message (a tight `for(;;){}` still dies at 2 s — e2e
    // script-sandbox.spec.ts pins that exact message). The total cap is what
    // stops `while (true) await vision.read.width()`.
    expect(appSource).toContain("const SCRIPT_TIMEOUT_MS = 2_000;");
    expect(runScript).toContain("idle = setTimeout(() => finish(`Script timed out after ${SCRIPT_TIMEOUT_MS} ms`), SCRIPT_TIMEOUT_MS);");
    expect(runScript).toContain("armIdle(); // the worker made progress");
    expect(runScript).toMatch(/const total = setTimeout\(\(\) => finish\(`Script exceeded the \$\{SCRIPT_MAX_RUNTIME_MS\} ms runtime budget`\), SCRIPT_MAX_RUNTIME_MS\);/);
    expect(runScript).toContain("clearTimeout(total);");
  });

  it("surfaces vision.log output so the console can show what a read found", () => {
    // "✓ " prefix: Dialogs.tsx colours anything else as an error.
    expect(runScript).toContain("finish(logs.length ? `✓ ${logs.join(\"\\n\")}` : \"\");");
    expect(runScript).toContain("if (logs.length < SCRIPT_MAX_LOG_LINES) logs.push(");
  });
});

// ── the real worker module, driven like the main thread drives it ──
// scriptWorker.ts deletes half of globalThis on load (that IS its job), so it
// can't be imported into the test process — it runs in a throwaway child node
// realm with a fake `self`, one process per case because the worker keeps its
// op budget in module state (the app gives every run a fresh worker).
const workerHarness = `
import assert from "node:assert";
const later = setTimeout; // captured before the worker deletes it
let onmsg = null, wake = null;
const outbox = [];
globalThis.self = {
  addEventListener: (_t, fn) => { onmsg = fn; },
  postMessage: (m) => { outbox.push(m); if (wake) { const w = wake; wake = null; w(); } },
};
await import("./worker.mjs");
const next = () => new Promise((res) => {
  if (outbox.length) return res(outbox.shift());
  wake = () => res(outbox.shift());
});
// The main thread's half: replay what each read flushed, then answer it.
async function run(code, reads, values) {
  const replayed = [];
  onmsg({ data: { code, ops: ["newDoc", "addLayer", "log", "adj.vibrance"], reads } });
  for (;;) {
    const msg = await next();
    if (msg.kind === "read") {
      replayed.push(...msg.ops);
      const v = values[msg.path];
      later(() => onmsg({ data: { id: msg.id, ok: true, value: typeof v === "function" ? v(replayed) : v } }), 0);
      continue;
    }
    if (msg.ops) replayed.push(...msg.ops);
    return { msg, replayed };
  }
}
const CASE = process.argv[2];
if (CASE === "read") {
  const { msg, replayed } = await run(
    \`vision.newDoc(10, 10, "t");
     const n = await vision.read.layerCount();
     vision.log("count=" + n);
     const w = await vision.read.width();
     vision.adj.vibrance(w / 100, 0);\`,
    ["layerCount", "width"],
    { layerCount: (flushed) => flushed.length, width: 400 },
  );
  assert.strictEqual(msg.ok, true, JSON.stringify(msg));
  assert.deepStrictEqual(replayed, [
    ["newDoc", [10, 10, "t"]],
    ["log", ["count=1"]],     // the read observed newDoc already flushed (1 op)
    ["adj.vibrance", [4, 0]], // and the script sized an op to the value it got
  ]);
}
if (CASE === "budget") {
  const { msg, replayed } = await run(
    \`for (let i = 0; i < 200; i++) vision.addLayer();
     await vision.read.width();
     for (let i = 0; i < 200; i++) vision.addLayer();\`,
    ["width"], { width: 1 },
  );
  assert.strictEqual(msg.ok, false);
  assert.strictEqual(msg.error, LIMIT_ERROR);
  assert.strictEqual(replayed.length, 200); // only the pre-read flush ran
}
if (CASE === "reject") {
  onmsg({ data: { code: 'try { await vision.read.width(); } catch (e) { vision.log(e.message); }', ops: ["log"], reads: ["width"] } });
  const req = await next();
  assert.strictEqual(req.kind, "read");
  later(() => onmsg({ data: { id: req.id, ok: false, error: "no document" } }), 0);
  const done = await next();
  assert.deepStrictEqual(done, { ok: true, ops: [["log", ["no document"]]] });
}
if (CASE === "writes-only") {
  onmsg({ data: { code: 'vision.newDoc(4, 4, "sync");', ops: ["newDoc"] } }); // no reads key at all
  assert.deepStrictEqual(await next(), { ok: true, ops: [["newDoc", [4, 4, "sync"]]] });
}
if (CASE === "import") {
  onmsg({ data: { code: 'import("x")', ops: [], reads: [] } });
  assert.deepStrictEqual(await next(), { ok: false, error: "Dynamic import is not available in scripts" });
}
console.log("ok");
`;

describe("scriptWorker, executed", () => {
  const dir = mkdtempSync(join(tmpdir(), "mv-script-"));
  beforeAll(async () => {
    const { transformWithEsbuild } = await import("vite");
    // Inline the two constants so the copy has no relative imports to resolve.
    const src = workerSource.replace(
      /^import \{[^}]*\} from "\.\/scriptLimits";$/m,
      `const SCRIPT_MAX_OPS = ${SCRIPT_MAX_OPS};\nconst SCRIPT_LIMIT_ERROR = ${JSON.stringify(SCRIPT_LIMIT_ERROR)};`,
    );
    expect(src).not.toContain("./scriptLimits");
    writeFileSync(join(dir, "worker.mjs"), (await transformWithEsbuild(src, "scriptWorker.ts")).code);
    writeFileSync(join(dir, "harness.mjs"), `const LIMIT_ERROR = ${JSON.stringify(SCRIPT_LIMIT_ERROR)};\n${workerHarness}`);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const drive = (which: string) =>
    execFileSync(process.execPath, [join(dir, "harness.mjs"), which], { encoding: "utf8" }).trim();

  it("flushes pending ops with a read and hands the live value back to the script", () => {
    expect(drive("read")).toBe("ok");
  });

  it("counts ops for the whole run — flushing for a read does not refill the budget", () => {
    expect(drive("budget")).toBe("ok");
  });

  it("rejects a failed read into the script, which can catch it and carry on", () => {
    expect(drive("reject")).toBe("ok");
  });

  it("still runs a plain write-only script with no read channel at all", () => {
    expect(drive("writes-only")).toBe("ok");
  });

  it("still refuses dynamic import", () => {
    expect(drive("import")).toBe("ok");
  });
});
