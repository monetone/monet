import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MCP_EVENTS, startMonetMcp } from "./bridge.js";
import type { McpToolDef } from "./types.js";

// In-memory stand-in for the Tauri event bus the bridge talks to.
type Listener = (event: { payload: unknown }) => unknown;
const listeners = new Map<string, Set<Listener>>();
const emitted: Array<{ event: string; payload: unknown }> = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, cb: Listener) => {
    const set = listeners.get(event) ?? new Set<Listener>();
    set.add(cb);
    listeners.set(event, set);
    return () => {
      set.delete(cb);
    };
  },
  emit: async (event: string, payload: unknown) => {
    emitted.push({ event, payload });
  },
}));

/** Deliver an event to every current listener and wait for the async ones. */
async function fire(event: string, payload: unknown): Promise<void> {
  await Promise.all([...(listeners.get(event) ?? [])].map((cb) => cb({ payload })));
}

const TOOLS: McpToolDef[] = [
  {
    name: "adj.brightness",
    description: "Adjust brightness",
    inputSchema: {
      type: "object",
      properties: { amount: { type: "number" } },
      required: ["amount"],
      additionalProperties: false,
    },
  },
];

function responses() {
  return emitted.filter((e) => e.event === MCP_EVENTS.response);
}

function start(extra: Partial<Parameters<typeof startMonetMcp>[0]> = {}) {
  return startMonetMcp({
    serverInfo: { name: "test-app", version: "1.2.3" },
    tools: TOOLS,
    handlers: { "adj.brightness": (a) => `brightness=${a.amount}` },
    log: false,
    ...extra,
  });
}

beforeEach(() => {
  listeners.clear();
  emitted.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startMonetMcp", () => {
  it("listens on request + ready and says hello so the host re-announces", async () => {
    await start();
    expect(listeners.get(MCP_EVENTS.request)?.size).toBe(1);
    expect(listeners.get(MCP_EVENTS.ready)?.size).toBe(1);
    expect(emitted).toEqual([{ event: MCP_EVENTS.hello, payload: {} }]);
  });

  it("answers a request event with a response carrying the same id and a JSON-RPC result", async () => {
    await start();
    await fire(MCP_EVENTS.request, {
      id: 7,
      payload: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/list" }),
    });

    expect(responses()).toHaveLength(1);
    const { id, payload } = responses()[0].payload as { id: number; payload: string };
    expect(id).toBe(7);
    expect(JSON.parse(payload)).toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { tools: TOOLS },
    });
  });

  it("routes tools/call through to the real handler", async () => {
    await start();
    await fire(MCP_EVENTS.request, {
      id: 1,
      payload: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "adj.brightness", arguments: { amount: 12 } },
      }),
    });
    const { payload } = responses()[0].payload as { payload: string };
    expect(JSON.parse(payload).result).toEqual({
      content: [{ type: "text", text: "brightness=12" }],
    });
  });

  it("replies with an empty payload for a notification (no JSON-RPC reply)", async () => {
    await start();
    await fire(MCP_EVENTS.request, {
      id: 3,
      payload: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(responses()[0].payload).toEqual({ id: 3, payload: "" });
  });

  it("wraps a throwing handleRaw as -32603 instead of rejecting", async () => {
    const rejections: unknown[] = [];
    const onRejection = (e: unknown) => rejections.push(e);
    process.on("unhandledRejection", onRejection);
    try {
      // A tool whose description blows up when serialized makes handleRaw itself
      // throw (JSON.stringify of the tools/list result), not just the handler.
      const exploding = {
        name: "boom",
        get description(): string {
          throw new Error("kaboom");
        },
        inputSchema: { type: "object", properties: {} },
      } as unknown as McpToolDef;
      await start({ tools: [exploding], handlers: {} });
      await fire(MCP_EVENTS.request, {
        id: 5,
        payload: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
      });

      const { id, payload } = responses()[0].payload as { id: number; payload: string };
      expect(id).toBe(5);
      expect(JSON.parse(payload)).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: "kaboom" },
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("populates connection from the ready event and notifies onReady", async () => {
    const seen: unknown[] = [];
    const handle = await start({ onReady: (info) => seen.push(info) });
    expect(handle.connection).toBeNull();

    const info = { url: "http://127.0.0.1:41234/mcp", token: "abc123" };
    await fire(MCP_EVENTS.ready, info);

    expect(handle.connection).toEqual(info);
    expect(seen).toEqual([info]);
  });

  it("logs the endpoint by default and stays quiet when log is false", async () => {
    const info = { url: "http://127.0.0.1:1/mcp", token: "t" };
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    await start({ log: undefined });
    await fire(MCP_EVENTS.ready, info);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("test-app");
    expect(spy.mock.calls[0][0]).toContain(info.url);

    listeners.clear();
    await start({ log: false });
    await fire(MCP_EVENTS.ready, info);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stop() detaches both listeners so later events are ignored", async () => {
    const handle = await start();
    handle.stop();

    expect(listeners.get(MCP_EVENTS.request)?.size ?? 0).toBe(0);
    expect(listeners.get(MCP_EVENTS.ready)?.size ?? 0).toBe(0);

    await fire(MCP_EVENTS.request, {
      id: 9,
      payload: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }),
    });
    await fire(MCP_EVENTS.ready, { url: "u", token: "t" });

    expect(responses()).toHaveLength(0);
    expect(handle.connection).toBeNull();
  });
});
