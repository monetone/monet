import { describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({
  blocked: false,
  handler: vi.fn(() => "done"),
  start: vi.fn((options: unknown) => options),
}));

vi.mock("@monet-ui/monet-mcp", () => ({ startMonetMcp: stub.start }));
vi.mock("./mcp.generated", () => ({
  mcpManifest: { version: "1", tools: [] },
  mcpHandlers: { mutate: stub.handler },
}));
// The real guard runs: it only needs the engine's duck-typed transaction query.
vi.mock("../state/app", () => ({
  engine: { engine: { history_transaction_active: () => stub.blocked } },
}));

import { startVisionMcp } from "./index";

describe("Vision MCP transaction isolation", () => {
  it("does not dispatch external commands into an open preview transaction", async () => {
    const bridge = await startVisionMcp() as unknown as { handlers: Record<string, (args: Record<string, unknown>) => unknown> };
    stub.blocked = true;
    expect(() => bridge.handlers.mutate({})).toThrow("Finish or cancel the current edit");
    expect(stub.handler).not.toHaveBeenCalled();

    stub.blocked = false;
    expect(bridge.handlers.mutate({})).toBe("done");
    expect(stub.handler).toHaveBeenCalledOnce();
  });
});
