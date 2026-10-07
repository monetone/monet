import { describe, expect, it } from "vitest";
import fixture from "../fixtures/canonical-recipe-v2.json";
import { normalizeRecipe } from "./developRecipe";

const sort = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sort)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)]))
      : value;

describe("Rust-authoritative canonical recipe fixture", () => {
  it("normalizes to the checked canonical bytes and digest", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(sort(normalizeRecipe(fixture.recipe))));
    expect(new TextDecoder().decode(bytes)).toBe(fixture.canonicalJson);
    for (const value of [bytes, new TextEncoder().encode(fixture.canonicalJson)]) {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
      expect(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")).toBe(fixture.sha256);
    }
  });
});
