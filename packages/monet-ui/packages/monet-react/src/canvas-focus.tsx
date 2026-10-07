// ─────────────────────────────────────────────────────────────
// Monet · DesignCanvas — fullscreen focus overlay
// ─────────────────────────────────────────────────────────────
// Opens one artboard fullscreen over a dimmed backdrop with section + index
// navigation. Behaviour + accessibility only (visuals in canvas.css):
//   • ←/→ step within the section, ↑/↓ step across non-empty sections,
//   • Esc or a backdrop click exits,
//   • focus is trapped inside the overlay and restored on close (useFocusTrap),
//   • role="dialog" aria-modal, labelled by the section title.

import React from "react";
import { Portal, useFocusTrap, useMonetId } from "./overlay-core";
import { useDCContext } from "./canvas-context";
import type { DCArtboardProps } from "./canvas-export";
import { isEditableTarget } from "./internal";

/** Per-section metadata the overlay needs for cross-section navigation. */
export interface DCSectionMeta {
  title?: string;
  subtitle?: string;
  /** Visible slot ids in display order. */
  slotIds: string[];
}

/** The focused registry entry: which section + the artboard element. */
export interface DCFocusEntry {
  sectionId: string;
  artboard: React.ReactElement<DCArtboardProps>;
}

/** (#182) Stable handler so the surface ref callback can unbind it. */
const noWheel = (e: WheelEvent) => e.preventDefault();

export interface DCFocusOverlayProps {
  entry: DCFocusEntry;
  sectionMeta: Record<string, DCSectionMeta>;
  sectionOrder: string[];
}

/** Fullscreen focus mode — overlay one artboard; ←/→ within section, ↑/↓
 *  across sections, Esc or backdrop click to exit. Portaled to body so its
 *  fixed positioning is the real viewport regardless of any ancestor transform
 *  (including the canvas zoom). */
export function DCFocusOverlay({ entry, sectionMeta, sectionOrder }: DCFocusOverlayProps) {
  const ctx = useDCContext();
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = useMonetId("monet-dc-focus-title");
  useFocusTrap(surfaceRef, { active: true });

  const { sectionId, artboard } = entry;
  const sec = ctx?.section(sectionId) ?? {};
  const meta = sectionMeta[sectionId];
  const peers = meta.slotIds;
  const aid = (artboard.props.id ?? artboard.props.label) as string;
  const idx = peers.indexOf(aid);
  const secIdx = sectionOrder.indexOf(sectionId);

  const go = (d: number) => {
    const n = peers[(idx + d + peers.length) % peers.length];
    if (n) ctx?.setFocus(`${sectionId}/${n}`);
  };
  const goSection = (d: number) => {
    // Sections whose artboards are all deleted have slotIds:[] — step past them
    // to the next non-empty section so ↑/↓ doesn't dead-end.
    const n = sectionOrder.length;
    for (let i = 1; i < n; i++) {
      const ns = sectionOrder[(((secIdx + d * i) % n) + n) % n];
      const first = sectionMeta[ns] && sectionMeta[ns].slotIds[0];
      if (first) {
        ctx?.setFocus(`${ns}/${first}`);
        return;
      }
    }
  };

  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // (#181) Never hijack keys typed into a field inside the focused artboard
      // — the overlay renders arbitrary children, so ←/→ must stay caret motion
      // and Esc must reach the field (same guard as DCViewport in canvas.tsx).
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goSection(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        goSection(1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        ctx?.setFocus(null);
      }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  });

  const { width = 260, height = 480, children } = artboard.props;
  const [vp, setVp] = React.useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1280,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
  React.useEffect(() => {
    const r = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);
  const scale = Math.max(
    0.1,
    Math.min((vp.w - 200) / width, (vp.h - 260) / height, 2),
  );

  // (#182) Suppress background scroll/zoom behind the modal with a NATIVE
  // non-passive listener: React binds `wheel` at the root with {passive:true},
  // so an onWheel={e => e.preventDefault()} is silently a no-op. Bound from the
  // ref callback because <Portal> mounts the surface on ITS own re-render, so
  // this component's effects have all run (with a null ref) by then.
  const setSurface = React.useCallback((el: HTMLDivElement | null) => {
    surfaceRef.current?.removeEventListener("wheel", noWheel);
    surfaceRef.current = el;
    el?.addEventListener("wheel", noWheel, { passive: false });
  }, []);

  const [ddOpen, setDd] = React.useState(false);

  const Arrow = ({ dir, onClick }: { dir: "left" | "right"; onClick: () => void }) => (
    <button
      type="button"
      className="monet-dc-focus-arrow"
      data-dir={dir}
      aria-label={dir === "left" ? "Previous artboard" : "Next artboard"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d={dir === "left" ? "M11 3L5 9l6 6" : "M7 3l6 6-6 6"} />
      </svg>
    </button>
  );

  const sections = sectionOrder.filter((sid) => sectionMeta[sid].slotIds.length);

  return (
    <Portal>
      <div
        ref={setSurface}
        className="monet-dc-focus"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={() => ctx?.setFocus(null)}
      >
        {/* top bar: section dropdown (left) · close (right) */}
        <div className="monet-dc-focus-bar" onClick={(e) => e.stopPropagation()}>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="monet-dc-focus-sectionbtn"
              aria-haspopup="listbox"
              aria-expanded={ddOpen}
              onClick={() => setDd((o) => !o)}
            >
              <span className="monet-dc-focus-sectiontitle">
                <span id={titleId} style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.3 }}>
                  {meta.title}
                </span>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" style={{ opacity: 0.7 }} aria-hidden="true">
                  <path d="M2 4l3.5 3.5L9 4" />
                </svg>
              </span>
              {meta.subtitle && (
                <span className="monet-dc-focus-sectionsub">{meta.subtitle}</span>
              )}
            </button>
            {ddOpen && (
              <div className="monet-dc-focus-dropdown" role="listbox" aria-label="Sections">
                {sections.map((sid) => (
                  <button
                    type="button"
                    key={sid}
                    role="option"
                    aria-selected={sid === sectionId}
                    className="monet-dc-focus-option"
                    data-current={sid === sectionId || undefined}
                    onClick={() => {
                      setDd(false);
                      const f = sectionMeta[sid].slotIds[0];
                      if (f) ctx?.setFocus(`${sid}/${f}`);
                    }}
                  >
                    {sectionMeta[sid].title}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="monet-dc-focus-close"
            aria-label="Close focus view"
            onClick={() => ctx?.setFocus(null)}
          >
            ×
          </button>
        </div>

        {/* card centered, label + index below — only the card itself stops
            propagation so any backdrop click (including the margins around the
            card) exits focus */}
        <div className="monet-dc-focus-stage">
          <div
            className="monet-dc-focus-cardwrap"
            onClick={(e) => e.stopPropagation()}
            style={{ width: width * scale, height: height * scale }}
          >
            <div
              className="monet-dc-focus-card"
              style={{ width, height, transform: `scale(${scale})` }}
            >
              {children || <div className="monet-dc-focus-placeholder">{aid}</div>}
            </div>
          </div>
          <div className="monet-dc-focus-caption" onClick={(e) => e.stopPropagation()}>
            {(sec.labels || {})[aid] ?? artboard.props.label}
            <span className="monet-dc-focus-index">
              {idx + 1} / {peers.length}
            </span>
          </div>
        </div>

        <Arrow dir="left" onClick={() => go(-1)} />
        <Arrow dir="right" onClick={() => go(1)} />

        {/* dots */}
        <div className="monet-dc-focus-dots" onClick={(e) => e.stopPropagation()}>
          {peers.map((p, i) => (
            <button
              type="button"
              key={p}
              className="monet-dc-focus-dot"
              data-active={i === idx || undefined}
              aria-label={`Go to artboard ${i + 1}`}
              aria-current={i === idx ? "true" : undefined}
              onClick={() => ctx?.setFocus(`${sectionId}/${p}`)}
            />
          ))}
        </div>
      </div>
    </Portal>
  );
}
