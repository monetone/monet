import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs helper shared with Vite.
import { resolveContainedPath } from "./resolveContainedPath.mjs";

describe("resolveContainedPath", () => {
  const root = resolve("/tmp/vision-ort");

  it("resolves normal runtime files below the static root", () => {
    expect(resolveContainedPath(root, "ort-wasm.wasm?cache=1")).toBe(resolve(root, "ort-wasm.wasm"));
  });

  it.each(["../package.json", "%2e%2e/package.json", "sub/../../package.json", "%00.wasm", "%E0%A4%A"])(
    "rejects unsafe path %s",
    (requestPath) => expect(resolveContainedPath(root, requestPath)).toBeNull(),
  );
});
