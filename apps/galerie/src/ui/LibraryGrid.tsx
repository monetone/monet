// LibraryGrid — the virtualized Library grid. Only cells in (and near) the
// viewport are mounted; spacers preserve the scrollbar for the full catalog.
// Scrolling near the end pages the next batch from the catalog.

import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { columnCount, computeGridWindow } from "../lib/grid";
import { dragPayloadIds, writePhotoDrag } from "../lib/photoDrag";
import { store, useCatalog } from "../state/store";
import { GridCell } from "./GridCell";
import { PhotoContextMenu, retargetOnContextMenu } from "./PhotoContextMenu";

/** Pick a replacement file for a missing source and relink it. */
async function relinkSource(sourceAssetId: number): Promise<void> {
  const picked = await open({ multiple: false, directory: false, title: "Relink Missing Photo" });
  if (typeof picked === "string") await store.relinkPhoto(sourceAssetId, picked);
}

const GAP = 12;
const CELL_META = 30; // meta bar height under each thumbnail
const THUMB_EDGE = 256; // decode target for grid thumbnails

function EmptyState({ available, error }: { available: boolean; error: string | null }) {
  return (
    <div className="gal-empty">
      {!available ? (
        <>
          <div className="gal-empty-title">Catalog unavailable</div>
          <div className="gal-empty-sub">Run the desktop app to browse a catalog.</div>
        </>
      ) : (
        <>
          <div className="gal-empty-title">Import photos to begin your catalog</div>
          <div className="gal-empty-sub">File ▸ Import Photos… (⇧⌘I)</div>
        </>
      )}
      {error && <div className="gal-empty-err">{error}</div>}
    </div>
  );
}

export function LibraryGrid() {
  const st = useCatalog();
  // Thumbnail box width (Lightroom's Thumbnails size) — a persisted view pref.
  const CELL = st.gridCellSize;
  // LR's J cycle: clean cells drop the meta bar, expanded cells add a second line.
  const metaH = st.gridStyle === "clean" ? 0 : st.gridStyle === "expanded" ? CELL_META * 2 : CELL_META;
  const ROW_H = CELL + metaH; // thumbnail + meta bar
  const ROW_PITCH = ROW_H + GAP; // row-to-row stride (CSS grid `gap` sits between rows)
  const [scrollTop, setScrollTop] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const roRef = useRef<ResizeObserver | null>(null);
  // One paint per photo per drag gesture: without this, dragging out of and
  // back into a cell would toggle the payload straight back off.
  const paintedRef = useRef<Set<number>>(new Set());

  // Ref callback (not a mount-only effect): the scroll node is conditionally
  // rendered, so it can remount when the grid goes empty→populated. Attaching the
  // observer here re-measures every mount; a `[]` effect would miss the remount
  // and leave `size` stale at {0,0}, collapsing the window.
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
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

  const cols = columnCount(size.w - GAP * 2, CELL, GAP);
  // The buffer is a bounded window [photosStart, photosStart+length) over the
  // filtered set — the grid maps its absolute window indices into it.
  const loadedStart = st.photosStart;
  const loadedEnd = loadedStart + st.photos.length;
  // Size the scroll area by the full filtered set, not the loaded window — the
  // scrollbar must be proportional to a 100k catalog so dragging it is random
  // access. Once the keyset is exhausted the loaded extent is the truth (a stale
  // count can't leave dead placeholder cells).
  const gridCount = st.hasMore ? Math.max(st.total, loadedEnd) : loadedEnd;
  const win = computeGridWindow(scrollTop, size.h, ROW_PITCH, cols, gridCount, 2);

  // Publish the column count so ↑/↓ keyboard navigation moves a full row.
  useEffect(() => {
    store.setGridColumns(cols);
  }, [cols]);

  // Quick Collection markers: rebuilt only when the membership cache changes,
  // not on every scroll/paint render (the cache can hold thousands of ids).
  const quickMembers = useMemo(() => new Set(st.quickMemberIds), [st.quickMemberIds]);

  // Fill the window from the catalog: a normal scroll near the tail pages the
  // next batch; a scrollbar jump outside the loaded window (either direction —
  // the buffer trims as it scrolls) fetches the gap in bounded chunks.
  useEffect(() => {
    if (st.loading) return;
    if (win.startIndex < loadedStart) void store.loadUntil(win.startIndex);
    else if (st.hasMore && win.endIndex >= loadedEnd - cols) {
      void store.loadUntil(win.endIndex + cols); // +cols of read-ahead
    }
  }, [win.startIndex, win.endIndex, loadedStart, loadedEnd, st.hasMore, st.loading, cols]);

  const showEmpty = (!st.available && !st.ready) || (st.ready && st.photos.length === 0 && !st.loading);
  if (showEmpty) return <EmptyState available={st.available} error={st.error} />;

  const painting = st.painter != null;
  const paint = (id: number) => {
    if (paintedRef.current.has(id)) return;
    paintedRef.current.add(id);
    void store.paint(id);
  };

  const visible = st.photos.slice(
    Math.max(0, win.startIndex - loadedStart),
    Math.max(0, win.endIndex - loadedStart),
  );
  // Window cells outside the loaded window (right after a scrollbar jump, in
  // either direction) render as spinner stubs until the gap fetch lands.
  const pendingBefore = Math.max(0, Math.min(win.endIndex, loadedStart) - win.startIndex);
  const pendingAfter = Math.max(0, win.endIndex - win.startIndex - pendingBefore - visible.length);
  const stub = (absIndex: number) => (
    <div key={`pending-${absIndex}`} className="gal-cell">
      <div className="gal-cell-thumb">
        <div className="gal-cell-spinner" />
      </div>
    </div>
  );
  return (
    <PhotoContextMenu>
    <div
      ref={measureRef}
      className={"gal-grid-scroll" + (painting ? " is-painting" : "")}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onMouseDown={() => paintedRef.current.clear()}
    >
      {st.expandedStackId != null && (
        <div className="gal-stack-banner">
          <button onClick={() => void store.expandStack(null)}>← Back to Library</button>
          <span>Stack — {st.photos.length} photos</span>
        </div>
      )}
      <div style={{ height: win.padTop }} />
      <div
        className="gal-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${CELL}px)`,
          gridAutoRows: `${ROW_H}px`,
          gap: GAP,
          padding: `0 ${GAP}px`,
        }}
      >
        {Array.from({ length: pendingBefore }, (_, i) => stub(win.startIndex + i))}
        {visible.map((p) => (
          <GridCell
            key={p.id}
            photo={p}
            edge={THUMB_EDGE}
            selected={st.selection.includes(p.id)}
            active={st.activeId === p.id}
            onSelect={(e) => {
              if (painting) paint(p.id);
              else if (e.shiftKey) store.selectRange(p.id);
              else store.select(p.id, e.metaKey || e.ctrlKey);
            }}
            // LR: right-click outside the selection retargets before the menu opens.
            onContextMenu={() => retargetOnContextMenu(p.id)}
            // Drag onto a Collections row adds the selection; off while painting
            // so a spray can't turn into a native drag.
            onDragStart={
              painting ? undefined : (e) => writePhotoDrag(e.dataTransfer, dragPayloadIds(st.selection, p.id))
            }
            onPaintDrag={painting ? () => paint(p.id) : undefined}
            onExpandStack={(stackId) => void store.expandStack(stackId)}
            onRelink={(sourceAssetId) => void relinkSource(sourceAssetId)}
            quickMember={quickMembers.has(p.id)}
            onToggleQuick={() => void store.toggleQuickMembership([p.id])}
            cellStyle={st.gridStyle}
          />
        ))}
        {Array.from({ length: pendingAfter }, (_, i) =>
          stub(win.startIndex + pendingBefore + visible.length + i),
        )}
      </div>
      <div style={{ height: win.padBottom }} />
    </div>
    </PhotoContextMenu>
  );
}
