// ─────────────────────────────────────────────────────────────
// ui/panels/graphic-styles-panel — saved appearance presets
// ─────────────────────────────────────────────────────────────
// Mirrors the Swatches panel: each cell is a saved appearance (Graphic Style)
// previewed by its fill. Click a cell to apply that appearance to the selection;
// ＋ saves the selected object's appearance as a new style; 🗑 deletes one.

import { useState } from "react";
import { commands } from "../../commands";
import { useEditorState, useStore } from "../../state/store-context";
import { paintBackground } from "../paint-css";

const tbBtn = { background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", fontSize: 14, padding: "2px 6px", lineHeight: 1 } as const;

export function GraphicStylesPanel() {
  const store = useStore();
  const st = useEditorState();
  const styles = st.doc.graphicStyles ?? [];
  const hasSel = st.selection.length > 0;

  // Which style cell is selected (for Delete). None if out of range (after delete / undo).
  const [selectedRaw, setSelected] = useState<number | null>(null);
  const selected = selectedRaw !== null && selectedRaw < styles.length ? selectedRaw : null;

  return (
    <div style={{ padding: "2px 2px 8px" }}>
      <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 2 }}>
        <div className="monet-section-label">Graphic Styles</div>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            type="button"
            data-graphic-style-action="new"
            title="New Graphic Style"
            aria-label="New Graphic Style"
            disabled={!hasSel}
            style={{ ...tbBtn, opacity: hasSel ? 1 : 0.4 }}
            onClick={() => commands.newGraphicStyle(store)}
          >
            ＋
          </button>
          <button
            type="button"
            data-graphic-style-action="delete"
            title="Delete Graphic Style"
            aria-label="Delete Graphic Style"
            disabled={selected === null}
            style={{ ...tbBtn, opacity: selected === null ? 0.4 : 1 }}
            onClick={() => {
              if (selected === null) return;
              commands.deleteGraphicStyle(store, selected);
              setSelected(null);
            }}
          >
            🗑
          </button>
        </div>
      </div>
      {styles.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "6px 4px" }}>
          Select an object and click ＋ to save its appearance as a style.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 4 }}>
          {styles.map((gs, i) => (
            <button
              key={gs.id}
              data-graphic-style={gs.id}
              className={`artisan-swatch-cell ${selected === i ? "is-selected" : ""}`}
              style={{ ...paintBackground(gs.fill), outline: selected === i ? "2px solid var(--accent-vector)" : undefined }}
              title={gs.name}
              onClick={() => {
                setSelected(i);
                commands.applyGraphicStyle(store, gs.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
