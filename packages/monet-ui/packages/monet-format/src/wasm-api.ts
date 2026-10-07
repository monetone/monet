// wasm-api — a typed view over the wasm-pack bindings generated from the shared
// Rust `monet-format` crate. The init strategy lives in index.ts (browser fetch
// / Node initSync); this module only types the calls. The `../wasm` glue is
// produced by `pnpm run build:wasm` (wasm-pack).

import {
  convertSequenceTimeBase as wasmConvert,
  isContainer as wasmIsContainer,
  parse as wasmParse,
  readContainer as wasmReadContainer,
  serialize as wasmSerialize,
  writeContainer as wasmWriteContainer,
} from "../wasm/monet_format.js";
import type { ContainerEntry, ContainerManifest, MonetContainer } from "./container.js";
import type { MonetFile, MonetSequence, TimeBase } from "./schema.js";

export function rawParse(json: string): MonetFile {
  return wasmParse(json) as MonetFile;
}

export function rawSerialize(file: MonetFile): string {
  return wasmSerialize(file as unknown as object) as string;
}

export function rawConvertSequenceTimeBase(seq: MonetSequence, to: TimeBase): MonetSequence {
  return wasmConvert(seq as unknown as object, to as unknown as object) as MonetSequence;
}

/**
 * The manifest crosses the bridge as JSON TEXT, not as a JS object: the wasm
 * serializer THROWS on an integer beyond 2^53 (a foreign writer's 64-bit id,
 * hash or nanosecond timestamp), which would make that whole document
 * unopenable from JS. The typed surface above is unchanged.
 *
 * ponytail: THE JS NUMBER CEILING, stated in full — an unknown manifest NUMBER
 * is not couriered byte-for-byte across this lane, because `JSON.parse` puts it
 * in an f64 and `JSON.stringify` re-prints it from there. An integer past 2^53
 * comes back rounded (…993 → …992) and RE-SAVES rounded; a float whose JS text
 * form differs loses that form (`24.0` → `24`, `1e2` → `100`). Altered in the
 * integer case, semantically equal in the float one; the pure-Rust lane keeps
 * both exactly. A fix needs a BigInt/raw-number-aware JSON parser AND printer
 * here. Pinned by test/container.test.ts, and in docs/plans/11-universal-
 * container.md §"Known limits".
 */
interface RawContainer {
  manifestJson: string;
  entries: ContainerEntry[];
}

export function rawReadContainer(bytes: Uint8Array): MonetContainer {
  const raw = wasmReadContainer(bytes) as RawContainer;
  return { manifest: JSON.parse(raw.manifestJson) as ContainerManifest, entries: raw.entries };
}

export function rawWriteContainer(container: MonetContainer): Uint8Array {
  const raw: RawContainer = {
    manifestJson: JSON.stringify(container.manifest),
    entries: container.entries,
  };
  return wasmWriteContainer(raw as unknown as object);
}

export function rawIsContainer(bytes: Uint8Array): boolean {
  return wasmIsContainer(bytes);
}

export { default as initWasm, initSync as initWasmSync } from "../wasm/monet_format.js";
