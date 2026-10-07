// Creative viewport / canvas gallery demos — one openable panel per widget in
// the "monet-cv-" viewport family (CanvasRuler, ZoomControl, Navigator, Marquee,
// GridGuides). Interactive widgets (ZoomControl / Navigator) are wrapped in a
// useState demo so the controls actually drive their mocked host state; the
// presentational widgets (CanvasRuler / Marquee / GridGuides) get mock data.
// Each demo is sized to sit inside a ~300×250 floating panel.
import { useState } from "react";
import {
  CanvasRuler,
  ZoomControl,
  Navigator,
  Marquee,
  GridGuides,
  type ViewportRect,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

// ─── CanvasRuler ───────────────────────────────────────────────
// Presentational: a horizontal + vertical ruler pair framing a mock canvas
// corner, with a cursor line on each tracking a fixed mock pointer position.
function CanvasRulerDemo() {
  const cursorX = 640; // px-unit position the horizontal cursor follows
  const cursorY = 360;
  return (
    <div style={{ padding: 8, display: "grid", gap: 8 }}>
      <CanvasRuler
        end={1280}
        pixelsPerUnit={0.2}
        unit="px"
        cursor={cursorX}
      />
      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <CanvasRuler
          orientation="vertical"
          end={720}
          pixelsPerUnit={0.2}
          unit="px"
          cursor={cursorY}
        />
        <div
          style={{
            flex: 1,
            minHeight: 144,
            borderRadius: 4,
            background:
              "repeating-conic-gradient(rgba(255,255,255,0.05) 0% 25%, transparent 0% 50%) 0 / 16px 16px",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        />
      </div>
    </div>
  );
}

// ─── ZoomControl ───────────────────────────────────────────────
// Controlled: − / + and the % readout drive `zoom`; presets quick-pick it and
// Fit snaps back to 100%. The mock canvas scales to mirror the live zoom.
function ZoomControlDemo() {
  const [zoom, setZoom] = useState(1);
  return (
    <div style={{ padding: 8, display: "grid", gap: 10, justifyItems: "start" }}>
      <ZoomControl
        value={zoom}
        onChange={setZoom}
        presets={[0.25, 0.5, 1, 2, 4]}
        onFit={() => setZoom(1)}
        accent="var(--accent-raster)"
      />
      <div
        style={{
          width: "100%",
          height: 120,
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          borderRadius: 4,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 6,
            background: "linear-gradient(135deg, #4aa6b0, #d6884a)",
            transform: `scale(${zoom})`,
            transition: "transform 120ms ease",
          }}
        />
      </div>
    </div>
  );
}

// ─── Navigator ─────────────────────────────────────────────────
// Controlled minimap: drag the inset marquee (or arrow-key it) to pan, and the
// zoom row's slider drives `zoom`. The preview is a mock document thumbnail.
function NavigatorDemo() {
  const [viewport, setViewport] = useState<ViewportRect>({
    x: 0.2,
    y: 0.18,
    w: 0.45,
    h: 0.4,
  });
  const [zoom, setZoom] = useState(1.5);
  const preview = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "radial-gradient(circle at 30% 30%, #d6884a 0%, transparent 45%), radial-gradient(circle at 70% 70%, #4aa6b0 0%, transparent 50%), #1c2024",
      }}
    />
  );
  return (
    <div style={{ padding: 8 }}>
      <Navigator
        preview={preview}
        viewport={viewport}
        onViewportChange={setViewport}
        zoom={zoom}
        onZoomChange={setZoom}
        accent="var(--accent-raster)"
      />
    </div>
  );
}

// ─── Marquee ───────────────────────────────────────────────────
// Presentational: a marching-ants selection rectangle over a mock canvas. The
// host must be position:relative so the marquee positions from its top-left.
function MarqueeDemo() {
  const rect = { x: 36, y: 28, w: 180, h: 110 };
  return (
    <div style={{ padding: 8 }}>
      <div
        style={{
          position: "relative",
          height: 180,
          borderRadius: 4,
          overflow: "hidden",
          background:
            "repeating-conic-gradient(rgba(255,255,255,0.05) 0% 25%, transparent 0% 50%) 0 / 16px 16px",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <Marquee
          rect={rect}
          label={`${rect.w} × ${rect.h}`}
          accent="var(--accent-raster)"
        />
      </div>
    </div>
  );
}

// ─── GridGuides ────────────────────────────────────────────────
// Presentational overlay: a background grid + subdivisions with two accent
// guide lines. Lives as the last child of a position:relative canvas surface.
function GridGuidesDemo() {
  return (
    <div style={{ padding: 8 }}>
      <div
        style={{
          position: "relative",
          height: 180,
          borderRadius: 4,
          overflow: "hidden",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <GridGuides
          gridSize={32}
          subdivisions={3}
          guides={[
            { axis: "x", pos: 96 },
            { axis: "x", pos: 192 },
            { axis: "y", pos: 90 },
          ]}
          accent="var(--accent-vector)"
        />
      </div>
    </div>
  );
}

export const viewportEntries: GalleryEntry[] = [
  {
    id: "viewport/CanvasRuler",
    label: "CanvasRuler",
    category: "Viewport",
    section: "Creative",
    render: () => <CanvasRulerDemo />,
    flush: true,
  },
  {
    id: "viewport/ZoomControl",
    label: "ZoomControl",
    category: "Viewport",
    section: "Creative",
    render: () => <ZoomControlDemo />,
  },
  {
    id: "viewport/Navigator",
    label: "Navigator",
    category: "Viewport",
    section: "Creative",
    render: () => <NavigatorDemo />,
  },
  {
    id: "viewport/Marquee",
    label: "Marquee",
    category: "Viewport",
    section: "Creative",
    render: () => <MarqueeDemo />,
    flush: true,
  },
  {
    id: "viewport/GridGuides",
    label: "GridGuides",
    category: "Viewport",
    section: "Creative",
    render: () => <GridGuidesDemo />,
    flush: true,
  },
];
