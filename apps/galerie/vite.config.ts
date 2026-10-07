import { cpSync, createReadStream, existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// onnxruntime-web (Select Subject / U²-Net) loads its wasm runtime from
// `${ort.env.wasm.wasmPaths}`, set to "/ort/". Rather than commit ~37 MB of
// wasm, serve the two jsep runtime files straight from node_modules in dev and
// copy them into dist/ort at build. Keeps the repo lean; the model itself
// (public/models/u2netp.onnx, 4.4 MB Apache-2.0) is committed.
const ORT_FILES = ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"];
const ortDir = fileURLToPath(new URL("./node_modules/onnxruntime-web/dist/", import.meta.url));

function ortRuntime(): Plugin {
  return {
    name: "galerie-ort-runtime",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith("/ort/")) return next();
        const name = basename(req.url.split("?")[0]);
        if (!ORT_FILES.includes(name)) return next();
        const file = resolve(ortDir, name);
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const outDir = fileURLToPath(new URL("./dist/ort/", import.meta.url));
      for (const name of ORT_FILES) {
        const src = resolve(ortDir, name);
        if (existsSync(src)) cpSync(src, resolve(outDir, name));
      }
    },
  };
}

// Vite serves the frontend; the Tauri config (src-tauri/tauri.conf.json) points
// its devUrl / frontendDist at this dev server / its `dist` output.
export default defineConfig({
  plugins: [react(), ortRuntime()],
  clearScreen: false,
  server: { port: 1426, strictPort: true, host: "127.0.0.1" },
  // `src/engine.ts` starts developWorker.ts with `{ type: "module" }`, but Vite's
  // build default for `worker.format` is `iife`, which Rollup cannot code-split —
  // so `vite build` failed outright while dev (unbundled) was fine. Match the
  // source's own intent. Vision carries the same line for the AVIF encoder.
  worker: { format: "es" },
  envPrefix: ["VITE_", "TAURI_ENV_", "TAURI_"],
  resolve: {
    alias: {
      // The shared Rust/WASM render engine (packages/engine), built into
      // engine/pkg by `pnpm engine:build`. Same engine Vision + Artisan use.
      "@engine": fileURLToPath(new URL("./engine/pkg/monet_render_engine.js", import.meta.url)),
    },
  },
  // The wasm-pack glue loads the .wasm itself; don't let Vite pre-bundle it.
  optimizeDeps: { exclude: ["@engine"] },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true, sourcemap: false },
});
