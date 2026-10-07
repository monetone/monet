// The port table in docs/mcp.md drifted once already (Galerie shipped wired and
// undocumented). This pins it to what the apps actually register.
//   node --test docs/mcp-ports.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

/** app → port as documented in the "### Ports" table of docs/mcp.md. */
function documentedPorts() {
  const doc = readFileSync(join(repo, "docs/mcp.md"), "utf8");
  const table = doc.split("### Ports")[1];
  assert.ok(table, "docs/mcp.md has no '### Ports' section");
  const ports = new Map();
  for (const [, app, port] of table.matchAll(/^\|\s*(\w+)\s*\|\s*(\d{4,5})\s*\|$/gm)) {
    ports.set(app, Number(port));
  }
  return ports;
}

/** app → port as registered by `McpOptions::new(..).port(N)` in its main.rs. */
function wiredPorts() {
  const ports = new Map();
  for (const app of readdirSync(join(repo, "apps"), { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    let main;
    try {
      main = readFileSync(join(repo, "apps", app.name, "src-tauri/src/main.rs"), "utf8");
    } catch {
      continue; // not a Tauri app
    }
    // .port() may sit on a following line (rustfmt wraps the longer calls).
    const m = main.match(/McpOptions::new\([^)]*\)[\s\S]{0,120}?\.port\((\d+)\)/);
    if (m) ports.set(app.name, Number(m[1]));
  }
  return ports;
}

test("docs/mcp.md port table matches the ports the apps register", () => {
  const wired = wiredPorts();
  assert.ok(wired.size >= 7, `expected >=7 MCP-wired apps, found ${wired.size}`);
  assert.deepEqual(
    Object.fromEntries([...documentedPorts()].sort()),
    Object.fromEntries([...wired].sort()),
  );
});

test("no two apps claim the same MCP port", () => {
  const wired = [...wiredPorts()];
  assert.equal(new Set(wired.map(([, p]) => p)).size, wired.length, `duplicate port in ${JSON.stringify(wired)}`);
});
