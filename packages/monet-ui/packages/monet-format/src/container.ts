// ─────────────────────────────────────────────────────────────
// container.ts — the ONE Monet document container, typed for JS.
//
// A stored ZIP whose first entry is `manifest.json`. Every app opens every
// extension; dispatch is on the manifest's `kind`/`role`, never on the file name
// (a `.mcin` renamed `.mvis` still opens). See docs/plans/11-universal-container.md.
//
// The zip + manifest logic is the shared Rust `monet-format` crate over the same
// WASM bridge as parse/serialize — `readContainer`/`writeContainer`/`isContainer`
// live in index.ts with the other init-gated calls. This module is the pure half:
// types, the extension registry, and the courier-safe entry helpers.
//
// THE COURIER RULE (design doc 11 rule 2): `readContainer` hands you the WHOLE
// container and `writeContainer` writes all of it back. Touch only the entries
// you own (`setEntry`) and another app's work survives your save automatically.
// ─────────────────────────────────────────────────────────────

import { MonetFormatError } from "./helpers.js";
import { MONET_FORMAT, type AppName } from "./schema.js";

/** The reserved first zip entry. Its presence is the container sniff. */
export const MANIFEST_PATH = "manifest.json";

/**
 * The CONTAINER's wire version. Deliberately its OWN constant (not the `.monet`
 * envelope's `SCHEMA_VERSION`): two independent formats that happen to both be
 * at 1 today, and bumping one must not silently bump the other.
 */
export const CONTAINER_SCHEMA_VERSION = 1;

/** Primary payload class. Open-ended: a future kind still loads (rule 3). */
export type ContainerKind = "graphics" | "time" | "catalog" | "scene" | (string & {});

/** What a reader dispatches on. An unknown `role` is not an error (rule 1). */
export interface ManifestEntry {
  path: string;
  role: string;
  /** Unknown per-entry fields, re-emitted verbatim. */
  [key: string]: unknown;
}

export interface ContainerManifest {
  format: string;
  schemaVersion: number;
  /** Who wrote it last. */
  app: { name: AppName; version: string };
  kind: ContainerKind;
  entries: ManifestEntry[];
  /** Unknown top-level fields, re-emitted verbatim. */
  [key: string]: unknown;
}

/** One payload blob. `manifest.json` is not here — it is `manifest`. */
export interface ContainerEntry {
  path: string;
  data: Uint8Array;
}

export interface MonetContainer {
  manifest: ContainerManifest;
  entries: ContainerEntry[];
}

/** One row of the registry: extension ⟷ app ⟷ kind. */
export interface ContainerAppInfo {
  ext: string;
  app: AppName;
  kind: ContainerKind;
}

/**
 * The seven apps' extensions (design doc 11). Only the extension and the entries
 * inside differ — the container is the same, so this table is a *hint* (which
 * app owns a file, what to name a new one), never the load-time discriminator.
 */
export const CONTAINER_APPS: readonly ContainerAppInfo[] = [
  { ext: ".mvis", app: "monet-vision", kind: "graphics" },
  { ext: ".mart", app: "monet-artisan", kind: "graphics" },
  { ext: ".mgal", app: "monet-galerie", kind: "catalog" },
  { ext: ".mcin", app: "monet-cinema", kind: "time" },
  { ext: ".mani", app: "monet-anime", kind: "time" },
  { ext: ".mryt", app: "monet-rythme", kind: "time" },
  { ext: ".mjou", app: "monet-jouer", kind: "scene" },
];

/** Registry lookup by extension or file name (case-insensitive, dot optional). */
export function containerAppForExtension(extOrPath: string): ContainerAppInfo | undefined {
  const lower = extOrPath.toLowerCase();
  // Dot optional: a dotless input IS the extension ("mvis"), so it gets one —
  // `slice(-1)` would look up its last character instead and always miss (#119).
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : `.${lower}`;
  return CONTAINER_APPS.find((row) => row.ext === ext);
}

/** Registry lookup by app name (e.g. "monet-rythme" → `.mryt`, "time"). */
export function containerAppForName(app: string): ContainerAppInfo | undefined {
  return CONTAINER_APPS.find((row) => row.app === app);
}

/** A new, empty container written by `app`. */
export function createContainer(app: { name: AppName; version: string }, kind: ContainerKind): MonetContainer {
  return {
    manifest: { format: MONET_FORMAT, schemaVersion: CONTAINER_SCHEMA_VERSION, app, kind, entries: [] },
    entries: [],
  };
}

/** Raw bytes of one entry, by path. */
export function getEntry(container: MonetContainer, path: string): Uint8Array | undefined {
  return container.entries.find((entry) => entry.path === path)?.data;
}

/** Every entry carrying `role`, in manifest order (e.g. all `pixels`). */
export function entriesByRole(container: MonetContainer, role: string): ContainerEntry[] {
  // Driven from the MANIFEST, exactly like the crate's `paths_for_role`/`role`:
  // `container.entries` is in zip FILE order, which a foreign writer can order
  // differently from the manifest — filtering it would hand the two lanes
  // different payloads for the same bytes (#218). A manifest row whose file is
  // absent drops out, same as Rust's `role()`.
  return container.manifest.entries
    .filter((e) => e.role === role)
    .map((e) => container.entries.find((entry) => entry.path === e.path))
    .filter((entry): entry is ContainerEntry => entry !== undefined);
}

/** Mirror of the crate's `validate_entry_path` (container/mod.rs): an entry path
 *  is relative and `/`-separated, with no empty/`.`/`..` segment, backslash or
 *  NUL. Checked HERE so the refusal lands on the call that introduced the path,
 *  not later inside `writeContainer` on a half-mutated container (#219). */
function validateEntryPath(path: string): void {
  const driveAbsolute = /^[a-z]:\//i.test(path);
  if (
    path === ""
    || path.startsWith("/")
    || driveAbsolute
    || path.includes("\\")
    || path.includes("\0")
    || path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new MonetFormatError(`invalid container entry path \`${path}\``);
  }
}

/**
 * Add or replace ONE entry this app owns, in place — the courier-safe write.
 * Every other entry, and this entry's own unknown manifest fields, are untouched.
 *
 * THROWS on two refusals, both BEFORE anything is mutated, and both the same
 * ones the crate's `Container::set` makes: the path must be a valid relative
 * container path (`validateEntryPath`), and `manifest.json` is reserved (the
 * writer emits its own), since writing it would produce an archive with two of
 * them, where the impostor wins the next read.
 */
export function setEntry(container: MonetContainer, path: string, role: string, data: Uint8Array): void {
  validateEntryPath(path);
  if (path === MANIFEST_PATH) {
    throw new MonetFormatError(`${MANIFEST_PATH} is reserved — the writer emits the manifest itself`);
  }
  const entry = container.entries.find((e) => e.path === path);
  if (entry) entry.data = data;
  else container.entries.push({ path, data });

  const listed = container.manifest.entries.find((e) => e.path === path);
  if (listed) listed.role = role;
  else container.manifest.entries.push({ path, role });
}

/** Drop one entry this app owns. Dropping a FOREIGN entry is what rule 2 forbids. */
export function removeEntry(container: MonetContainer, path: string): void {
  container.entries = container.entries.filter((e) => e.path !== path);
  container.manifest.entries = container.manifest.entries.filter((e) => e.path !== path);
}
