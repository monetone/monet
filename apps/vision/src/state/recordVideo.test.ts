// Video export captures the engine and document id before the first frame.
// A tab switch must not redirect later frames, and closing the initiating
// document must cancel between awaited frames.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { engine, recordVideo, store } from "./app";

function fakeEngine() {
  return {
    width: () => 2,
    height: () => 2,
    frame_count: () => 2,
    add_frame: vi.fn(),
    frame_thumb: vi.fn(() => new Uint8Array(16)),
  };
}

function installDom() {
  class FakeRecorder {
    state = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array([7])], { type: "video/webm" }) });
      this.onstop?.();
    }
  }
  const g = globalThis as Record<string, unknown>;
  g.MediaRecorder = FakeRecorder;
  g.document = {
    createElement: (tag: string) => {
      if (tag !== "canvas") return {};
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData: () => {},
        }),
        captureStream: () => ({ getVideoTracks: () => [{ requestFrame() {} }] }),
      };
    },
  };
}

function openDoc(id: number) {
  (store as unknown as { set: (patch: object) => void }).set({
    documents: [{ id, name: `doc-${id}`, dirty: false, hasFile: false }],
    activeDocId: id,
    ready: true,
  });
}

describe("recordVideo", () => {
  afterEach(() => {
    engine.engine = null;
    delete (globalThis as Record<string, unknown>).MediaRecorder;
    delete (globalThis as Record<string, unknown>).document;
    (store as unknown as { set: (patch: object) => void }).set({
      documents: [],
      activeDocId: 0,
      ready: false,
    });
  });

  it("keeps drawing the captured engine after the active engine is replaced between frames", async () => {
    installDom();
    openDoc(4);
    const captured = fakeEngine();
    const replacement = fakeEngine();
    captured.frame_thumb.mockImplementation(() => {
      if (captured.frame_thumb.mock.calls.length === 1) engine.engine = replacement as never;
      return new Uint8Array(16);
    });
    engine.engine = captured as never;
    const result = await recordVideo(1000);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(engine.engine).toBe(replacement);
    expect(captured.frame_thumb).toHaveBeenCalledTimes(2);
    expect(replacement.frame_thumb).not.toHaveBeenCalled();
  });

  it("cancels between frames when the initiating document closes", async () => {
    installDom();
    openDoc(4);
    const captured = fakeEngine();
    captured.frame_thumb.mockImplementation(() => {
      (store as unknown as { set: (patch: object) => void }).set({
        documents: [{ id: 9, name: "other", dirty: false, hasFile: false }],
        activeDocId: 9,
        ready: true,
      });
      return new Uint8Array(16);
    });
    engine.engine = captured as never;
    await expect(recordVideo(1000)).rejects.toThrow("Video export cancelled: the document was closed");
    expect(captured.frame_thumb).toHaveBeenCalledTimes(1);
  });
});
