// ─────────────────────────────────────────────────────────────
// ui/panels/brushes-panel — document calligraphic brush library
// ─────────────────────────────────────────────────────────────

import { Slider } from "@monet-ui/monet-react";

import { Ops, Query } from "../../engine";
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

const actionStyle = (enabled = true) => ({ ...tbBtn, opacity: enabled ? 1 : 0.35, cursor: enabled ? "pointer" : "default" });

const numberInput = {
  width: 58,
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  color: "var(--text-1)",
  borderRadius: 4,
  padding: "2px 4px",
  fontSize: 11,
} as const;

export function BrushesPanel() {
  const store = useStore();
  const st = useEditorState();
  const entries = Query.brushDefinitionEntries(st.doc);
  const active = entries.find((entry) => entry.brush.id === st.activeBrushId) ?? entries[0] ?? null;
  const brush = active?.brush ?? null;

  const createBrush = () => {
    let id: string | null = null;
    store.transact("New Brush", (doc) => {
      const b = Ops.Brushes.addCalligraphicBrush(doc, {
        name: `Calligraphic ${(doc.brushes?.length ?? 0) + 1}`,
        size: brush?.size ?? 10,
        angle: brush?.angle ?? -45,
        roundness: brush?.roundness ?? 1,
        paintSource: brush?.paintSource ?? "stroke",
      });
      id = b.id;
    });
    if (id) store.setActiveBrush(id);
  };

  const updateBrush = (patch: Parameters<typeof Ops.Brushes.updateCalligraphicBrush>[2]) => {
    if (!brush) return;
    store.transact("Edit Brush", (doc) => {
      Ops.Brushes.updateCalligraphicBrush(doc, brush.id, patch);
    });
  };

  const deleteBrush = () => {
    if (!brush) return;
    const next = entries.find((entry) => entry.brush.id !== brush.id)?.brush.id ?? brush.id;
    store.transact("Delete Brush", (doc) => {
      Ops.Brushes.deleteBrushDefinition(doc, brush.id);
    });
    store.setActiveBrush(next);
  };

  const duplicateBrush = () => {
    if (!brush) return;
    let id: string | null = null;
    store.transact("Duplicate Brush", (doc) => {
      id = Ops.Brushes.duplicateBrush(doc, brush.id)?.id ?? null;
    });
    if (id) store.setActiveBrush(id);
  };

  const applyBrush = () => {
    if (!brush || st.selection.length === 0) return;
    store.transact("Apply Brush", (doc) => {
      Ops.Brushes.applyBrushToItems(doc, st.selection, brush.id);
    });
  };

  return (
    <div style={{ padding: "4px 6px 8px" }}>
      <div className="monet-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <div className="monet-section-label">Brushes</div>
        <span style={{ display: "flex", gap: 1 }}>
          <button
            type="button"
            data-brush-action="new"
            title="New Brush"
            aria-label="New Brush"
            style={actionStyle(true)}
            onClick={createBrush}
          >
            +
          </button>
          <button
            type="button"
            data-brush-action="duplicate"
            title="Duplicate Brush"
            aria-label="Duplicate Brush"
            disabled={!brush}
            style={actionStyle(!!brush)}
            onClick={duplicateBrush}
          >
            Duplicate
          </button>
          <button
            type="button"
            data-brush-action="delete"
            title="Delete Brush"
            aria-label="Delete Brush"
            disabled={!brush || entries.length <= 1}
            style={actionStyle(!!brush && entries.length > 1)}
            onClick={deleteBrush}
          >
            Delete
          </button>
        </span>
      </div>

      {entries.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "4px 2px" }}>No brushes</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {entries.map(({ brush, usageCount }) => (
            <button
              key={brush.id}
              type="button"
              className={`monet-layer ${brush.id === active?.brush.id ? "is-selected" : ""}`}
              data-brush={brush.id}
              aria-pressed={brush.id === active?.brush.id}
              style={{ alignItems: "center", minHeight: 30, textAlign: "left", border: "none", width: "100%" }}
              onClick={() => store.setActiveBrush(brush.id)}
            >
              <span className="name" style={{ minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{brush.name}</span>
                <span style={{ display: "block", color: "var(--text-3)", fontSize: 10 }}>
                  {brush.kind} · {brush.size}px · {usageCount} use{usageCount === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {brush ? (
        <>
          <div className="monet-section-label" style={{ marginTop: 8 }}>Calligraphic</div>
          <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4 }}>
            <span>Size</span>
            <input
              data-brush-field="size"
              type="number"
              min={0.1}
              max={500}
              step={1}
              value={brush.size}
              aria-label="Brush size"
              style={numberInput}
              onChange={(e) => updateBrush({ size: Number(e.currentTarget.value) })}
            />
          </div>
          <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4 }}>
            <span>Angle</span>
            <input
              data-brush-field="angle"
              type="number"
              step={1}
              value={brush.angle}
              aria-label="Brush angle"
              style={numberInput}
              onChange={(e) => updateBrush({ angle: Number(e.currentTarget.value) })}
            />
          </div>
          <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4 }}>
            <span>Roundness</span>
            <Slider
              aria-label="Brush roundness"
              min={1}
              max={100}
              step={1}
              accent="var(--accent-vector)"
              value={Math.round(brush.roundness * 100)}
              onChange={(v) => updateBrush({ roundness: v / 100 })}
              style={{ width: 92, flex: "none" }}
            />
          </div>
          <button
            type="button"
            data-brush-action="apply"
            disabled={st.selection.length === 0}
            style={{
              width: "100%",
              marginTop: 8,
              padding: "4px 6px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "var(--panel-2)",
              color: "var(--text-1)",
              opacity: st.selection.length ? 1 : 0.45,
            }}
            onClick={applyBrush}
          >
            Apply to Stroke
          </button>
        </>
      ) : null}
    </div>
  );
}
