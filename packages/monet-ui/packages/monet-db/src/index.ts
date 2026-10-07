// @monet-ui/monet-db — the typed bridge to the shared `monet-db` Rust library
// (../../crates/monet-db), reached through an app's database Tauri commands.
//
// A BRIDGE, not a second implementation: every function here is one `invoke`.
// The pragmas, the maintenance calls and the container ↔ live-database
// lifecycle all live in Rust, where the only SQLite connection is.
//
// EVERY method here maps to a command an app really registers. A binding with
// no command behind it is worse than a missing feature: it typechecks, it
// autocompletes, and it fails at runtime in front of a user.
//
// An app registers these commands on its own Tauri plugin, so binding names the
// plugin and the prefix its commands carry:
//
//   const db = monetDb("catalog", "catalog_");   // Galerie's `.galcat` plugin
//   await db.open("/Users/me/Pictures/Main.galcat");

import { invoke, isTauri } from "@tauri-apps/api/core";

/** The generic database surface every Monet app's plugin exposes. */
export interface MonetDb {
  /** Open (creating if absent) the database at `path`; returns its schema version. */
  open(path: string): Promise<number>;
  /** Close the open database (flushes the WAL). */
  close(): Promise<void>;
  /** `PRAGMA integrity_check` — "ok" when clean, else the first problem. */
  integrityCheck(): Promise<string>;
  /** Compact + re-analyze: checkpoint, VACUUM, refresh planner stats. */
  optimize(): Promise<void>;
  /** Copy a consistent point-in-time snapshot to `dest`. */
  backup(dest: string): Promise<void>;
}

/** True when the native plugin is reachable (running under Tauri). */
export function dbAvailable(): boolean {
  return isTauri();
}

/**
 * Bind to an app's database plugin. `plugin` is the Tauri plugin namespace
 * (Galerie's is `"catalog"`), `prefix` the command prefix that plugin
 * registered — the default suits a plugin that names its commands `db_*`.
 */
export function monetDb(plugin: string, prefix = "db_"): MonetDb {
  const call = <T>(name: string, args?: Record<string, unknown>): Promise<T> =>
    invoke<T>(`plugin:${plugin}|${prefix}${name}`, args);

  return {
    open: (path) => call<number>("open", { path }),
    close: () => call<void>("close"),
    integrityCheck: () => call<string>("integrity_check"),
    optimize: () => call<void>("optimize"),
    backup: (dest) => call<void>("backup", { dest }),
  };
}
