import { describe, it, expect } from "vitest";
import { deserializeDocument } from "./json";

describe("deserializeDocument — defensive validation (SEC-M4)", () => {
  it("rejects a pathologically deep document instead of crashing the renderer", () => {
    // Build the JSON text directly (JSON.stringify of a deep object would itself
    // recurse). Either our depth cap or JSON.parse rejects it — both are fine; the
    // security property is that a malicious file does not reach the recursive render.
    const depth = 1200;
    const open = '{"type":"group","children":['.repeat(depth);
    const close = "]}".repeat(depth);
    const text = `{"layers":[{"items":[${open}${close}]}],"artboards":[]}`;
    expect(() => deserializeDocument(text)).toThrow();
  });

  it("clamps non-finite numeric coordinates to finite values", () => {
    // 1e999 parses to Infinity through JSON.parse and would poison bbox/geometry math.
    const text = '{"layers":[{"items":[{"type":"rect","x":1e999,"y":-1e999,"width":4,"height":4}]}],"artboards":[]}';
    const doc = deserializeDocument(text);
    const rect = doc.layers[0].items[0] as unknown as { x: number; y: number };
    expect(Number.isFinite(rect.x)).toBe(true);
    expect(Number.isFinite(rect.y)).toBe(true);
  });

  it("does not pollute Object.prototype via a __proto__ key", () => {
    deserializeDocument('{"layers":[],"artboards":[],"__proto__":{"polluted":true}}');
    expect(({} as unknown as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
