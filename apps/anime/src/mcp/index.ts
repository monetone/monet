// Monet Anime — MCP entry point. Starts the live-app MCP bridge so an MCP
// client (Claude Desktop / Claude Code) can drive the running app. Call once
// after boot, inside Tauri only (see main.tsx). The connection URL + token are
// written to mcp.json in the app's config dir by the Rust host.

import { startMonetMcp, type McpBridgeHandle } from "@monet-ui/monet-mcp";

import { mcpHandlers, mcpManifest } from "./mcp.generated";

export async function startAnimeMcp(): Promise<McpBridgeHandle> {
  return startMonetMcp({
    serverInfo: { name: "monet-anime", version: mcpManifest.version },
    tools: mcpManifest.tools,
    handlers: mcpHandlers,
  });
}
