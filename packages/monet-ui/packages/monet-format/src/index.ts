// ─────────────────────────────────────────────────────────────
// @monet-ui/monet-format — the universal, cross-openable `.monet` project format.
//
//   import { parse, serialize, createFile, convertSequenceTimeBase } from "@monet-ui/monet-format";
//   import { readContainer, writeContainer, isContainer } from "@monet-ui/monet-format";
//
// The FORMAT LOGIC (parse / serialize / timeBase conversion) is the shared Rust
// `monet-format` crate compiled to WASM — the single source of truth. This
// package wraps it with the typed API + the trivial JS envelope helpers, so
// consumers keep the exact same imports as the former TypeScript implementation.
//
// One-time init: call `await initMonetFormat()` at app startup (the browser
// can't instantiate WASM synchronously). The functions throw until it resolves.
// In Node (e.g. vitest), `initMonetFormat()` loads the .wasm from disk.
// ─────────────────────────────────────────────────────────────

import type { MonetContainer } from "./container.js";
import { MonetFormatError } from "./helpers.js";
import type { MonetFile, MonetSequence, TimeBase } from "./schema.js";
import {
  initWasm,
  initWasmSync,
  rawConvertSequenceTimeBase,
  rawIsContainer,
  rawParse,
  rawReadContainer,
  rawSerialize,
  rawWriteContainer,
} from "./wasm-api.js";

export * from "./schema.js";
export * from "./helpers.js";
export * from "./container.js";

let ready = false;

function isNode(): boolean {
  const g = globalThis as unknown as { process?: { versions?: { node?: string } } };
  return !!g.process?.versions?.node;
}

/**
 * Initialize the WASM module once. Call at app startup before parse/serialize.
 * - Browser: instantiates by fetching the co-located `.wasm` (pass an override
 *   `input` — URL/Response/bytes — if your bundler needs it).
 * - Node (vitest/SSR): reads the `.wasm` from disk and instantiates synchronously.
 */
export async function initMonetFormat(input?: unknown): Promise<void> {
  if (ready) return;
  if (input !== undefined) {
    await initWasm(input as never);
  } else if (isNode()) {
    // Computed specifiers keep tsc from resolving these; the isNode() guard keeps
    // the branch from ever running in the browser (where the bundler leaves the
    // import as dead code), so node: builtins never load there.
    const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(p: string): Uint8Array };
    const nodeUrl = (await import(/* @vite-ignore */ "node:" + "url")) as { fileURLToPath(u: URL): string };
    const path = nodeUrl.fileURLToPath(new URL("../wasm/monet_format_bg.wasm", import.meta.url));
    initWasmSync({ module: fs.readFileSync(path) });
  } else {
    await initWasm();
  }
  ready = true;
}

function guard(): void {
  if (!ready) {
    throw new MonetFormatError(
      "monet-format WASM is not initialized — call `await initMonetFormat()` at app startup",
    );
  }
}

/** Run a WASM call, surfacing any failure as a `MonetFormatError` (uniform contract). */
function wrap<T>(fn: () => T): T {
  guard();
  try {
    return fn();
  } catch (e) {
    throw new MonetFormatError(e instanceof Error ? e.message : String(e));
  }
}

/** Parse + validate a `.monet` file. Throws `MonetFormatError` on bad input. */
export function parse(json: string): MonetFile {
  return wrap(() => rawParse(json));
}

/** Serialize a `.monet` file to pretty JSON. */
export function serialize(file: MonetFile): string {
  return wrap(() => rawSerialize(file));
}

/** Return a copy of `seq` with every backbone time converted to `to`. */
export function convertSequenceTimeBase(seq: MonetSequence, to: TimeBase): MonetSequence {
  return wrap(() => rawConvertSequenceTimeBase(seq, to));
}

/**
 * Read a container into `{ manifest, entries }` — ALL of it, including entries
 * this app doesn't understand, so handing it back to `writeContainer` couriers
 * them (design doc 11 rule 2). Throws on anything that is not a Monet container.
 */
export function readContainer(bytes: Uint8Array): MonetContainer {
  return wrap(() => rawReadContainer(bytes));
}

/** Write a container: `manifest.json` first, then every entry, in order. */
export function writeContainer(container: MonetContainer): Uint8Array {
  return wrap(() => rawWriteContainer(container));
}

/**
 * Is this a Monet container? Sniff only — bytes that fail it are a bare-JSON
 * `.monet`, a foreign zip, or not ours at all, and the caller falls through to
 * its other readers. Cheap: no parse, no allocation.
 */
export function isContainer(bytes: Uint8Array): boolean {
  return wrap(() => rawIsContainer(bytes));
}
