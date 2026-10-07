// Filmstrip — a horizontal strip of the loaded photos along the bottom dock.
// Clicking makes a photo active (Loupe/Develop target). Horizontally windowed:
// only cells in (and near) the viewport are mounted, so a large loaded set
// neither mounts thousands of <img> nor lets the thumbnail LRU evict a blob out
// from under a visible cell. Thumbnails load lazily + concurrency-gated.

import { useCallback, useEffect, useRef, useState } from "react";

import type { PhotoRow } from "../catalog/types";
import { computeGridWindow } from "../lib/grid";
import { dragPayloadIds, writePhotoDrag } from "../lib/photoDrag";
import { store, useCatalog } from "../state/store";
import { basename } from "./GridCell";
import { PhotoContextMenu, retargetOnContextMenu } from "./PhotoContextMenu";
import { hasBadges, photoBadges } from "./photoBadges";
import { useThumbnail } from "./useThumbnail";

const FILM_EDGE = 128;
const GAP = 6; // matches .gal-filmstrip `gap`
const PAD = 8; // matches .gal-filmstrip `padding`
const OVERSCAN = 4;

// Flag / rating / colour-label badges overlaid on a filmstrip thumbnail (LR shows
// these on the strip too). Nothing to draw → no overlay.
function FilmBadges({ photo }: { photo: PhotoRow }) {
  const b = photoBadges(photo);
  if (!hasBadges(b)) return null;
  return (
    <div className="gal-film-badges">
      {b.flag === 1 && <span className="gal-flag is-pick">⚑</span>}
      {b.flag === -1 && <span className="gal-flag is-reject">⚑</span>}
      {b.rating > 0 && <span className="gal-stars">{"★".repeat(b.rating)}</span>}
      {b.labelColor && <span className="gal-label" style={{ background: b.labelColor }} />}
    </div>
  );
}

function FilmCell({ photo, active }: { photo: PhotoRow; active: boolean }) {
  const url = useThumbnail(photo, FILM_EDGE);
  return (
    <div
      className={"gal-film-cell" + (active ? " is-active" : "")}
      onClick={() => store.setActive(photo.id)}
      // LR: right-click outside the selection retargets before the menu opens.
      onContextMenu={() => retargetOnContextMenu(photo.id)}
      // Drag onto a Collections row adds the selection (or just this photo).
      draggable
      onDragStart={(e) => writePhotoDrag(e.dataTransfer, dragPayloadIds(store.getState().selection, photo.id))}
      title={basename(photo.path)}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <div className="gal-cell-spinner" />}
      <FilmBadges photo={photo} />
    </div>
  );
}

export function Filmstrip() {
  const st = useCatalog();
  const elRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    elRef.current = el;
    if (!el) {
      roRef.current = null;
      return;
    }
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
    measure();
  }, []);

  // Cell width is height-derived (aspect-ratio 3/2, height:100%); measure the
  // strip and derive the row-to-row stride. Approximate to a few px (the flex
  // `gap` sits around the spacers too) — OVERSCAN absorbs the drift.
  // ponytail: pitch from measured height, not a hard-coded cell width.
  const cellW = Math.max(1, (size.h - PAD * 2) * 1.5);
  const pitch = cellW + GAP;
  const win = computeGridWindow(scrollLeft, size.w, pitch, 1, st.photos.length, OVERSCAN);

  // Keep the active photo in view — windowing unmounts off-screen cells, so a
  // culling/arrow move that changes `activeId` must pull the strip along.
  const activeId = st.activeId;
  useEffect(() => {
    const el = elRef.current;
    if (!el || activeId == null || size.w === 0) return;
    const idx = st.photos.findIndex((p) => p.id === activeId);
    if (idx < 0) return;
    const left = idx * pitch;
    const right = left + cellW;
    if (left < el.scrollLeft) el.scrollLeft = Math.max(0, left - GAP);
    else if (right > el.scrollLeft + size.w) el.scrollLeft = right - size.w + GAP;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- photos read fresh via activeId re-render
  }, [activeId, size.w, size.h]);

  if (st.photos.length === 0) {
    return <div className="gal-film-empty">No photos</div>;
  }

  const visible = st.photos.slice(win.startIndex, win.endIndex);
  return (
    // gal-ctx-fill keeps the wrapper's height definite so the strip's
    // height:100% chain survives the extra div.
    <PhotoContextMenu className="gal-ctx-fill">
      <div
        ref={measureRef}
        className="gal-filmstrip"
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
      >
        <div style={{ flex: "none", width: win.padTop }} />
        {visible.map((p) => (
          <FilmCell key={p.id} photo={p} active={st.activeId === p.id} />
        ))}
        <div style={{ flex: "none", width: win.padBottom }} />
      </div>
    </PhotoContextMenu>
  );
}
