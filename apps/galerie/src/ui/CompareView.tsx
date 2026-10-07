// CompareView — LR's Compare (C): a pinned "Select" beside a "Candidate", for
// A/B culling. The Select stays put while ←/→ flip the Candidate through the
// set (store.moveCompareCandidate); ⇄ swaps the two; "Make Select" promotes the
// Candidate. Clicking either pane toggles a SYNCED Fit ↔ 1:1 zoom: one shared
// normalized focal point drives both panes' transforms (each derives its own
// pan from its natural size via panForFocus), and dragging while zoomed pans
// both together — Lightroom's linked compare zoom. Each pane carries a mini
// cull bar (flag + rating) so A/B decisions land without leaving the view.

import { useEffect, useRef, useState } from "react";

import type { PhotoRow } from "../catalog/types";
import { centerPan, fitScale, panForFocus } from "../lib/loupeZoom";
import { store, useCatalog } from "../state/store";
import { basename } from "./GridCell";
import { PreviewImg } from "./PreviewImg";

const COMPARE_EDGE = 2048;
const ZOOM_SCALE = 1; // 1:1 preview pixels, matching the Loupe's detail zoom

/** The shared focal point (normalized to the image), or null = both panes fit. */
type Focus = { nx: number; ny: number } | null;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function CullBar({ photo }: { photo: PhotoRow }) {
  return (
    <div className="gal-compare-cull">
      <button
        className={"gal-filter-flag is-pick" + (photo.flag === 1 ? " is-sel" : "")}
        title="Pick"
        onClick={() => void store.cull(photo.id, photo.rating, photo.flag === 1 ? 0 : 1, photo.colorLabel)}
      >
        ⚑
      </button>
      <button
        className={"gal-filter-flag is-reject" + (photo.flag === -1 ? " is-sel" : "")}
        title="Reject"
        onClick={() => void store.cull(photo.id, photo.rating, photo.flag === -1 ? 0 : -1, photo.colorLabel)}
      >
        ⚑
      </button>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={"gal-compare-star" + (photo.rating >= n ? " is-sel" : "")}
          title={`Rate ${n}`}
          onClick={() => void store.cull(photo.id, photo.rating === n ? 0 : n, photo.flag, photo.colorLabel)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function ComparePane({
  photo,
  tag,
  focus,
  onFocus,
  onPromote,
}: {
  photo: PhotoRow;
  tag: string;
  focus: Focus;
  onFocus: (f: Focus) => void;
  /** Present on the Candidate: promote it to Select. */
  onPromote?: () => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; nx: number; ny: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // A new photo in this pane invalidates its natural size (the shared focus
  // stays — LR keeps the zoom while candidates flip).
  useEffect(() => setNat(null), [photo.id, photo.readPath]);

  const ready = nat != null && nat.w > 0 && view.w > 0 && view.h > 0;
  const zoomed = focus != null && ready;
  const pan = zoomed ? panForFocus(focus.nx, focus.ny, nat.w, nat.h, ZOOM_SCALE, view.w, view.h) : null;

  // Map a click in the fitted view to normalized image coordinates.
  const focusAt = (clientX: number, clientY: number): Focus => {
    if (!ready) return null;
    const r = boxRef.current!.getBoundingClientRect();
    const sFit = fitScale(nat.w, nat.h, view.w, view.h);
    const fp = centerPan(nat.w, nat.h, sFit, view.w, view.h);
    const nx = (clientX - r.left - fp.x) / (nat.w * sFit);
    const ny = (clientY - r.top - fp.y) / (nat.h * sFit);
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null; // letterbox click
    return { nx, ny };
  };

  return (
    <div className="gal-compare-pane">
      <div
        ref={boxRef}
        className={"gal-compare-box" + (zoomed ? " is-zoomed" : "")}
        onPointerDown={(e) => {
          if (!zoomed || focus == null) return;
          dragRef.current = { sx: e.clientX, sy: e.clientY, nx: focus.nx, ny: focus.ny };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d || !ready) return;
          // Dragging moves the shared focal point (both panes follow).
          onFocus({
            nx: clamp01(d.nx - (e.clientX - d.sx) / (nat.w * ZOOM_SCALE)),
            ny: clamp01(d.ny - (e.clientY - d.sy) / (nat.h * ZOOM_SCALE)),
          });
        }}
        onPointerUp={(e) => {
          const d = dragRef.current;
          dragRef.current = null;
          // A still click (no meaningful drag) toggles the zoom off.
          if (d && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 4) onFocus(null);
        }}
        onClick={(e) => {
          if (zoomed) return; // handled by the pointer-up toggle
          const f = focusAt(e.clientX, e.clientY);
          if (f) onFocus(f);
        }}
      >
        <PreviewImg
          photo={photo}
          edge={COMPARE_EDGE}
          className={"gal-compare-img" + (zoomed ? " is-zoomed" : "")}
          style={zoomed && pan ? { transform: `translate(${pan.x}px, ${pan.y}px) scale(${ZOOM_SCALE})` } : undefined}
          onLoad={(w, h) => setNat({ w, h })}
        />
      </div>
      <div className="gal-compare-tag">
        {tag} · {basename(photo.path)}
        {onPromote && (
          <button className="gal-filter-btn" title="Promote to Select" onClick={onPromote}>
            Make Select
          </button>
        )}
      </div>
      <CullBar photo={photo} />
    </div>
  );
}

export function CompareView() {
  const st = useCatalog();
  const [focus, setFocus] = useState<Focus>(null);
  const selIdx = st.activeId != null ? st.photos.findIndex((p) => p.id === st.activeId) : -1;
  const select = selIdx >= 0 ? st.photos[selIdx] : undefined;

  // Prefer the pinned Candidate; if it fell out of the buffer (a cull/remove),
  // fall back to the Select's neighbour so the pane is never blank mid-session.
  let candidate: PhotoRow | undefined =
    st.compareCandidateId != null ? st.photos.find((p) => p.id === st.compareCandidateId) : undefined;
  if (!candidate && selIdx >= 0) candidate = st.photos[selIdx + 1] ?? st.photos[selIdx - 1];

  if (!select) {
    return (
      <div className="gal-empty">
        <div className="gal-empty-title">Nothing to compare</div>
        <div className="gal-empty-sub">Select a photo, then press C.</div>
      </div>
    );
  }

  return (
    <div className="gal-compare">
      <ComparePane photo={select} tag="Select" focus={focus} onFocus={setFocus} />
      <button
        className="gal-compare-swap"
        title="Swap Select and Candidate"
        disabled={!candidate}
        onClick={() => store.swapCompare()}
      >
        ⇄
      </button>
      {candidate ? (
        <ComparePane
          photo={candidate}
          tag="Candidate"
          focus={focus}
          onFocus={setFocus}
          onPromote={() => store.makeCompareSelect(candidate!.id)}
        />
      ) : (
        <div className="gal-compare-pane gal-compare-empty">End of the set</div>
      )}
    </div>
  );
}
