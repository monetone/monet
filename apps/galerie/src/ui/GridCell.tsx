// GridCell — one photo cell (thumbnail + flag/rating/label badges). Shared by
// the Library grid and, in smaller form, the filmstrip.

import type { CSSProperties, DragEvent, MouseEvent } from "react";

import type { PhotoRow } from "../catalog/types";
import { store, type GridStyle } from "../state/store";
import { formatCamera } from "../lib/exifFormat";
import { gridViewOptions } from "../lib/gridViewOptions";
import { labelName } from "../lib/labelSet";
import { LABEL_COLORS, metadataStatusBadge } from "./photoBadges";
import { useMetadataStatus } from "./useMetadataStatus";
import { useThumbnail } from "./useThumbnail";

// The badge CSS (.gal-flag/.gal-stars) targets bare spans; strip the native
// <button> chrome inline so clickable badges render identically.
// ponytail: inline reset — move to galerie.css if more badges become buttons.
const badgeBtn: CSSProperties = {
  background: "none",
  border: 0,
  padding: 0,
  font: "inherit",
  color: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};

/** "n of N" position label for an EXPANDED stack member; null for unstacked
 *  photos and for the cover (order 0), which carries the ▤ expand badge. */
export function stackPosition(p: {
  stackId: number | null;
  stackOrder: number | null;
  stackCount: number;
}): string | null {
  if (p.stackId == null || p.stackOrder == null || p.stackCount < 2) return null;
  if (p.stackOrder === 0) return null;
  return `${p.stackOrder + 1} of ${p.stackCount}`;
}

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

export function GridCell({
  photo,
  edge,
  selected,
  active,
  onSelect,
  onContextMenu,
  onDragStart,
  onPaintDrag,
  onExpandStack,
  onRelink,
  quickMember,
  onToggleQuick,
  cellStyle = "compact",
}: {
  photo: PhotoRow;
  edge: number;
  selected: boolean;
  active: boolean;
  onSelect: (e: MouseEvent) => void;
  /** Right-click, fired before the surrounding <PhotoContextMenu> opens. */
  onContextMenu?: (e: MouseEvent) => void;
  /** Drag-to-collection: writes the photo-ids payload; presence enables dragging. */
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  /** Painter drag-spray: fired when the pointer drags across the cell. */
  onPaintDrag?: () => void;
  /** Click the stack badge to expand the cover's stack (null = not collapsible). */
  onExpandStack?: (stackId: number) => void;
  /** Click the missing badge to relink this photo's source asset. */
  onRelink?: (sourceAssetId: number) => void;
  /** Quick/Target Collection marker (LR's hover circle, filled for members). */
  quickMember?: boolean;
  onToggleQuick?: () => void;
  /** Grid cell style (LR's J cycle). Defaults to the compact badge bar. */
  cellStyle?: GridStyle;
}) {
  const url = useThumbnail(photo, edge);
  const metaBadge = metadataStatusBadge(useMetadataStatus(photo));
  const opts = gridViewOptions(); // module-cached; the ⌘J dialog is the only writer
  // Badge clicks cull the whole selection when this cell is part of it (LR).
  const cullBadge = (e: MouseEvent, part: { rating?: number; flag?: number }) => {
    e.stopPropagation();
    const sel = store.getState().selection;
    void store.cullMany(selected && sel.length ? sel : [photo.id], part);
  };
  // A collapsed stack cover in the normal grid (order 0, >1 member).
  const collapsedCover =
    photo.stackId != null && photo.stackOrder === 0 && photo.stackCount > 1;
  return (
    <div
      className={"gal-cell" + (selected ? " is-selected" : "") + (active ? " is-active" : "")}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      draggable={onDragStart != null}
      onDragStart={onDragStart}
      onMouseEnter={onPaintDrag ? (e) => e.buttons === 1 && onPaintDrag() : undefined}
      title={basename(photo.path)}
    >
      <div className="gal-cell-thumb">
        {url ? <img src={url} alt="" draggable={false} /> : <div className="gal-cell-spinner" />}
        {cellStyle !== "clean" && photo.isVirtualCopy && (
          <span className="gal-cell-vc" title={photo.copyName ?? "Virtual Copy"}>
            ❏
          </span>
        )}
        {cellStyle !== "clean" && opts.quickMarker && onToggleQuick && (
          <button
            className={"gal-cell-quick" + (quickMember ? " is-member" : "")}
            title={
              quickMember
                ? "Remove from Quick/Target Collection"
                : "Add to Quick/Target Collection"
            }
            onClick={(e) => {
              e.stopPropagation();
              onToggleQuick();
            }}
          />
        )}
        {opts.stackCount && stackPosition(photo) && (
          // Expanded stack member (Expand All / expanded-stack view): LR's
          // "n of N" position badge; [ / ] reorder, so the number is live.
          <span className="gal-cell-stack" title={`In stack — position ${stackPosition(photo)}`}>
            {stackPosition(photo)}
          </span>
        )}
        {collapsedCover && opts.stackCount && (
          <button
            className="gal-cell-stack"
            title={`Stack of ${photo.stackCount} — click to expand`}
            onClick={(e) => {
              e.stopPropagation();
              onExpandStack?.(photo.stackId!);
            }}
          >
            ▤ {photo.stackCount}
          </button>
        )}
        {cellStyle !== "clean" && metaBadge && (
          // LR's metadata-status arrows; resolve via the Metadata panel's
          // Save/Read buttons. ponytail: inline style like badgeBtn — move to
          // galerie.css if the badge grows behavior.
          <span
            className="gal-cell-metastatus"
            title={metaBadge.label}
            style={{
              position: "absolute",
              right: 4,
              bottom: 4,
              padding: "0 3px",
              borderRadius: 3,
              background: "rgba(0,0,0,0.55)",
              fontSize: 11,
              lineHeight: "14px",
            }}
          >
            {metaBadge.glyph}
          </span>
        )}
        {photo.missing && (
          <button
            className="gal-cell-missing"
            title="Source file is missing — click to relink"
            onClick={(e) => {
              e.stopPropagation();
              onRelink?.(photo.sourceAssetId);
            }}
          >
            ⚠ Missing
          </button>
        )}
      </div>
      {cellStyle !== "clean" && (
        <div className="gal-cell-bar">
          {opts.flags && (
            // Click toggles Pick (LR: the reject state clears to unflagged too).
            <button
              className={
                "gal-flag" +
                (photo.flag === 1 ? " is-pick" : photo.flag === -1 ? " is-reject" : "")
              }
              style={photo.flag === 0 ? { ...badgeBtn, opacity: 0.3 } : badgeBtn}
              title={photo.flag === 1 ? "Remove pick flag" : "Flag as pick"}
              onClick={(e) => cullBadge(e, { flag: photo.flag === 1 ? 0 : 1 })}
            >
              ⚑
            </button>
          )}
          {opts.ratings && (
            <span className="gal-stars">
              {[1, 2, 3, 4, 5].map((n) => (
                // Star n sets rating n; clicking the top lit star clears (LR).
                <button
                  key={n}
                  style={n <= photo.rating ? badgeBtn : { ...badgeBtn, opacity: 0.25 }}
                  title={n === photo.rating ? "Clear rating" : `Rate ${n}`}
                  onClick={(e) => cullBadge(e, { rating: n === photo.rating ? 0 : n })}
                >
                  ★
                </button>
              ))}
            </span>
          )}
          {opts.filename && <span className="gal-cell-name">{basename(photo.path)}</span>}
          {opts.labels && photo.colorLabel && LABEL_COLORS[photo.colorLabel] && (
            <span className="gal-label" title={labelName(photo.colorLabel)} style={{ background: LABEL_COLORS[photo.colorLabel] }} />
          )}
        </div>
      )}
      {cellStyle === "expanded" && opts.metaLine && (
        <div className="gal-cell-meta2">
          {[
            formatCamera(photo.cameraMake, photo.cameraModel),
            photo.captureTime != null ? new Date(photo.captureTime * 1000).toLocaleDateString() : null,
            `${photo.width}×${photo.height}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}
