// ─────────────────────────────────────────────────────────────
// engines.ts — the multi-engine system. Monet Jouer authors on one bundled
// Phaser ("the editor engine") but can *install* additional Phaser builds and
// run the current project under any of them, to test how scenes + animations
// behave across versions (e.g. the Elastic easing default changed between
// releases).
//
// Three kinds of engine source:
//   • bundled — the statically-imported Phaser; always installed.
//   • local   — a build shipped in public/engines/ (offline, one-click).
//   • cdn     — any version downloaded from jsDelivr on demand. The dist bytes
//     are cached in IndexedDB so the install persists and works offline after
//     the first download.
//
// A downloaded build is loaded as a same-origin blob: script (CSP allows
// `script-src 'self' blob:` and `connect-src … https://cdn.jsdelivr.net`), so
// the cross-origin code never executes directly. Each build's `window.Phaser`
// namespace is captured into a registry and the global restored, keeping
// versions isolated; games are created from a captured namespace's `Game`.
// ─────────────────────────────────────────────────────────────

import Phaser from "phaser";

/** A Phaser namespace (loosely typed — versions differ). */
export type PhaserNS = typeof Phaser & { VERSION?: string };

export type EngineStatus = "available" | "installing" | "installed" | "error";
export type EngineSource = "bundled" | "local" | "cdn";

export interface EngineInfo {
  version: string;
  label: string;
  status: EngineStatus;
  source: EngineSource;
  /** cdn engines can be uninstalled (cache evicted). */
  removable: boolean;
}

const BUNDLED_VERSION = (Phaser as PhaserNS).VERSION ?? "4.1.0";

/** Built-in offline builds shipped under public/engines/. */
const LOCAL: { version: string; url: string }[] = [
  { version: "4.0.0", url: "/engines/phaser-4.0.0.min.js" },
  { version: "3.90.0", url: "/engines/phaser-3.90.0.min.js" },
];

const cdnDistUrl = (v: string) => `https://cdn.jsdelivr.net/npm/phaser@${v}/dist/phaser.min.js`;
const JSDELIVR_META = "https://data.jsdelivr.com/v1/packages/npm/phaser";
const SEMVER = /^\d+\.\d+\.\d+$/;

// In-memory loaded namespaces.
const namespaces = new Map<string, PhaserNS>([[BUNDLED_VERSION, Phaser as PhaserNS]]);
// CDN versions known to be installed (cached in IndexedDB).
const cdnInstalled = new Set<string>();
// Per-version status overrides (loading/error).
const transient = new Map<string, EngineStatus>();

let activeVersion = BUNDLED_VERSION;

// ── reactive snapshot (useSyncExternalStore-friendly) ─────────
export interface EnginesSnapshot {
  engines: EngineInfo[];
  active: string;
  rev: number;
}

let rev = 0;
let snapshot: EnginesSnapshot = build();
const listeners = new Set<() => void>();

function statusOf(version: string, source: EngineSource): EngineStatus {
  const t = transient.get(version);
  if (t) return t;
  if (source === "bundled") return "installed";
  if (namespaces.has(version)) return "installed";
  if (source === "cdn") return cdnInstalled.has(version) ? "installed" : "available";
  return "available"; // local, not yet loaded — one click installs it
}

function build(): EnginesSnapshot {
  const seen = new Set<string>();
  const rows: EngineInfo[] = [];
  const add = (version: string, source: EngineSource) => {
    if (seen.has(version)) return;
    seen.add(version);
    rows.push({
      version,
      label: `Phaser ${version}${source === "bundled" ? " · bundled" : ""}`,
      status: statusOf(version, source),
      source,
      removable: source === "cdn",
    });
  };
  add(BUNDLED_VERSION, "bundled");
  LOCAL.forEach((e) => add(e.version, "local"));
  [...cdnInstalled].sort(byVersionDesc).forEach((v) => add(v, "cdn"));
  return { engines: rows, active: activeVersion, rev };
}

function byVersionDesc(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return 0;
}

function bump(): void {
  rev++;
  snapshot = build();
  for (const l of listeners) l();
}

export const enginesStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  getSnapshot(): EnginesSnapshot {
    return snapshot;
  },
};

// ── queries ───────────────────────────────────────────────────
export function isInstalled(version: string): boolean {
  return namespaces.has(version) || cdnInstalled.has(version) || version === BUNDLED_VERSION;
}
export function getEngine(version: string): PhaserNS | undefined {
  return namespaces.get(version);
}
export function activeEngine(): { version: string; ns: PhaserNS | undefined } {
  return { version: activeVersion, ns: namespaces.get(activeVersion) };
}
export function engineVersion(ns: PhaserNS): string {
  return ns.VERSION ?? "?";
}
export function setActiveEngine(version: string): void {
  if (activeVersion === version) return;
  activeVersion = version;
  bump();
}

// ── install / load ────────────────────────────────────────────
/** Load (install) an engine so it can run. Resolves the namespace, downloading
 *  + caching a CDN build on first use. Idempotent. A version that is neither
 *  bundled nor local is treated as a CDN install. */
export async function installEngine(version: string): Promise<PhaserNS> {
  const existing = namespaces.get(version);
  if (existing) return existing;
  if (!SEMVER.test(version)) throw new Error(`Invalid version: ${version}`);

  transient.set(version, "installing");
  bump();
  try {
    const local = LOCAL.find((e) => e.version === version);
    let ns: PhaserNS;
    if (local) {
      ns = await loadAndCapture(local.url);
    } else {
      ns = await loadCdn(version); // fetch+cache+blob-load
      cdnInstalled.add(version);
    }
    namespaces.set(version, ns);
    transient.delete(version);
    bump();
    return ns;
  } catch (e) {
    transient.set(version, "error");
    bump();
    throw e;
  }
}

/** Evict a downloaded (cdn) engine: drop the cache + the loaded namespace. */
export async function removeEngine(version: string): Promise<void> {
  if (version === BUNDLED_VERSION) return;
  await idbDelete(version).catch(() => {});
  cdnInstalled.delete(version);
  namespaces.delete(version);
  transient.delete(version);
  if (activeVersion === version) activeVersion = BUNDLED_VERSION;
  bump();
}

/** Fetch the list of installable Phaser versions from the jsDelivr metadata API
 *  (stable releases only), so the UI can offer a picker. Falls back to a small
 *  built-in list if the network/registry is unavailable. */
export async function fetchAvailableVersions(): Promise<string[]> {
  try {
    const res = await fetch(JSDELIVR_META, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { versions?: { version: string }[] };
    const list = (data.versions ?? [])
      .map((v) => v.version)
      .filter((v) => SEMVER.test(v)); // stable x.y.z only
    return list.length ? list : FALLBACK_VERSIONS;
  } catch {
    return FALLBACK_VERSIONS;
  }
}

const FALLBACK_VERSIONS = ["4.1.0", "4.0.0", "3.90.0", "3.88.2", "3.80.1", "3.70.0", "3.60.0"];

// ── loaders ───────────────────────────────────────────────────
async function loadCdn(version: string): Promise<PhaserNS> {
  let js = await idbGet(version);
  if (!js) {
    const res = await fetch(cdnDistUrl(version));
    if (!res.ok) throw new Error(`Download failed (${res.status}) for Phaser ${version}`);
    js = await res.text();
    await idbPut(version, js).catch(() => {}); // best-effort cache
  }
  const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  try {
    return await loadAndCapture(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Append a <script>, capture the Phaser namespace it installs on window, and
 *  restore the previous global so versions don't clobber each other. */
function loadAndCapture(url: string): Promise<PhaserNS> {
  return new Promise((resolve, reject) => {
    const prev = (window as unknown as { Phaser?: PhaserNS }).Phaser;
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => {
      const ns = (window as unknown as { Phaser?: PhaserNS }).Phaser;
      (window as unknown as { Phaser?: PhaserNS }).Phaser = prev;
      if (!ns || typeof (ns as unknown as { Game?: unknown }).Game !== "function") {
        reject(new Error("engine did not expose Phaser.Game"));
      } else {
        resolve(ns);
      }
    };
    s.onerror = () => reject(new Error(`Failed to load engine script: ${url}`));
    document.head.appendChild(s);
  });
}

// ── IndexedDB cache (best-effort; no-ops where unavailable) ───
const DB_NAME = "mj-engines";
const STORE = "builds";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) return reject(new Error("no indexedDB"));
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "version" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb open failed"));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) =>
    new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  );
}

async function idbGet(version: string): Promise<string | undefined> {
  try {
    const row = (await tx<{ version: string; js: string } | undefined>("readonly", (s) => s.get(version)));
    return row?.js;
  } catch {
    return undefined;
  }
}
function idbPut(version: string, js: string): Promise<unknown> {
  return tx("readwrite", (s) => s.put({ version, js }));
}
function idbDelete(version: string): Promise<unknown> {
  return tx("readwrite", (s) => s.delete(version));
}
async function idbKeys(): Promise<string[]> {
  try {
    return (await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys())).map(String);
  } catch {
    return [];
  }
}

// ── init: surface already-cached cdn engines as installed ─────
void idbKeys().then((keys) => {
  let changed = false;
  for (const v of keys) {
    if (v !== BUNDLED_VERSION && SEMVER.test(v) && !LOCAL.some((l) => l.version === v)) {
      if (!cdnInstalled.has(v)) { cdnInstalled.add(v); changed = true; }
    }
  }
  if (changed) bump();
});
