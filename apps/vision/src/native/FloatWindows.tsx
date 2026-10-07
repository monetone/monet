// ─────────────────────────────────────────────────────────────
// Window ▸ Arrange float windows, main-webview side (#477). Every floated
// document gets an OS window (src-tauri/src/float.rs, src/float.tsx) and, here,
// an unseen Window ▸ Arrange view sized like that window's canvas. The window's
// input is replayed into this view — onto the element under the pointer, as a
// real click would land — so its tools, editors, zoom, pan and hit radii are
// the ones every other canvas view runs. What the view then shows goes back to
// the window: its transform, the document's pixels and marching ants as frames,
// and its editing chrome (guides, paths, crop and transform frames, the text
// editor) as markup. See floatProtocol.ts for the wire.
// ─────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { CanvasView } from "../canvas/CanvasView";
import { engine, store, text, useStore } from "../state/app";
import { viewOf } from "../state/store";
import {
  FLOAT_CLOSED, FLOAT_FOCUS, FLOAT_INPUT, FLOAT_OVERLAY, FLOAT_VIEW, FRAME_ANTS, FRAME_PIXELS, FRAME_OVERLAY, WHOLE,
  floatLabel, frameHeader, inputEvent, pixelFrame, unionRect,
  type FloatInput, type FloatOverlay, type FloatViewState, type Rect,
} from "./floatProtocol";

/** Stream document `doc` to its window. While it is the document the engine
 *  holds, the window gets the rects the engine blits (one union per frame in
 *  flight); otherwise the document's own composite, whenever its display
 *  revision has moved past the one the window last received — so switching
 *  focus between windows resends nothing that is already there. One frame at
 *  a time: the window acks each on its next animation frame, so a busy stroke
 *  coalesces instead of queueing. The window scales and turns the pixels
 *  itself, so panning and zooming there move no pixels at all.
 *  ponytail: a whole frame is the whole document at full size (w·h·4 bytes),
 *  sent when the window opens and when a background document repaints; frames
 *  cropped and scaled to the window's viewport are the upgrade if a big
 *  document makes that lag. */
function streamDoc(doc: number, host: () => HTMLElement | undefined) {
  const label = floatLabel(doc);
  let dirty: Rect | null = null; // pixels the window lacks
  let ants: Int32Array | null = null; // a boundary the window lacks
  let boundary: Int32Array = new Int32Array(0), antsHeld = false; // the view's boundary; does the window show one?
  let busy = true; // until the window announces itself
  // What the window holds (with `dirty` still to come): the display revision
  // and size of its pixels, and the engine activation they came through.
  let shown: number | null = null, shownSize = "", shownGen = -1;
  let wasLive = false;
  let viewKey = "", overlayKey = "";
  let textRevision = 0;
  let rasterDirty = false, rasterHeld = false;
  // ponytail: overlay repaints send a full frame; crop to dirty rects if large masks lag.
  let rasterCanvas: HTMLCanvasElement | null = null;
  const live = () => store.engineDocId() === doc;
  const send = (kind: number, head: number[], body: Uint8Array) =>
    invoke<boolean>("plugin:float|frame", body, { headers: { "x-float-frame": frameHeader(doc, kind, head) } });

  const flush = () => {
    if (busy) return;
    let sent: Promise<boolean>, undo: () => void;
    if (dirty) {
      const on = live(), rect = on ? dirty : WHOLE;
      const img = on ? engine.displayImage() : store.docPixels(doc);
      dirty = null;
      if (!img) return;
      shown = store.docDisplayRevision(doc);
      shownSize = `${img.width}x${img.height}`;
      const { head, body } = pixelFrame(img, rect);
      sent = send(FRAME_PIXELS, head, body);
      undo = () => { dirty = unionRect(dirty, rect); shown = null; };
    } else if (rasterDirty) {
      rasterDirty = false;
      const sources = Array.from(host()?.querySelectorAll<HTMLCanvasElement | HTMLImageElement>('[data-mv-float-raster="1"]') ?? [])
        .filter((el) => el instanceof HTMLCanvasElement ? el.width && el.height : el.complete && el.naturalWidth);
      if (!sources.length && !rasterHeld) { flush(); return; }
      rasterHeld = sources.length > 0;
      rasterCanvas ??= document.createElement("canvas");
      const size = rasterHeld ? store.docSize(doc) : null;
      rasterCanvas.width = size?.w ?? 0;
      rasterCanvas.height = size?.h ?? 0;
      const ctx = rasterCanvas.getContext("2d")!;
      for (const source of sources) {
        ctx.globalAlpha = source.style.opacity ? Number(source.style.opacity) : 1;
        ctx.drawImage(source, 0, 0, rasterCanvas.width, rasterCanvas.height);
      }
      const { head, body } = size
        ? pixelFrame(ctx.getImageData(0, 0, size.w, size.h), WHOLE)
        : { head: [0, 0, 0, 0, 0, 0], body: new Uint8Array(0) };
      sent = send(FRAME_OVERLAY, head, body);
      undo = () => { rasterDirty = true; };
    } else if (ants) {
      const pts = ants;
      ants = null;
      antsHeld = pts.length > 0;
      sent = send(FRAME_ANTS, [0, 0, 0, 0, 0, 0], new Uint8Array(pts.buffer, pts.byteOffset, pts.byteLength));
      undo = () => { ants ??= pts; };
    } else return;
    busy = true;
    sent.then(
      // Not listening (reloading): it announces itself again, and gets it all.
      (delivered) => { if (!delivered) undo(); },
      // A failed hand-over must not stall the window: take it back, try again.
      (e) => {
        console.warn("Float frame failed:", e);
        undo();
        busy = false;
        requestAnimationFrame(flush);
      },
    );
  };
  const mark = (r: Rect) => {
    dirty = unionRect(dirty, r);
    queueMicrotask(flush);
  };
  const onBlit = (x: number, y: number, w: number, h: number) => {
    if (!live()) return;
    // An activation repaints the document whole; the window may hold it already.
    if (engine.docGen !== shownGen) {
      shownGen = engine.docGen;
      const img = engine.displayImage();
      if (!dirty && shown === store.docDisplayRevision(doc) && shownSize === `${img?.width}x${img?.height}`) return;
    }
    mark({ x, y, w, h });
  };
  const onStore = () => {
    const s = store.state, on = live();
    if (on !== wasLive) {
      wasLive = on;
      // Every change of a live document came as a blit, so the window holds
      // its current revision — unless rects of it are still unsent, which can
      // no longer be read off the engine.
      if (!on) {
        if (dirty) dirty = WHOLE;
        else shown = store.docDisplayRevision(doc);
      }
    }
    if (!on && store.docDisplayRevision(doc) !== shown) mark(WHOLE);
    const v = viewOf(s, doc);
    const view: FloatViewState = {
      zoom: v.zoom, panX: v.panX, panY: v.panY, rotationAngle: v.rotationAngle,
      par: s.pixelAspectCorrection ? s.pixelAspect : 1,
      name: `${store.docName(doc) ?? ""}${store.docDirty(doc) ? "*" : ""}`,
      ants: s.showSelectionEdges && s.showExtras,
    };
    const k = JSON.stringify(view);
    if (k !== viewKey) { viewKey = k; void emitTo(label, FLOAT_VIEW, view); }
  };

  // The view's editing chrome, as markup: everything drawn over the pixels
  // except canvases (ants travel as a boundary, the rest are not mirrored)
  // and the text field, which the window keeps a live one of.
  let pending = false;
  const publish = () => {
    pending = false;
    const box = host()?.querySelector("[data-mv-docbox]");
    const overlay: FloatOverlay = { html: "", text: null };
    const viewport = host()?.querySelector<HTMLElement>(".mv-canvas-viewport");
    const cursor = viewport?.querySelector<HTMLElement>('[data-testid="mv-brush-cursor"]');
    if (viewport && cursor) overlay.cursor = { css: viewport.style.cursor, tipCss: cursor.style.cssText, tipHtml: cursor.innerHTML };
    let over = false;
    for (const el of box?.children ?? []) {
      if (el.hasAttribute("data-mv-pixels")) over = true;
      else if (over && !["CANVAS", "IMG", "TEXTAREA"].includes(el.tagName)) overlay.html += el.outerHTML;
    }
    const field = box?.querySelector<HTMLTextAreaElement>("textarea.mv-text-edit");
    const edit = store.state.textEdit;
    if (field && edit) overlay.text = { id: edit.id, fresh: edit.fresh, value: field.value, css: field.style.cssText, wrap: field.wrap, revision: textRevision };
    const k = JSON.stringify(overlay);
    if (k !== overlayKey) { overlayKey = k; void emitTo(label, FLOAT_OVERLAY, overlay); }
  };
  const schedule = () => {
    rasterDirty = true;
    queueMicrotask(flush);
    if (!pending) { pending = true; queueMicrotask(publish); }
  };
  // The view itself, not the host: the host moves on every replayed pointer.
  const watch = new MutationObserver(schedule);
  const view = host()?.querySelector(".mv-canvas-viewport");
  if (view) watch.observe(view, { subtree: true, childList: true, attributes: true, characterData: true });
  view?.addEventListener("load", schedule, true);

  engine.blitListeners.add(onBlit);
  const unsubscribe = store.subscribe(onStore);
  onStore();
  return {
    ack() { busy = false; flush(); },
    overlay: schedule,
    acceptText(revision: number) {
      if (!Number.isSafeInteger(revision) || revision <= textRevision) return false;
      textRevision = revision;
      return true;
    },
    ready() {
      busy = false;
      viewKey = overlayKey = "";
      shown = null;
      antsHeld = false;
      rasterHeld = false;
      textRevision = 0;
      if (boundary.length) ants = boundary;
      mark(WHOLE);
      onStore();
      schedule();
    },
    ants(pts: Int32Array) {
      boundary = pts;
      if (!pts.length && !antsHeld) return; // no selection then, none now
      ants = pts;
      queueMicrotask(flush);
    },
    dispose() { engine.blitListeners.delete(onBlit); unsubscribe(); watch.disconnect(); view?.removeEventListener("load", schedule, true); },
  };
}

/** Where a float's press landed: its gesture's moves and release go there, as
 *  pointer capture would send them, and its click after. */
interface Press { target: Element | null; click: Element | null }

/** Replay a float's pointer on its unseen view: moved so the pointer sits at
 *  the main window's top-left (always on screen, whatever the float's size),
 *  briefly made hit-testable, and dispatched on the element under it. */
function replayPointer(host: HTMLElement, m: FloatInput & { x: number; y: number }, press: Press) {
  const view = host.querySelector(".mv-canvas-viewport");
  if (!view) return;
  host.style.transform = `translate(${-m.x}px, ${-m.y}px)`;
  let target = m.type === "click" ? press.click : m.type === "pointerdown" ? null : press.target;
  if (!target) {
    host.style.visibility = "visible";
    target = document.elementsFromPoint(0, 0).find((el) => view.contains(el)) ?? view;
    host.style.visibility = "hidden";
  }
  if (m.type === "pointerdown") press.target = target;
  if (m.type === "pointerup" || m.type === "pointercancel") [press.click, press.target] = [press.target, null];
  const event = inputEvent(m, view.getBoundingClientRect());
  if (event) target.dispatchEvent(event);
}

export function FloatWindows() {
  const floatDocs = useStore((s) => s.floatDocs);
  const [sizes, setSizes] = useState<Record<number, { w: number; h: number }>>({});
  const hosts = useRef(new Map<number, HTMLElement>());
  const streams = useRef(new Map<number, ReturnType<typeof streamDoc>>());
  const presses = useRef(new Map<number, Press>());

  // One window per floated document: open the new ones, close the dropped.
  useLayoutEffect(() => {
    const open = streams.current;
    floatDocs.forEach((doc, index) => {
      if (open.has(doc)) return;
      open.set(doc, streamDoc(doc, () => hosts.current.get(doc)));
      void invoke("plugin:float|open", { doc, title: store.docName(doc) ?? "", index })
        .catch((e) => { console.warn("Float in Window failed:", e); store.unfloatDoc(doc); });
    });
    for (const [doc, stream] of open) {
      if (floatDocs.includes(doc)) continue;
      stream.dispose();
      open.delete(doc);
      void invoke("plugin:float|close", { doc });
    }
  }, [floatDocs]);
  useEffect(() => () => {
    for (const stream of streams.current.values()) stream.dispose();
    streams.current.clear();
  }, []);

  useEffect(() => {
    const offs = [
      listen<FloatInput>(FLOAT_INPUT, ({ payload: m }) => {
        const stream = streams.current.get(m.doc), host = hosts.current.get(m.doc);
        if (!stream || !host) return;
        switch (m.type) {
          case "ack": return stream.ack();
          case "ready": return stream.ready();
          case "resize": return setSizes((prev) => ({ ...prev, [m.doc]: { w: m.w, h: m.h } }));
          // The float's own text field typed into the open edit: the same
          // update the main view's field makes on change, and its Escape.
          case "text": {
            const id = store.state.textEdit?.id, spec = id === undefined ? null : text.get(id);
            if (id !== undefined && spec && store.state.activeDocId === m.doc && stream.acceptText(m.revision)) {
              text.apply(id, text.setText(spec, m.value));
              stream.overlay();
            }
            return;
          }
          case "textEnd": if (store.state.activeDocId === m.doc) store.endTextEdit(); return;
          // Keys go where the main window's own shortcuts listen.
          case "keydown": case "keyup": {
            if (store.state.activeDocId !== m.doc) return;
            const event = inputEvent(m, { left: 0, top: 0 });
            if (event) document.body.dispatchEvent(event);
            return;
          }
          default: {
            const press = presses.current.get(m.doc) ?? { target: null, click: null };
            presses.current.set(m.doc, press);
            replayPointer(host, m, press);
            stream.overlay();
          }
        }
      }),
      // Focusing a float makes its document the one panels and menus act on.
      listen<number>(FLOAT_FOCUS, ({ payload }) => store.activateDoc(payload)),
      // Closing it returns the document to the tab bar, still open.
      listen<number>(FLOAT_CLOSED, ({ payload }) => store.unfloatDoc(payload)),
    ];
    return () => { for (const off of offs) void off.then((f) => f()); };
  }, []);

  return floatDocs.map((doc) => (
    <div
      key={doc} aria-hidden data-mv-float-host={doc}
      ref={(el) => { if (el) hosts.current.set(doc, el); else hosts.current.delete(doc); }}
      style={{ position: "fixed", left: 0, top: 0, width: sizes[doc]?.w ?? 0, height: sizes[doc]?.h ?? 0, visibility: "hidden" }}
    >
      <CanvasView paneDocId={doc} floatHost onBoundary={(pts) => streams.current.get(doc)?.ants(pts)} onOverlay={() => streams.current.get(doc)?.overlay()} />
    </div>
  ));
}
