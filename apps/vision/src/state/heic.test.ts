import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HEIC_RE } from "./heic";

describe("HEIC_RE", () => {
  it("matches .heic/.heif names case-insensitively, not others", () => {
    expect(HEIC_RE.test("IMG_0001.heic")).toBe(true);
    expect(HEIC_RE.test("photo.HEIC")).toBe(true);
    expect(HEIC_RE.test("photo.heif")).toBe(true);
    expect(HEIC_RE.test("photo.HEIF")).toBe(true);
    expect(HEIC_RE.test("a.b.heic")).toBe(true);
    expect(HEIC_RE.test("photo.jpg")).toBe(false);
    expect(HEIC_RE.test("heic.png")).toBe(false);
    expect(HEIC_RE.test("photo.heix")).toBe(false);
    expect(HEIC_RE.test("photo.hei")).toBe(false);
  });
});

// The dispatch + file-dialog wiring lives in the heavy state/app module (it pulls
// in the WASM engine, so it isn't importable in the node unit env). Guard the
// wiring at the source level instead — cheap regression net for "someone removed
// the .heic open path". Mirrors pdfImport.test.ts › app.ts open wiring.
describe("app.ts open wiring", () => {
  const src = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
  it("dispatches HEIC_RE to openHeic in routeOpen", () => {
    expect(src).toMatch(/if\s*\(HEIC_RE\.test\(name\)\)\s*return openHeic\(/);
  });
  it("openHeic invokes the native heic plugin", () => {
    expect(src).toContain('invoke<ArrayBuffer>("plugin:heic|decode_heic", bytes)');
  });
  it("guards the browser build with a desktop-required message", () => {
    expect(src).toMatch(/if\s*\(!isTauri\(\)\)\s*\{\s*reportOpen\(name, new Error\("HEIC\/HEIF open requires/);
  });
  it("lists heic/heif in the open filters and accept string", () => {
    expect(src).toMatch(/"avif", "heic", "heif"/);
    expect(src).toMatch(/OPEN_ACCEPT = "[^"]*\.heic,\.heif/);
  });
});
