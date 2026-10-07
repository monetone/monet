import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const engine = resolve(root, "packages/engine");
const unchanged = [
  "packages/monet-ui/crates/monet-format/dev/xcf_writer.rs",
  "packages/monet-ui/crates/monet-format/src/format/convert.rs",
  "packages/monet-ui/crates/monet-format/src/format/mod.rs",
  "packages/monet-ui/crates/monet-format/src/format/serialize.rs",
  "packages/monet-ui/crates/monet-format/src/graphics/mod.rs",
  "packages/monet-ui/crates/monet-format/src/import/codec.rs",
  "packages/monet-ui/crates/monet-format/src/import/descriptor.rs",
  "packages/monet-ui/crates/monet-format/src/import/document.rs",
  "packages/monet-ui/crates/monet-format/src/import/psd.rs",
  "packages/monet-ui/crates/monet-format/src/import/reader.rs",
  "packages/monet-ui/crates/monet-format/src/import/xcf.rs",
  "packages/monet-ui/crates/monet-format/tests/psd.rs",
  "packages/monet-ui/crates/monet-format/tests/psd_real.rs",
  "packages/monet-ui/crates/monet-format/tests/xcf.rs",
  "packages/monet-ui/crates/monet-mcp/src/lib.rs",
  "packages/monet-ui/crates/monet-ui/src/lib.rs",
  "packages/monet-ui/crates/monet-ui/src/tests.rs",
  "packages/monet-ui/crates/monet-ui/src/vibrancy.rs",
  "packages/monet-ui/crates/monet-ui/src/window_state.rs",
  "packages/monet-ui/examples/sandbox/src-tauri/src/main.rs",
  "packages/engine/src/raster/format_import.rs",
];
const rustSources = [
  ...["cache_identity.rs", "color.rs", "develop.rs", "image.rs", "lib.rs", "recipe.rs"].map(
    (file) => resolve(engine, "crates/monet-photo-core/src", file),
  ),
  resolve(engine, "crates/monet-photo-core/src/kernels/mod.rs"),
  resolve(engine, "crates/monet-photo-core/examples/wasm_golden.rs"),
  resolve(engine, "fixtures/mvsn-v15-provenance-generator.rs"),
  ...[
    "build.rs",
    "src/catalog.rs",
    "src/develop_job.rs",
    "src/develop_scheduler.rs",
    "src/lib.rs",
    "src/main.rs",
    "src/proof.rs",
    "src/raw_decode.rs",
    "src/tiff_export.rs",
    "src/bin/product_proof.rs",
    "src/bin/proxy_proof.rs",
    "src/bin/shared_core_fixture.rs",
  ].map((file) => resolve(root, "apps/galerie/src-tauri", file)),
];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
}

const format = run("rustfmt", ["--edition", "2021", "--check", ...rustSources]);
if (format.status !== 0) throw new Error(format.stderr || format.stdout);

const spill = run("git", ["diff", "--quiet", "HEAD", "--", ...unchanged]);
if (spill.status !== 0) throw new Error("a formatter-only path differs from HEAD");

const workspace = run("cargo", [
  "fmt",
  "--manifest-path",
  resolve(engine, "Cargo.toml"),
  "--",
  "--check",
]);
if (workspace.status !== 1) {
  throw new Error(`expected inherited formatter drift, got status ${workspace.status}`);
}
const output = `${workspace.stdout}${workspace.stderr}`.replace(
  // eslint-disable-next-line no-control-regex -- deliberately strips ANSI SGR escapes
  /\x1b(?:\[[0-9;]*m|\(B)/g,
  "",
);
const expected = new Set([
  "packages/engine/src/raster/format_import.rs",
]);
const seen = new Set();
let currentPath;
let removed = [];
let inheritedHunks = 0;

function verifyRemoved() {
  if (!removed.length) return;
  const head = run("git", ["show", `HEAD:${currentPath}`]);
  if (head.status !== 0 || !head.stdout.includes(removed.join("\n"))) {
    throw new Error(`formatter hunk is not inherited from HEAD: ${currentPath}`);
  }
  inheritedHunks += 1;
  removed = [];
}

for (const line of output.split("\n")) {
  const header = line.match(/^Diff in (.+):\d+:$/);
  if (header) {
    verifyRemoved();
    currentPath = header[1].slice(root.length + 1);
    if (!expected.has(currentPath)) {
      throw new Error(`unexpected formatter drift: ${currentPath}`);
    }
    seen.add(currentPath);
  } else if (line.startsWith("-")) {
    removed.push(line.slice(1));
  } else {
    verifyRemoved();
  }
}
verifyRemoved();
const missing = [...expected].filter((path) => !seen.has(path));
if (missing.length) throw new Error(`missing expected baseline paths: ${missing.join(", ")}`);

console.log(
  JSON.stringify({
    pass: true,
    directRustSources: rustSources.length,
    unchangedFormatterPaths: unchanged.length,
    inheritedWorkspaceHunks: inheritedHunks,
  }),
);
