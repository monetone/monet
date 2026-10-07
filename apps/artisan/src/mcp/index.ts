// Monet Artisan — MCP entry point. Starts the live-app MCP bridge so an MCP
// client (Claude Desktop / Claude Code) can drive the running app. Call once
// after boot, inside Tauri only (see main.tsx). The connection URL + token are
// written to mcp.json in the app's config dir by the Rust host.

import { startMonetMcp, type McpBridgeHandle, type McpHandlers } from "@monet-ui/monet-mcp";

import { mcpHandlers, mcpManifest } from "./mcp.generated";
import { store } from "../state/app";

/**
 * An MCP call that lands mid-gesture would edit the document inside the tool's
 * open transaction and then force it closed, so the rest of the drag lands
 * outside any transaction and cannot be undone. Refuse instead — the client can
 * retry — which is the same contract Vision's bridge enforces.
 */
const transactionSafeHandlers = Object.fromEntries(
  Object.entries(mcpHandlers).map(([name, handler]) => [
    name,
    (args: Record<string, unknown>) => {
      if (store.transactionBase !== null) {
        throw new Error(`${name}: an edit is in progress — finish the current gesture and retry`);
      }
      return handler(args);
    },
  ]),
) as McpHandlers;

export async function startArtisanMcp(): Promise<McpBridgeHandle> {
  return startMonetMcp({
    serverInfo: { name: "monet-artisan", version: mcpManifest.version },
    tools: mcpManifest.tools,
    handlers: transactionSafeHandlers,
  });
}
