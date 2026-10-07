// @monet-ui/monet-mcp — shared MCP bridge for every Monet app.
//
// Browser/runtime entry. The Node-only codegen lives behind the "./codegen"
// subpath export so it (and its `typescript` dependency) never reach an app
// bundle.

export type {
  JsonSchema,
  McpToolDef,
  McpManifest,
  McpHandler,
  McpHandlers,
  McpImageResult,
  McpServerInfo,
  McpConnection,
} from "./types.js";

export {
  createMcpServer,
  validateArgs,
  PROTOCOL_VERSION,
  type ToolContent,
  type McpServer,
  type McpServerOptions,
  type RpcRequest,
  type RpcResponse,
  type ToolCallResult,
} from "./protocol.js";

export {
  startMonetMcp,
  MCP_EVENTS,
  type StartMcpOptions,
  type McpBridgeHandle,
} from "./bridge.js";
