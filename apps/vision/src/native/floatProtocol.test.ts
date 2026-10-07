// @vitest-environment jsdom
// Window ▸ Arrange float windows (#477): the frames and input that cross
// between the main webview and a float window.
import { describe, expect, it } from "vitest";
import {
  FRAME_ANTS, FRAME_PIXELS, WHOLE, endsTextEdit, frameHeader, inputEvent, keyInput, pixelFrame, pointerInput, positionFloatCursor, readFrame, textEchoValue, unionRect,
} from "./floatProtocol";

/** A w×h image whose pixel (x, y) is [x, y, 7, 255]. */
function image(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x, y, 7, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}

/** The frame float.rs hands the window: the header's words, then the body. */
function wire(header: string, body: Uint8Array): ArrayBuffer {
  const words = header.split(",").map(Number);
  const out = new Uint8Array(words.length * 4 + body.length);
  const view = new DataView(out.buffer);
  words.forEach((w, i) => view.setUint32(i * 4, w, true));
  out.set(body, words.length * 4);
  return out.buffer;
}

describe("float frames", () => {
  it("carry one dirty rect, row by row, with the document's size", () => {
    const img = image(6, 4);
    const { head, body } = pixelFrame(img, { x: 2, y: 1, w: 3, h: 2 });
    const header = frameHeader(9, FRAME_PIXELS, head);
    expect(header.split(",")[0]).toBe("9"); // float.rs routes on this
    const f = readFrame(wire(header, body));
    expect([f.kind, f.docW, f.docH, f.x, f.y, f.w, f.h]).toEqual([FRAME_PIXELS, 6, 4, 2, 1, 3, 2]);
    expect([...f.rgba!.subarray(0, 4)]).toEqual([2, 1, 7, 255]);
    expect([...f.rgba!.subarray(3 * 4, 3 * 4 + 4)]).toEqual([2, 2, 7, 255]); // second row starts at x=2 again
    expect(f.rgba!.length).toBe(3 * 2 * 4);
  });

  it("send the whole document as its own bytes, uncopied, and clamp a rect hanging off its edge", () => {
    const img = image(5, 3);
    const whole = pixelFrame(img, WHOLE);
    expect(whole.head).toEqual([5, 3, 0, 0, 5, 3]);
    expect(whole.body.buffer).toBe(img.data.buffer);
    expect(pixelFrame(img, { x: 3.5, y: -2, w: 9, h: 3 }).head).toEqual([5, 3, 3, 0, 2, 1]);
  });

  it("carry the marching ants as the boundary's points", () => {
    const pts = Int32Array.from([1, 2, 3, 4]);
    const f = readFrame(wire(frameHeader(9, FRAME_ANTS, [0, 0, 0, 0, 0, 0]), new Uint8Array(pts.buffer)));
    expect(f.kind).toBe(FRAME_ANTS);
    expect([...f.ants!]).toEqual([1, 2, 3, 4]);
  });

  it("coalesce the dabs of one frame in flight into their bounding rect", () => {
    const r = unionRect(unionRect(null, { x: 5, y: 5, w: 2, h: 2 }), { x: 1, y: 6, w: 2, h: 4 });
    expect(r).toEqual({ x: 1, y: 5, w: 6, h: 5 });
  });
});

describe("float input", () => {
  it("positions the main canvas's cursor appearance locally and hides it outside the float", () => {
    const tip = document.createElement("div");
    const cursor = { css: "none", tipCss: "position: fixed; display: block; width: 80px; height: 80px; left: 0px; top: 0px; transform: translate(-50%, -50%);", tipHtml: "" };
    positionFloatCursor(tip, cursor, { x: 240, y: 170 });
    expect(tip.style).toMatchObject({ display: "block", width: "80px", left: "240px", top: "170px", transform: "translate(-50%, -50%)" });
    positionFloatCursor(tip, { ...cursor, tipCss: cursor.tipCss.replaceAll("80px", "160px") }, { x: 241, y: 171 });
    expect(tip.style).toMatchObject({ width: "160px", left: "241px", top: "171px" });
    positionFloatCursor(tip, cursor, null);
    expect(tip.style.display).toBe("none");
  });

  it("keeps Caps Lock in pointer and keyboard messages", () => {
    const pointer = new PointerEvent("pointermove", { modifierCapsLock: true });
    const m = pointerInput(1, pointer, { left: 0, top: 0 });
    expect(m.capsLock).toBe(true);
    expect((inputEvent(m, { left: 0, top: 0 }) as PointerEvent).getModifierState("CapsLock")).toBe(true);
    const key = keyInput(1, new KeyboardEvent("keydown", { key: "CapsLock", modifierCapsLock: true }));
    expect((inputEvent(key, { left: 0, top: 0 }) as KeyboardEvent).getModifierState("CapsLock")).toBe(true);
  });

  it("replays a pointer at the same spot of the main window's view, with its pen and modifiers", () => {
    const seen = new PointerEvent("pointerdown", {
      clientX: 130, clientY: 95, button: 0, buttons: 1, pressure: 0.5, pointerId: 3, pointerType: "pen", shiftKey: true,
    });
    const m = pointerInput(7, seen, { left: 100, top: 80 });
    expect(m).toMatchObject({ doc: 7, type: "pointerdown", x: 30, y: 15, pressure: 0.5, pointerType: "pen", shiftKey: true });

    const replayed = inputEvent(JSON.parse(JSON.stringify(m)), { left: -2000, top: 10 }) as PointerEvent;
    expect(replayed.type).toBe("pointerdown");
    expect([replayed.clientX, replayed.clientY]).toEqual([-1970, 25]);
    expect([replayed.buttons, replayed.pressure, replayed.pointerId, replayed.shiftKey, replayed.altKey]).toEqual([1, 0.5, 3, true, false]);
    expect(replayed.bubbles).toBe(true); // React listens at the root
  });

  it("replays wheel, clicks and keys, and nothing for text or flow control", () => {
    const vp = { left: 0, top: 0 };
    const wheel = inputEvent(pointerInput(1, new WheelEvent("wheel", { deltaY: -40, ctrlKey: true }), vp), vp) as WheelEvent;
    expect([wheel.type, wheel.deltaY, wheel.ctrlKey]).toEqual(["wheel", -40, true]);
    expect(inputEvent(pointerInput(1, new MouseEvent("dblclick"), vp), vp)!.type).toBe("dblclick");
    expect(inputEvent(pointerInput(1, new MouseEvent("click"), vp), vp)!.type).toBe("click"); // the ✓ of a transform frame
    const key = inputEvent(keyInput(1, new KeyboardEvent("keydown", { key: "z", code: "KeyZ", metaKey: true })), vp) as KeyboardEvent;
    expect([key.type, key.key, key.code, key.metaKey]).toEqual(["keydown", "z", "KeyZ", true]);
    expect(inputEvent({ doc: 1, type: "ack" }, vp)).toBeNull();
    expect(inputEvent({ doc: 1, type: "text", value: "hi", revision: 1 }, vp)).toBeNull();
    expect(inputEvent({ doc: 1, type: "resize", w: 5, h: 5 }, vp)).toBeNull();
  });

  it("finishes a text edit on Escape or ⌘/Ctrl-Enter, and types everything else", () => {
    const k = (key: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({ key, metaKey: false, ctrlKey: false, ...mods });
    expect(endsTextEdit(k("Escape"))).toBe(true);
    expect(endsTextEdit(k("Enter", { metaKey: true }))).toBe(true);
    expect(endsTextEdit(k("Enter", { ctrlKey: true }))).toBe(true);
    expect(endsTextEdit(k("Enter"))).toBe(false); // a new line
    expect(endsTextEdit(k("h"))).toBe(false);
  });

  it("ignores older typing echoes and accepts external undo after repeated or coalesced acknowledgements", () => {
    // Fast typing produced A → AB → A before any echo arrived.
    const current = "A", sent = 3;
    expect(textEchoValue(current, sent, { value: "A", revision: 1 })).toBe("A");
    expect(textEchoValue(current, sent, { value: "AB", revision: 2 })).toBe("A");
    // The latest acknowledgement also works when intermediate echoes coalesced.
    expect(textEchoValue(current, sent, { value: "A", revision: 3 })).toBe("A");
    // Undo/main-window edits reuse the acknowledged revision, not the historical value.
    expect(textEchoValue(current, sent, { value: "AB", revision: 3 })).toBe("AB");
    expect(textEchoValue("AB", sent, { value: "", revision: 3 })).toBe("");
    expect(textEchoValue("ABC", 4, { value: "AB", revision: 3 })).toBe("ABC");
  });
});
