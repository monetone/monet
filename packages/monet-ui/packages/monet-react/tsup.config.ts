import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2021",
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@tauri-apps/api",
    "@tauri-apps/plugin-fs",
    "@tauri-apps/plugin-dialog",
    "@monet-ui/monet-core",
  ],
});
