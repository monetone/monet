import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  views: [] as number[][],
  resizes: [] as number[][],
  renders: 0,
}));

vi.mock("@engine", () => ({
  default: vi.fn(async () => ({ memory: new WebAssembly.Memory({ initial: 1 }) })),
  Engine: class Engine {
    resize(w: number, h: number) {
      calls.resizes.push([w, h]);
    }
    set_view(tx: number, ty: number, zoom: number, angle: number) {
      calls.views.push([tx, ty, zoom, angle]);
    }
    set_document() {}
    render() {
      calls.renders += 1;
    }
    output_ptr() {
      return 0;
    }
    free() {}
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", {});
  calls.views.length = 0;
  calls.resizes.length = 0;
  calls.renders = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe("EngineClient view", () => {
  it("scales pan and zoom by the device-pixel ratio and renders once", async () => {
    const { EngineClient, initEngine } = await import("./EngineClient");
    await initEngine();
    const canvas = {
      width: 0,
      height: 0,
      style: {} as { width?: string; height?: string },
      getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: () => {},
      }),
    };
    const client = new EngineClient();
    client.setCanvas(canvas as unknown as HTMLCanvasElement);
    client.resize(10, 8, 2);
    client.setView(3, 4, 1.5, 0.2);
    client.render();

    expect(calls.resizes).toEqual([[20, 16]]);
    expect(calls.views).toEqual([[6, 8, 3, 0.2]]);
    expect(calls.renders).toBe(1);
    expect(canvas.width).toBe(20);
    expect(canvas.height).toBe(16);
  });
});
