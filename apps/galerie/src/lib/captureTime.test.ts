import { describe, expect, it } from "vitest";

import { epochToLocalInput, localInputToEpoch } from "./captureTime";

describe("captureTime conversions", () => {
  it("round-trips an instant through the datetime-local format", () => {
    const t = Math.floor(Date.UTC(2026, 6, 19, 12, 34) / 1000);
    const input = epochToLocalInput(t);
    expect(input).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(localInputToEpoch(input)).toBe(t); // same local wall-clock → same epoch
  });

  it("rejects unparsable input", () => {
    expect(localInputToEpoch("")).toBeNull();
    expect(localInputToEpoch("not-a-date")).toBeNull();
  });
});
