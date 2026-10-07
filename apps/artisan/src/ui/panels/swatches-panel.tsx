// ─────────────────────────────────────────────────────────────
// ui/panels/swatches-panel — document swatches + quick color picker
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { fromHex, linearGradient, noPaint, Ops, type Paint, solid, spotPaint, toHex } from "../../engine";
import { commands } from "../../commands";
import { fileCommands } from "../../io/commands";
import { useEditorState, useStore } from "../../state/store-context";
import { applyPaintToActive, currentPaints } from "../paint-apply";
import { paintBackground } from "../paint-css";

const tbBtn = { background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", fontSize: 14, padding: "2px 6px", lineHeight: 1 } as const;

export function SwatchesPanel() {
  const store = useStore();
  const st = useEditorState();
  const apply = (paint: Paint) => applyPaintToActive(store, paint);

  // Which swatch cell is selected (for Delete). Treated as none if out of range
  // (e.g. after a delete / undo shrinks the list).
  const [selectedRaw, setSelected] = useState<number | null>(null);
  const selected = selectedRaw !== null && selectedRaw < st.doc.swatches.length ? selectedRaw : null;

  const active = st.activePaint === "fill" ? currentPaints(store).fill : currentPaints(store).stroke;
  const activeHex = active.type === "solid" ? toHex(active.color) : "#000000";
  const applySpot = () => {
    if (active.type !== "solid") return;
    const name = `Spot ${activeHex.toUpperCase()}`;
    let id: string | null = null;
    store.transact("Spot Color", (doc) => {
      const ink = Ops.Prepress.upsertSpotInk(doc, name, active.color);
      id = ink.id;
      const paint = spotPaint(name, active.color, { id: ink.id });
      if (st.activePaint === "fill") Ops.Paint.applyFill(doc, st.selection, paint);
      else Ops.Paint.applyStrokePaint(doc, st.selection, paint);
    });
    const paint = spotPaint(name, active.color, { id: id ?? undefined });
    if (st.activePaint === "fill") store.setFill(paint);
    else store.setStroke({ ...st.stroke, paint });
  };

  return (
    <div style={{ padding: "2px 2px 8px" }}>
      <div className="monet-row" style={{ gap: 6 }}>
        <input
          type="color"
          className="artisan-color-input"
          value={activeHex}
          onChange={(e) => apply(solid(fromHex(e.target.value)))}
          title="Pick color"
        />
        <button className="monet-chip" onClick={() => apply(noPaint())}>None</button>
        <button className="monet-chip" onClick={() => apply(linearGradient())}>Gradient</button>
        <button
          type="button"
          className="monet-chip"
          disabled={active.type !== "solid"}
          title="Convert the current color to a spot ink"
          aria-label="Create spot color from current color"
          onClick={applySpot}
        >
          Spot Color
        </button>
      </div>
      <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
        <div className="monet-section-label">Swatches</div>
        <div style={{ display: "flex", gap: 2 }}>
          <button type="button" data-swatch-action="new" title="New Swatch" aria-label="New Swatch" style={tbBtn} onClick={() => commands.newSwatch(store, active)}>＋</button>
          <button
            type="button"
            data-swatch-action="sort-hue"
            title="Sort by Hue"
            aria-label="Sort by Hue"
            disabled={st.doc.swatches.length < 2}
            style={{ ...tbBtn, opacity: st.doc.swatches.length < 2 ? 0.4 : 1 }}
            onClick={() => commands.sortSwatchesByHue(store)}
          >
            ↕
          </button>
          <button
            type="button"
            data-swatch-action="delete"
            title="Delete Swatch"
            aria-label="Delete Swatch"
            disabled={selected === null}
            style={{ ...tbBtn, opacity: selected === null ? 0.4 : 1 }}
            onClick={() => {
              if (selected === null) return;
              commands.deleteSwatch(store, selected);
              setSelected(null);
            }}
          >
            🗑
          </button>
          <button
            type="button"
            data-swatch-action="delete-unused"
            title="Delete Unused Swatches"
            aria-label="Delete Unused Swatches"
            style={tbBtn}
            onClick={() => {
              commands.deleteUnusedSwatches(store);
              setSelected(null);
            }}
          >
            ⌫
          </button>
          <button
            type="button"
            data-swatch-action="import"
            title="Import Swatches (.aco / .ase / .act)"
            aria-label="Import Swatches"
            style={tbBtn}
            onClick={() => void fileCommands.importSwatches(store)}
          >
            ⤒
          </button>
          <button
            type="button"
            data-swatch-action="export"
            title="Export Swatches (.ase)"
            aria-label="Export Swatches"
            disabled={!st.doc.swatches.some((sw) => sw.type === "solid")}
            style={{ ...tbBtn, opacity: st.doc.swatches.some((sw) => sw.type === "solid") ? 1 : 0.4 }}
            onClick={() => void fileCommands.exportSwatches(store)}
          >
            ⤓
          </button>
          <button
            type="button"
            data-swatch-action="add-used"
            title="Add Used Colors"
            aria-label="Add Used Colors"
            style={tbBtn}
            onClick={() => commands.addUsedColors(store)}
          >
            ⊕
          </button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 4 }}>
        {st.doc.swatches.map((sw, i) => (
          <button
            key={i}
            className={`artisan-swatch-cell ${selected === i ? "is-selected" : ""}`}
            style={{ ...paintBackground(sw), outline: selected === i ? "2px solid var(--accent-vector)" : undefined }}
            onClick={() => {
              setSelected(i);
              apply(sw);
            }}
            title={sw.type === "solid" ? sw.ink?.kind === "spot" ? sw.ink.name : toHex(sw.color) : sw.type}
          />
        ))}
      </div>
    </div>
  );
}
