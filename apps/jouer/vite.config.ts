import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

// `vite preview` mode (used by e2e) serves the built bundle with the SAME
// Content-Security-Policy the Tauri desktop app ships, so the e2e suite can
// catch CSP regressions the (CSP-less) dev server can't. The policy is read
// from tauri.conf.json so there is a single source of truth.
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

// Vite serves the Monet Jouer frontend; the Tauri config points devUrl /
// frontendDist at it. The game engine is Phaser (pure JS), consumed as a
// normal npm dependency — there is no Rust/WASM engine here.
export default defineConfig({
  plugins: [react(), previewCsp()],
  clearScreen: false,
  // `MJ_EXPOSE=1 vite build` keeps `window.__mj` in a production bundle so an
  // e2e project can drive the prod build under CSP. Off by default, so a normal
  // `pnpm build` ships without the test hook (dead-code-eliminated).
  define: { __MJ_EXPOSE__: JSON.stringify(process.env.MJ_EXPOSE === "1") },
  server: {
    // One dev port per app so several Monet apps can run side by side (needed
    // for any cross-app export/import or drag-and-drop work). See root AGENTS.md.
    port: 1423,
    strictPort: true,
    host: "127.0.0.1",
    fs: { allow: [".."] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_", "TAURI_"],
  build: { target: "es2022", outDir: "dist", emptyOutDir: true, sourcemap: false },
});
