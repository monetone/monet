import { describe, expect, it, vi } from "vitest";

import { fitDimensions, ThumbnailCache } from "./thumbnailCache";

describe("fitDimensions", () => {
  it("scales landscape down to fit maxEdge on the long side", () => {
    expect(fitDimensions(4000, 3000, 320)).toEqual({ width: 320, height: 240 });
  });
  it("scales portrait down to fit maxEdge on the long side", () => {
    expect(fitDimensions(3000, 4000, 320)).toEqual({ width: 240, height: 320 });
  });
  it("never upscales a small image", () => {
    expect(fitDimensions(100, 80, 320)).toEqual({ width: 100, height: 80 });
  });
  it("degenerate sizes → zero", () => {
    expect(fitDimensions(0, 100, 320)).toEqual({ width: 0, height: 0 });
  });
});

describe("ThumbnailCache", () => {
  it("evicts least-recently-used past capacity and revokes the URL", () => {
    const evicted: string[] = [];
    const c = new ThumbnailCache(2, (u) => evicted.push(u));
    c.set(1, "u1");
    c.set(2, "u2");
    c.set(3, "u3"); // over capacity → evict 1 (oldest)
    expect(evicted).toEqual(["u1"]);
    expect(c.has(1)).toBe(false);
    expect(c.has(2)).toBe(true);
    expect(c.has(3)).toBe(true);
  });

  it("get() promotes recency so the promoted entry survives", () => {
    const evicted: string[] = [];
    const c = new ThumbnailCache(2, (u) => evicted.push(u));
    c.set(1, "u1");
    c.set(2, "u2");
    expect(c.get(1)).toBe("u1"); // promote 1 → 2 is now oldest
    c.set(3, "u3");
    expect(evicted).toEqual(["u2"]);
    expect(c.has(1)).toBe(true);
    expect(c.has(2)).toBe(false);
  });

  it("re-setting an id revokes the old URL and keeps size", () => {
    const evicted: string[] = [];
    const c = new ThumbnailCache(4, (u) => evicted.push(u));
    c.set(1, "u1");
    c.set(1, "u1b");
    expect(evicted).toEqual(["u1"]);
    expect(c.get(1)).toBe("u1b");
    expect(c.size).toBe(1);
  });

  it("clear() revokes everything", () => {
    const onEvict = vi.fn();
    const c = new ThumbnailCache(4, onEvict);
    c.set(1, "u1");
    c.set(2, "u2");
    c.clear();
    expect(onEvict).toHaveBeenCalledTimes(2);
    expect(c.size).toBe(0);
  });

  it("delete() revokes an owned URL exactly once", () => {
    const onEvict = vi.fn();
    const c = new ThumbnailCache(4, onEvict);
    c.set(1, "u1");
    c.delete(1);
    c.delete(1);
    expect(onEvict).toHaveBeenCalledOnce();
  });
});
