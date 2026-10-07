// helpers — pure-JS envelope helpers + the error type. No WASM, no Node; safe in
// any runtime. The heavy logic (parse/serialize/convert) lives in the Rust
// `monet-format` crate (WASM); these are trivial object operations.

import { MONET_FORMAT, SCHEMA_VERSION, type AppName, type DataBag, type MonetDocument, type MonetFile } from "./schema.js";

export class MonetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonetFormatError";
  }
}

/** Wrap a document in the current envelope. */
export function createFile(document: MonetDocument, app: { name: AppName; version: string }): MonetFile {
  return { format: MONET_FORMAT, schemaVersion: SCHEMA_VERSION, app, document };
}

/** Read an entity's payload for `app` (e.g. "cinema"); `{}` if absent. */
export function getData<T = Record<string, unknown>>(entity: { data?: DataBag }, app: string): T {
  return (entity.data?.[app] as T) ?? ({} as T);
}

/** Set an entity's payload for `app`, preserving other namespaces. */
export function setData(entity: { data?: DataBag }, app: string, payload: unknown): void {
  entity.data = { ...(entity.data ?? {}), [app]: payload };
}
