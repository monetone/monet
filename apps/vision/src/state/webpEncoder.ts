// webpEncoder.ts — runtime lossy-WebP encode via @jsquash's single-thread codec.
//
// Both encoder wasms are imported as Vite asset URLs (?url) and handed to
// emscripten through `locateFile`, so the binary is emitted and correctly served
// in BOTH the dev server and the production bundle. Without this, @jsquash's own
// `import.meta.url`-relative wasm lookup resolves into the bundled-deps directory
// (where the .wasm isn't), the fetch falls back to index.html, and WASM
// instantiation dies with "expected magic word 00 61 73 6d". init() feature-
// detects SIMD and loads either encoder, so we provide both and dispatch by name.
// Isolated in its own module so app.ts's export helper stays node-testable.
import encode, { init as initEncoder } from "@jsquash/webp/encode";
import simdWasmUrl from "@jsquash/webp/codec/enc/webp_enc_simd.wasm?url";
import baseWasmUrl from "@jsquash/webp/codec/enc/webp_enc.wasm?url";

let ready: Promise<unknown> | null = null;
function ensure(): Promise<unknown> {
  // Drop the memo on failure (#154) — a transient wasm fetch/instantiate error
  // would otherwise be cached forever and kill WebP export for the session.
  if (!ready) {
    ready = initEncoder({ locateFile: (p: string) => (p.includes("simd") ? simdWasmUrl : baseWasmUrl) })
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/** Encode RGBA ImageData to lossy WebP bytes. `quality` is 0–100. */
export async function encodeWebpLossy(image: ImageData, quality: number): Promise<ArrayBuffer> {
  await ensure();
  return encode(image, { quality, lossless: 0 });
}
