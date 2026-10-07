import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end layered import of PSD / PSB / GIMP XCF through the real wasm engine
// (Engine.fromFormat → monet-format → adapter → engine Layer stack). Drives the
// store exactly as the file-open path does; fixtures are read in Node and the
// bytes injected into the page.

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  Array.from(readFileSync(join(here, "../../../packages/monet-ui/crates/monet-format/test-assets/fixtures", name)));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

/** Open a format fixture and return a map of layer name → {kind, textSpec}. */
async function open(page: import("@playwright/test").Page, bytes: number[]) {
  return await page.evaluate((arr) => {
    const mv = (window as any).__mv;
    const E = () => mv.engine.engine;
    mv.store.openFormat(new Uint8Array(arr), "fixture");
    const out: { w: number; h: number; count: number; layers: Record<string, { kind: number; text: string }> } = {
      w: E().width(),
      h: E().height(),
      count: E().layer_count(),
      layers: {},
    };
    for (let i = 0; i < out.count; i++) {
      const id = E().layer_id_at(i);
      out.layers[E().layer_name(id)] = { kind: E().layer_kind(id), text: E().layer_text_spec(id) };
    }
    return out;
  }, bytes);
}

test("imports a layered PSD with groups, text, adjustment + effects", async ({ page }) => {
  const r = await open(page, fixture("sample.psd"));
  expect(r.w).toBe(16);
  expect(r.h).toBe(16);
  expect(r.count).toBe(8);
  expect(r.layers["Group"].kind).toBe(6); // group folder
  expect(r.layers["Bright"].kind).toBe(1); // adjustment layer
  expect(r.layers["Hi"].kind).toBe(2); // text layer
  expect(r.layers["Hi"].text).toContain('"Hi"'); // re-editable text spec carried through
  expect(r.layers["Background"].kind).toBe(0);
});

test("imports a layered PSB (large-document format) identically", async ({ page }) => {
  const r = await open(page, fixture("sample.psb"));
  expect(r.w).toBe(16);
  expect(r.h).toBe(16);
  expect(r.count).toBe(8);
  expect(r.layers["Group"].kind).toBe(6);
  expect(r.layers["Hi"].kind).toBe(2);
});

test("imports a layered GIMP XCF with a group + offset child", async ({ page }) => {
  const r = await open(page, fixture("sample.xcf"));
  expect(r.w).toBe(16);
  expect(r.h).toBe(16);
  expect(r.count).toBe(4);
  expect(r.layers["Group"].kind).toBe(6);
  expect(r.layers["Child"].kind).toBe(0);
  expect(r.layers["Background"].kind).toBe(0);
});
