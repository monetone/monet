// Shared MCP types. Kept dependency-free so both the browser bridge and the
// Node codegen can import them.

/** A minimal JSON-Schema subset — enough to describe MCP tool inputs. */
export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  description?: string;
  default?: unknown;
  additionalProperties?: boolean;
}

/** One MCP tool: a name, a human description, and a JSON-Schema for its args. */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

/** The full set of tools an app exposes, plus identifying metadata. */
export interface McpManifest {
  /** App id, e.g. "vision". */
  app: string;
  /** App / server version. */
  version: string;
  tools: McpToolDef[];
}

/**
 * Return this from a handler to emit an MCP `image` content block instead of a
 * text blob — `image` is either raw bytes or an already-base64 string.
 */
export interface McpImageResult {
  image: string | Uint8Array | ArrayBuffer;
  mimeType: string;
}

/** A runtime handler for one tool. Receives the validated argument object. */
export type McpHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/** Map of tool name → handler. Generated alongside the manifest. */
export type McpHandlers = Record<string, McpHandler>;

/** MCP `serverInfo` reported on `initialize`. */
export interface McpServerInfo {
  name: string;
  version: string;
}

/** Connection details emitted by the Rust host once the HTTP server is bound. */
export interface McpConnection {
  url: string;
  token: string;
}
