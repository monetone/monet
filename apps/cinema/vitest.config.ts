import { defineConfig } from "vitest/config";

// Unit tests for the pure leaves of the timeline engine (timecode math, model
// factories/queries, ops, project IO). They use the `.test.ts` suffix and run
// in node — no DOM, no WASM, no WebCodecs. Shared packages have their own tests.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    environment: "node",
    // Initialize the monet-format WASM (loaded from disk in Node) before tests.
    setupFiles: ["src/test-setup.ts"],
  },
});
