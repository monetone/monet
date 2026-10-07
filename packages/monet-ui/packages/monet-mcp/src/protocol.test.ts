import { describe, expect, it } from "vitest";

import { createMcpServer } from "./protocol.js";
import type { McpToolDef } from "./types.js";
import { analyze, check } from "./codegen.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const TOOLS: McpToolDef[] = [
  {
    name: "adj.brightness",
    description: "Adjust brightness",
    inputSchema: {
      type: "object",
      properties: { amount: { type: "number", minimum: -100, maximum: 100 } },
      required: ["amount"],
      additionalProperties: false,
    },
  },
  {
    name: "adj.posterize",
    description: "Posterize",
    inputSchema: {
      type: "object",
      properties: {
        levels: { type: "integer", minimum: 2, maximum: 255 },
        mode: { type: "string", enum: ["rgb", "lab"] },
        label: { type: "string", maxLength: 4 },
      },
      required: ["levels"],
      additionalProperties: false,
    },
  },
  {
    name: "doc.screenshot",
    description: "Screenshot the canvas",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

let lastArgs: Record<string, unknown> | null = null;

function server() {
  lastArgs = null;
  return createMcpServer({
    serverInfo: { name: "test", version: "0.0.0" },
    tools: TOOLS,
    handlers: {
      "adj.brightness": (a) => `brightness=${a.amount}`,
      "adj.posterize": (a) => {
        lastArgs = a;
        return `levels=${a.levels}`;
      },
      "doc.screenshot": () => ({ image: new Uint8Array([0, 1, 2, 253]), mimeType: "image/png" }),
      "throws": () => {
        throw new Error("boom");
      },
    },
  });
}

const call = (name: string, args: Record<string, unknown>) =>
  server().handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

describe("MCP protocol core", () => {
  it("answers initialize with serverInfo + tools capability", async () => {
    const res = await server().handle({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(res?.result).toMatchObject({
      serverInfo: { name: "test" },
      capabilities: { tools: {} },
    });
  });

  it("lists tools", async () => {
    const res = await server().handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((res?.result as { tools: unknown[] }).tools).toHaveLength(TOOLS.length);
  });

  it("calls a tool and wraps the result as text content", async () => {
    const res = await server().handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "adj.brightness", arguments: { amount: 42 } },
    });
    expect(res?.result).toEqual({ content: [{ type: "text", text: "brightness=42" }] });
  });

  it("reports tool errors via isError, not a JSON-RPC error", async () => {
    const res = await server().handle({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "throws", arguments: {} },
    });
    expect(res?.result).toMatchObject({ isError: true });
  });

  it("returns null (no reply) for notifications", async () => {
    const res = await server().handle({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res).toBeNull();
  });

  it("handleRaw returns '' for notifications and JSON for requests", async () => {
    expect(await server().handleRaw(JSON.stringify({ method: "notifications/initialized" }))).toBe("");
    const out = await server().handleRaw(JSON.stringify({ id: 9, method: "ping" }));
    expect(JSON.parse(out)).toMatchObject({ id: 9, result: {} });
  });

  it("returns method-not-found for unknown methods", async () => {
    const res = await server().handle({ jsonrpc: "2.0", id: 5, method: "nope" });
    expect(res?.error?.code).toBe(-32601);
  });
});

describe("MCP inputSchema enforcement", () => {
  it("rejects a missing required argument with -32602 and never calls the handler", async () => {
    const res = await call("adj.posterize", {});
    expect(res?.error?.code).toBe(-32602);
    expect(res?.error?.message).toContain("levels is required");
    expect(res?.result).toBeUndefined();
    expect(lastArgs).toBeNull();
  });

  it("rejects a wrong-typed argument", async () => {
    const res = await call("adj.posterize", { levels: "banana" });
    expect(res?.error?.code).toBe(-32602);
    expect(lastArgs).toBeNull();
  });

  it("rejects non-integers, out-of-range numbers, bad enums, overlong strings and extra keys", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ levels: 4.5 }, "integer"],
      [{ levels: 1 }, ">= 2"],
      [{ levels: 999 }, "<= 255"],
      [{ levels: 4, mode: "cmyk" }, "one of"],
      [{ levels: 4, label: "toolong" }, "at most 4"],
      [{ levels: 4, nope: 1 }, "not a known argument"],
    ];
    for (const [args, needle] of cases) {
      const res = await call("adj.posterize", args);
      expect(res?.error?.code, JSON.stringify(args)).toBe(-32602);
      expect(res?.error?.message, JSON.stringify(args)).toContain(needle);
    }
  });

  it("accepts a valid call and forwards the arguments", async () => {
    const res = await call("adj.posterize", { levels: 4, mode: "lab", label: "a" });
    expect(res?.result).toEqual({ content: [{ type: "text", text: "levels=4" }] });
    expect(lastArgs).toEqual({ levels: 4, mode: "lab", label: "a" });
  });

  it("validates direct callTool() calls too", async () => {
    const res = await server().callTool("adj.brightness", { amount: 500 });
    expect(res).toMatchObject({ isError: true });
    expect(res.content[0]).toMatchObject({ text: expect.stringContaining("<= 100") });
  });

  it("leaves tools without an advertised schema alone", async () => {
    const res = await server().callTool("throws", { whatever: true });
    expect(res).toMatchObject({ isError: true, content: [{ type: "text", text: "boom" }] });
  });
});

describe("MCP image content", () => {
  it("returns an image block for a { image, mimeType } handler result", async () => {
    const res = await call("doc.screenshot", {});
    expect(res?.result).toEqual({
      content: [{ type: "image", data: "AAEC/Q==", mimeType: "image/png" }],
    });
  });

  it("passes an already-base64 string through and defaults nothing else to image", async () => {
    const s = createMcpServer({
      serverInfo: { name: "t", version: "0" },
      tools: [],
      handlers: {
        b64: () => ({ image: "AAEC", mimeType: "image/jpeg" }),
        json: () => ({ image: "not-an-image-result" }),
      },
    });
    expect(await s.callTool("b64", {})).toEqual({
      content: [{ type: "image", data: "AAEC", mimeType: "image/jpeg" }],
    });
    expect(await s.callTool("json", {})).toEqual({
      content: [{ type: "text", text: '{"image":"not-an-image-result"}' }],
    });
  });
});

describe("MCP codegen", () => {
  it("derives a tool + schema from an @mcp function", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-codegen-"));
    const src = path.join(dir, "commands.ts");
    fs.writeFileSync(
      src,
      `
/**
 * Apply a Gaussian blur.
 * @mcp fil.gaussian
 * @param radius Blur radius in pixels (0..250).
 * @param mono Monochrome flag.
 * @param label Optional output label (maxLength 64).
 */
export function gaussian(radius: number, mono = false, label?: string): string { return ""; }

/** No tag here — should be reported as uncovered. */
export function notExposed(x: number): void {}
`,
    );
    const out = analyze({ app: "t", version: "0.0.0", src: ["commands.ts"], out: ".", cwd: dir });
    expect(out.manifest.tools).toHaveLength(1);
    const tool = out.manifest.tools[0];
    expect(tool.name).toBe("fil.gaussian");
    expect(tool.description).toContain("Gaussian");
    expect(tool.inputSchema.properties?.radius).toMatchObject({
      type: "number",
      minimum: 0,
      maximum: 250,
    });
    expect(tool.inputSchema.properties?.mono).toMatchObject({ type: "boolean", default: false });
    expect(tool.inputSchema.properties?.label).toMatchObject({
      type: "string",
      maxLength: 64,
      description: "Optional output label.",
    });
    expect(tool.inputSchema.required).toEqual(["radius"]);
    expect(out.uncovered).toContain("commands.ts:notExposed");
    expect(out.generatedTs).toContain(`"fil.gaussian": (a) => S0.gaussian(`);
  });

  it("accepts generated outputs checked out with CRLF line endings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-codegen-crlf-"));
    const opts = { app: "t", version: "0.0.0", src: ["commands.ts"], out: ".", cwd: dir };
    fs.writeFileSync(path.join(dir, "commands.ts"), `
/** @mcp test.ping */
export function ping(): string { return "pong"; }
`);
    const rendered = analyze(opts);
    fs.writeFileSync(path.join(dir, "mcp.manifest.json"), rendered.manifestJson.replace(/\n/g, "\r\n"));
    fs.writeFileSync(path.join(dir, "mcp.generated.ts"), rendered.generatedTs.replace(/\n/g, "\r\n"));

    expect(check(opts).ok).toBe(true);
  });
});
