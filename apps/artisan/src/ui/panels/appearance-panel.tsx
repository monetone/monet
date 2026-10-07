// ─────────────────────────────────────────────────────────────
// ui/panels/appearance-panel — ordered fill/stroke stack controls
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { Ops, Query, appearanceEntryEffects, legacyAppearanceEntries, type AppearanceEntry } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";
import { paintBackground } from "../paint-css";

const tbBtn = {
  background: "none",
  border: "none",
  color: "var(--text-2)",
  cursor: "pointer",
  fontSize: 12,
  padding: "2px 5px",
  lineHeight: 1,
} as const;

const actionStyle = (enabled = true) => ({ ...tbBtn, opacity: enabled ? 1 : 0.35, cursor: enabled ? "pointer" : "default" });

const numberInput = {
  width: 54,
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  color: "var(--text-1)",
  borderRadius: 4,
  padding: "2px 4px",
  fontSize: 11,
} as const;

const entryPaint = (entry: AppearanceEntry) => (entry.kind === "fill" ? entry.paint : entry.stroke.paint);

export function AppearancePanel() {
  const store = useStore();
  const st = useEditorState();
  const item = st.selection.length === 1 ? Query.getItem(st.doc, st.selection[0]) : null;
  const entries = item ? item.appearance?.entries ?? legacyAppearanceEntries(item) : [];
  const [selectedRaw, setSelected] = useState<string | null>(null);
  const active = entries.find((entry) => entry.id === selectedRaw) ?? entries[0] ?? null;
  const activeIndex = active ? entries.findIndex((entry) => entry.id === active.id) : -1;
  const hasTarget = !!item && !!active;
  const canAddPaint = !!item && Ops.Appearance.canAddPaint(item);

  const addFill = () => {
    if (!item) return;
    let id: string | null = null;
    store.transact("New Appearance Fill", (doc) => {
      id = Ops.Appearance.addFill(doc, [item.id], st.fill, { name: "Fill" })[0]?.id ?? null;
    });
    if (id) setSelected(id);
  };

  const addStroke = () => {
    if (!item) return;
    let id: string | null = null;
    store.transact("New Appearance Stroke", (doc) => {
      id = Ops.Appearance.addStroke(doc, [item.id], st.stroke, { name: "Stroke" })[0]?.id ?? null;
    });
    if (id) setSelected(id);
  };

  const updateActive = (patch: Parameters<typeof Ops.Appearance.updateEntry>[3]) => {
    if (!item || !active) return;
    store.transact("Edit Appearance", (doc) => {
      Ops.Appearance.updateEntry(doc, [item.id], active.id, patch);
    });
  };

  const duplicateActive = () => {
    if (!item || !active) return;
    let id: string | null = null;
    store.transact("Duplicate Appearance Entry", (doc) => {
      id = Ops.Appearance.duplicateEntry(doc, [item.id], active.id)[0]?.id ?? null;
    });
    if (id) setSelected(id);
  };

  return (
    <div style={{ padding: "4px 6px 8px" }}>
      <div className="monet-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <div className="monet-section-label">Appearance</div>
        <span style={{ display: "flex", gap: 1 }}>
          <button type="button" data-appearance-action="add-fill" title="New Fill" aria-label="New Fill" disabled={!canAddPaint} style={actionStyle(canAddPaint)} onClick={addFill}>
            + Fill
          </button>
          <button type="button" data-appearance-action="add-stroke" title="New Stroke" aria-label="New Stroke" disabled={!canAddPaint} style={actionStyle(canAddPaint)} onClick={addStroke}>
            + Stroke
          </button>
        </span>
      </div>

      {!item ? (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "6px 4px" }}>
          No single object selected.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {entries.map((entry) => {
              const effects = appearanceEntryEffects(item, entry).length;
              const visible = entry.visible !== false;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`monet-layer ${active?.id === entry.id ? "is-selected" : ""}`}
                  data-appearance-entry={entry.id}
                  aria-pressed={active?.id === entry.id}
                  style={{ alignItems: "center", minHeight: 32, textAlign: "left", border: "none", width: "100%", opacity: visible ? 1 : 0.55 }}
                  onClick={() => setSelected(entry.id)}
                >
                  <span style={{ width: 22, height: 18, borderRadius: 3, border: "1px solid var(--border)", ...paintBackground(entryPaint(entry)) }} />
                  <span className="name" style={{ minWidth: 0 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name ?? (entry.kind === "fill" ? "Fill" : "Stroke")}</span>
                    <span style={{ display: "block", color: "var(--text-3)", fontSize: 10 }}>
                      {entry.kind}{entry.opacity != null ? ` · ${Math.round(entry.opacity * 100)}%` : ""}{effects ? ` · ${effects} fx` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {active ? (
            <>
              <div className="monet-section-label" style={{ marginTop: 8 }}>{active.kind === "fill" ? "Fill" : "Stroke"}</div>
              <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                <span>Opacity</span>
                <input
                  data-appearance-field="opacity"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round((active.opacity ?? 1) * 100)}
                  style={numberInput}
                  onChange={(e) => updateActive({ opacity: Number(e.currentTarget.value) / 100 })}
                />
              </div>
              <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 5 }}>
                <button type="button" data-appearance-action="toggle-visible" disabled={!hasTarget} style={actionStyle(hasTarget)} onClick={() => updateActive({ visible: active.visible === false })}>
                  {active.visible === false ? "Show" : "Hide"}
                </button>
                <span style={{ display: "flex", gap: 1 }}>
                  <button type="button" data-appearance-action="move-down" disabled={!hasTarget || activeIndex <= 0} style={actionStyle(hasTarget && activeIndex > 0)} onClick={() => store.transact("Move Appearance Entry", (doc) => Ops.Appearance.moveEntry(doc, [item.id], active.id, "down"))}>
                    Down
                  </button>
                  <button type="button" data-appearance-action="move-up" disabled={!hasTarget || activeIndex >= entries.length - 1} style={actionStyle(hasTarget && activeIndex < entries.length - 1)} onClick={() => store.transact("Move Appearance Entry", (doc) => Ops.Appearance.moveEntry(doc, [item.id], active.id, "up"))}>
                    Up
                  </button>
                </span>
              </div>
              <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 5 }}>
                <button type="button" data-appearance-action="apply-active-paint" disabled={!hasTarget} style={actionStyle(hasTarget)} onClick={() => updateActive(active.kind === "fill" ? { paint: st.fill } : { stroke: st.stroke })}>
                  {active.kind === "fill" ? "Apply Fill" : "Apply Stroke"}
                </button>
                <span style={{ display: "flex", gap: 1 }}>
                  <button type="button" data-appearance-action="duplicate" aria-label="Duplicate appearance entry" disabled={!hasTarget} style={actionStyle(hasTarget)} onClick={duplicateActive}>
                    Duplicate
                  </button>
                  <button type="button" data-appearance-action="delete" aria-label="Delete appearance entry" disabled={!hasTarget || entries.length <= 1} style={actionStyle(hasTarget && entries.length > 1)} onClick={() => store.transact("Delete Appearance Entry", (doc) => Ops.Appearance.deleteEntry(doc, [item.id], active.id))}>
                    Delete
                  </button>
                </span>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
