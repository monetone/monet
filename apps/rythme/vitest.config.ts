import { defineConfig } from "vitest/config";

// Scope tests to Rythme's own pure-engine suite. Shared packages have their own
// tests. The engine is framework-free TypeScript and runs in Node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["node_modules/**", "dist/**"],
    // Initialize the monet-format WASM (loaded from disk in Node) before tests.
    setupFiles: ["src/test-setup.ts"],
  },
});
