import { describe, expect, it } from "vitest";

import { fingerprint } from "./fingerprint";

const bytes = (...vals: number[]) => new Uint8Array(vals);

describe("fingerprint", () => {
  it("is deterministic and a 64-char hex SHA-256", async () => {
    const a = await fingerprint(bytes(1, 2, 3, 4), 4);
    const b = await fingerprint(bytes(1, 2, 3, 4), 4);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when content differs", async () => {
    const a = await fingerprint(bytes(1, 2, 3, 4), 4);
    const b = await fingerprint(bytes(1, 2, 3, 9), 4);
    expect(a).not.toBe(b);
  });
});
