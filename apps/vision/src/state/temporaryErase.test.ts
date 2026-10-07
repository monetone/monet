import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

type Call = { m: string; args: unknown[] };

function makeStore() {
  const calls: Call[] = [];
  const engine = new Proxy({} as Record<string, unknown>, {
    get: (_target, prop: string) => (...args: unknown[]) => { calls.push({ m: prop, args }); },
  });
  const client = { engine, lastBrush: [] as number[], onCommit: null as (() => void) | null };
  return { store: new Store(client as never), client, calls };
}

const last = (calls: Call[], method: string) => calls.filter((call) => call.m === method).at(-1);

describe("temporary Brush erase", () => {
  it("samples the held state only when pushBrush starts the next stroke", () => {
    const { store, client, calls } = makeStore();
    store.setTool("brush");
    const modeCalls = calls.filter((call) => call.m === "set_brush_mode").length;

    store.setTemporaryErase(true);
    expect(calls.filter((call) => call.m === "set_brush_mode")).toHaveLength(modeCalls);
    store.beginBrushStroke();
    expect(last(calls, "set_brush")?.args.at(-1)).toBe(true);
    expect(last(calls, "set_brush_mode")?.args[0]).toBe(1);
    expect(client.lastBrush.at(-1)).toBe(1);

    store.setTool("pencil");
    expect(last(calls, "set_brush_mode")?.args[0]).toBe(1);
    const latchedModeCalls = calls.filter((call) => call.m === "set_brush_mode").length;
    store.setTemporaryErase(false);
    expect(calls.filter((call) => call.m === "set_brush_mode")).toHaveLength(latchedModeCalls);
    store.pushBrush();
    expect(last(calls, "set_brush")?.args.at(-1)).toBe(true);
    expect(last(calls, "set_brush_mode")?.args[0]).toBe(1);
    expect(client.lastBrush.at(-1)).toBe(1);

    store.endBrushStroke();
    store.setTool("brush");
    expect(last(calls, "set_brush")?.args.at(-1)).toBe(false);
    expect(last(calls, "set_brush_mode")?.args[0]).toBe(0);
    expect(client.lastBrush.at(-1)).toBe(0);

    store.beginBrushStroke();
    store.setTemporaryErase(true);
    store.pushBrush();
    expect(last(calls, "set_brush")?.args.at(-1)).toBe(false);
    expect(last(calls, "set_brush_mode")?.args[0]).toBe(0);
    expect(client.lastBrush.at(-1)).toBe(0);
    store.endBrushStroke();
    store.setTemporaryErase(false);
  });

  it("cannot be armed from another tool", () => {
    const { store, calls } = makeStore();
    store.setTool("pencil");
    store.setTemporaryErase(true);
    store.setTool("brush");
    expect(last(calls, "set_brush_mode")?.args[0]).toBe(0);
  });
});
