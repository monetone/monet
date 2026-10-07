// Timeline ▸ Reverse Frames. Photoshop's frame-animation panel has it; Vision's
// had New Frame, Delete, Tween, Loop and Onion Skin but no way to play a run
// backwards — you had to delete every frame and recapture in reverse.
//
// The frame/delay pairing is covered engine-side (packages/engine's
// `reverse_frames`). Here the `anim` namespace itself is driven against a fake
// engine: each command must reach its engine call AND commit (frame edits are
// document content — the dirty flag and history sync hang off commit), and must
// sit inside the op-captured `animImpl` so a recorded step carries a replayable
// descriptor instead of going volatile.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { actions, anim, engine } from "./app";

/** Node has no Storage; `actions.save` persists through it. */
function installStorage() {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
}

/** Only the frame surface `anim` touches; `width`/`height` keep commit's
 *  geometry check quiet. */
function fakeEngine() {
  const calls: string[] = [];
  return {
    calls,
    reverse_frames() { calls.push("reverse_frames"); },
    frames_from_layers() { calls.push("frames_from_layers"); },
    frames_to_layers() { calls.push("frames_to_layers"); },
    add_frame() { calls.push("add_frame"); },
    frame_count() { return 3; },
    width() { return 0; },
    height() { return 0; },
  };
}

let onSync: typeof engine.onSync;
let commit: ReturnType<typeof vi.spyOn>;
let e: ReturnType<typeof fakeEngine>;

beforeEach(() => {
  installStorage();
  onSync = engine.onSync;
  engine.onSync = null; // a full store resync reads far more engine surface than this
  e = fakeEngine();
  engine.engine = e as never;
  commit = vi.spyOn(engine, "commit");
});
afterEach(() => {
  actions.stop();
  actions.suspend(false);
  engine.onSync = onSync;
  engine.engine = null;
  vi.restoreAllMocks();
});

describe("Reverse Frames is reachable", () => {
  it("the anim namespace exposes it and commits", () => {
    anim.reverseFrames();

    expect(e.calls).toEqual(["reverse_frames"]);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("lives in animImpl, so an Action records and replays it", () => {
    // animImpl is wrapped by withOpCapture; a helper defined outside it would be
    // invocable but silently absent from a recorded action — the step would
    // carry no descriptor and the action would refuse to persist.
    actions.start();
    actions.suspend(true);
    anim.reverseFrames();
    actions.suspend(false);
    actions.record(() => anim.reverseFrames());
    actions.stop();
    const id = actions.save("Reverse");

    expect(id).toBeGreaterThan(0);
    expect(actions.isPersistable(id), "reverseFrames must sit inside animImpl").toBe(true);

    // …and the saved step really replays the engine call.
    e.calls.length = 0;
    actions.playNamed(id);
    expect(e.calls).toEqual(["reverse_frames"]);
  });

  it("a display-only read leaves no descriptor, which is what animImpl buys", () => {
    // Contrast case: `anim.count` lives in animReads, OUTSIDE the capture proxy.
    // If it were captured, the step below would look persistable — so this is
    // what makes the guarantee above discriminating rather than vacuous.
    actions.start();
    actions.suspend(true);
    anim.count();
    actions.suspend(false);
    actions.record(() => {});
    actions.stop();
    const id = actions.save("Read");

    expect(actions.isPersistable(id)).toBe(false);
  });

  it("Make Frames From Layers is reachable and recordable too", () => {
    anim.framesFromLayers();
    expect(e.calls).toEqual(["frames_from_layers"]);
    expect(commit).toHaveBeenCalledTimes(1);

    actions.start();
    actions.suspend(true);
    anim.framesFromLayers();
    actions.suspend(false);
    actions.record(() => anim.framesFromLayers());
    actions.stop();
    const id = actions.save("From Layers");
    expect(actions.isPersistable(id), "must sit inside animImpl to record in an Action").toBe(true);
  });

  it("Flatten Frames Into Layers is reachable and recordable too", () => {
    anim.framesToLayers();
    expect(e.calls).toEqual(["frames_to_layers"]);
    expect(commit).toHaveBeenCalledTimes(1);

    actions.start();
    actions.suspend(true);
    anim.framesToLayers();
    actions.suspend(false);
    actions.record(() => anim.framesToLayers());
    actions.stop();
    const id = actions.save("To Layers");
    expect(actions.isPersistable(id), "must sit inside animImpl to record in an Action").toBe(true);
  });
});

// The Animation panel's buttons stay a SOURCE check: Panels.tsx is a React
// component, and this app has no DOM environment or renderer in its unit suite
// (vitest runs in node; jsdom/@testing-library are not dependencies, and the
// vitest config excludes Panels.tsx from coverage for exactly that reason).
// Rendered behaviour is Playwright's job; this is the cheap "someone deleted the
// button / unwired the handler" net until a spec covers it.
describe("the Animation panel exposes the commands (source wiring)", () => {
  const panels = readFileSync(new URL("../ui/Panels.tsx", import.meta.url), "utf8");

  it("has a Reverse button wired to anim.reverseFrames", () => {
    expect(panels).toContain("data-mv-reverse-frames");
    expect(panels).toContain("anim.reverseFrames()");
  });

  it("is disabled below two frames, matching the engine's no-op", () => {
    const from = panels.indexOf("data-mv-reverse-frames");
    const button = panels.slice(from - 120, from + 240);
    expect(button).toContain("disabled={frames < 2}");
  });

  it("has the Make Frames / Flatten Frames buttons too", () => {
    expect(panels).toContain("data-mv-frames-from-layers");
    expect(panels).toContain("anim.framesFromLayers()");
    expect(panels).toContain("data-mv-frames-to-layers");
    expect(panels).toContain("anim.framesToLayers()");
  });
});
