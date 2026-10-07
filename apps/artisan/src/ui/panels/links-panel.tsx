// ─────────────────────────────────────────────────────────────
// ui/panels/links-panel — placed image link/embed status
// ─────────────────────────────────────────────────────────────

import { Ops, Query, type PlacedAssetStatus } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";

const tbBtn = {
  background: "none",
  border: "none",
  color: "var(--text-2)",
  cursor: "pointer",
  fontSize: 13,
  padding: "2px 5px",
  lineHeight: 1,
} as const;

const statusLabel: Record<PlacedAssetStatus, string> = {
  ok: "OK",
  missing: "Missing",
  modified: "Modified",
};

const actionStyle = (enabled = true) => ({ ...tbBtn, opacity: enabled ? 1 : 0.35, cursor: enabled ? "pointer" : "default" });

export function LinksPanel() {
  const store = useStore();
  const { doc, selection } = useEditorState();
  const entries = Query.placedAssetEntries(doc);
  const selected = new Set(selection);
  const selectItem = (itemId: string) => {
    const ids = Query.selectableIds(store.doc, [itemId]);
    if (ids.length) store.setSelection(ids);
  };

  const relink = (itemId: string, current: string) => {
    const source = window.prompt("Relink image source", current);
    if (!source) return;
    store.transact("Relink Image", (d) => {
      Ops.LinkedAssets.relinkImage(d, itemId, source);
    });
  };

  const embed = (itemId: string) => {
    store.transact("Embed Image", (d) => {
      Ops.LinkedAssets.embedImage(d, itemId);
    });
  };

  const update = (itemId: string) => {
    store.transact("Update Link", (d) => {
      Ops.LinkedAssets.updateLinkedImage(d, itemId);
    });
  };

  const mark = (itemId: string, status: PlacedAssetStatus) => {
    store.transact("Link Status", (d) => {
      Ops.LinkedAssets.setImageAssetStatus(d, itemId, status);
    });
  };

  return (
    <div style={{ padding: "4px 6px 8px" }}>
      <div className="monet-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <div className="monet-section-label">Links</div>
        <span data-links-count style={{ fontSize: 10, color: "var(--text-3)" }}>{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "4px 2px" }}>No placed images</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {entries.map((entry) => {
            const { asset } = entry;
            const isLinked = asset.mode === "linked";
            const rowSelected = selected.has(entry.itemId);
            const source = asset.source ?? entry.href;
            return (
              <div
                key={entry.itemId}
                className={`monet-layer ${rowSelected ? "is-selected" : ""}`}
                data-link-item={entry.itemId}
                data-link-mode={asset.mode}
                data-link-status={asset.status}
                onClick={() => selectItem(entry.itemId)}
                style={{ alignItems: "center", minHeight: 28 }}
              >
                <span title={isLinked ? "Linked" : "Embedded"} aria-label={isLinked ? "Linked" : "Embedded"} style={{ width: 16, textAlign: "center" }}>
                  {isLinked ? "⛓" : "▣"}
                </span>
                <span className="name" style={{ minWidth: 0 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.name ?? entry.itemName}</span>
                  <span style={{ display: "block", color: "var(--text-3)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {statusLabel[asset.status]} · {entry.layerName}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 1, marginLeft: "auto" }}>
                  <button type="button" data-link-action="missing" title="Mark Missing" aria-label="Mark Missing" style={tbBtn} onClick={(e) => { e.stopPropagation(); mark(entry.itemId, "missing"); }}>!</button>
                  <button type="button" data-link-action="relink" title="Relink" aria-label="Relink" style={tbBtn} onClick={(e) => { e.stopPropagation(); relink(entry.itemId, source); }}>↪</button>
                  <button type="button" data-link-action="embed" title="Embed" aria-label="Embed" disabled={!isLinked} style={actionStyle(isLinked)} onClick={(e) => { e.stopPropagation(); if (isLinked) embed(entry.itemId); }}>▣</button>
                  <button type="button" data-link-action="update" title="Update Link" aria-label="Update Link" disabled={!isLinked} style={actionStyle(isLinked)} onClick={(e) => { e.stopPropagation(); if (isLinked) update(entry.itemId); }}>↻</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
