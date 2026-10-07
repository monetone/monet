import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Content-Aware Scale dialog", () => {
  const dialogSource = readFileSync(fileURLToPath(new URL("./Dialogs.tsx", import.meta.url)), "utf8");

  it("carves in yielded steps and cancels with Esc", () => {
    const from = dialogSource.indexOf("function ContentAwareScale()");
    expect(from).toBeGreaterThanOrEqual(0);
    const body = dialogSource.slice(from, dialogSource.indexOf("\nfunction ", from + 1));
    expect(body).toContain("beginContentAwareScale");
    expect(body).toContain("stepContentAwareScale(1)");
    expect(body).toContain("finishContentAwareScale");
    expect(body).toContain("cancelContentAwareScale");
    expect(body).toContain("requestAnimationFrame");
    expect(body).toContain(" of ");
    expect(body).toContain("Esc cancels");
    expect(body).not.toContain("store.contentAwareScale(");
  });
});
