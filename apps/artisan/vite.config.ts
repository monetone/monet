import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Vite serves the frontend; the Tauri config (src-tauri/tauri.conf.json) points
// its devUrl / frontendDist at this dev server / its `dist` output.
//
// The Rust/WASM rendering engine is consumed from engine/pkg (produced by
// `pnpm engine:build`) via the @engine alias — same pattern as Monet Vision.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1421, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_", "TAURI_ENV_", "TAURI_"],
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("./engine/pkg/monet_render_engine.js", import.meta.url)),
    },
  },
  // The wasm-pack glue loads the .wasm itself; don't let Vite pre-bundle it.
  optimizeDeps: { exclude: ["@engine"] },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true, sourcemap: false },
});
