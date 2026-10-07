// The `doc.open` handoff: an agent must be able to hand the *running* Artisan a
// document, not just tell it to make a blank one — and a failed open must reach
// the client as an error, never as a cheerful "Opened …" over the old document.

import { describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ fileCommands: { openPath: vi.fn(async () => true) } }));
const app = vi.hoisted(() => ({ store: { __store: true } }));

vi.mock("../io/commands", () => io);
vi.mock("../state/app", () => app);

import { mcpHandlers, mcpManifest } from "./mcp.generated";

const handlers = mcpHandlers as Record<string, (args: Record<string, unknown>) => unknown>;

describe("artisan MCP doc.open", () => {
  it("has one generated handler for every manifest tool", () => {
    expect(Object.keys(handlers).sort()).toEqual(mcpManifest.tools.map((t) => t.name).sort());
  });

  it("publishes a path argument and routes through the shared loader", async () => {
    expect(mcpManifest.tools.find((t) => t.name === "doc.open")?.inputSchema).toMatchObject({
      properties: { path: { type: "string" } },
      required: ["path"],
    });

    await expect(handlers["doc.open"]({ path: "/tmp/Logo.monetgfx" })).resolves.toBe("Opened /tmp/Logo.monetgfx");
    expect(io.fileCommands.openPath).toHaveBeenCalledWith(app.store, "/tmp/Logo.monetgfx");
  });

  it("propagates the loader's error instead of reporting a success", async () => {
    io.fileCommands.openPath.mockRejectedValueOnce(new Error('"Photo.monetgfx" has no vector layer — open it in Monet Vision.'));
    await expect(handlers["doc.open"]({ path: "/tmp/Photo.monetgfx" })).rejects.toThrow(/no vector layer/);
  });
});
