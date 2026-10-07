// Monet Vision — MCP entry point. Starts the live-app MCP bridge so an MCP
// client (Claude Desktop / Claude Code) can drive the running app. Call once
// after boot, inside Tauri only (see main.tsx). The connection URL + token are
// written to mcp.json in the app's config dir by the Rust host.

import { startMonetMcp, type McpBridgeHandle, type McpHandlers } from "@monet-ui/monet-mcp";

import { mcpHandlers, mcpManifest } from "./mcp.generated";
import { engine } from "../state/app";
import { assertHistorySettled } from "../engine/historyTransaction";

const transactionSafeHandlers = Object.fromEntries(Object.entries(mcpHandlers).map(([name, handler]) => [
  name,
  (args: Record<string, unknown>) => {
    assertHistorySettled(engine.engine);
    return handler(args);
  },
])) as McpHandlers;

export async function startVisionMcp(): Promise<McpBridgeHandle> {
  return startMonetMcp({
    serverInfo: { name: "monet-vision", version: mcpManifest.version },
    tools: mcpManifest.tools,
    handlers: transactionSafeHandlers,
  });
}
