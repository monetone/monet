// ─────────────────────────────────────────────────────────────
// render/raster-document — the Rust/WASM-rendered document surface
// ─────────────────────────────────────────────────────────────
// Drives the EngineClient from the editor store: pushes the serialized document
// when it changes, the view on pan/zoom, and blits the rasterized frame onto a
// <canvas>. This replaces the SVG <ArtboardBackgrounds>/<DocumentContent> when
// the Rust renderer is enabled (see rasterRendererEnabled); editing chrome
// (grid, handles, guides, tool overlays) stays in SVG above it.

import { useEffect, useRef, useState } from "react";
import { IO } from "../engine";
import { useEditorState } from "../state/store-context";
import { EngineClient, engineReady, initEngine } from "../engine-rs/EngineClient";

export function RasterDocument({ width, height }: { width: number; height: number }) {
  const state = useEditorState();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<EngineClient | null>(null);
  const [ready, setReady] = useState(engineReady());

  // Boot the wasm module once.
  useEffect(() => {
    let live = true;
    void initEngine().then(() => live && setReady(true)).catch((error) => console.error("[Artisan] render engine failed:", error));
    return () => {
      live = false;
    };
  }, []);

  // Bind the canvas to a fresh client when wasm is ready.
  useEffect(() => {
    if (!ready || !canvasRef.current) return;
    const c = new EngineClient();
    c.setCanvas(canvasRef.current);
    clientRef.current = c;
    return () => {
      c.dispose();
      clientRef.current = null;
    };
  }, [ready]);

  // Push the document to the engine whenever it changes (structural sharing makes
  // doc identity stable across pure view/selection changes, so this is rare).
  useEffect(() => {
    const c = clientRef.current;
    if (!ready || !c) return;
    c.setDocument(IO.serializeDocument(state.doc));
  }, [ready, state.doc]);

  // Resize / re-view / repaint on any view, size, or document change.
  useEffect(() => {
    const c = clientRef.current;
    if (!ready || !c) return;
    const dpr = window.devicePixelRatio || 1;
    c.resize(width, height, dpr);
    c.setView(state.view.tx, state.view.ty, state.view.zoom, state.view.angle);
    c.render();
  }, [ready, width, height, state.doc, state.view]);

  return <canvas ref={canvasRef} className="artisan-raster" style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }} />;
}
