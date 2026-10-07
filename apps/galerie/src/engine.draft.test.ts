// PERF-11 — the Develop draft tier. Two contracts:
// 1. draftMaxEdge only asks for a draft that actually pays: it needs a measured
//    stage and a real size gap against the full proxy.
// 2. openProgressiveDevelopSession routes `renderBatch(_, "draft")` to the
//    canvas-sized engine and everything else (idle refine, and the single
//    `render` that feeds heal/Select-Subject pixel analysis) to the full proxy
//    — and frees both engines.
//
// No Worker in the test env, so both tiers take openDevelopWorkerSession's sync
// fallback; the tiering under test is the same either way.

import { describe, expect, it, vi } from "vitest";

import { createDefaultRecipe } from "@monet-ui/monet-photo";

const mocks = vi.hoisted(() => {
  // An engine reporting a real size, whose proxy_engine downscales like the
  // wasm one — that is what makes a draft tier distinguishable from the full.
  const makeEngine = (w: number, h: number) => ({
    width: vi.fn(() => w),
    height: vi.fn(() => h),
    camera_raw_develop: vi.fn(),
    composite: vi.fn(),
    active_layer_rgba8: vi.fn(() => new Uint8Array(4)),
    undo: vi.fn(),
    free: vi.fn(),
    assign_profile: vi.fn(),
    convert_profile_with_icc: vi.fn(),
    proxy_engine: vi.fn((_x: number, _y: number, _w: number, _h: number, maxEdge: number) => {
      const s = maxEdge / Math.max(w, h);
      return makeEngine(Math.round(w * s), Math.round(h * s));
    }),
  });
  type MockEngine = ReturnType<typeof makeEngine>;
  return {
    makeEngine,
    fromImage: vi.fn((_b: Uint8Array): MockEngine => makeEngine(4000, 3000)),
  };
});

vi.mock("@engine", () => ({
  default: vi.fn(async () => ({})),
  Engine: { fromImage: mocks.fromImage },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => false) }));
vi.mock("./rawDecode", () => ({ RAW_PROXY_MAX_EDGE: 4096, decodeRawPath: vi.fn() }));

import { draftMaxEdge, openProgressiveDevelopSession } from "./engine";

const BYTES = new Uint8Array([1, 2, 3, 4]);
const recipe = createDefaultRecipe();

describe("draftMaxEdge", () => {
  it("drafts at the stage's device-pixel size when the proxy is much bigger", () => {
    expect(draftMaxEdge(1000, 4000)).toBe(1000);
    expect(draftMaxEdge(1600.4, 4096)).toBe(1600);
  });

  it("refuses a draft that would barely shrink the develop pass", () => {
    expect(draftMaxEdge(3000, 4000)).toBe(0); // 1.33× — under DRAFT_MIN_GAIN
    expect(draftMaxEdge(1000, 1200)).toBe(0); // already-small photo
  });

  it("refuses an unmeasured or nonsense stage", () => {
    expect(draftMaxEdge(0, 4000)).toBe(0);
    expect(draftMaxEdge(40, 4000)).toBe(0);
    expect(draftMaxEdge(NaN, 4000)).toBe(0);
    expect(draftMaxEdge(1000, NaN)).toBe(0);
  });
});

describe("openProgressiveDevelopSession", () => {
  it("renders drag frames on the canvas-sized tier and everything else full", async () => {
    mocks.fromImage.mockClear();
    const s = await openProgressiveDevelopSession(BYTES, false, undefined, recipe, 1000);
    await s.draftReady;

    // The session's own size stays the full proxy — overlays and zoom key off it.
    expect([s.width, s.height]).toEqual([4000, 3000]);

    const [draft] = await s.renderBatch([recipe], "draft");
    expect([draft.width, draft.height]).toEqual([1000, 750]);

    const [refined] = await s.renderBatch([recipe]);
    expect([refined.width, refined.height]).toEqual([4000, 3000]);
    const [explicit] = await s.renderBatch([recipe], "full");
    expect([explicit.width, explicit.height]).toEqual([4000, 3000]);

    // Single render = pixel analysis (heal source, Select Subject): never draft.
    const one = await s.render(recipe);
    expect([one.width, one.height]).toEqual([4000, 3000]);

    // Both tiers decoded the source, and free() releases both engines.
    const engines = mocks.fromImage.mock.results.map((r) => r.value);
    expect(engines).toHaveLength(2);
    s.free();
    // The draft's engine is the proxy the second decode produced, not the decode.
    expect(engines[0].free).toHaveBeenCalled();
    expect(engines[1].proxy_engine.mock.results[0].value.free).toHaveBeenCalled();
  });

  it("falls back to the full tier when no draft is worth opening", async () => {
    mocks.fromImage.mockClear();
    const s = await openProgressiveDevelopSession(BYTES, false, undefined, recipe, 0);
    await s.draftReady;
    expect(mocks.fromImage).toHaveBeenCalledTimes(1); // no second decode
    const [f] = await s.renderBatch([recipe], "draft");
    expect([f.width, f.height]).toEqual([4000, 3000]);
    s.free();
  });
});
