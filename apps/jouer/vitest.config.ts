import { defineConfig } from "vitest/config";

// Unit tests for the pure leaves (model factory/queries, ops, timecode, .jouer
// io, Phaser code export). They use the `.test.ts` suffix and run in node (no
// DOM/Phaser needed — the model and export are framework-free).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
