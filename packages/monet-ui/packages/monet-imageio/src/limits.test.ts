import { describe, expect, it } from "vitest";

import { checkedBufLen, MAX_DIM, MAX_PIXELS } from "./limits";

describe("checkedBufLen", () => {
  it("accepts the exact image budgets and rejects unsafe dimensions before allocation", () => {
    expect(checkedBufLen(8_000, 10_000, 4)).toBe(MAX_PIXELS * 4);
    expect(checkedBufLen(MAX_DIM, 1, 4)).toBe(MAX_DIM * 4);
    expect(checkedBufLen(8_000, 10_001, 4)).toBeNull();
    expect(checkedBufLen(MAX_DIM + 1, 1, 4)).toBeNull();
    expect(checkedBufLen(2, 1, Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});
