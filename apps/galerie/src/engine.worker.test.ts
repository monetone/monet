// PERF-03 — off-main-thread Develop. Three contracts:
// 1. maskRenderJobs predicts EXACTLY the render sequence compositeMasks asks
//    for (the async loop pre-renders those in one worker batch and replays
//    them, so a drift here would silently drop a mask's effect).
// 2. openDevelopWorkerSession without Workers falls back to the sync session
//    behind the same async API.
// 3. The worker protocol client: open → ready sizes the session, renderBatch
//    resolves per-recipe frames, free() rejects in-flight renders + terminates.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultRecipe, type DevelopRecipeV2, type Mask } from "@monet-ui/monet-photo";

import { newAiSubjectMask, newGradientMask } from "./lib/maskEdit";
import { compositeMasks } from "./lib/maskComposite";

const mocks = vi.hoisted(() => {
  const fill = (px: number[]): Uint8Array => {
    const buf = new Uint8Array(4);
    buf.set(px);
    return buf;
  };
  const makeEngine = () => {
    // Exposure rides flat param index 4 (see recipeToParams / develop_buf ABI).
    let rgba = fill([1, 2, 3, 255]);
    return {
      camera_raw_develop: vi.fn((p: Float32Array) => {
        rgba = fill(p[4] !== 0 ? [9, 8, 7, 255] : [1, 2, 3, 255]);
      }),
      composite: vi.fn(),
      width: vi.fn(() => 1),
      height: vi.fn(() => 1),
      active_layer_rgba8: vi.fn(() => rgba),
      undo: vi.fn(),
      free: vi.fn(),
      assign_profile: vi.fn(),
      convert_profile_with_icc: vi.fn(),
    };
  };
  return { makeEngine, fromImage: vi.fn(makeEngine), isTauri: vi.fn(() => false) };
});

vi.mock("@engine", () => ({
  default: vi.fn(async () => ({})),
  Engine: { fromImage: mocks.fromImage },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("./rawDecode", () => ({
  RAW_PROXY_MAX_EDGE: 4096,
  decodeRawPath: vi.fn(),
}));
vi.mock("./lib/subjectMask", () => ({
  getSubjectCoverage: vi.fn((id: string) =>
    id === "cached" ? new Float32Array(320 * 320).fill(1) : undefined,
  ),
}));

import { maskRenderJobs, openDevelopWorkerSession, replayFrames } from "./engine";

const withExposure = (m: Mask): Mask => ({
  ...m,
  adjustments: { ...m.adjustments, exposure: 0.5 },
});

beforeEach(() => {
  mocks.fromImage.mockClear();
  mocks.isTauri.mockReturnValue(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("maskRenderJobs", () => {
  it("predicts compositeMasks' render requests exactly, in order", () => {
    const active = withExposure(newGradientMask("linearGradient", "m1", "Linear 1"));
    const neutral = newGradientMask("radialGradient", "m2", "Radial 1"); // no adjustments set
    const disabled = { ...withExposure(newGradientMask("linearGradient", "m3", "Linear 2")), enabled: false };
    const aiCached = withExposure(newAiSubjectMask("m4", "Subject 1", "cached"));
    const aiMissing = withExposure(newAiSubjectMask("m5", "Subject 2", "never-computed"));
    const recipe: DevelopRecipeV2 = {
      ...createDefaultRecipe(),
      masks: { masks: [active, neutral, disabled, aiCached, aiMissing] },
    };

    const frame = { rgba: new Uint8ClampedArray(2 * 2 * 4), width: 2, height: 2 };
    const requested: DevelopRecipeV2[] = [];
    compositeMasks(
      (rr) => {
        requested.push(rr);
        return frame;
      },
      recipe,
      frame,
    );

    const jobs = maskRenderJobs(recipe);
    expect(jobs).toHaveLength(2); // active parametric + cached AI, nothing else
    expect(jobs).toEqual(requested);
  });

  it("replayFrames hands frames back in order and falls back to base when short", () => {
    const f = (n: number) => ({ width: 1, height: 1, rgba: new Uint8Array([n, 0, 0, 255]) });
    const base = f(0);
    const render = replayFrames([f(1), f(2)], base);
    const dummy = createDefaultRecipe();
    expect(render(dummy).rgba[0]).toBe(1);
    expect(render(dummy).rgba[0]).toBe(2);
    expect(render(dummy).rgba[0]).toBe(0); // drift → base, never garbage
  });
});

describe("openDevelopWorkerSession", () => {
  const exposed: DevelopRecipeV2 = {
    ...createDefaultRecipe(),
    basic: { ...createDefaultRecipe().basic, exposure: 1 },
  };

  it("falls back to the sync session when Workers don't exist", async () => {
    vi.stubGlobal("Worker", undefined);
    const session = await openDevelopWorkerSession(new Uint8Array([1, 2, 3]));
    expect(session.width).toBe(1);
    const frames = await session.renderBatch([createDefaultRecipe(), exposed]);
    expect(Array.from(frames[0].rgba)).toEqual([1, 2, 3, 255]);
    expect(Array.from(frames[1].rgba)).toEqual([9, 8, 7, 255]);
    const single = await session.render(exposed);
    expect(Array.from(single.rgba)).toEqual([9, 8, 7, 255]);
    session.free();
  });

  it("drives the worker protocol: open sizes, batches resolve, free rejects in-flight", async () => {
    interface Msg {
      t: string;
      seq?: number;
      recipes?: DevelopRecipeV2[];
    }
    class FakeWorker {
      static last: FakeWorker | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: ((e: { message: string }) => void) | null = null;
      posted: Msg[] = [];
      terminated = false;
      holdRenders = false;
      constructor() {
        FakeWorker.last = this;
      }
      postMessage(msg: Msg): void {
        this.posted.push(msg);
        if (msg.t === "openBytes" || msg.t === "openPixels") {
          queueMicrotask(() => this.onmessage?.({ data: { t: "ready", width: 7, height: 5 } }));
        } else if (msg.t === "render" && !this.holdRenders) {
          queueMicrotask(() =>
            this.onmessage?.({
              data: {
                t: "frames",
                seq: msg.seq,
                frames: msg.recipes!.map((_, i) => ({
                  width: 7,
                  height: 5,
                  rgba: new Uint8Array([i, 0, 0, 255]),
                })),
              },
            }),
          );
        }
      }
      terminate(): void {
        this.terminated = true;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);

    const session = await openDevelopWorkerSession(new Uint8Array([1, 2, 3]));
    const worker = FakeWorker.last!;
    expect(worker.posted[0].t).toBe("openBytes"); // isTauri false → byte path
    expect(session.width).toBe(7);
    expect(session.height).toBe(5);

    const frames = await session.renderBatch([createDefaultRecipe(), exposed]);
    expect(frames).toHaveLength(2);
    expect(frames[1].rgba[0]).toBe(1);

    worker.holdRenders = true;
    const inFlight = session.render(createDefaultRecipe());
    session.free();
    await expect(inFlight).rejects.toThrow("develop session freed");
    expect(worker.terminated).toBe(true);
    await expect(session.render(createDefaultRecipe())).rejects.toThrow("develop session freed");
  });
});
