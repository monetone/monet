// ─────────────────────────────────────────────────────────────

import { SCRIPT_LIMIT_ERROR, SCRIPT_MAX_OPS } from "./scriptLimits";
// scriptWorker — sandboxed runner for the Scripting Console.
//
// Untrusted, user-pasted script code runs HERE, in an isolated Worker realm:
// no `window`, no `document`, no `fetch`, no DOM, and — critically — no access
// to the Tauri IPC bridge (which is injected into the main window, not workers),
// so a script cannot reach @tauri-apps/plugin-fs to read/write files or
// exfiltrate. The curated `vision` API exposed to the script only RECORDS calls
// as `[opPath, args]`; the recorded list is posted back to the main thread,
// which validates each op against its allowlist and executes it against the
// engine. The script therefore drives the editor but can touch nothing else.
// (Closes review Sec C1: previously `new Function(code)` ran in the full page
// realm with ambient fs/DOM/network reach.)
//
// READS (V-SCRIPT-1). Writes stay record-and-replay, but the script can now ask
// for document state: `vision.read.*` leaves are async — awaiting one FLUSHES
// the ops recorded so far to the main thread, which executes them and answers
// with the live value. So `await vision.read.layers()` sees the layer the
// script just added, and a script can loop, branch and size ops to the canvas.
// The read channel carries plain structured-cloned data in one direction only:
// the worker still holds no host handle, and a read path is checked against its
// own allowlist on the main thread exactly like an op.
//
// ponytail: ops themselves stay fire-and-forget — `vision.addLayer()` returns
// undefined, read the resulting state back (`await vision.read.activeLayerId()`).
// Upgrade path if that chafes: return a thenable per op that flushes on await.
// ─────────────────────────────────────────────────────────────

interface RunMsg {
  code: string;
  /** Allowlisted op paths (e.g. "fill", "adj.brightnessContrast") the main
   *  thread will accept and execute. The worker mirrors this shape so the script
   *  sees the same `vision` API surface. */
  ops: string[];
  /** Allowlisted read paths (e.g. "layers", "selectionBounds"), exposed under
   *  `vision.read.*` as async leaves. Absent = writes only. */
  reads?: string[];
}
/** Main-thread answer to one `vision.read.*` call. */
interface ReadReply {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}
type Recorded = [string, unknown[]];

// `self` is the DedicatedWorkerGlobalScope; avoid pulling in the webworker lib
// (which conflicts with the DOM lib used by the rest of src) via a narrow cast.
const ctx = self as unknown as {
  addEventListener: (type: "message", listener: (e: MessageEvent<RunMsg | ReadReply>) => void) => void;
  postMessage: (msg: unknown) => void;
};
const postResult = ctx.postMessage.bind(ctx);
const listen = ctx.addEventListener.bind(ctx);
// AsyncFunction, captured before the constructor paths below are removed: the
// script body is compiled as an async function so it can `await` a read at top
// level. A sync script is unaffected (it runs to completion before the first
// microtask). Grabbing it here — not `Function` — is what keeps `await` legal.
const runCode = Object.getPrototypeOf(async function () {}).constructor as
  (...args: string[]) => (vision: unknown) => Promise<void>;
const containsImport = RegExp.prototype.test.bind(/\bimport\b/);

// Function constructors can rebuild `import()` without spelling it in the
// original source. Remove every intrinsic constructor path before user code.
for (const fn of [function () {}, async function () {}, function* () {}, async function* () {}])
  Object.defineProperty(Object.getPrototypeOf(fn), "constructor", { value: undefined, writable: false, configurable: false });

// Remove every ambient path that can perform network I/O, create a less
// restricted realm, or spoof the worker's result channel. Keep the bound
// postMessage above as the worker's sole outbound capability.
const deniedGlobals = [
  "fetch", "fetchLater", "XMLHttpRequest", "WebSocket", "WebSocketStream", "EventSource",
  "WebTransport", "RTCPeerConnection", "webkitRTCPeerConnection", "Worker",
  "SharedWorker", "importScripts", "FontFace", "fonts", "caches", "indexedDB",
  "navigator", "location", "BroadcastChannel", "postMessage", "close", "eval",
  "Function", "setTimeout", "setInterval", "onmessage", "addEventListener",
  "removeEventListener", "dispatchEvent", "Notification", "ShadowRealm",
  "webkitRequestFileSystem", "webkitRequestFileSystemSync",
  "webkitResolveLocalFileSystemURL", "webkitResolveLocalFileSystemSyncURL",
  "IdleDetector", "PressureObserver",
];
for (const name of deniedGlobals) {
  let owner: object | null = globalThis;
  while (owner && !Object.prototype.hasOwnProperty.call(owner, name)) owner = Object.getPrototypeOf(owner);
  if (owner) Object.defineProperty(owner, name, { value: undefined, writable: false, configurable: false });
  if (owner !== globalThis) Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
}

// Ops recorded since the last flush, and the run's cumulative op count — the
// budget is per RUN, not per flush, so draining for a read can't refill it.
const recorded: Recorded[] = [];
let opCount = 0;
let overflowed = false;
const pendingReads = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let nextReadId = 1;

// Graft leaves onto a nested object mirroring the vision API shape, from dotted
// paths. There is no engine, store, or any host handle in this realm — a leaf
// can only append to the sink or ask the main thread a question.
function attach(root: Record<string, unknown>, paths: string[], leaf: (path: string) => unknown): void {
  for (const path of paths) {
    const parts = path.split(".");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      node[parts[i]] = node[parts[i]] ?? {};
      node = node[parts[i]] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = leaf(path);
  }
}

function record(path: string, args: unknown[]): void {
  if (opCount >= SCRIPT_MAX_OPS) {
    overflowed = true;
    throw SCRIPT_LIMIT_ERROR;
  }
  opCount++;
  recorded.push([path, args]);
}

// Ask the main thread for live state. The ops recorded so far ride along and are
// executed BEFORE the read is evaluated, so a script always observes its own edits.
function requestRead(path: string, args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextReadId++;
    pendingReads.set(id, { resolve, reject });
    postResult({ kind: "read", id, path, args, ops: recorded.splice(0, recorded.length) });
  });
}

function settleRead(reply: ReadReply): void {
  const pending = pendingReads.get(reply.id);
  if (!pending) return;
  pendingReads.delete(reply.id);
  if (reply.ok) pending.resolve(reply.value);
  else pending.reject(new Error(reply.error || "Read failed"));
}

async function run({ code, ops, reads = [] }: RunMsg): Promise<void> {
  const vision: Record<string, unknown> = {};
  attach(vision, ops, (path) => (...args: unknown[]) => record(path, args));
  const readTree: Record<string, unknown> = {};
  attach(readTree, reads, (path) => (...args: unknown[]) => requestRead(path, args));
  vision.read = readTree;
  try {
    // ponytail: conservatively rejects `import` in strings/comments; add a lexer only if scripts need that word as data.
    if (containsImport(code)) throw new Error("Dynamic import is not available in scripts");
    await runCode("vision", code)(vision);
    if (overflowed) {
      postResult({ ok: false, error: SCRIPT_LIMIT_ERROR });
      return;
    }
    postResult({ ok: true, ops: recorded });
  } catch (err) {
    postResult({ ok: false, error: overflowed ? SCRIPT_LIMIT_ERROR : err instanceof Error ? err.message : String(err) });
  }
}

listen("message", (e) => {
  const msg = e.data;
  if ("code" in msg) void run(msg);
  else settleRead(msg);
});
