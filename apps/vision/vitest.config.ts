import { defineConfig } from "vitest/config";

// Unit tests for the pure leaves (text model, effect param layout, …). They use
// the `.test.ts` suffix so they don't collide with the Playwright e2e `.spec.ts`
// files, and run in node (no DOM/WASM needed).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    // Unit coverage owns the Node-safe TS surface; React/DOM behavior is covered
    // by Playwright rather than pretending a Node report measures the UI.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      include: ["src/**/*.{ts,tsx}", "scripts/**/*.{mjs,jsx}"],
      exclude: [
        "src/mcp/mcp.generated.ts",
        // These three live app-shell modules require the DOM, Tauri, and WASM
        // integration environment, so the Node report cannot instrument them.
        // The changed-file selector still includes them and therefore fails
        // closed until changed logic moves to an instrumented module.
        "src/App.tsx",
        "src/ui/Dialogs.tsx",
        "src/ui/Panels.tsx",
      ],
      // CI applies the 90% lines / 85% branches ratchet to changed production
      // TS/TSX modules; these global floors remain until coverage grows.
      thresholds: { statements: 55, branches: 50, functions: 50, lines: 55 },
    },
  },
});
