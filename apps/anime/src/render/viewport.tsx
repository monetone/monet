// ─────────────────────────────────────────────────────────────
// render/viewport — the composition viewport. Composites the active comp's
// layers (sampled at the current playhead) as CSS-transformed DOM elements
// inside a comp-sized stage scaled to fit. Same evaluator as playback, so the
// preview is WYSIWYG. Click-to-select; drag a selected layer to move it.
// ─────────────────────────────────────────────────────────────

import { useLayoutEffect, useRef, useState } from "react";
import { selectLayer, setTransformValue } from "../commands";
import { activeComp } from "../model/query";
import { effectiveTransform, layerLive } from "../model/sample";
import type { BlendMode, Effect, Layer } from "../model/types";
import { store, useEditor } from "../state/store";

function cssBlend(mode: BlendMode): string | undefined {
  if (mode === "normal") return undefined;
  if (mode === "add") return "screen"; // closest widely-supported mix-blend-mode
  return mode;
}

function effectsFilter(effects: Effect[]): string | undefined {
  const parts: string[] = [];
  for (const fx of effects) {
    if (!fx.enabled) continue;
    switch (fx.kind) {
      case "blur":
        parts.push(`blur(${fx.params.radius ?? 0}px)`);
        break;
      case "brightness":
        parts.push(`brightness(${fx.params.amount ?? 100}%)`);
        break;
      case "glow":
        parts.push(`drop-shadow(0 0 ${fx.params.radius ?? 0}px currentColor)`);
        break;
      case "dropShadow": {
        const d = fx.params.distance ?? 0;
        const a = ((fx.params.angle ?? 135) * Math.PI) / 180;
        parts.push(`drop-shadow(${Math.round(Math.cos(a) * d)}px ${Math.round(Math.sin(a) * d)}px ${fx.params.blur ?? 0}px rgba(0,0,0,0.6))`);
        break;
      }
      case "tint":
        parts.push(`saturate(${Math.max(0, 100 - (fx.params.amount ?? 0))}%) hue-rotate(${fx.params.hue ?? 0}deg)`);
        break;
    }
  }
  return parts.length ? parts.join(" ") : undefined;
}

function LayerContent({ layer }: { layer: Layer }) {
  const base: React.CSSProperties = { width: layer.width, height: layer.height, color: layer.color };
  switch (layer.kind) {
    case "text":
      return (
        <div
          style={{
            ...base,
            display: "flex",
            alignItems: "center",
            justifyContent: layer.align === "left" ? "flex-start" : layer.align === "right" ? "flex-end" : "center",
            fontFamily: layer.fontFamily ?? "Inter, system-ui, sans-serif",
            fontSize: layer.fontSize ?? 96,
            fontWeight: 700,
            lineHeight: 1.05,
            whiteSpace: "pre",
            textAlign: layer.align ?? "center",
          }}
        >
          {layer.text}
        </div>
      );
    case "image":
      return layer.src ? <img src={layer.src} style={{ ...base, objectFit: "cover", display: "block" }} alt="" draggable={false} /> : <div style={{ ...base, background: layer.color }} />;
    case "shape":
      return <div style={{ ...base, background: layer.color, borderRadius: layer.shape === "ellipse" ? "50%" : 0 }} />;
    case "null":
      return <div style={{ ...base, outline: "1px dashed rgba(255,255,255,0.3)" }} />;
    default: // solid
      return <div style={{ ...base, background: layer.color }} />;
  }
}

export function Viewport() {
  const { project, playhead, selection, pixelsPerSecond: _pps } = useEditor();
  const comp = activeComp(project);
  const areaRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.4);
  const drag = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(null);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const recompute = () => {
      const pad = 48;
      const aw = el.clientWidth - pad;
      const ah = el.clientHeight - pad;
      setFit(Math.max(0.05, Math.min(aw / comp.width, ah / comp.height)));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [comp.width, comp.height]);

  const onLayerDown = (e: React.PointerEvent, layer: Layer) => {
    e.stopPropagation();
    selectLayer(layer.id, e.shiftKey);
    if (layer.locked) return;
    const xf = effectiveTransform(layer, playhead);
    drag.current = { id: layer.id, startX: e.clientX, startY: e.clientY, ox: xf.x, oy: xf.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / fit;
    const dy = (e.clientY - d.startY) / fit;
    setTransformValue(d.id, "x", Math.round(d.ox + dx));
    setTransformValue(d.id, "y", Math.round(d.oy + dy));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // index 0 = front; paint back→front so the topmost layer renders last (on top).
  const painted = [...comp.layers].reverse();

  return (
    <div
      ref={areaRef}
      className="anime-viewport"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerDown={() => store.setSelection([])}
    >
      <div
        className="anime-stage"
        style={{ width: comp.width, height: comp.height, background: comp.background, transform: `scale(${fit})` }}
      >
        {painted.map((layer) =>
          layerLive(layer, playhead) ? (
            <div
              key={layer.id}
              onPointerDown={(e) => onLayerDown(e, layer)}
              style={(() => {
                const xf = effectiveTransform(layer, playhead);
                return {
                  position: "absolute",
                  left: 0,
                  top: 0,
                  transformOrigin: "0 0",
                  transform: `translate(${xf.x}px, ${xf.y}px) rotate(${xf.rotation}deg) scale(${xf.scaleX / 100}, ${xf.scaleY / 100}) translate(${-xf.anchorX}px, ${-xf.anchorY}px)`,
                  opacity: xf.opacity / 100,
                  mixBlendMode: cssBlend(layer.blendMode) as React.CSSProperties["mixBlendMode"],
                  filter: effectsFilter(layer.effects),
                  outline: selection.includes(layer.id) ? "1.5px solid var(--accent-motion, #e64980)" : undefined,
                  outlineOffset: 0,
                  cursor: layer.locked ? "default" : "move",
                } as React.CSSProperties;
              })()}
            >
              <LayerContent layer={layer} />
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
