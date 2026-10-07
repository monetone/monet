import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite serves this example's frontend; the Tauri config points devUrl /
// frontendDist at it. @monet-ui/monet-* are workspace deps consumed from
// their built dist.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1424, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_", "TAURI_ENV_", "TAURI_"],
  build: { target: "es2021", outDir: "dist", emptyOutDir: true, sourcemap: false },
});
