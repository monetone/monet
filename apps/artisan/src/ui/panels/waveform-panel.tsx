// ─────────────────────────────────────────────────────────────
// ui/panels/waveform-panel — luma / RGB waveform monitor
// ─────────────────────────────────────────────────────────────
// A broadcast waveform scope for the active artboard. The cols×rows density
// grid(s) are produced by the SHARED render engine ops Engine.waveform() /
// Engine.waveform_rgb() (packages/engine) — the exact ops monet-vision uses —
// so both apps show an identical scope. Because Artisan's on-canvas renderer is
// SVG by default (the Rust composite is opt-in + viewport-sized), this panel
// renders the whole artboard offscreen through its OWN EngineClient so the scope
// is always available and always covers the full artwork. Read-only.

import { useEffect, useRef, useState } from "react";
import { IO } from "../../engine";
import { useEditorState } from "../../state/store-context";
import { EngineClient, initEngine } from "../../engine-rs/EngineClient";
import { drawWaveform, drawWaveformRgb } from "@monet-ui/monet-scopes";
import { scopeFit } from "./scope-fit";

const ANALYSIS = 256; // longest side of the offscreen render feeding the scope
const COLS = 176; // waveform column buckets
const ROWS = 128; // waveform value buckets
const W = 200; // on-screen scope width (px)
const H = 116; // on-screen scope height (px)

export function WaveformPanel() {
  const state = useEditorState();
  const doc = state.doc;
  const displayRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<EngineClient | null>(null);
  const [ready, setReady] = useState(false);
  const [rgb, setRgb] = useState(false);

  // Boot the shared wasm engine once with a private offscreen client.
  useEffect(() => {
    let live = true;
    void initEngine().then(() => {
      if (!live) return;
      const c = new EngineClient();
      c.setCanvas(document.createElement("canvas"));
      clientRef.current = c;
      setReady(true);
    }).catch((error) => console.error("[Artisan] waveform engine failed:", error));
    return () => {
      live = false;
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, []);

  // Render the active artboard offscreen through the shared engine, then compute
  // + draw its waveform. Re-runs on document edits and the luma/RGB toggle.
  useEffect(() => {
    if (!ready) return;
    const c = clientRef.current;
    const dctx = displayRef.current?.getContext("2d");
    if (!c || !dctx) return;
    const ab = doc.artboards[doc.activeArtboard] ?? doc.artboards[0];
    if (!ab || ab.width <= 0 || ab.height <= 0) return;
    // Aspect-matched surface: a square one letterboxes non-square artboards and
    // the waveform's x axis is the surface's, not the artboard's.
    const fit = scopeFit(ab, ANALYSIS);
    c.resize(fit.width, fit.height, 1);
    c.setDocument(IO.serializeDocument(doc));
    c.setView(fit.panX, fit.panY, fit.zoom, 0);
    c.render();
    if (rgb) drawWaveformRgb(dctx, c.waveformRgb(COLS, ROWS), COLS, ROWS, W, H);
    else drawWaveform(dctx, c.waveform(COLS, ROWS), COLS, ROWS, W, H);
  }, [ready, doc, rgb]);

  return (
    <div style={{ padding: "4px 8px 8px" }}>
      <div className="monet-row" style={{ gap: 6, marginBottom: 4 }}>
        <span className="monet-section-label" style={{ margin: 0 }}>Waveform</span>
        <button
          type="button"
          data-waveform-mode
          onClick={() => setRgb((v) => !v)}
          style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer" }}
        >
          {rgb ? "RGB" : "Luma"}
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
        <canvas
          ref={displayRef}
          width={W}
          height={H}
          data-waveform-canvas
          style={{ width: W, height: H, display: "block", borderRadius: 4 }}
        />
      </div>
    </div>
  );
}
