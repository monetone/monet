import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ort = vi.hoisted(() => ({
  env: { wasm: { wasmPaths: "", numThreads: 0, proxy: false } },
  InferenceSession: { create: vi.fn(async (url: string) => ({ url })) },
}));

vi.mock("onnxruntime-web", () => ort);

describe("ONNX Runtime environment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.assign(ort.env.wasm, { wasmPaths: "", numThreads: 0, proxy: false });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("pins one proxy configuration before concurrent session creation", async () => {
    vi.stubGlobal("Worker", class Worker {});
    vi.stubGlobal("document", {});
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("navigator", { hardwareConcurrency: 12 });
    const observed: boolean[] = [];
    ort.InferenceSession.create.mockImplementation(async (url: string) => {
      observed.push(ort.env.wasm.proxy);
      return { url };
    });

    const { createSession } = await import("./ortEnv");
    await Promise.all([
      createSession("a.onnx", {}),
      createSession("b.onnx", {}),
      createSession("c.onnx", {}),
    ]);

    expect(ort.env.wasm).toEqual({ wasmPaths: "/ort/", numThreads: 4, proxy: true });
    expect(observed).toEqual([true, true, true]);

    // Losing worker globals later must not reroute already-created sessions.
    vi.stubGlobal("Worker", undefined);
    vi.stubGlobal("document", undefined);
    await createSession("d.onnx", {});
    expect(ort.env.wasm.proxy).toBe(true);
    expect(observed.at(-1)).toBe(true);
  });

  it("surfaces a create error without retrying or switching backend mode", async () => {
    vi.stubGlobal("Worker", class Worker {});
    vi.stubGlobal("document", {});
    const failure = new Error("bad model");
    ort.InferenceSession.create.mockRejectedValueOnce(failure);

    const { createSession } = await import("./ortEnv");
    await expect(createSession("bad.onnx", {})).rejects.toBe(failure);

    expect(ort.InferenceSession.create).toHaveBeenCalledTimes(1);
    expect(ort.env.wasm.proxy).toBe(true);
  });

  it("uses one wasm thread without cross-origin isolation", async () => {
    vi.stubGlobal("crossOriginIsolated", false);
    const { ortThreadCount } = await import("./ortEnv");
    expect(ortThreadCount()).toBe(1);
  });
});
