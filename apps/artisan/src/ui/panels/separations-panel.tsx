// ─────────────────────────────────────────────────────────────
// ui/panels/separations-panel — print plate preview
// ─────────────────────────────────────────────────────────────

import { Ops, Query, toCSS } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";

const Row = ({ label, value, attr }: { label: string; value: string | number; attr?: string }) => (
  <div className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
    <span style={{ color: "var(--text-3)" }}>{label}</span>
    <span data-separations={attr}>{value}</span>
  </div>
);

const usageLabel = (count: number): string => `${count} ${count === 1 ? "use" : "uses"}`;

export function SeparationsPanel() {
  const store = useStore();
  const { doc } = useEditorState();
  const preview = Query.separationPreview(doc);
  const usedPlates = preview.plates.filter((plate) => plate.uses.length > 0);

  const setOverprintPreview = (value: boolean) => {
    store.transact("Overprint Preview", (d) => {
      Ops.Prepress.setOverprintPreview(d, value);
    });
  };

  const setPlateEnabled = (id: string, value: boolean) => {
    store.transact("Toggle Separation Plate", (d) => {
      Ops.Prepress.setInkEnabled(d, id, value);
    });
  };

  return (
    <div style={{ padding: "4px 8px 8px" }}>
      <div className="monet-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <div className="monet-section-label">Separations</div>
        <label className="monet-row" style={{ gap: 5, fontSize: 10, color: "var(--text-3)" }}>
          <input
            data-separations-overprint-preview
            type="checkbox"
            checked={preview.overprintPreview}
            onChange={(event) => setOverprintPreview(event.currentTarget.checked)}
            style={{ width: 12, height: 12, margin: 0 }}
          />
          Overprint
        </label>
      </div>

      <Row label="Process Plates" value={preview.processPlateCount} attr="process-count" />
      <Row label="Spot Plates" value={preview.spotPlateCount} attr="spot-count" />
      <Row label="Overprint Objects" value={preview.overprintObjectCount} attr="overprint-count" />

      <div className="monet-section-label" style={{ marginTop: 8 }}>Plates</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {preview.plates.map((plate) => (
          <div
            key={plate.id}
            className="monet-layer"
            data-separation-plate={plate.name}
            data-separation-kind={plate.kind}
            style={{ alignItems: "center", minHeight: 28, opacity: plate.enabled ? 1 : 0.45 }}
          >
            <input
              type="checkbox"
              checked={plate.enabled}
              aria-label={`${plate.enabled ? "Hide" : "Show"} ${plate.name} plate`}
              onChange={(event) => setPlateEnabled(plate.id, event.currentTarget.checked)}
              style={{ width: 12, height: 12, margin: 0, flex: "0 0 auto" }}
            />
            <span
              aria-hidden="true"
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: toCSS(plate.color),
                border: "1px solid var(--border)",
                flex: "0 0 auto",
              }}
            />
            <span className="name" style={{ minWidth: 0 }}>
              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{plate.name}</span>
              <span style={{ display: "block", color: "var(--text-3)", fontSize: 10 }}>
                {plate.kind} · {usageLabel(plate.uses.length)}
                {plate.overprintUses ? ` · ${plate.overprintUses} overprint` : ""}
              </span>
            </span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-3)" }}>{Math.round(plate.maxCoverage)}%</span>
          </div>
        ))}
      </div>

      {usedPlates.length === 0 && (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "4px 2px" }}>No inked artwork</div>
      )}
    </div>
  );
}
