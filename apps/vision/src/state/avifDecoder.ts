// avifDecoder.ts — runtime AVIF decode via @jsquash's single-thread decoder.
//
// The decoder wasm is imported as a Vite asset URL (?url) and fed to emscripten
// through `locateFile`, so the binary is emitted and correctly served in BOTH
// the dev server and the production bundle. Without this, @jsquash's own
// `import.meta.url`-relative wasm lookup resolves to the bundled-deps directory
// (where the .wasm isn't), the fetch falls back to index.html, and WASM
// instantiation dies with "expected magic word 00 61 73 6d". Isolated in its
// own module so avif.ts's pure helpers stay importable in node unit tests.
import decode, { init as initDecoder } from "@jsquash/avif/decode";
import wasmUrl from "@jsquash/avif/codec/dec/avif_dec.wasm?url";

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  // Drop the memo on failure (#148) — a transient wasm fetch/instantiate error
  // would otherwise be cached forever and kill AVIF opening for the session.
  if (!ready) ready = initDecoder({ locateFile: () => wasmUrl }).catch((e) => { ready = null; throw e; });
  return ready;
}

/** Decode AVIF file bytes to RGBA ImageData (8-bit). */
export async function decodeAvif(buffer: ArrayBuffer): Promise<ImageData> {
  await ensure();
  const img = await decode(buffer);
  if (!img) throw new Error("AVIF decode produced no image");
  return img;
}
