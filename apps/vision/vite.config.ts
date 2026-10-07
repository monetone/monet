import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { cpSync, createReadStream, existsSync, readFileSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
// @ts-expect-error — plain .mjs CLI shared with the release build.
import { modelReleaseExcludes } from "./scripts/check-model-licenses.mjs";
// @ts-expect-error — plain .mjs helper shared with its Node unit test.
import { resolveContainedPath } from "./scripts/resolveContainedPath.mjs";

// `vite preview` mode (used by the "desktop" e2e project) serves the built
// bundle with the SAME Content-Security-Policy the Tauri desktop app ships, so
// the e2e suite can catch CSP regressions that the (CSP-less) dev server can't.
// The policy is read from tauri.conf.json so there is a single source of truth.
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

// onnxruntime-web loads its wasm runtime factory (.mjs) via a dynamic
// import() of `${wasmPaths}ort-wasm-*.mjs`. Vite refuses to serve files
// from public/ as modules (it 500s the `?import` request), so in dev we
// serve /ort/* straight off disk, bypassing the transform pipeline.
// In a production build, dist/ort is plain static and needs no help.
function ortRuntime(): Plugin {
  const dir = fileURLToPath(new URL("./public/ort", import.meta.url));
  return {
    name: "ort-runtime-static",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith("/ort/")) return next();
        const file = resolveContainedPath(dir, req.url.slice("/ort/".length));
        if (!file || !existsSync(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Copy public assets selectively instead of letting Vite copy the whole tree:
// ignored model directories can be multi-gigabyte local installs, so deleting
// them only after emission would still make release builds machine-dependent.
function selectivePublicAssets(): Plugin {
  const publicDir = fileURLToPath(new URL("./public", import.meta.url));
  const excludes = modelReleaseExcludes(readFileSync(fileURLToPath(new URL("./public/models/.gitignore", import.meta.url)), "utf8")) as string[];
  const unusedOrt = new Set(["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]);
  let outDir = "";
  return {
    name: "selective-public-assets",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      cpSync(publicDir, outDir, {
        recursive: true,
        filter(source) {
          if (source === publicDir) return true;
          const rel = relative(publicDir, source).split(sep).join("/");
          if (rel.startsWith("models/")) {
            const modelRel = rel.slice("models/".length);
            if (excludes.some((entry) => modelRel === entry || modelRel.startsWith(`${entry}/`))) return false;
          }
          if (rel.startsWith("ort/") && unusedOrt.has(basename(rel))) return false;
          return true;
        },
      });
    },
  };
}

// Vite serves the Monet Vision frontend; the Tauri config points devUrl /
// frontendDist at it. The Rust/WASM rendering engine is consumed from
// engine/pkg (produced by `pnpm engine:build`) via the @engine alias.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ortRuntime(), previewCsp(), selectivePublicAssets()],
  clearScreen: false,
  // `vite build --mode e2e` keeps `window.__mv` in a production bundle so the
  // "desktop" e2e project can drive the prod build under CSP. Off by default,
  // so normal `pnpm build` ships without the test hook (dead-code-eliminated).
  define: { __MV_EXPOSE__: JSON.stringify(mode === "e2e") },
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // Repo root, not just apps/ — the shared wasm packages (monet-format's
    // monet_format_bg.wasm) live under packages/ and Vite blocks anything
    // outside this list, which silently failed the container format in e2e.
    fs: { allow: ["../.."] },
  },
  // `@jsquash/avif` (AVIF export encoder) ships a multithreaded worker whose
  // default IIFE format can't be code-split by Rollup; ES-module workers are
  // supported by the Tauri webviews and the encoder falls back to single-thread
  // at runtime when the page isn't cross-origin-isolated.
  worker: { format: "es" },
  envPrefix: ["VITE_", "TAURI_ENV_", "TAURI_"],
  resolve: {
    // Select ORT's external-runtime entry because the pinned runtime is served
    // from /ort; its default bundle would emit a second 25 MiB WASM copy.
    conditions: ["module", "browser", "development|production", "onnxruntime-web-use-extern-wasm"],
    alias: {
      "@engine": fileURLToPath(new URL("./engine/pkg/monet_render_engine.js", import.meta.url)),
    },
  },
  // The wasm-pack glue loads the .wasm itself; don't let Vite pre-bundle it.
  // onnxruntime-web fetches its runtime wasm from /ort at runtime too.
  // Pre-bundle @jsquash's AVIF decoder so its first (lazy) use doesn't trigger a
  // runtime dep-optimization reload — its wasm is supplied explicitly via a ?url
  // asset + locateFile (see avifDecoder.ts), so bundling the JS glue is safe.
  optimizeDeps: { exclude: ["@engine", "onnxruntime-web"], include: ["@jsquash/avif/decode"] },
  build: {
    target: "es2022", outDir: "dist", emptyOutDir: true, sourcemap: false, copyPublicDir: false,
    // ORT starts its proxy worker from import.meta.url. Keep that module free
    // of app imports, which access document and cannot run inside a worker.
    // float.html is a Window ▸ Arrange float window's page (src/float.tsx).
    rollupOptions: {
      input: { main: fileURLToPath(new URL("./index.html", import.meta.url)), float: fileURLToPath(new URL("./float.html", import.meta.url)) },
      output: { manualChunks: { ort: ["onnxruntime-web"] } },
    },
  },
}));
