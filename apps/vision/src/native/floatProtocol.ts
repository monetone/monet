// ─────────────────────────────────────────────────────────────
// Window ▸ Arrange float windows (#477): what travels between the main webview,
// which owns every document, and a float window, which is only a canvas.
//
//   main → float  frames: raw bytes through src-tauri/src/float.rs (`frame`
//                 → the float's `attach` channel): a dirty rect of pixels, or
//                 the selection's marching-ants boundary. One at a time, paced
//                 by the float's `ack` once it has drawn one (on its rAF).
//                 view: where the document sits in the float, as an event.
//                 overlay: the view's editing chrome (guides, paths, crop and
//                 transform frames…) as markup, and an open text edit.
//   float → main  input: pointer, wheel, keys and typed text as the float saw
//                 them (through float.rs `input`), which the main webview
//                 replays into its own view of the document, so every tool runs
//                 through the one canvas pipeline.
// Engine-free, so it unit-tests in node.
// ─────────────────────────────────────────────────────────────

import type { DocView } from "../state/viewTransform";

export const FLOAT_INPUT = "monet://float/input";
export const FLOAT_VIEW = "monet://float/view";
export const FLOAT_OVERLAY = "monet://float/overlay";
// Emitted by src-tauri/src/float.rs.
export const FLOAT_FOCUS = "monet://float/focus";
export const FLOAT_CLOSED = "monet://float/closed";

export const floatLabel = (doc: number) => `float-${doc}`;

export interface Rect { x: number; y: number; w: number; h: number }

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** The whole document, whatever its size (clamped when packed). */
export const WHOLE: Rect = { x: 0, y: 0, w: Infinity, h: Infinity };

/** Where the document sits in a float, and what to call its window. */
export interface FloatViewState extends DocView {
  par: number; // pixel-aspect stretch on x
  name: string;
  ants: boolean; // View ▸ Show ▸ Selection Edges (and Extras)
}

/** An open text edit in the float's document: the main view's editor box,
 *  which the float mirrors with a real text field of its own. */
export interface FloatText { id: number; fresh: boolean; value: string; css: string; wrap: string; revision: number }

/** Keep newer local typing until its revision is acknowledged. An external
 * edit after that acknowledgement is authoritative, even if typed before. */
export const textEchoValue = (local: string, sentRevision: number, echo: Pick<FloatText, "value" | "revision">): string =>
  echo.revision < sentRevision ? local : echo.value;

export interface FloatCursor { css: string; tipCss: string; tipHtml: string }
export interface FloatOverlay { html: string; text: FloatText | null; cursor?: FloatCursor }

/** The main view owns cursor appearance; the float owns its screen position. */
export function positionFloatCursor(el: HTMLElement, cursor: FloatCursor | undefined, point: { x: number; y: number } | null) {
  el.style.cssText = cursor?.tipCss ?? "display: none";
  if (!point) { el.style.display = "none"; return; }
  el.style.left = `${point.x}px`;
  el.style.top = `${point.y}px`;
}

// A frame: [doc, kind, docW, docH, x, y, w, h] as little-endian u32 (float.rs
// writes it from the `x-float-frame` header, routing on `doc`), then the body:
// the rect's RGBA rows, or the ants' boundary as i32 (x, y) pairs.
export const FRAME_PIXELS = 0;
export const FRAME_ANTS = 1;
export const FRAME_OVERLAY = 2;
const HEADER = 32;

interface Pixels { width: number; height: number; data: Uint8ClampedArray }

/** Rect `r` of `img`, clamped to it: the header words after `doc` and `kind`,
 *  and the body — the image's own bytes when that is the whole of it. */
export function pixelFrame(img: Pixels, r: Rect): { head: number[]; body: Uint8Array } {
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
  const w = Math.max(0, Math.min(img.width, Math.ceil(r.x + r.w)) - x);
  const h = Math.max(0, Math.min(img.height, Math.ceil(r.y + r.h)) - y);
  const head = [img.width, img.height, x, y, w, h];
  if (w === img.width && h === img.height) return { head, body: new Uint8Array(img.data.buffer, img.data.byteOffset, w * h * 4) };
  const body = new Uint8Array(w * h * 4);
  const row = img.width * 4;
  for (let j = 0; j < h; j++) {
    const at = (y + j) * row + x * 4;
    body.set(img.data.subarray(at, at + w * 4), j * w * 4);
  }
  return { head, body };
}

/** The `x-float-frame` header float.rs turns into the frame's first words. */
export const frameHeader = (doc: number, kind: number, head: number[]) => [doc, kind, ...head].join(",");

export function readFrame(buf: ArrayBuffer) {
  const head = new DataView(buf, 0, HEADER);
  const [kind, docW, docH, x, y, w, h] = [1, 2, 3, 4, 5, 6, 7].map((i) => head.getUint32(i * 4, true));
  return kind === FRAME_ANTS
    ? { kind, docW, docH, ants: new Int32Array(buf, HEADER, (buf.byteLength - HEADER) / 4) }
    : { kind, docW, docH, x, y, w, h, rgba: new Uint8ClampedArray(buf, HEADER, w * h * 4) };
}

interface Mods { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean; capsLock?: boolean }

interface PointerInput extends Mods {
  doc: number;
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "click" | "dblclick" | "wheel";
  x: number; y: number; button: number; buttons: number;
  pointerId: number; pointerType: string; pressure: number; tiltX: number; tiltY: number;
  deltaX: number; deltaY: number; deltaMode: number;
}
interface KeyInput extends Mods { doc: number; type: "keydown" | "keyup"; key: string; code: string; repeat: boolean }

/** Input from a float window (pointer positions in its viewport's px), what
 *  its text field now holds, its canvas size, and the stream's flow control. */
export type FloatInput =
  | PointerInput
  | KeyInput
  | { doc: number; type: "text"; value: string; revision: number }
  | { doc: number; type: "textEnd" }
  | { doc: number; type: "resize"; w: number; h: number }
  | { doc: number; type: "ready" | "ack" };

const mods = (e: Mods & { getModifierState?: (key: string) => boolean }): Mods => ({
  shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey,
  capsLock: e.getModifierState?.("CapsLock") ?? e.capsLock ?? false,
});

/** A float's pointer, click or wheel event, relative to its viewport. */
export function pointerInput(doc: number, e: MouseEvent, viewport: { left: number; top: number }): PointerInput {
  const p = e as Partial<PointerEvent>, wheel = e as Partial<WheelEvent>;
  return {
    doc, type: e.type as "pointerdown", x: e.clientX - viewport.left, y: e.clientY - viewport.top,
    button: e.button, buttons: e.buttons, ...mods(e),
    pointerId: p.pointerId ?? 1, pointerType: p.pointerType ?? "mouse", pressure: p.pressure ?? 0,
    tiltX: p.tiltX ?? 0, tiltY: p.tiltY ?? 0,
    deltaX: wheel.deltaX ?? 0, deltaY: wheel.deltaY ?? 0, deltaMode: wheel.deltaMode ?? 0,
  };
}

export function keyInput(doc: number, e: KeyboardEvent): KeyInput {
  return { doc, type: e.type as "keydown", key: e.key, code: e.code, repeat: e.repeat, ...mods(e) };
}

/** Keys that finish a text edit typed in a float: Escape, or ⌘/Ctrl-Enter. */
export const endsTextEdit = (e: { key: string; metaKey: boolean; ctrlKey: boolean }) =>
  e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey));

/** The DOM event that replays `m` on a main-window view whose viewport sits
 *  at `viewport` — or null for the messages that aren't DOM input. */
export function inputEvent(m: FloatInput, viewport: { left: number; top: number }): Event | null {
  if ("key" in m) {
    return new KeyboardEvent(m.type, { key: m.key, code: m.code, repeat: m.repeat, ...mods(m), modifierCapsLock: m.capsLock, bubbles: true, cancelable: true });
  }
  if (!("x" in m)) return null;
  const init = {
    clientX: viewport.left + m.x, clientY: viewport.top + m.y, button: m.button, buttons: m.buttons, ...mods(m), modifierCapsLock: m.capsLock,
    bubbles: true, cancelable: true, composed: true,
  };
  if (m.type === "wheel") return new WheelEvent("wheel", { ...init, deltaX: m.deltaX, deltaY: m.deltaY, deltaMode: m.deltaMode });
  if (m.type === "click" || m.type === "dblclick") return new MouseEvent(m.type, init);
  return new PointerEvent(m.type, {
    ...init, pointerId: m.pointerId, pointerType: m.pointerType, pressure: m.pressure,
    tiltX: m.tiltX, tiltY: m.tiltY, isPrimary: true,
  });
}
