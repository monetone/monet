// Guards #471: Allow Tool Recording. The recorder proxies store commands, but a
// pointer gesture is not one — brush strokes lived in EngineClient's collab
// capture channel and lasso/marquee drags called the engine straight from the
// canvas, so recording a painting gesture saved zero steps. This drives the real
// facade: the toggle gates capture, and a captured stroke survives export/import
// and repaints on replay.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { actions, engine } from "./app";

// Exactly representable in f32 — the recorded step stores the brush as one.
const BRUSH = [20, 0.5, 1, 1, 0.25, 1, 2, 3, 255, 0];
const LOCAL_BRUSH = [9, 1, 1, 1, 0.5, 0, 0, 0, 255, 1];
const PTS = [10, 10, 1, 12, 14, 0.5];

/** An engine double that reports one layer and logs the paint calls. */
function paintEngine() {
  const calls: [string, ...unknown[]][] = [];
  engine.engine = {
    layer_count: () => 1,
    layer_id_at: () => 7,
    layer_locked: () => false,
    active_layer_id: () => 7,
    set_active_layer: () => {},
    set_brush: (...a: unknown[]) => calls.push(["set_brush", ...a]),
    stroke_begin: () => { calls.push(["stroke_begin"]); return true; },
    stroke_to: (...a: unknown[]) => calls.push(["stroke_to", ...a]),
    stroke_end: () => calls.push(["stroke_end"]),
    composite: () => {},
  } as never;
  vi.spyOn(engine, "blit").mockImplementation(() => {});
  vi.spyOn(engine, "commit").mockReturnValue(true);
  engine.lastBrush = [...LOCAL_BRUSH];
  return calls;
}

beforeEach(() => { actions.start(); });
afterEach(() => {
  actions.stop();
  actions.setAllowToolRecording(false);
  vi.restoreAllMocks();
});

describe("Allow Tool Recording gate (#471)", () => {
  it("records nothing while off, and subscribes to the stroke channel while on", () => {
    expect(actions.allowToolRecording()).toBe(false);
    expect(engine.onStrokeRecorded).toBeNull();
    actions.recordTool(["selectRect", [0, 0, 10, 10, 0]]);
    expect(actions.count()).toBe(0);

    actions.setAllowToolRecording(true);
    expect(actions.allowToolRecording()).toBe(true);
    expect(typeof engine.onStrokeRecorded).toBe("function");
    actions.recordTool(["selectRect", [0, 0, 10, 10, 0]]);
    expect(actions.count()).toBe(1);

    actions.setAllowToolRecording(false);
    expect(engine.onStrokeRecorded).toBeNull(); // …and stops paying for capture
  });

  it("records nothing when the recorder is not running, toggle or no toggle", () => {
    actions.setAllowToolRecording(true);
    actions.stop();
    actions.recordTool(["selectRect", [0, 0, 10, 10, 0]]);
    actions.start();
    expect(actions.count()).toBe(0);
  });

  it("refuses a gesture whose args a saved action could not hold", () => {
    actions.setAllowToolRecording(true);
    actions.recordTool(["paintStroke", [() => {}, PTS] as never]);
    expect(actions.count()).toBe(0);
  });
});

describe("a captured stroke is a real step (#471)", () => {
  it("reaches the recorder through the engine's capture channel", () => {
    actions.setAllowToolRecording(true);
    engine.onStrokeRecorded!({ layer: 7, brush: BRUSH, pts: PTS });
    expect(actions.count()).toBe(1);
  });

  it("survives save and export, and repaints the stroke on replay", () => {
    const calls = paintEngine();
    actions.setAllowToolRecording(true);
    engine.onStrokeRecorded!({ layer: 7, brush: BRUSH, pts: PTS });
    const id = actions.save("Painted");

    // Persistable means the step carries a descriptor, not a session-only thunk.
    expect(actions.isPersistable(id)).toBe(true);
    const json = actions.exportJson();
    expect(json).toContain("paintStroke");

    // Replay it after a reload — the step is rebuilt from the exported JSON.
    actions.delete(id);
    expect(actions.importJson(json).rejected).toEqual([]);
    const reloaded = actions.list().find((a) => a.name.startsWith("Painted"))!;
    actions.playNamed(reloaded.id);

    expect(calls).toEqual([
      ["set_brush", ...BRUSH.slice(0, 9), false],
      ["stroke_begin"],
      ["stroke_to", 10, 10, 1],
      ["stroke_to", 12, 14, 0.5],
      ["stroke_end"],
      // …and the user's own brush is back, not the one the action painted with.
      ["set_brush", ...LOCAL_BRUSH.slice(0, 9), true],
    ]);
    actions.delete(reloaded.id);
  });
});
