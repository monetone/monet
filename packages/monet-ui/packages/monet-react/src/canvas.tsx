// ─────────────────────────────────────────────────────────────
// Monet · DesignCanvas — entry (DesignCanvas + DCViewport)
// ─────────────────────────────────────────────────────────────
// A Figma-ish infinite design canvas: warm-gray grid background, reorderable
// artboards grouped into sections, inline-editable labels/titles, a fullscreen
// focus overlay, and pluggable sidecar persistence.
//
// This module owns the stateful wrapper (DesignCanvas) and the transform-based
// pan/zoom viewport (DCViewport), and re-exports the public surface from the
// sibling modules so a single `export * from "./canvas"` covers the whole
// component. Visuals live in @monet-ui/monet-core/canvas.css ("monet-dc-"
// prefix); behaviour + accessibility live here and in the siblings.
//
// Usage:
//   <DesignCanvas>
//     <DCSection id="onboarding" title="Onboarding" subtitle="First-run variants">
//       <DCArtboard id="a" label="A · Dusk" width={260} height={480}>…</DCArtboard>
//       <DCArtboard id="b" label="B · Minimal" width={260} height={480}>…</DCArtboard>
//     </DCSection>
//   </DesignCanvas>

import React from "react";
import { isEditableTarget } from "./internal";
import { DCContext, type DCContextValue } from "./canvas-context";
import {
  dcFlatten,
  defaultDesignCanvasBridge,
  type DesignCanvasProps,
  type DesignCanvasState,
  type DCSectionProps,
  type DCArtboardProps,
} from "./canvas-export";
import { DCSection, DCArtboard } from "./canvas-items";
import {
  DCFocusOverlay,
  type DCSectionMeta,
  type DCFocusEntry,
} from "./canvas-focus";

// ─── public re-exports (the integrator does `export * from "./canvas"`) ──
export {
  dcExport,
  dcFlatten,
  defaultDesignCanvasBridge,
  DC_STATE_FILE,
} from "./canvas-export";
export type {
  DesignCanvasProps,
  DesignCanvasState,
  DesignCanvasPersistedState,
  DesignCanvasBridge,
  DCSectionProps,
  DCSectionState,
  DCArtboardProps,
  DCPostItProps,
  DCExportKind,
} from "./canvas-export";
export { DCSection, DCArtboard, DCPostIt, DCEditable } from "./canvas-items";
export { DCFocusOverlay } from "./canvas-focus";
export type {
  DCSectionMeta,
  DCFocusEntry,
  DCFocusOverlayProps,
} from "./canvas-focus";
export type { DCContextValue } from "./canvas-context";
export { useDCContext } from "./canvas-context";

// ─── DesignCanvas — stateful wrapper around the pan/zoom viewport ──
//
// Owns runtime state (per-section order, renamed titles/labels, hidden
// artboards, focused artboard). Order/titles/labels/hidden persist through the
// pluggable [`DesignCanvasBridge`] (default: fetch-read of the sidecar + an
// optional omelette write). Focus is ephemeral.

/** A Figma-ish design canvas: pan/zoom viewport hosting reorderable sections
 *  of artboards with inline editing, focus mode, and pluggable persistence. */
export function DesignCanvas({
  children,
  minScale,
  maxScale,
  style,
  bridge,
}: DesignCanvasProps) {
  const [state, setState] = React.useState<DesignCanvasState>({
    sections: {},
    focus: null,
  });
  // Hold rendering until the bridge read settles so the saved order/titles
  // appear on first paint (no source-order flash). didRead gates writes until
  // the read settles so the empty initial state can't clobber a slow read;
  // skipNextWrite suppresses the one echo-write that would otherwise follow
  // hydration.
  const [ready, setReady] = React.useState(false);
  const didRead = React.useRef(false);
  const skipNextWrite = React.useRef(false);

  // Resolve the bridge once. A missing prop falls back to the default
  // (fetch-read + omelette-write); an explicit `{}` disables persistence.
  const bridgeRef = React.useRef<ReturnType<typeof defaultDesignCanvasBridge>>();
  if (bridgeRef.current === undefined) {
    bridgeRef.current = bridge ?? defaultDesignCanvasBridge();
  }
  const activeBridge = bridgeRef.current;

  React.useEffect(() => {
    let off = false;
    const settle = () => {
      didRead.current = true;
      if (!off) setReady(true);
    };
    const load = activeBridge.load;
    if (load) {
      Promise.resolve()
        .then(load)
        .then((saved) => {
          if (off || !saved || !saved.sections) return;
          skipNextWrite.current = true;
          setState((s) => ({ ...s, sections: saved.sections }));
        })
        .catch(() => {})
        .finally(settle);
    } else {
      settle();
    }
    // Reveal anyway after a short grace period so a hung read can't block paint.
    const t = setTimeout(() => {
      if (!off) setReady(true);
    }, 150);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [activeBridge]);

  React.useEffect(() => {
    if (!didRead.current) return;
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    const save = activeBridge.save;
    if (!save) return;
    const t = setTimeout(() => {
      Promise.resolve(save({ sections: state.sections })).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [state.sections, activeBridge]);

  // Build registries synchronously from children so FocusOverlay can read them
  // in the same render. Fragments are flattened; wrapping in other elements
  // still opts out of focus/reorder.
  const registry: Record<string, DCFocusEntry> = {};
  const sectionMeta: Record<string, DCSectionMeta> = {};
  const sectionOrder: string[] = [];
  dcFlatten(children).forEach((sec) => {
    if (!React.isValidElement(sec) || sec.type !== DCSection) return;
    const secProps = sec.props as DCSectionProps;
    const sid = (secProps.id ?? secProps.title) as string | undefined;
    if (!sid) return;
    sectionOrder.push(sid);
    const persisted = state.sections[sid] || {};
    const abs: [string, React.ReactElement<DCArtboardProps>][] = [];
    dcFlatten(secProps.children).forEach((ab) => {
      if (!React.isValidElement(ab) || ab.type !== DCArtboard) return;
      const abProps = ab.props as DCArtboardProps;
      const aid = abProps.id ?? abProps.label;
      if (aid) abs.push([aid, ab as React.ReactElement<DCArtboardProps>]);
    });
    // hidden is scoped to one source revision — when the source regenerates
    // (artboard-ID set changes), prior deletes don't apply to new content.
    const srcKey = abs.map(([k]) => k).join("\x1f");
    const hidden = persisted.srcKey === srcKey ? persisted.hidden || [] : [];
    const srcIds: string[] = [];
    abs.forEach(([aid, ab]) => {
      if (hidden.includes(aid)) return;
      registry[`${sid}/${aid}`] = { sectionId: sid, artboard: ab };
      srcIds.push(aid);
    });
    const kept = (persisted.order || []).filter((k) => srcIds.includes(k));
    sectionMeta[sid] = {
      title: persisted.title ?? secProps.title,
      subtitle: secProps.subtitle,
      slotIds: [...kept, ...srcIds.filter((k) => !kept.includes(k))],
    };
  });

  const api = React.useMemo<DCContextValue>(
    () => ({
      state,
      section: (id) => state.sections[id] || {},
      patchSection: (id, p) =>
        setState((s) => ({
          ...s,
          sections: {
            ...s.sections,
            [id]: {
              ...s.sections[id],
              ...(typeof p === "function" ? p(s.sections[id] || {}) : p),
            },
          },
        })),
      setFocus: (slotId) => setState((s) => ({ ...s, focus: slotId })),
    }),
    [state],
  );

  // Esc exits focus; any outside pointerdown commits an in-progress rename.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "Escape") api.setFocus(null);
    };
    const onPd = (e: PointerEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae.isContentEditable && !ae.contains(e.target as Node)) ae.blur();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPd, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPd, true);
    };
  }, [api]);

  return (
    <DCContext.Provider value={api}>
      <DCViewport minScale={minScale} maxScale={maxScale} style={style}>
        {ready && children}
      </DCViewport>
      {state.focus && registry[state.focus] && (
        <DCFocusOverlay
          entry={registry[state.focus]}
          sectionMeta={sectionMeta}
          sectionOrder={sectionOrder}
        />
      )}
    </DCContext.Provider>
  );
}

// ─── DCViewport — transform-based pan/zoom (internal) ───────────
//
// Input mapping (Figma-style):
//   • trackpad pinch  → zoom   (ctrlKey wheel; Safari gesture* events)
//   • trackpad scroll → pan    (two-finger)
//   • mouse wheel     → zoom   (notched; distinguished from trackpad scroll)
//   • middle-drag / primary-drag-on-bg → pan
//
// Transform state lives in a ref and is written straight to the DOM
// (translate3d + will-change) so wheel ticks don't go through React — keeps
// pans at 60fps on dense canvases. The scaled world keeps the same
// scaled-parent contract the dockable engine relies on (it divides pointer
// coords by `getBoundingClientRect().width / offsetWidth`).

interface DCViewportProps {
  children?: React.ReactNode;
  minScale?: number;
  maxScale?: number;
  style?: React.CSSProperties;
}

function DCViewport({
  children,
  minScale = 0.1,
  maxScale = 8,
  style = {},
}: DCViewportProps) {
  const vpRef = React.useRef<HTMLDivElement>(null);
  const worldRef = React.useRef<HTMLDivElement>(null);
  const tf = React.useRef({ x: 0, y: 0, scale: 1 });
  // Persist viewport across reloads so the user lands back where they were.
  // pathname keeps multiple canvas files in one origin apart.
  const tfKey =
    "monet-dc-viewport:" +
    (typeof location !== "undefined" ? location.pathname : "/");
  const saveT = React.useRef<ReturnType<typeof setTimeout>>();

  const lastPostedScale = React.useRef<number | undefined>(undefined);
  const apply = React.useCallback(() => {
    const { x, y, scale } = tf.current;
    const el = worldRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    // Exposed for zoom-invariant chrome (labels, buttons, overlays on cards).
    el.style.setProperty("--dc-inv-zoom", String(1 / scale));
    // Pan/zoom moves the content like a scroll does: fixed overlays anchored
    // inside (an artboard ⋯ menu, a Select's list) re-place themselves on it.
    vpRef.current?.dispatchEvent(new Event("scroll"));
    // Keep a host toolbar's % readout in sync with the canvas scale. Pan ticks
    // leave scale unchanged — skip the cross-frame post for those.
    if (lastPostedScale.current !== scale) {
      lastPostedScale.current = scale;
      try {
        window.parent.postMessage({ type: "__dc_zoom", scale }, "*");
      } catch {
        // cross-origin parent; advisory only
      }
    }
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => {
      try {
        localStorage.setItem(tfKey, JSON.stringify(tf.current));
      } catch {
        // storage may be unavailable (private mode / disabled)
      }
    }, 200);
  }, [tfKey]);

  React.useLayoutEffect(() => {
    const flush = () => {
      clearTimeout(saveT.current);
      try {
        localStorage.setItem(tfKey, JSON.stringify(tf.current));
      } catch {
        // ignore
      }
    };
    try {
      const s = JSON.parse(localStorage.getItem(tfKey) || "null");
      if (s && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.scale)) {
        tf.current = {
          x: s.x,
          y: s.y,
          scale: Math.min(maxScale, Math.max(minScale, s.scale)),
        };
        apply();
      }
    } catch {
      // ignore malformed persisted transform
    }
    // Flush on pagehide and unmount so a reload within the 200ms debounce
    // window doesn't drop the last pan/zoom.
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;

    let isGesturing = false;

    const zoomAt = (cx: number, cy: number, factor: number) => {
      const r = vp.getBoundingClientRect();
      const px = cx - r.left;
      const py = cy - r.top;
      const t = tf.current;
      const next = Math.min(maxScale, Math.max(minScale, t.scale * factor));
      const k = next / t.scale;
      // --dc-inv-zoom consumers (.monet-dc-sectionhead's CSS zoom, each
      // section's marginBottom) reflow on every scale change, vertically
      // shifting the world layout — so a world point mathematically pinned
      // under the cursor drifts. Anchor the DOM element under the cursor
      // instead: record its screen Y, apply the transform, then cancel
      // whatever vertical drift the reflow introduced.
      let marker: Element | null = null;
      let markerY0 = 0;
      if (k !== 1) {
        const hit = document.elementFromPoint(cx, cy);
        marker =
          hit && hit.closest
            ? hit.closest("[data-dc-slot],[data-dc-section]")
            : null;
        if (marker) markerY0 = marker.getBoundingClientRect().top;
      }
      // keep the world point under the cursor fixed
      t.x = px - (px - t.x) * k;
      t.y = py - (py - t.y) * k;
      t.scale = next;
      apply();
      if (marker) {
        // A pure zoom around (cx, cy) maps screen Y → cy + (Y - cy) * k. Any
        // departure after the --dc-inv-zoom reflow is the layout drift.
        const drift = marker.getBoundingClientRect().top - (cy + (markerY0 - cy) * k);
        if (Math.abs(drift) > 0.1) {
          t.y -= drift;
          apply();
        }
      }
    };

    // Mouse-wheel vs trackpad-scroll heuristic. A physical wheel sends
    // line-mode deltas (Firefox) or large integer pixel deltas with no X
    // component (Chrome/Safari). Trackpad two-finger scroll sends
    // small/fractional pixel deltas, often with non-zero deltaX. ctrlKey is set
    // by the browser for trackpad pinch.
    const isMouseWheel = (e: WheelEvent) =>
      e.deltaMode !== 0 ||
      (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (isGesturing) return; // Safari: gesture* owns the pinch
      if ((e.ctrlKey || e.metaKey) && !isMouseWheel(e)) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
      } else if (isMouseWheel(e)) {
        zoomAt(e.clientX, e.clientY, Math.exp(-Math.sign(e.deltaY) * 0.18));
      } else {
        tf.current.x -= e.deltaX;
        tf.current.y -= e.deltaY;
        apply();
      }
    };

    // Safari sends native gesture* events for trackpad pinch with a smooth
    // e.scale; preferring these over the ctrl+wheel fallback gives a much
    // better feel there. No-ops on other browsers.
    let gsBase = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      isGesturing = true;
      gsBase = tf.current.scale;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      zoomAt(ge.clientX, ge.clientY, (gsBase * ge.scale) / tf.current.scale);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      isGesturing = false;
    };

    // Drag-pan: middle button anywhere, or primary button on canvas background
    // (anything that isn't an artboard or an inline editor).
    let drag: { id: number; lx: number; ly: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element;
      const onBg = !target.closest("[data-dc-slot], .monet-dc-editable");
      if (!(e.button === 1 || (e.button === 0 && onBg))) return;
      e.preventDefault();
      vp.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
      vp.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      tf.current.x += e.clientX - drag.lx;
      tf.current.y += e.clientY - drag.ly;
      drag.lx = e.clientX;
      drag.ly = e.clientY;
      apply();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      vp.releasePointerCapture(e.pointerId);
      drag = null;
      vp.style.cursor = "";
    };

    // Host-driven zoom (toolbar % menu). Zooms around viewport centre so the
    // visible midpoint stays fixed — matching a host's iframe-zoom feel.
    const onHostMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.type === "__dc_set_zoom" && typeof d.scale === "number") {
        const r = vp.getBoundingClientRect();
        zoomAt(r.left + r.width / 2, r.top + r.height / 2, d.scale / tf.current.scale);
      } else if (d && d.type === "__dc_probe") {
        // A host's reset asks whether a canvas is present; re-announce and
        // clear the pan-tick guard so apply() re-posts the current scale.
        try {
          window.parent.postMessage({ type: "__dc_present" }, "*");
        } catch {
          /* cross-origin */
        }
        lastPostedScale.current = undefined;
        apply();
      }
    };
    window.addEventListener("message", onHostMsg);
    // Announce canvas mode so a host toolbar proxies its % control here instead
    // of scaling the iframe element. The apply() that follows emits the initial
    // __dc_zoom so the toolbar % is correct before first pinch.
    try {
      window.parent.postMessage({ type: "__dc_present" }, "*");
    } catch {
      /* cross-origin */
    }
    lastPostedScale.current = undefined;
    apply();

    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    vp.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    vp.addEventListener("gestureend", onGestureEnd as EventListener, { passive: false });
    vp.addEventListener("pointerdown", onPointerDown);
    vp.addEventListener("pointermove", onPointerMove);
    vp.addEventListener("pointerup", onPointerUp);
    vp.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("message", onHostMsg);
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("gesturestart", onGestureStart as EventListener);
      vp.removeEventListener("gesturechange", onGestureChange as EventListener);
      vp.removeEventListener("gestureend", onGestureEnd as EventListener);
      vp.removeEventListener("pointerdown", onPointerDown);
      vp.removeEventListener("pointermove", onPointerMove);
      vp.removeEventListener("pointerup", onPointerUp);
      vp.removeEventListener("pointercancel", onPointerUp);
    };
  }, [apply, minScale, maxScale]);

  return (
    <div ref={vpRef} className="monet-dc-viewport" style={style}>
      <div ref={worldRef} className="monet-dc-world">
        <div className="monet-dc-grid" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
