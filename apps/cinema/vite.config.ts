import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

// `vite preview` mode serves the built bundle with the SAME Content-Security-
// Policy the Tauri desktop app ships (read from tauri.conf.json, single source
// of truth), so a preview/e2e run can catch CSP regressions the (CSP-less) dev
// server can't.
function previewCsp(): Plugin {
  return {
    name: "preview-csp",
    configurePreviewServer(server) {
      let csp = "";
      try {
        const conf = JSON.parse(
          readFileSync(fileURLToPath(new URL("./src-tauri/tauri.conf.json", import.meta.url)), "utf8"),
        );
        csp = conf?.app?.security?.csp ?? "";
      } catch { /* no CSP configured */ }
      server.middlewares.use((_req, res, next) => {
        if (csp) res.setHeader("Content-Security-Policy", csp);
        next();
      });
    },
  };
}

// Vite serves the Monet Cinema frontend; the Tauri config points devUrl /
// frontendDist at it. The Rust/WASM compositing engine is consumed from
// engine/pkg (produced by `pnpm engine:build`) via the @engine alias.
export default defineConfig({
  plugins: [react(), previewCsp()],
  clearScreen: false,
  // `MC_EXPOSE=1 vite build` keeps `window.__mc` in a production bundle so an
  // e2e/preview run can drive the prod build under CSP. Off (and tree-shaken)
  // in a normal `pnpm build`.
  define: { __MC_EXPOSE__: JSON.stringify(process.env.MC_EXPOSE === "1") },
  server: {
    // One dev port per app so several Monet apps can run side by side (needed
    // for any cross-app export/import or drag-and-drop work). See root AGENTS.md.
    port: 1422,
    strictPort: true,
    host: "127.0.0.1",
    // Allow the monorepo root so the dev server can serve the monet-format WASM
    // shipped from packages/monet-ui (outside apps/).
    fs: { allow: ["../.."] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_", "TAURI_"],
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("./engine/pkg/cinema_engine.js", import.meta.url)),
    },
  },
  // The wasm-pack glue loads the .wasm itself; don't let Vite pre-bundle it.
  optimizeDeps: { exclude: ["@engine", "@monet-ui/monet-format"] },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true, sourcemap: false },
});
