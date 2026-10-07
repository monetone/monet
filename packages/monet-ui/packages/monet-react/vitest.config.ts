import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// ─────────────────────────────────────────────────────────────
// Vitest — React-component DOM tests (dev-only)
// ─────────────────────────────────────────────────────────────
// Runs the @testing-library DOM suite under jsdom. Deliberately scoped so it
// never collides with the zero-dep `node:test` suite:
//   • include ONLY matches test/dom/**/*.test.tsx
//   • the node:test files use the .test.ts extension under test/ (not test/dom)
// so `node --test "test/**/*.test.ts"` and `vitest run` are fully independent.
//
// Globals are intentionally OFF — every test imports { describe, it, expect,
// vi, … } from "vitest" explicitly. That keeps `tsc --noEmit` (which compiles
// src/ only) untouched: there is no ambient typing dependency to wire up.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: false,
    environment: "jsdom",
    // Plus the framework-free logic modules that live in src/ (atomic-write …).
    // They must be tested HERE rather than in a consuming app: Vitest
    // externalizes a workspace dependency, so an app's `vi.mock("@tauri-apps/…")`
    // cannot reach through the package boundary into this code.
    include: ["test/dom/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["./test/dom/setup.ts"],
  },
});
