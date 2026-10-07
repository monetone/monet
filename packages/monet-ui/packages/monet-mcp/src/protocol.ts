// Pure MCP server core — JSON-RPC 2.0 over the Model Context Protocol.
//
// This module has NO Tauri / DOM / Node dependency on purpose: it is the single
// place the protocol is implemented, reused by
//   • the live-app bridge (bridge.ts → Tauri events → Rust HTTP host), and
//   • a future headless host (drive the same manifest + handlers from Node).
//
// It implements the request/response methods MCP clients (Claude Desktop /
// Claude Code, the MCP Inspector) need: initialize, ping, tools/list,
// tools/call, and silently accepts notifications (e.g. notifications/initialized).

import type { JsonSchema, McpHandlers, McpServerInfo, McpToolDef } from "./types.js";

/** Protocol revision we advertise on `initialize`. */
export const PROTOCOL_VERSION = "2025-06-18";

export interface McpServerOptions {
  serverInfo: McpServerInfo;
  tools: McpToolDef[];
  handlers: McpHandlers;
  /** Override the advertised protocol version (defaults to PROTOCOL_VERSION). */
  protocolVersion?: string;
}

type RpcId = string | number | null;

export interface RpcRequest {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: unknown;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** One MCP content block. Handlers producing an image return {@link McpImageResult}. */
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolCallResult {
  content: ToolContent[];
  isError?: boolean;
}

/**
 * Validate a tool call's arguments against its advertised `inputSchema`.
 * Returns a human-readable reason, or null when the arguments are valid.
 *
 * Covers exactly the JsonSchema subset in types.ts (the codegen emits nothing
 * else): type, required, enum, minimum/maximum, maxLength, items and
 * additionalProperties:false.
 */
export function validateArgs(
  schema: JsonSchema | undefined,
  args: Record<string, unknown>,
): string | null {
  return schema ? validateValue(schema, args, "arguments") : null;
}

function validateValue(schema: JsonSchema, value: unknown, path: string): string | null {
  const t = schema.type;
  if (t) {
    const okType =
      t === "object"
        ? typeof value === "object" && value !== null && !Array.isArray(value)
        : t === "array"
          ? Array.isArray(value)
          : t === "null"
            ? value === null
            : t === "integer"
              ? typeof value === "number" && Number.isInteger(value)
              : t === "number"
                ? typeof value === "number" && Number.isFinite(value)
                : typeof value === t;
    if (!okType) return `${path} must be ${t}`;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `${path} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`;
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      return `${path} must be >= ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum)
      return `${path} must be <= ${schema.maximum}`;
  }
  if (typeof value === "string" && schema.maxLength !== undefined && value.length > schema.maxLength)
    return `${path} must be at most ${schema.maxLength} characters`;
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const err = validateValue(schema.items, value[i], `${path}[${i}]`);
      if (err) return err;
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = schema.properties;
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined) return `${path}.${key} is required`;
    }
    for (const [key, sub] of Object.entries(props ?? {})) {
      if (obj[key] === undefined) continue;
      const err = validateValue(sub, obj[key], `${path}.${key}`);
      if (err) return err;
    }
    if (schema.additionalProperties === false && props) {
      const extra = Object.keys(obj).find((k) => !(k in props));
      if (extra) return `${path}.${extra} is not a known argument`;
    }
  }
  return null;
}

/** Base64 without Buffer, so this stays browser-safe. */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** A `{ image, mimeType }` handler result becomes an image content block. */
function asImageContent(result: unknown): ToolContent | null {
  if (!result || typeof result !== "object") return null;
  const { image, mimeType } = result as { image?: unknown; mimeType?: unknown };
  if (typeof mimeType !== "string") return null;
  const data =
    typeof image === "string"
      ? image
      : image instanceof Uint8Array
        ? toBase64(image)
        : image instanceof ArrayBuffer
          ? toBase64(new Uint8Array(image))
          : null;
  return data === null ? null : { type: "image", data, mimeType };
}

function toContent(result: unknown): ToolContent {
  return (
    asImageContent(result) ?? {
      type: "text",
      text: typeof result === "string" ? result : JSON.stringify(result ?? null),
    }
  );
}

export interface McpServer {
  /** Handle one parsed request. Returns null for notifications (no reply). */
  handle(req: RpcRequest): Promise<RpcResponse | null>;
  /**
   * Handle a raw JSON-RPC string. Returns the response JSON, or "" when the
   * input was a notification / empty (the caller should reply 202 No Content).
   */
  handleRaw(text: string): Promise<string>;
  listTools(): McpToolDef[];
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
}

export function createMcpServer(opts: McpServerOptions): McpServer {
  const version = opts.protocolVersion ?? PROTOCOL_VERSION;

  const ok = (id: RpcId, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (id: RpcId, code: number, message: string, data?: unknown): RpcResponse => ({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });

  /** Argument check against the advertised schema; null when the call is valid. */
  function invalidArgs(name: string, args: Record<string, unknown>): string | null {
    const tool = opts.tools.find((t) => t.name === name);
    return tool ? validateArgs(tool.inputSchema, args ?? {}) : null;
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const handler = opts.handlers[name];
    if (!handler) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    const bad = invalidArgs(name, args);
    if (bad) return { content: [{ type: "text", text: `Invalid params: ${bad}` }], isError: true };
    try {
      const result = await handler(args ?? {});
      return { content: [toContent(result)] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: msg }], isError: true };
    }
  }

  async function handle(req: RpcRequest): Promise<RpcResponse | null> {
    // A JSON-RPC notification has no `id`; we accept it and reply nothing.
    if (req == null || req.id === undefined) return null;
    const id = req.id;
    const method = req.method ?? "";
    switch (method) {
      case "initialize":
        return ok(id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: opts.serverInfo,
        });
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: opts.tools });
      case "tools/call": {
        const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (!params.name) return fail(id, -32602, "Invalid params: missing tool name");
        const args = params.arguments ?? {};
        const bad = opts.handlers[params.name] ? invalidArgs(params.name, args) : null;
        if (bad) return fail(id, -32602, `Invalid params: ${bad}`);
        const res = await callTool(params.name, args);
        return ok(id, res);
      }
      default:
        return fail(id, -32601, `Method not found: ${method}`);
    }
  }

  async function handleRaw(text: string): Promise<string> {
    if (!text || !text.trim()) return "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return JSON.stringify(fail(null, -32700, "Parse error"));
    }
    if (Array.isArray(parsed)) {
      const out: RpcResponse[] = [];
      for (const item of parsed) {
        const r = await handle(item as RpcRequest);
        if (r) out.push(r);
      }
      return out.length ? JSON.stringify(out) : "";
    }
    const r = await handle(parsed as RpcRequest);
    return r ? JSON.stringify(r) : "";
  }

  return { handle, handleRaw, listTools: () => opts.tools, callTool };
}
