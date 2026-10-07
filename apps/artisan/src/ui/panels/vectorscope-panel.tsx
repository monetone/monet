// ─────────────────────────────────────────────────────────────
// ui/panels/vectorscope-panel — hue/saturation vectorscope
// ─────────────────────────────────────────────────────────────
// A colour-grading scope for the active artboard. The n×n hue/saturation
// density grid is produced by the SHARED render engine op Engine.vectorscope()
// (packages/engine) — the exact op monet-vision uses — so both apps show an
// identical scope. Because Artisan's on-canvas renderer is SVG by default (the
// Rust composite is opt-in + viewport-sized), this panel renders the whole
// artboard offscreen through its OWN EngineClient so the scope is always
// available and always covers the full artwork, regardless of the display
// renderer. Read-only; never mutates the document.

import { useEffect, useRef, useState } from "react";
import { IO } from "../../engine";
import { useEditorState } from "../../state/store-context";
import { EngineClient, initEngine } from "../../engine-rs/EngineClient";
import { drawVectorscope } from "@monet-ui/monet-scopes";
import { scopeFit } from "./scope-fit";

const ANALYSIS = 256; // longest side of the offscreen render feeding the scope
const N = 128; // scope grid resolution (n×n)
const SIZE = 176; // on-screen scope diameter (px)

export function VectorscopePanel() {
  const state = useEditorState();
  const doc = state.doc;
  const displayRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<EngineClient | null>(null);
  const [ready, setReady] = useState(false);

  // Boot the shared wasm engine once with a private offscreen client.
  useEffect(() => {
    let live = true;
    void initEngine().then(() => {
      if (!live) return;
      const c = new EngineClient();
      c.setCanvas(document.createElement("canvas"));
      clientRef.current = c;
      setReady(true);
    }).catch((error) => console.error("[Artisan] vectorscope engine failed:", error));
    return () => {
      live = false;
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, []);

  // Render the active artboard offscreen through the shared engine, then compute
  // + draw its vectorscope. Re-runs on document edits (doc identity is stable
  // across pure view/selection changes via structural sharing).
  useEffect(() => {
    if (!ready) return;
    const c = clientRef.current;
    const dctx = displayRef.current?.getContext("2d");
    if (!c || !dctx) return;
    const ab = doc.artboards[doc.activeArtboard] ?? doc.artboards[0];
    if (!ab || ab.width <= 0 || ab.height <= 0) return;
    // Aspect-matched surface so the artboard fills it — a square surface would
    // letterbox non-square artboards and analyse whatever sits in the margins.
    const fit = scopeFit(ab, ANALYSIS);
    c.resize(fit.width, fit.height, 1);
    c.setDocument(IO.serializeDocument(doc));
    c.setView(fit.panX, fit.panY, fit.zoom, 0);
    c.render();
    drawVectorscope(dctx, c.vectorscope(N), N, SIZE);
  }, [ready, doc]);

  return (
    <div style={{ padding: "4px 8px 8px" }}>
      <div className="monet-row" style={{ gap: 6, marginBottom: 4 }}>
        <span className="monet-section-label" style={{ margin: 0 }}>Vectorscope</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-3)" }}>hue / saturation</span>
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
        <canvas
          ref={displayRef}
          width={SIZE}
          height={SIZE}
          data-vectorscope-canvas
          style={{ width: SIZE, height: SIZE, display: "block", borderRadius: "50%" }}
        />
      </div>
    </div>
  );
}
