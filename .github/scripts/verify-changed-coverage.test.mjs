import test from "node:test";
import assert from "node:assert/strict";
import { evaluateChangedCoverage, selectChangedVisionSourceFiles } from "./verify-changed-coverage.mjs";

const file = "apps/vision/src/state/example.ts";
const summary = (lines, branches) => ({
  [`/repo/${file}`]: {
    lines: { total: 10, pct: lines },
    branches: { total: 10, pct: branches },
  },
});

test("selects changed production TypeScript and TSX covered by Vision Vitest", () => {
  assert.deepEqual(selectChangedVisionSourceFiles([
    file,
    "apps/vision/src/state/example.test.ts",
    "apps/vision/src/state/example.test.tsx",
    "apps/vision/src/App.tsx",
    "apps/vision/src/mcp/mcp.generated.ts",
    "apps/vision/scripts/check-model-licenses.mjs",
    "packages/engine/src/lib.rs",
  ]), [file, "apps/vision/src/App.tsx"]);
});

test("fails a changed module missing from the coverage report", () => {
  assert.equal(evaluateChangedCoverage([file], {}).length, 1);
});

test("selects large TSX shells so missing unit coverage fails closed", () => {
  assert.deepEqual(selectChangedVisionSourceFiles([
    "apps/vision/src/App.tsx",
    "apps/vision/src/ui/Dialogs.tsx",
    "apps/vision/src/ui/Panels.tsx",
    "apps/vision/src/ui/CanvasView.tsx",
    "apps/vision/src/ui/ErrorBoundary.tsx",
  ]), [
    "apps/vision/src/App.tsx",
    "apps/vision/src/ui/Dialogs.tsx",
    "apps/vision/src/ui/Panels.tsx",
    "apps/vision/src/ui/CanvasView.tsx",
    "apps/vision/src/ui/ErrorBoundary.tsx",
  ]);
});

test("fails a changed module below the line threshold", () => {
  assert.equal(evaluateChangedCoverage([file], summary(89.99, 100)).length, 1);
});

test("fails a changed module below the branch threshold", () => {
  assert.equal(evaluateChangedCoverage([file], summary(100, 84.99)).length, 1);
});

test("accepts a changed module at both coverage thresholds", () => {
  assert.deepEqual(evaluateChangedCoverage([file], summary(90, 85)), []);
});
