import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite serves the frontend; the Tauri config (src-tauri/tauri.conf.json) points
// its devUrl / frontendDist at this dev server / its `dist` output.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1421, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_", "TAURI_ENV_", "TAURI_"],
  build: { target: "es2021", outDir: "dist", emptyOutDir: true, sourcemap: false },
});
