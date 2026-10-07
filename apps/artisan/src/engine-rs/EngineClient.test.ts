import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@engine", () => ({
  default: engine.init,
  Engine: class Engine {},
}));

beforeEach(() => {
  vi.resetModules();
  engine.init.mockReset();
  vi.stubGlobal("window", {});
});
afterEach(() => vi.unstubAllGlobals());

describe("initEngine", () => {
  it("shares one in-flight wasm boot across concurrent callers", async () => {
    let finish!: (output: { memory: WebAssembly.Memory }) => void;
    engine.init.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { initEngine, engineReady } = await import("./EngineClient");

    const boots = [initEngine(), initEngine(), initEngine()];
    expect(engine.init).toHaveBeenCalledOnce();
    finish({ memory: new WebAssembly.Memory({ initial: 1 }) });
    await Promise.all(boots);
    expect(engineReady()).toBe(true);
  });

  it("retries after a shared failed boot", async () => {
    engine.init
      .mockRejectedValueOnce(new Error("missing wasm"))
      .mockResolvedValueOnce({ memory: new WebAssembly.Memory({ initial: 1 }) });
    const { initEngine, engineReady } = await import("./EngineClient");

    const failed = await Promise.allSettled([initEngine(), initEngine()]);
    expect(failed.every((result) => result.status === "rejected")).toBe(true);
    expect(engine.init).toHaveBeenCalledOnce();
    expect(engineReady()).toBe(false);

    await initEngine();
    expect(engine.init).toHaveBeenCalledTimes(2);
    expect(engineReady()).toBe(true);
  });

  it("handles boot rejection at every mounted caller", () => {
    for (const path of ["../render/raster-document.tsx", "../ui/panels/waveform-panel.tsx", "../ui/panels/vectorscope-panel.tsx"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).toMatch(/initEngine\(\)[\s\S]*?\.catch\(\(error\) => console\.error/);
    }
  });
});
