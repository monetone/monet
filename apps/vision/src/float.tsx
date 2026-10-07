// ─────────────────────────────────────────────────────────────
// Window ▸ Arrange ▸ Float in Window (#477): the float window's page, opened by
// src-tauri/src/float.rs as float.html?doc=<id>. It is a title bar and a canvas,
// nothing else: no engine and no store — the main webview owns the document,
// sends its pixels, ants, editing chrome and where they sit, and takes this
// window's input back (see native/floatProtocol.ts). Its own entry, so none of
// the editor's start-up (session recovery, saved actions, the MCP bridge) runs
// a second time here.
// ─────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@monet-ui/monet-core/index.css";
import { MonetProvider, Titlebar, useMonetContext, windowControls } from "@monet-ui/monet-react";
import { viewCss } from "./state/viewTransform";
import { antsCache, drawAnts } from "./canvas/ants";
import {
  FLOAT_OVERLAY, FLOAT_VIEW, FRAME_ANTS, FRAME_OVERLAY, endsTextEdit, floatLabel, keyInput, pointerInput, positionFloatCursor, readFrame, textEchoValue,
  type FloatInput, type FloatOverlay, type FloatViewState,
} from "./native/floatProtocol";

const ACCENT = "var(--accent-raster)";
const doc = Number(new URLSearchParams(location.search).get("doc"));
// A float raises no event of its own; float.rs forwards this, stamped as ours.
const send = (event: FloatInput) => void invoke("plugin:float|input", { event }).catch((e) => console.warn("Float input failed:", e));

function FloatView() {
  const { platform } = useMonetContext() ?? { platform: "mac" as const };
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const antsRef = useRef<HTMLCanvasElement>(null);
  const rasterOverlayRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const [view, setView] = useState<FloatViewState | null>(null);
  const [overlay, setOverlay] = useState<FloatOverlay>({ html: "", text: null });
  const [boundary, setBoundary] = useState(new Int32Array(0));
  const [size, setSize] = useState({ w: 0, h: 0 }); // the document's, from its frames
  const cursorStyleRef = useRef(overlay.cursor);
  useLayoutEffect(() => {
    cursorStyleRef.current = overlay.cursor;
    if (cursorRef.current) positionFloatCursor(cursorRef.current, overlay.cursor, pointerRef.current);
  }, [overlay.cursor]);

  // Frames in: draw each as it lands, ack it on the next animation frame so
  // the main window sends the next (the stream runs at this window's pace).
  useEffect(() => {
    const channel = new Channel<ArrayBuffer>((buf) => {
      const f = readFrame(buf), cv = f.kind === FRAME_OVERLAY ? rasterOverlayRef.current! : canvasRef.current!;
      if (f.kind === FRAME_ANTS) setBoundary(f.ants!);
      else {
        if (cv.width !== f.docW || cv.height !== f.docH) {
          cv.width = f.docW;
          cv.height = f.docH;
          if (f.kind !== FRAME_OVERLAY) setSize({ w: f.docW, h: f.docH });
        }
        if (f.w && f.h) cv.getContext("2d")!.putImageData(new ImageData(f.rgba!, f.w, f.h), f.x!, f.y!);
      }
      requestAnimationFrame(() => send({ doc, type: "ack" }));
    });
    const offs = [
      listen<FloatViewState>(FLOAT_VIEW, (e) => setView(e.payload), { target: floatLabel(doc) }),
      listen<FloatOverlay>(FLOAT_OVERLAY, (e) => setOverlay(e.payload), { target: floatLabel(doc) }),
    ];
    void Promise.all(offs)
      .then(() => invoke("plugin:float|attach", { channel }))
      .then(() => send({ doc, type: "ready" }))
      .catch((e) => console.error("Float window could not attach:", e));
    return () => { for (const off of offs) void off.then((f) => f()); };
  }, []);

  // Marching ants, animated here from the boundary the main window found.
  const showAnts = !!view?.ants && boundary.length > 0;
  useEffect(() => {
    const cv = antsRef.current!;
    cv.width = showAnts ? size.w : 0;
    cv.height = showAnts ? size.h : 0;
    if (!showAnts) return;
    const ctx = cv.getContext("2d")!, cache = antsCache();
    let phase = 0, raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      phase = (phase + 1) % 8;
      drawAnts(ctx, boundary, phase, cache);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showAnts, boundary, size.w, size.h]);

  // An open text edit: a real field over the document, laid out as the main
  // window's editor is, so typing — composition included — happens here, and
  // each change goes back as the edit's new text. The field stays the text's
  // authority: the main window's echoes of what it was sent (which can trail a
  // fast typist) are not taken back, only a change made there.
  const text = overlay.text;
  const composing = useRef(false);
  const sentRevision = useRef(0);
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el || !text) return;
    el.style.cssText = text.css;
    el.wrap = text.wrap;
    const value = textEchoValue(el.value, sentRevision.current, text);
    if (!composing.current && el.value !== value) el.value = value;
  }, [text]);
  useEffect(() => {
    const el = fieldRef.current;
    if (!el || !text) return;
    el.focus({ preventScroll: true });
    // A fresh layer's placeholder goes with the first keystroke.
    if (text.fresh) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per edit
  }, [text?.id]);

  // Input out, in this viewport's px: the main window maps it through the
  // same view it sends back. The text field keeps its own.
  useEffect(() => {
    const vp = viewportRef.current!;
    const inField = (e: Event) => !!fieldRef.current?.contains(e.target as Node);
    const resize = new ResizeObserver(() => send({ doc, type: "resize", w: vp.clientWidth, h: vp.clientHeight }));
    resize.observe(vp);
    const onPointer = (e: MouseEvent) => {
      pointerRef.current = inField(e) ? null : { x: e.clientX, y: e.clientY };
      if (cursorRef.current) positionFloatCursor(cursorRef.current, cursorStyleRef.current, pointerRef.current);
      if (inField(e)) return;
      if (e.type === "pointerdown") vp.setPointerCapture((e as PointerEvent).pointerId);
      if (e.type === "wheel") e.preventDefault();
      send(pointerInput(doc, e, vp.getBoundingClientRect()));
    };
    const pointerTypes = ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "dblclick"];
    for (const t of pointerTypes) vp.addEventListener(t, onPointer as EventListener);
    const leave = () => {
      pointerRef.current = null;
      if (cursorRef.current) positionFloatCursor(cursorRef.current, cursorStyleRef.current, null);
    };
    vp.addEventListener("pointerleave", leave);
    vp.addEventListener("wheel", onPointer, { passive: false });
    const noMenu = (e: Event) => e.preventDefault();
    vp.addEventListener("contextmenu", noMenu);
    // Every shortcut is the main window's (its keydown handler owns them all);
    // while the text field has the keys they are typing, and Escape or
    // ⌘Enter finishes the edit.
    const onKey = (e: KeyboardEvent) => {
      if (inField(e)) {
        if (e.type === "keydown" && !e.isComposing && endsTextEdit(e)) {
          e.preventDefault();
          send({ doc, type: "textEnd" });
        }
        return;
      }
      e.preventDefault();
      send(keyInput(doc, e));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      resize.disconnect();
      for (const t of pointerTypes) vp.removeEventListener(t, onPointer as EventListener);
      vp.removeEventListener("pointerleave", leave);
      vp.removeEventListener("wheel", onPointer);
      vp.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  const name = view?.name ?? "";
  const full = { position: "absolute", left: 0, top: 0, width: size.w, height: size.h } as const;
  return (
    <div className={`monet-window monet-window--${platform} monet-window--bare`} style={{ "--accent": ACCENT } as React.CSSProperties}>
      {/* Closing the tab or the window hands the document back to the tab bar. */}
      <Titlebar docs={name ? [name] : []} activeDoc={name} app="VISION" accent={ACCENT} platform={platform} controls={windowControls} drag onDocClose={() => windowControls.close()} />
      <div
        ref={viewportRef} data-mv-float={doc}
        style={{
          position: "relative", flex: 1, minHeight: 0, overflow: "hidden", cursor: overlay.cursor?.css ?? "crosshair", touchAction: "none",
          background: "repeating-conic-gradient(#1a1d22 0% 25%, #15171c 0% 50%) 50% / 22px 22px",
        }}
      >
        <div
          style={{
            ...full, transformOrigin: "0 0",
            transform: view ? viewCss(view, view.par, size.w, size.h) : undefined,
            visibility: view && size.w ? "visible" : "hidden",
            boxShadow: "0 12px 48px rgba(0,0,0,0.6)",
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ ...full, imageRendering: (view?.zoom ?? 1) >= 2 ? "pixelated" : "auto" }}
          />
          <canvas ref={antsRef} data-mv-float-ants="" style={{ ...full, imageRendering: "pixelated", pointerEvents: "none" }} />
          <canvas ref={rasterOverlayRef} data-mv-float-raster-overlay="" style={{ ...full, imageRendering: "pixelated", pointerEvents: "none" }} />
          {/* The main window's editing chrome for this view, as it drew it. */}
          <div data-mv-float-overlay="" style={{ ...full, pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: overlay.html }} />
          {text && (
            <textarea
              key={text.id} ref={fieldRef} className="mv-text-edit" aria-label="Text layer editor" spellCheck={false}
              defaultValue={text.value}
              onInput={(e) => {
                const value = e.currentTarget.value;
                send({ doc, type: "text", value, revision: ++sentRevision.current });
              }}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
            />
          )}
        </div>
        <div ref={cursorRef} data-mv-float-cursor="" dangerouslySetInnerHTML={{ __html: overlay.cursor?.tipHtml ?? "" }} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <MonetProvider>
    <FloatView />
  </MonetProvider>,
);
