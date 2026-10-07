import { defineConfig } from "vitest/config";

// Scope tests to Anime's own pure-model suite. Shared packages have their own
// tests. The model/io code is framework-free TypeScript and runs in Node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["node_modules/**", "dist/**"],
    // Initialize the monet-format WASM (loaded from disk in Node) before tests.
    setupFiles: ["src/test-setup.ts"],
  },
});
