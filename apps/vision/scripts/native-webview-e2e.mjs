#!/usr/bin/env node
/**
 * End-to-end checks against the REAL native macOS WKWebView build.
 *
 *   node scripts/native-webview-e2e.mjs [--keep-open]
 *   MONET_NATIVE_E2E_APP="/path/to/Monet Vision Native E2E.app" \
 *   MONET_NATIVE_E2E_IDENTIFIER=dev.monet.vision.native-e2e node scripts/native-webview-e2e.mjs
 *
 * Build the test bundle with that identifier to give it separate recovery,
 * preferences and MCP connection files. Only a process launched here is driven.
 *
 * Why this exists: `playwright test` covers Chromium and WebKit, but neither is
 * the webview Vision actually ships in. Playwright cannot drive a Tauri WKWebView,
 * and `tauri-driver` has no macOS support because Apple ships no WebDriver for
 * WKWebView — so the shipped surface had no automated coverage at all.
 *
 * The app already hosts an MCP server (src-tauri/src/main.rs, port 48211) whose
 * verbs run inside that webview. Driving it over HTTP and asserting on
 * `doc.exportPngBase64` gives a real end-to-end signal: the bytes come back from
 * the same Rust/WASM engine and the same WKWebView the user runs.
 *
 * Pixel assertions compare content hashes rather than fixed golden values, so the
 * suite proves "this operation changed the render, in the right direction" without
 * pinning engine output that legitimately evolves.
 *
 * WebKit also publishes the page to the macOS Accessibility API, so the type checks
 * press the real combobox options and menu items through System Events. The
 * terminal running this needs Accessibility permission. The float-window checks
 * (#477) also drive the real mouse through cliclick (brew install cliclick) and
 * read the screen with screencapture, so it needs Screen Recording as well.
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(new URL(import.meta.url)));
const APP = resolve(process.env.MONET_NATIVE_E2E_APP ?? resolve(HERE, "..", "src-tauri/target/release/bundle/macos/Monet Vision.app"));
const IDENTIFIER = process.env.MONET_NATIVE_E2E_IDENTIFIER ?? "dev.monet.vision";
if (!/^[a-zA-Z0-9.-]+$/.test(IDENTIFIER)) throw new Error("MONET_NATIVE_E2E_IDENTIFIER must be a bundle identifier");
// Executed directly (not through `open`) so argv, stdout and the exit status reach us.
const BIN = join(APP, "Contents/MacOS/Vision");
// Committed 64x64 fixture with real detail — see the blur check for why that matters.
const FIXTURE = resolve(HERE, "..", "src-tauri/fixtures/px.png");
const CONN = join(homedir(), "Library/Application Support", IDENTIFIER, "mcp.json");
const CRASHES = join(homedir(), "Library/Logs/DiagnosticReports");
const KEEP = process.argv.includes("--keep-open");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── harness ─────────────────────────────────────────────────────────── */

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push({ name, error: e.message });
    console.log(`  FAIL ${name}\n         ${e.message}`);
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/* ── MCP client ──────────────────────────────────────────────────────── */

let conn = null;
let guiPid = null;

async function call(name, args = {}) {
  const res = await fetch(conn.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conn.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${name}: ${JSON.stringify(body.error)}`);
  const content = body.result?.content?.[0];
  if (body.result?.isError) throw new Error(`${name}: ${content?.text ?? "unknown tool error"}`);
  return content?.text ?? content;
}

/** Rendered document as {hash, bytes} — the pixels the native webview produced. */
async function render() {
  const image = await call("doc.exportPngBase64", {});
  assert(image?.type === "image" && image.mimeType === "image/png", "export was not MCP PNG image content");
  const raw = Buffer.from(image.data, "base64");
  assert(raw.length > 8 && raw.subarray(1, 4).toString() === "PNG", "export was not a PNG");
  return { hash: createHash("md5").update(raw).digest("hex"), bytes: raw.length, raw };
}

/** The open documents' names, from the scripting API. */
async function docNames() {
  const out = await call("script.run", { code: "vision.log(JSON.stringify((await vision.read.documents()).map((d) => d.name)))" });
  return JSON.parse(out.replace(/^✓ ?/, ""));
}

/** A non-interlaced RGB(A) PNG as 8-bit pixels: { w, h, bpp, px }. */
function decodePng(png) {
  let pos = 8, w = 0, h = 0, bpp = 0, depth = 0;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos), tag = png.toString("ascii", pos + 4, pos + 8), data = png.subarray(pos + 8, pos + 8 + len);
    if (tag === "IHDR") {
      [w, h, depth] = [data.readUInt32BE(0), data.readUInt32BE(4), data[8]];
      bpp = { 2: 3, 6: 4 }[data[9]] * (depth / 8);
      assert((depth === 8 || depth === 16) && bpp && data[12] === 0, "expected an 8/16-bit non-interlaced RGB(A) PNG");
    }
    if (tag === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), s = w * bpp, px = Buffer.alloc(s * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (s + 1)];
    for (let x = 0; x < s; x++) {
      const a = x >= bpp ? px[y * s + x - bpp] : 0, b = y ? px[(y - 1) * s + x] : 0, c = x >= bpp && y ? px[(y - 1) * s + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      px[y * s + x] = raw[y * (s + 1) + 1 + x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
    }
  }
  return { w, h, bpp: bpp / (depth / 8), px: depth === 16 ? px.filter((_, i) => i % 2 === 0) : px };
}

/** Horizontal extent of the pixels that differ from the top-left one — how
 *  wide the drawn text is. */
function inkWidth(png) {
  const { w, h, bpp, px } = decodePng(png);
  let min = w, max = -1;
  for (let i = 0; i < w * h; i++) {
    for (let k = 0; k < bpp; k++) {
      if (Math.abs(px[i * bpp + k] - px[k]) > 64) { min = Math.min(min, i % w); max = Math.max(max, i % w); break; }
    }
  }
  return max - min + 1;
}

/* ── native UI through Accessibility ─────────────────────────────────── */

const osascript = (args) => {
  assert(launched.has(guiPid) && alive(guiPid), "no owned Vision process for Accessibility");
  const scoped = args.map((arg, i) => args[i - 1] === "-e" ? arg.replaceAll("__MONET_PID__", String(guiPid)) : arg);
  return new Promise((resolve, reject) =>
    execFile("osascript", scoped, { timeout: 180_000 }, (e, out, err) => (e ? reject(new Error(err.trim() || e.message)) : resolve(out.trim()))));
};

/** Click a native menu item: menu("Type", "Panels", "Character Panel"). */
function menu(top, ...path) {
  const item = path.pop();
  const ref = path.reduce((r, sub) => `menu 1 of menu item "${sub}" of ${r}`, `menu 1 of menu bar item "${top}" of menu bar 1`);
  return osascript(["-e", `tell application "System Events" to tell (first process whose unix id is __MONET_PID__) to click menu item "${item}" of ${ref}`]);
}

/* ── Window ▸ Arrange float windows (#477) ───────────────────────────── */

/** Click a Window ▸ Arrange item once it is enabled: the native menu is
 *  rebuilt a beat after the first document opens on the launch's Home. */
async function arrange(item) {
  const ref = `menu item "${item}" of menu 1 of menu item "Arrange" of menu 1 of menu bar item "Window" of menu bar 1`;
  await until(`Window ▸ Arrange ▸ ${item} never enabled`,
    () => osascript(["-e", `tell application "System Events" to tell (first process whose unix id is __MONET_PID__) to get enabled of ${ref}`]), (v) => v === "true");
  await osascript(["-e", `tell application "System Events" to tell (first process whose unix id is __MONET_PID__) to click ${ref}`]);
}

// Every window of the app as { name, x, y }, in screen points.
const WINDOWS = `function run() {
  return JSON.stringify(Application("System Events").processes.whose({ unixId: __MONET_PID__ })[0].windows().map((w) => {
    const [x, y] = w.position(), [width, height] = w.size();
    return { name: w.name(), x, y, w: width, h: height };
  }));
}`;
const windows = async () => JSON.parse(await osascript(["-l", "JavaScript", "-e", WINDOWS]));

// The document titles in a window's tab bar, or presses a button in it.
const IN_WINDOW = `function run([win, what, label]) {
  const get = (f) => { try { return f(); } catch { return null; } };
  const find = (el, test, depth = 0) => {
    for (const k of get(() => el.uiElements()) ?? []) {
      if (test(k)) return k;
      const hit = depth < 5 ? find(k, test, depth + 1) : null;
      if (hit) return hit;
    }
    return null;
  };
  const w = Application("System Events").processes.whose({ unixId: __MONET_PID__ })[0].windows.byName(win);
  if (what === "tabs") {
    const bar = find(w, (k) => get(() => k.role()) === "AXTabGroup" && get(() => k.description()) === "Open documents");
    return JSON.stringify(bar ? bar.uiElements().map((t) => get(() => t.title())) : []);
  }
  const button = find(w, (k) => get(() => k.role()) === "AXButton" && get(() => k.description()) === label);
  if (!button) throw new Error("no " + label + " button in " + win);
  button.actions.byName("AXPress").perform();
  return "";
}`;
// A tab reads "<name>[*] Close <name>"; this is its document's name.
const tabsOf = async (win) => JSON.parse(await osascript(["-l", "JavaScript", "-e", IN_WINDOW, win, "tabs"]))
  .map((t) => t.split(" Close ")[0].replace(/\*$/, ""));
const press = (win, label) => osascript(["-l", "JavaScript", "-e", IN_WINDOW, win, "press", label]);

/** Poll `read` until `ok` holds, 15 s at most. */
async function until(what, read, ok) {
  let last;
  for (let i = 0; i < 60; i++, await sleep(250)) if (ok((last = await read()))) return last;
  throw new Error(`${what} (last saw ${JSON.stringify(last)})`);
}

/** The RGB on screen at (x, y) points. The terminal needs Screen Recording. */
async function screenRgb(x, y) {
  const file = join(tmpdir(), `monet-vision-float-${process.pid}.png`);
  await new Promise((done, fail) => execFile("screencapture", ["-x", `-R${Math.round(x)},${Math.round(y)},1,1`, file], (e) => (e ? fail(e) : done())));
  const { px } = decodePng(readFileSync(file));
  rmSync(file, { force: true });
  return [px[0], px[1], px[2]];
}

/** The share of on-screen pixels in the (x, y, w, h) points rect that pass `test(r, g, b)`. */
async function screenShare(x, y, w, h, test) {
  const file = join(tmpdir(), `monet-vision-strip-${process.pid}.png`);
  await new Promise((done, fail) => execFile("screencapture", ["-x", `-R${Math.round(x)},${Math.round(y)},${w},${h}`, file], (e) => (e ? fail(e) : done())));
  const { w: pw, h: ph, bpp, px } = decodePng(readFileSync(file));
  rmSync(file, { force: true });
  let hits = 0;
  for (let i = 0; i < pw * ph; i++) if (test(px[i * bpp], px[i * bpp + 1], px[i * bpp + 2])) hits++;
  return hits / (pw * ph);
}
const darkShare = (x, y, w, h) => screenShare(x, y, w, h, (r, g, b) => r < 80 && g < 80 && b < 80);

// Finds a dialog (a window or sheet) whose text holds NEEDLE; with LABEL,
// presses that button in it. Returns how many such dialogs are up.
const DIALOG = `function run([needle, label]) {
  const get = (f) => { try { return f(); } catch { return null; } };
  const texts = (el, d = 0) => {
    let out = [];
    for (const k of get(() => el.uiElements()) ?? []) {
      const v = get(() => k.value());
      if (typeof v === "string") out.push(v);
      if (d < 4) out = out.concat(texts(k, d + 1));
    }
    return out;
  };
  const p = Application("System Events").processes.whose({ unixId: __MONET_PID__ })[0];
  const found = [];
  for (const w of p.windows()) {
    const sheets = (get(() => w.sheets()) ?? []).filter((h) => texts(h).join(" ").includes(needle));
    found.push(...(sheets.length ? sheets : texts(w).join(" ").includes(needle) ? [w] : []));
  }
  if (label && found.length) {
    const b = (get(() => found[0].buttons()) ?? []).find((x) => get(() => x.title()) === label || get(() => x.name()) === label);
    if (!b) throw new Error("no " + label + " button");
    b.actions.byName("AXPress").perform();
  }
  return String(found.length);
}`;
const dialogCount = async (needle, label = "") => Number(await osascript(["-l", "JavaScript", "-e", DIALOG, needle, label]));

// Presses the Transform Selection dialog's On Canvas button.
const ON_CANVAS = `function run() {
  const get = (f) => { try { return f(); } catch { return null; } };
  const w = Application("System Events").processes.whose({ unixId: __MONET_PID__ })[0].windows.byName("Monet Vision");
  const find = (el, d = 0) => {
    for (const k of get(() => el.uiElements()) ?? []) {
      if (get(() => k.role()) === "AXButton" && [get(() => k.title()), get(() => k.description()), get(() => k.name())].join(" ").includes("On Canvas")) return k;
      const hit = d < 20 ? find(k, d + 1) : null;
      if (hit) return hit;
    }
    return null;
  };
  const b = find(w);
  if (!b) return "none";
  b.actions.byName("AXPress").perform();
  return "pressed";
}`;

// How many text-layer editors each window holds, by window name.
const EDITORS = `function run() {
  const get = (f) => { try { return f(); } catch { return null; } };
  const out = {};
  for (const w of Application("System Events").processes.whose({ unixId: __MONET_PID__ })[0].windows()) {
    let n = 0;
    const walk = (el, d) => {
      for (const k of get(() => el.uiElements()) ?? []) { if (get(() => k.description()) === "Text layer editor") n++; if (d < 14) walk(k, d + 1); }
    };
    walk(w, 0);
    out[get(() => w.name())] = n;
  }
  return JSON.stringify(out);
}`;
const editors = async () => JSON.parse(await osascript(["-l", "JavaScript", "-e", EDITORS]));

/** Real mouse and keys (brew install cliclick): a float window is only
 *  reachable the way a user reaches it. */
const cliclick = async (...args) => {
  await osascript(["-e", 'tell application "System Events" to set frontmost of (first process whose unix id is __MONET_PID__) to true']);
  return new Promise((done, fail) =>
    execFile("cliclick", args, (e, _out, err) => (e ? fail(new Error(err.trim() || e.message)) : done())));
};

// Picks `label` in the Character panel's Font style list (the last Font style
// combobox; the options bar's comes first) and returns every Font style value.
const PICK_STYLE = `function run([label]) {
  const win = Application("System Events").processes.whose({ unixId: __MONET_PID__ })[0].windows[0];
  const get = (f) => { try { return f(); } catch { return null; } };
  const find = (el, test, out = []) => {
    for (const k of get(() => el.uiElements()) ?? []) { if (test(k)) out.push(k); find(k, test, out); }
    return out;
  };
  const styles = () => find(win, (k) => get(() => k.role()) === "AXComboBox" && get(() => k.description()) === "Font style");
  const panel = styles().pop();
  if (!panel) throw new Error("not ready: no Font style combobox");
  panel.actions.byName("AXPress").perform();
  delay(0.5);
  const option = find(panel.attributes.byName("AXParent").value(), (k) => get(() => k.title()) === label)[0];
  if (!option) {
    panel.actions.byName("AXPress").perform();
    throw new Error("not ready: no " + label + " option in the Font style list");
  }
  option.actions.byName("AXPress").perform();
  delay(0.5);
  return JSON.stringify(styles().map((s) => s.value().trim()));
}`;

// The Droplet dialog's summary line, or "" while it has none.
const DROPLET_SUMMARY = `function run() {
  const win = Application("System Events").processes.whose({ unixId: __MONET_PID__ })[0].windows[0];
  const get = (f) => { try { return f(); } catch { return null; } };
  const find = (el, test, out = []) => {
    for (const k of get(() => el.uiElements()) ?? []) { if (test(k)) out.push(k); find(k, test, out); }
    return out;
  };
  const text = (k) => String(get(() => k.value()) ?? get(() => k.title()) ?? "");
  const found = find(win, (k) => /^Processed \\d+ of \\d+/.test(text(k)));
  return found.length ? text(found[0]) : "";
}`;

/** The launch font scan publishes a family's styles only once their CSS aliases
 *  have loaded, so a pick first waits (about two minutes at most) for them. */
async function pickStyle(label) {
  for (let tries = 0; ; tries++) {
    try {
      return JSON.parse(await osascript(["-l", "JavaScript", "-e", PICK_STYLE, label]));
    } catch (e) {
      if (tries >= 10 || !e.message.includes("not ready")) throw e;
      await sleep(5000);
    }
  }
}

/** A new 640x200 document holding black 72px "HHHHHH" point type in `font`. */
const newType = (font, bold = false) => call("script.run", {
  code: `vision.newDoc(640, 200, "faces"); vision.text.create(${JSON.stringify({
    v: 1, kind: "point", vertical: false, ax: 16, ay: 40, runs: [{ text: "HHHHHH" }], font, size: 72, color: [0, 0, 0, 255],
    bold, italic: false, tracking: 0, kerning: "metrics", leading: 0, hScale: 1, vScale: 1, align: "left", direction: "ltr",
    composer: "latin", boxW: 480, boxH: 0, firstIndent: 0, leftIndent: 0, rightIndent: 0, spaceBefore: 0, spaceAfter: 0,
    antialias: "smooth", kashida: "none", diacriticX: 0, diacriticY: 0, stroke: null, shadow: null,
    warp: { style: "none", bend: 0, h: 0, v: 0, orient: "h" },
  })});`,
});

/* ── app lifecycle ───────────────────────────────────────────────────── */

// The Vision processes this harness started: the only ones it ever stops.
// Other lanes' apps and shells share this machine.
const launched = new Set();

/** PIDs running this bundle's own binary, matched on the exact executable
 *  path: another copy of Vision, or a shell whose command line names this
 *  one, never counts. */
const bundlePids = () => new Promise((done) =>
  execFile("pgrep", ["-x", "Vision"], (e, out) => {
    const pids = e ? [] : out.trim().split("\n").filter(Boolean);
    if (!pids.length) return done([]);
    execFile("ps", ["-o", "pid=,comm=", "-p", pids.join(",")], (e2, table) => done(e2 ? [] : table.trim().split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
      .filter((m) => m && m[2] === BIN)
      .map((m) => Number(m[1]))));
  }));

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Wait for an MCP connection written at or after `since` to answer. */
async function waitForMcp(since) {
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try {
      if (statSync(CONN).mtimeMs < since) continue;
      const c = JSON.parse(readFileSync(CONN, "utf8"));
      const pids = await bundlePids();
      const listeners = await new Promise((done) => execFile("lsof", ["-nP", `-iTCP:${new URL(c.url).port}`, "-sTCP:LISTEN", "-t"],
        (error, out) => done(error ? [] : out.trim().split(/\s+/).map(Number))));
      const matches = pids.filter((pid) => listeners.includes(pid));
      if (matches.length !== 1) continue; // another build wrote this connection file
      const res = await fetch(c.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) { conn = c; guiPid = matches[0]; return true; }
    } catch { /* not up yet */ }
  }
  return false;
}

/** `open` the bundle (with `args`, e.g. files for it) and record the process it starts. */
async function start(args = [APP]) {
  const before = await bundlePids();
  const since = Date.now();
  spawn("open", args, { stdio: "ignore", detached: true }).unref();
  const up = await waitForMcp(since);
  for (const pid of await bundlePids()) if (!before.includes(pid)) launched.add(pid);
  return up;
}

/** Quit the Vision this harness started, and nothing else. */
async function stopLaunched() {
  for (const pid of launched) { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
  for (let i = 0; i < 40 && [...launched].some(alive); i++) await sleep(250);
  for (const pid of launched) if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  launched.clear();
  guiPid = null;
}

async function launch() {
  if (!existsSync(APP)) {
    console.error(`No native bundle at:\n  ${APP}\nBuild it first:  pnpm --filter monet-vision run tauri build`);
    process.exit(2);
  }
  if ((await bundlePids()).length) {
    throw new Error(`The target bundle is already running: ${APP}. Use an isolated test bundle; the harness will not drive an existing process.`);
  }
  console.log(`• launching ${APP} (${IDENTIFIER})`);
  const up = await start();
  if (!up) {
    console.error("native app never answered on its MCP port");
    process.exit(2);
  }
}

/* ── the checks ──────────────────────────────────────────────────────── */

async function main() {
  console.log("Monet Vision — native WKWebView end-to-end\n");
  await launch();
  console.log(`• driving ${conn.url}\n`);

  await check("MCP surface is reachable and non-empty", async () => {
    const res = await fetch(conn.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${conn.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const tools = (await res.json()).result?.tools ?? [];
    assert(tools.length >= 40, `expected the generated tool surface, saw ${tools.length}`);
  });

  // #477: before the checks below open a pile of documents, since Cascade
  // floats every open one — and this first one needs the launch's Home, with
  // no document open, so a new one replaces the untouched blank.
  const floatName = `float-${Date.now()}`;
  await check("a new document replacing a floated untouched blank takes its window with it", async () => {
    const blank = `${floatName}-blank`;
    await call("doc.new", { width: 64, height: 64, name: blank });
    await arrange("Float in Window");
    await until("no window for the blank", windows, (ws) => ws.some((w) => w.name === blank));
    await call("doc.new", { width: 64, height: 64, name: `${blank}-next` });
    const docs = JSON.parse((await call("script.run", { code: "vision.log(JSON.stringify(await vision.read.documents()))" })).slice(2));
    assert(!docs.some((d) => d.name === blank), `the blank was not replaced: ${JSON.stringify(docs)}`);
    await until("the replaced blank's window stayed open", windows, (ws) => !ws.some((w) => w.name === blank));
  });

  await check("Window ▸ Arrange ▸ Float in Window shows the document in a second window, and painting there edits it", async () => {
    await call("doc.new", { width: 200, height: 150, name: floatName });
    await call("script.run", { code: "vision.setForeground(0, 0, 0, 1);" });
    await arrange("Float in Window");
    const float = (await until("no window opened for the document", windows, (ws) => ws.some((w) => w.name === floatName)))
      .find((w) => w.name === floatName);
    assert(!(await tabsOf("Monet Vision")).includes(floatName), "the floated document is still a tab of the main window");
    // Its canvas, under the 48 pt title bar, fitted to the white document.
    const cx = float.x + float.w / 2, cy = float.y + 48 + (float.h - 48) / 2;
    await until("the window never showed the white document", () => screenRgb(cx, cy), (rgb) => rgb.every((v) => v > 230));

    const before = await render();
    await cliclick(`c:${float.x + float.w - 200},${float.y + 24}`); // focus it by its title bar
    await cliclick("t:b"); // the Brush, through the window's own keys
    await cliclick(`dd:${cx - 60},${cy}`, `dm:${cx},${cy}`, `du:${cx + 60},${cy}`);
    await until("the stroke never showed in the window", () => screenRgb(cx, cy), (rgb) => rgb.every((v) => v < 60));
    assert((await render()).hash !== before.hash, "painting in the window did not change the document");
  });

  await check("closing the float window returns its document to the tab bar, still open", async () => {
    await press(floatName, "Close");
    await until("the float window stayed open", windows, (ws) => !ws.some((w) => w.name === floatName));
    await until("the document did not come back as a tab", () => tabsOf("Monet Vision"), (tabs) => tabs.includes(floatName));
    const docs = JSON.parse((await call("script.run", { code: "vision.log(JSON.stringify(await vision.read.documents()))" })).slice(2));
    assert(docs.some((d) => d.name === floatName && d.dirty), `the stroke's document is gone: ${JSON.stringify(docs)}`);
  });

  /** Float a fresh white document; its window and its canvas centre. */
  const floatFresh = async (name, width, height) => {
    await call("doc.new", { width, height, name });
    await arrange("Float in Window");
    const w = (await until(`no window opened for ${name}`, windows, (ws) => ws.some((x) => x.name === name))).find((x) => x.name === name);
    const cx = w.x + w.w / 2, cy = w.y + 48 + (w.h - 48) / 2;
    await until(`${name}'s window never showed the document`, () => screenRgb(cx, cy), (rgb) => rgb.every((v) => v > 230));
    await cliclick(`c:${w.x + w.w - 200},${w.y + 24}`); // focus it by its title bar
    return { w, cx, cy };
  };

  await check("a marquee dragged in a float window draws its marching ants there", async () => {
    const { cx, cy } = await floatFresh(`${floatName}-ants`, 200, 150);
    await cliclick("t:m"); // the Marquee, through the window's own keys
    await cliclick(`dd:${cx - 150},${cy - 100}`, `dm:${cx},${cy}`, `du:${cx + 150},${cy + 100}`);
    const sel = JSON.parse((await call("script.run", { code: "vision.log(JSON.stringify(await vision.read.selectionBounds()))" })).slice(2));
    assert(sel && sel.w > 20 && sel.h > 20, `no selection from the drag: ${JSON.stringify(sel)}`);
    // Along its top edge, half the ants are black on the white document.
    const share = await until("no marching ants along the selection's top edge in the window",
      () => darkShare(cx - 120, cy - 106, 240, 12), (s) => s > 0.05);
    assert(share < 0.9, `the edge strip is all dark (${share}), not ants`);
    await press(`${floatName}-ants`, "Close");
  });

  await check("Quick Mask in a float window shows the overlay, updates while painting and clears on exit", async () => {
    const name = `${floatName}-quick-mask`;
    const { w, cx, cy } = await floatFresh(name, 400, 300);
    const original = await render();
    await cliclick("t:m");
    await cliclick(`dd:${cx - 100},${cy - 60}`, `dm:${cx},${cy}`, `du:${cx + 100},${cy + 60}`);
    await cliclick("t:q");
    const red = ([r, g, b]) => r > 220 && g < 200 && b < 200;
    await until("Quick Mask never tinted the area outside the selection", () => screenRgb(cx + 140, cy), red);
    assert((await screenRgb(cx, cy)).every((v) => v > 230), "Quick Mask tinted the selected centre before painting");
    await call("script.run", { code: "vision.setForeground(0, 0, 0, 1);" });
    await cliclick("t:b");
    await cliclick(`dd:${cx - 30},${cy}`, `dm:${cx},${cy}`, `dm:${cx + 30},${cy}`);
    try {
      await until("painting the Quick Mask never updated the float's overlay before pointerup", () => screenRgb(cx, cy), red);
    } finally {
      await cliclick(`du:${cx + 30},${cy}`);
    }
    await cliclick(`m:${w.x + w.w - 200},${w.y + 24}`); // keep the cursor out of the sample
    assert((await render()).hash === original.hash, "Quick Mask painting changed the document pixels");
    await cliclick("t:q");
    await until("Quick Mask stayed visible after exit", () => screenRgb(cx, cy), (rgb) => rgb.every((v) => v > 230));
    assert((await render()).hash === original.hash, "exiting Quick Mask changed the document pixels");
    await press(name, "Close");
  });

  await check("the Type tool in a float window types into the layer, not into the shortcuts", async () => {
    const name = `${floatName}-type`;
    const { cx, cy } = await floatFresh(name, 400, 200);
    await call("script.run", { code: "vision.setForeground(0, 0, 0, 1);" });
    await cliclick("t:t"); // the Type tool
    const blank = await render();
    await cliclick(`c:${cx - 250},${cy}`);
    const placeholder = await until("the click made no text layer", render, (r) => r.hash !== blank.hash);
    const layers = JSON.parse((await call("script.run", { code: "vision.log(JSON.stringify(await vision.read.layers()))" })).slice(2));
    assert(layers.some((l) => l.kind === 2), `no type layer: ${JSON.stringify(layers)}`);
    await cliclick("t:hi"); // replaces the selected placeholder: h and i are also tool shortcuts
    assert((await editors())[name] === 1, "no text field in the window to type into");
    // Escape ends the edit. (A real key: cliclick's synthetic Escape is not
    // always handed to WebKit's text field.)
    await osascript(["-e", 'tell application "System Events" to tell (first process whose unix id is __MONET_PID__) to key code 53']);
    await until("Escape in the window's text field did not end the edit", editors, (e) => e[name] === 0 && e["Monet Vision"] === 0);
    const typed = await until("typing in the window never reached the layer", render, (r) => r.hash !== placeholder.hash);
    assert(inkWidth(typed.raw) < inkWidth(placeholder.raw), `"hi" is not narrower than the placeholder (${inkWidth(typed.raw)} vs ${inkWidth(placeholder.raw)})`);
    await press(name, "Close");
  });

  await check("an on-canvas selection frame shows in a float window, and its handle there transforms the selection", async () => {
    const name = `${floatName}-frame`;
    const { w, cx, cy } = await floatFresh(name, 400, 300);
    await cliclick("t:m");
    await cliclick(`dd:${cx - 100},${cy + 20}`, `dm:${cx},${cy + 60}`, `du:${cx + 100},${cy + 120}`);
    const bounds = async () => JSON.parse((await call("script.run", { code: "vision.log(JSON.stringify(await vision.read.selectionBounds()))" })).slice(2));
    const before = await bounds();
    // Select ▸ Transform Selection… ▸ On Canvas puts the frame up.
    await menu("Select", "Transform Selection…");
    await until("no On Canvas button", () => osascript(["-l", "JavaScript", "-e", ON_CANVAS]), (r) => r === "pressed");
    // The frame's blue (#5b8cff) outline and handle around that corner.
    await until("the frame never showed in the window", () => screenShare(cx + 90, cy + 110, 20, 20, (r, g, b) => r < 140 && g > 110 && g < 190 && b > 220), (s) => s > 0.02);
    await cliclick(`c:${w.x + w.w - 200},${w.y + 24}`);
    // Its bottom-right handle sits on the selection's corner; Enter applies.
    await cliclick(`dd:${cx + 100},${cy + 120}`, `dm:${cx + 130},${cy + 140}`, `du:${cx + 160},${cy + 160}`);
    await osascript(["-e", 'tell application "System Events" to tell (first process whose unix id is __MONET_PID__) to key code 36']);
    const after = await until("the frame dragged in the window never applied", bounds, (b) => b.w > before.w + 10 && b.h > before.h + 10);
    assert(after.x === before.x && after.y === before.y, `the frame moved its fixed corner: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    await press(name, "Close");
  });

  await check("Float All in Windows and Cascade float every document down the diagonal; Consolidate brings them back", async () => {
    await call("doc.new", { width: 120, height: 90, name: `${floatName}-b` });
    const open = JSON.parse((await call("script.run", { code: "vision.log(JSON.stringify(await vision.read.documents()))" })).slice(2));
    const floated = (ws) => ws.filter((w) => w.name !== "Monet Vision");
    await arrange("Float All in Windows");
    await until("not every document got a window", windows, (ws) => floated(ws).length === open.length);
    assert((await tabsOf("Monet Vision")).length === 0, "documents stayed in the tab bar");

    // Knock one out of line; Cascade puts it back.
    await osascript(["-e", `tell application "System Events" to tell (first process whose unix id is __MONET_PID__) to set position of window "${floatName}-b" to {700, 500}`]);
    await arrange("Cascade");
    const ws = await until("Cascade left a window out of line", windows, (ws) => {
      const main = ws.find((w) => w.name === "Monet Vision");
      const spots = floated(ws).map((w) => [w.x - main.x, w.y - main.y]).sort((a, b) => a[0] - b[0]);
      return spots.length === open.length && spots.every(([dx, dy], i) => Math.abs(dx - 28 * (i + 1)) <= 1 && Math.abs(dy - 28 * (i + 1)) <= 1);
    });
    assert(floated(ws).length === open.length, `windows: ${JSON.stringify(ws)}`);

    await arrange("Consolidate All to Tabs");
    await until("float windows stayed open", windows, (ws) => floated(ws).length === 0);
    await until("not every document came back as a tab", () => tabsOf("Monet Vision"), (tabs) => tabs.length === open.length);
  });

  await check("doc.new creates a document at the requested size", async () => {
    const out = await call("doc.new", { width: 96, height: 64 });
    assert(/96/.test(out) && /64/.test(out), `unexpected: ${out}`);
  });

  await check("a fresh document renders real PNG bytes", async () => {
    const r = await render();
    assert(r.bytes > 50, `png suspiciously small (${r.bytes}B)`);
  });

  await check("adj.invert changes the rendered pixels", async () => {
    await call("doc.new", { width: 96, height: 64 });
    const before = await render();
    await call("adj.invert", {});
    const after = await render();
    assert(before.hash !== after.hash, "invert did not change the render");
  });

  await check("adj.invert twice returns to the original render", async () => {
    await call("doc.new", { width: 96, height: 64 });
    const start = await render();
    await call("adj.invert", {});
    await call("adj.invert", {});
    const back = await render();
    assert(start.hash === back.hash, "double invert did not round-trip");
  });

  await check("xform.resizeImage changes the exported dimensions", async () => {
    await call("doc.new", { width: 96, height: 64 });
    const before = await render();
    await call("xform.resizeImage", { width: 48, height: 32 });
    const after = await render();
    assert(before.hash !== after.hash, "resize did not change the render");
    assert(after.bytes !== before.bytes, "resize produced identically sized output");
  });

  await check("xform.rotate90 changes the render", async () => {
    await call("doc.new", { width: 96, height: 64 });
    await call("adj.invert", {});
    const before = await render();
    await call("xform.rotate90", {});
    const after = await render();
    assert(before.hash !== after.hash, "rotate90 did not change the render");
  });

  await check("doc.open loads a real file from disk", async () => {
    await call("doc.open", { path: FIXTURE });
    const r = await render();
    assert(r.bytes > 200, `opened document rendered only ${r.bytes}B`);
  });

  // Blur needs actual detail: a Gaussian over a uniform field is mathematically
  // a no-op, so blurring a blank document proves nothing. px.png is 12KB of
  // detail at 64x64, which is why this opens a fixture instead of doc.new.
  await check("fil.gaussian blurs real image content", async () => {
    await call("doc.open", { path: FIXTURE });
    const before = await render();
    await call("fil.gaussian", { radius: 4 });
    const after = await render();
    assert(before.hash !== after.hash, "gaussian blur did not change the render");
    assert(after.bytes < before.bytes, `blur should compress better; ${before.bytes}B -> ${after.bytes}B`);
  });

  await check("fil.sharpen changes real image content", async () => {
    await call("doc.open", { path: FIXTURE });
    const before = await render();
    await call("fil.sharpen", { amount: 100 });
    const after = await render();
    assert(before.hash !== after.hash, "sharpen did not change the render");
  });

  await check("doc.addLayer reports success and keeps the doc renderable", async () => {
    await call("doc.new", { width: 96, height: 64 });
    await call("doc.addLayer", {});
    const r = await render();
    assert(r.bytes > 50, "document stopped rendering after adding a layer");
  });

  await check("ml.models answers without a model download", async () => {
    const out = await call("ml.models", {});
    assert(typeof out === "string" && out.length > 0, "ml.models returned nothing");
  });

  /* ── command line (#468): headless jobs beside the running GUI ──────── */

  /** Run the binary as a job; `during(child)` runs while it is up. */
  const cli = (args, during) => new Promise((done) => {
    const child = execFile(BIN, args, { timeout: 180_000 }, (_error, stdout, stderr) =>
      done({ code: child.exitCode, stdout, stderr }));
    during?.(child);
  });
  const scratch = mkdtempSync(join(tmpdir(), "monet-vision-cli-"));
  const inDir = join(scratch, "in dir");
  const outDir = join(scratch, "out");
  mkdirSync(inDir);
  mkdirSync(outDir);
  copyFileSync(FIXTURE, join(inDir, "px.png"));
  const okScript = join(scratch, "ok.js");
  writeFileSync(okScript, 'vision.log("hi from the command line");');
  const badScript = join(scratch, "bad.js");
  writeFileSync(badScript, "vision.nope();");
  const mcpBefore = readFileSync(CONN);
  const actionRef = `Default Actions/CliInvert ${Date.now()}`;
  let savedId = null;

  /* ── plug-in formats (#466): native file access and the real wasm codecs ── */
  const formatFixtures = resolve(HERE, "..", "test-assets/fixtures");
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [0, 0, 0], [255, 255, 0], [0, 255, 255], [255, 0, 255]];
  for (const name of ["pillow-rgba.jp2", "imagemagick-rgb.dpx", "imagemagick-rgb.cin"]) {
    await check(`doc.open renders the independent ${name} fixture with its colors and alpha`, async () => {
      await call("doc.open", { path: join(formatFixtures, name) });
      const { w, h, bpp, px } = decodePng((await render()).raw);
      assert(w === 4 && h === 2 && bpp === 4, `${name}: rendered ${w} × ${h}, ${bpp} channels`);
      const alpha = name.endsWith("jp2") ? [255, 128, 64, 0, 255, 255, 255, 255] : Array(8).fill(255);
      for (let i = 0; i < colors.length; i++) {
        assert(px[i * bpp + 3] === alpha[i], `${name}: pixel ${i} alpha ${px[i * bpp + 3]}, expected ${alpha[i]}`);
        assert(!alpha[i] || colors[i].every((v, c) => px[i * bpp + c] === v), `${name}: pixel ${i} color ${[...px.subarray(i * bpp, i * bpp + 3)]}`);
      }
    });
  }

  await check("doc.saveAs writes lossless JPEG 2000 that reopens with identical pixels", async () => {
    await call("doc.open", { path: join(formatFixtures, "pillow-rgba.jp2") });
    const before = decodePng((await render()).raw);
    const path = join(scratch, "native-roundtrip.jp2");
    await call("doc.saveAs", { path });
    const bytes = readFileSync(path);
    assert(bytes.subarray(0, 12).equals(Buffer.from([0, 0, 0, 12, 0x6a, 0x50, 0x20, 0x20, 13, 10, 0x87, 10])), "saved file has no JPEG 2000 signature");
    await call("doc.open", { path });
    const after = decodePng((await render()).raw);
    assert(after.w === before.w && after.h === before.h && after.bpp === before.bpp && after.px.equals(before.px), "JPEG 2000 save/reopen changed the pixels");
  });

  // #505: a File ▸ Export used to click a download anchor WKWebView cancels,
  // so the desktop app wrote nothing. The export must end in a native save
  // panel and the file must actually reach the chosen folder. Driven through
  // the real menu bar and NSSavePanel, like the unsaved-changes sheet below —
  // a sheet up means the panel showed; the destination is typed into the
  // panel's filename field (NSSavePanel navigates to an absolute path entered
  // there) and Save is pressed through the accessibility API.
  const SHEETS = `function run() {
    const p = Application("System Events").processes.whose({ unixId: __MONET_PID__ })[0];
    let n = 0;
    for (const w of p.windows()) { try { n += w.sheets().length; } catch { /* no sheets */ } }
    return String(n);
  }`;
  const sheetCount = async () => Number(await osascript(["-l", "JavaScript", "-e", SHEETS]));
  const SAVE_AS = `function run([path]) {
    const p = Application("System Events").processes.whose({ unixId: __MONET_PID__ })[0];
    const get = (f) => { try { return f(); } catch { return null; } };
    for (const w of p.windows()) {
      for (const s of get(() => w.sheets()) ?? []) {
        const fields = get(() => s.textFields()) ?? [];
        if (!fields.length) continue;
        fields[0].value = path;
        const save = (get(() => s.buttons()) ?? []).find((b) => String(get(() => b.title()) ?? get(() => b.name()) ?? "") === "Save");
        if (!save) throw new Error("no Save button in the save panel");
        save.actions.byName("AXPress").perform();
        return "saved";
      }
    }
    throw new Error("no save panel sheet with a filename field");
  }`;
  await check("File ▸ Export ▸ Quick Export as PNG shows the native save panel and writes the file (#505)", async () => {
    const name = `export-${Date.now()}`;
    await call("doc.new", { width: 32, height: 32, name });
    const dir = join(scratch, "export out");
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `${name}.png`);
    await menu("File", "Export", "Quick Export as PNG");
    await until("no native save panel for Quick Export", sheetCount, (n) => n > 0);
    await osascript(["-e", 'tell application "System Events" to set frontmost of (first process whose unix id is __MONET_PID__) to true']);
    assert((await osascript(["-l", "JavaScript", "-e", SAVE_AS, out])) === "saved", "the save panel did not take the destination");
    await until("the save panel never closed", sheetCount, (n) => n === 0);
    const written = await until(`no exported file at ${out}`, async () => existsSync(out), (yes) => yes);
    assert(written, "export wrote nothing");
    const bytes = readFileSync(out);
    assert(bytes.length > 50 && bytes.subarray(1, 4).toString() === "PNG", `export is not a PNG (${bytes.length}B)`);
  });

  await check("headerless Raw needs an explicit layout and a refused doc.open leaves the engine usable", async () => {
    const path = join(scratch, "native-layout.raw");
    writeFileSync(path, Buffer.from([9, 8, 7, 6, 255, 0, 0, 0, 255, 0]));
    const before = await render(), docs = await docNames();
    const refusal = await call("doc.open", { path }).then(() => "", (error) => error.message);
    assert(refusal.includes("doc.openPhotoshopRaw"), `expected an explicit-layout error, got ${refusal || "success"}`);
    assert((await render()).hash === before.hash && JSON.stringify(await docNames()) === JSON.stringify(docs), "refused Raw open changed the current document");
    await call("doc.openPhotoshopRaw", { path, width: 2, height: 1, channels: 3, depth: 8, interleaved: true, header: 4 });
    const opened = decodePng((await render()).raw);
    assert(opened.w === 2 && opened.h === 1 && opened.bpp === 4 && opened.px.equals(Buffer.from([255, 0, 0, 255, 0, 255, 0, 255])), "Photoshop Raw layout did not produce the red/green pixels");
    const original = (await render()).hash;
    await call("adj.invert");
    assert((await render()).hash !== original, "engine stopped responding after the refused Raw open");
  });

  await check("action.save stores an action for the command line", async () => {
    await call("doc.new", { width: 32, height: 32 });
    await call("action.record", { recording: true });
    await call("adj.invert", {});
    await call("action.record", { recording: false });
    const saved = JSON.parse(await call("action.save", { name: actionRef.slice(actionRef.indexOf("/") + 1) }));
    savedId = saved.id;
    assert(`${saved.set}/${saved.name}` === actionRef, `saved as ${saved.set}/${saved.name}`);
  });

  // A job reads saved actions from the WebKit store the GUI flushes lazily, so
  // this also waits (on state, not time) for that write to reach the disk.
  await check("--play-action naming no saved action exits 2, lists the saved ones and writes nothing", async () => {
    let run;
    for (let attempt = 0; attempt < 20; attempt++) {
      run = await cli(["--play-action", "Nope/Missing", "--batch", inDir, "--dest", outDir]);
      assert(run.code === 2, `exit ${run.code}: ${run.stderr}`);
      if (run.stderr.includes(actionRef)) break;
    }
    assert(run.stderr.includes(actionRef), `the saved action was never listed: ${run.stderr}`);
    assert(readdirSync(outDir).length === 0, `wrote ${readdirSync(outDir)}`);
  });

  await check("--run-script exits 0 and prints the script's log", async () => {
    const run = await cli(["--run-script", okScript]);
    assert(run.code === 0, `exit ${run.code}: ${run.stderr}`);
    assert(run.stdout.includes("hi from the command line"), `stdout: ${run.stdout}`);
  });

  await check("--run-script with a missing file exits 2 naming it", async () => {
    const missing = join(scratch, "missing.js");
    const run = await cli(["--run-script", missing]);
    assert(run.code === 2 && run.stderr.includes(missing), `exit ${run.code}: ${run.stderr}`);
  });

  await check("--run-script with a failing script exits 1 with its error", async () => {
    const run = await cli(["--run-script", badScript]);
    assert(run.code === 1 && run.stderr.trim().length > 0, `exit ${run.code}: ${run.stderr}`);
  });

  await check("--play-action --batch plays the saved action over the folder without showing a window", async () => {
    let windows = 0;
    const run = await cli(["--play-action", actionRef, "--batch", inDir, "--dest", outDir], (child) => {
      const sample = setInterval(() => execFile("osascript", ["-e",
        `tell application "System Events" to count windows of (first process whose unix id is ${child.pid})`],
        (e, out) => { if (!e) windows = Math.max(windows, Number(out.trim()) || 0); }), 250);
      child.on("exit", () => clearInterval(sample));
    });
    assert(run.code === 0, `exit ${run.code}: ${run.stderr}`);
    const out = join(outDir, "px_001_processed.png");
    assert(existsSync(out), `no output; the folder holds ${readdirSync(outDir)}`);
    await call("doc.open", { path: FIXTURE });
    const source = await render();
    await call("doc.open", { path: out });
    const processed = await render();
    assert(processed.hash !== source.hash, "the output renders like its source: the action did not run");
    assert(windows === 0, `the job showed ${windows} window(s)`);
  });

  // #469: a droplet descriptor handed over with images runs its batch over them.
  const dropOut = join(scratch, "droplet out");
  mkdirSync(dropOut);
  const droplet = join(scratch, "Invert droplet.json");
  writeFileSync(droplet, JSON.stringify({
    actionName: actionRef.slice(actionRef.indexOf("/") + 1), format: "png", template: "{name}_droplet", destDir: dropOut, stopOnError: false,
  }));
  const dropped = join(dropOut, "px_droplet.png");

  await check("monet-vision droplet.json <folder> runs the droplet headless and prints a summary", async () => {
    const run = await cli([droplet, inDir]);
    assert(run.code === 0 && run.stdout.includes("1 processed"), `exit ${run.code}: ${run.stdout}${run.stderr}`);
    assert(existsSync(dropped), `no output; the folder holds ${readdirSync(dropOut)}`);
    rmSync(dropped);
  });

  await check("command-line jobs leave the running GUI's MCP connection alone", async () => {
    assert(readFileSync(CONN).equals(mcpBefore), "a job rewrote mcp.json");
    await call("ml.models", {});
  });

  // #453: same-weight faces from the real /System/Library/Fonts, found by the
  // app's own Tauri font scan and picked in the Character panel.
  await check("Helvetica Neue Condensed Bold stays picked and draws condensed on canvas and in its work path", async () => {
    await newType('"Helvetica Neue", Helvetica, Arial, sans-serif');
    await menu("Type", "Panels", "Character Panel");
    const bold = await pickStyle("Bold");
    assert(bold.length === 2 && bold.every((v) => v === "Bold"), `Bold did not stick: ${bold}`);
    const wBold = inkWidth((await render()).raw);
    const condensed = await pickStyle("Condensed Bold");
    assert(condensed.length === 2 && condensed.every((v) => v === "Condensed Bold"), `Condensed Bold did not stick: ${condensed}`);
    const wCond = inkWidth((await render()).raw);
    assert(wBold > 100 && wCond < 0.85 * wBold, `canvas: Bold ${wBold}px, Condensed Bold ${wCond}px`);

    execFile("pbcopy").stdin.end("");
    await menu("Type", "Create Work Path");
    await menu("Layer", "Copy SVG");
    let svg = "";
    for (let i = 0; i < 20 && !svg.includes("<path"); i++) {
      await sleep(250);
      svg = await new Promise((r) => execFile("pbpaste", (e, out) => r(out ?? "")));
    }
    const xs = [...svg.matchAll(/ d="([^"]*)"/g)].flatMap((d) => [...d[1].matchAll(/(-?[\d.]+),-?[\d.]+/g)].map((m) => Number(m[1])));
    const wPath = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    assert(Math.abs(wPath - wCond) < 0.05 * wCond, `work path ${wPath}px wide, canvas ${wCond}px`);
  });

  // Runs after the pick above, which waited for the scan to load the aliases.
  await check("each Helvetica Neue face alias resolves on the canvas on its own", async () => {
    const width = async (face) => {
      await newType(`"Monet face:${face}", monospace`, true);
      return inkWidth((await render()).raw);
    };
    const bold = await width("HelveticaNeue-Bold"), condensed = await width("HelveticaNeue-CondensedBold");
    assert(condensed < 0.85 * bold, `alias only: Bold ${bold}px, Condensed Bold ${condensed}px`);
  });

  await check("Avenir Book and Roman are distinct picks that render differently", async () => {
    await newType('Avenir, "Avenir Next", sans-serif');
    const hashes = [];
    for (const label of ["Book", "Roman"]) {
      const picked = await pickStyle(label);
      assert(picked.length === 2 && picked.every((v) => v === label), `${label} did not stick: ${picked}`);
      hashes.push((await render()).hash);
    }
    assert(hashes[0] !== hashes[1], "Book and Roman rendered identically");
  });

  // The droplet app makes the same open-documents request of Vision (`open
  // -a <Vision> descriptor drop…`) as the `open -a` here. Each processed image
  // is closed once its output is written, so the open documents stay as they were.
  const dropIn = join(scratch, "drop in");
  mkdirSync(dropIn);
  for (const name of ["a.png", "b.png", "c.png"]) copyFileSync(FIXTURE, join(dropIn, name));
  const outputs = (dir) => readdirSync(dir).filter((f) => f.endsWith("_droplet.png")).sort();
  const waitOutputs = async (dir, count) => {
    for (let i = 0; i < 240 && outputs(dir).length < count; i++) await sleep(250);
    return outputs(dir);
  };
  await check("a droplet opened with images in the running GUI runs its batch, closes each image and shows the summary", async () => {
    const before = await docNames();
    spawn("open", ["-a", APP, droplet, dropIn], { stdio: "ignore" });
    const made = await waitOutputs(dropOut, 3);
    assert(made.join() === "a_droplet.png,b_droplet.png,c_droplet.png", `outputs: ${made}`);
    let summary = "";
    for (let i = 0; i < 20 && !summary; i++) {
      summary = await osascript(["-l", "JavaScript", "-e", DROPLET_SUMMARY]).catch(() => "");
      if (!summary) await sleep(500);
    }
    assert(summary === "Processed 3 of 3: a.png, b.png, c.png", `the Droplet dialog shows "${summary}"`);
    const after = await docNames();
    assert(JSON.stringify(after) === JSON.stringify(before), `open documents went from ${JSON.stringify(before)} to ${JSON.stringify(after)}`);
    await call("doc.open", { path: FIXTURE });
    const source = await render();
    await call("doc.open", { path: join(dropOut, "a_droplet.png") });
    assert((await render()).hash !== source.hash, "the output renders like its source: the droplet's action did not run");
  });

  // A cold launch gets its files as RunEvent::Opened before Tauri's setup has
  // run (#469): Vision must park them, not crash, whether they come from
  // `open -a` or from a droplet app.
  const crashReports = () => readdirSync(CRASHES).filter((f) => f.startsWith("Vision-"));
  const coldOut = join(scratch, "cold out");
  mkdirSync(coldOut);
  const coldDroplet = join(scratch, "Cold Droplet.app");
  let dropletApp = false;
  await check("action.saveDroplet builds a droplet app around a saved action", async () => {
    await call("action.saveDroplet", { path: coldDroplet, actionId: savedId, template: "{name}_droplet", destDir: coldOut });
    const bundled = JSON.parse(readFileSync(join(coldDroplet, "Contents/Resources/droplet.json"), "utf8"));
    assert(bundled.actionName === actionRef.slice(actionRef.indexOf("/") + 1) && bundled.destDir === coldOut, JSON.stringify(bundled));
    dropletApp = true;
  });
  const coldLaunch = async (args) => {
    assert(launched.size, "Vision was already running when the harness started; quit it to run the cold-launch checks");
    await stopLaunched();
    assert(!(await bundlePids()).length, "Vision is still running");
    const crashed = crashReports();
    const up = await start(args);
    return { up, newCrashes: () => crashReports().filter((f) => !crashed.includes(f)) };
  };

  await check("a cold `open -a Vision image` opens the image without crashing", async () => {
    const { up, newCrashes } = await coldLaunch(["-a", APP, join(dropIn, "a.png")]);
    assert(up, `Vision never answered; new crash reports: ${newCrashes()}`);
    let names = [];
    for (let i = 0; i < 40 && !names.includes("a.png"); i++) { await sleep(250); names = await docNames(); }
    assert(names.includes("a.png"), `open documents: ${JSON.stringify(names)}`);
    assert(!newCrashes().length, `new crash reports: ${newCrashes()}`);
  });

  await check("a drop on a droplet app with Vision not running launches it, runs the batch and closes each image", async () => {
    assert(dropletApp, "no droplet app to drop on");
    const { up, newCrashes } = await coldLaunch(["-a", coldDroplet, dropIn]);
    assert(up, `Vision never answered; new crash reports: ${newCrashes()}`);
    const made = await waitOutputs(coldOut, 3);
    assert(made.join() === "a_droplet.png,b_droplet.png,c_droplet.png", `outputs: ${made}`);
    await sleep(1000);
    const names = await docNames();
    assert(!names.some((name) => ["a.png", "b.png", "c.png"].includes(name)), `processed images left open: ${JSON.stringify(names)}`);
    assert(!newCrashes().length, `new crash reports: ${newCrashes()}`);
  });

  // By name: action ids are positional and restart with every launch above.
  const ours = JSON.parse(await call("action.list", {}).catch(() => "[]")).find((a) => `${a.set}/${a.name}` === actionRef);
  if (ours) await call("action.delete", { actionId: ours.id }).catch(() => {});
  rmSync(scratch, { recursive: true, force: true });

  // Last: it quits the app. (#477, and the #54 guard's destroy permission)
  await check("closing the main window with a dirty floated document asks once; Yes closes it and every float", async () => {
    const pids = await bundlePids();
    assert(pids.length && pids.every((pid) => launched.has(pid)), "the close check only quits Vision launched by this harness");
    const name = `${floatName}-dirty`;
    await call("doc.new", { width: 64, height: 64, name });
    await call("adj.invert", {});
    await arrange("Float in Window");
    await until("no window for the dirty document", windows, (ws) => ws.some((w) => w.name === name));
    await press("Monet Vision", "Close");
    await until("no unsaved-changes prompt", () => dialogCount("without saving"), (n) => n > 0);
    await sleep(1000);
    assert((await dialogCount("without saving")) === 1, "asked more than once");
    assert((await windows()).some((w) => w.name === name), "the float closed before the prompt was answered");
    await dialogCount("without saving", "Yes");
    await until("windows outlived the main window", async () => ((await bundlePids()).length ? windows().catch(() => []) : []), (ws) => ws.length === 0);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (!KEEP) await stopLaunched();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
