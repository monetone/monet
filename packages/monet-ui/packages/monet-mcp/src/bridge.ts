// Live-app bridge: connects the pure MCP server (protocol.ts) to the Rust host
// (the `monet-mcp` Tauri plugin) over custom Tauri events.
//
// Wire protocol (all via @tauri-apps/api/event — covered by the `core:default`
// capability, so no extra ACL is needed):
//
//   Rust → webview   "monet://mcp/request"   { id: number, payload: string }
//   webview → Rust   "monet://mcp/response"  { id: number, payload: string }
//   Rust → webview   "monet://mcp/ready"     { url: string, token: string }
//   webview → Rust   "monet://mcp/hello"     {}   (asks the host to re-emit ready)
//
// `payload` carries a raw JSON-RPC message; "" means "no content" (notification).

import { createMcpServer, type McpServerOptions } from "./protocol.js";
import type { McpConnection } from "./types.js";

export const MCP_EVENTS = {
  request: "monet://mcp/request",
  response: "monet://mcp/response",
  ready: "monet://mcp/ready",
  hello: "monet://mcp/hello",
} as const;

export interface StartMcpOptions extends McpServerOptions {
  /** Called when the Rust host reports the bound URL + token. */
  onReady?: (info: McpConnection) => void;
  /** Log the endpoint to the console when ready (default true). */
  log?: boolean;
}

export interface McpBridgeHandle {
  /** Detach the event listeners. */
  stop(): void;
  /** The live connection info once the host has reported it, else null. */
  readonly connection: McpConnection | null;
}

/**
 * Start the MCP bridge for a running Monet app. Safe to call only inside Tauri
 * (it dynamically imports `@tauri-apps/api/event`, so it stays out of a plain
 * browser bundle's critical path). Returns a handle to inspect the connection
 * and to stop the bridge.
 */
export async function startMonetMcp(opts: StartMcpOptions): Promise<McpBridgeHandle> {
  const { listen, emit } = await import("@tauri-apps/api/event");
  const server = createMcpServer(opts);
  let connection: McpConnection | null = null;

  const unlistenRequest = await listen<{ id: number; payload: string }>(
    MCP_EVENTS.request,
    async (event) => {
      const { id, payload } = event.payload;
      let responseText = "";
      try {
        responseText = await server.handleRaw(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        responseText = JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message },
        });
      }
      await emit(MCP_EVENTS.response, { id, payload: responseText });
    },
  );

  const unlistenReady = await listen<McpConnection>(MCP_EVENTS.ready, (event) => {
    connection = event.payload;
    if (opts.log !== false) {
      // eslint-disable-next-line no-console
      console.info(
        `[monet-mcp] ${opts.serverInfo.name} MCP server ready at ${event.payload.url} ` +
          `(token saved to the app data dir's mcp.json)`,
      );
    }
    opts.onReady?.(event.payload);
  });

  // Ask the host to (re-)announce itself, in case it bound before we listened.
  await emit(MCP_EVENTS.hello, {});

  return {
    stop() {
      unlistenRequest();
      unlistenReady();
    },
    get connection() {
      return connection;
    },
  };
}
