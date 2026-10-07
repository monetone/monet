// ─────────────────────────────────────────────────────────────
// ui/panels/document-info-panel — read-only document summary
// ─────────────────────────────────────────────────────────────
// Illustrator's Window ▸ Document Info: facts about the current document
// (colour mode, units, artboards, object counts, fonts) derived from the doc +
// selection. Read-only — it never mutates the document.

import { Query } from "../../engine";
import { useEditorState } from "../../state/store-context";

// Friendly labels for the raw item-type enum in the per-type object breakdown.
const TYPE_LABELS: Record<string, string> = {
  path: "Paths",
  compound: "Compound Paths",
  group: "Groups",
  rect: "Rectangles",
  ellipse: "Ellipses",
  polygon: "Polygons",
  star: "Stars",
  line: "Lines",
  text: "Type Objects",
  image: "Images",
};
const typeLabel = (t: string) => TYPE_LABELS[t] ?? t;

function Row({ label, value, attr }: { label: string; value: string | number; attr?: string }) {
  return (
    <div className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span data-docinfo={attr}>{value}</span>
    </div>
  );
}

export function DocumentInfoPanel() {
  const st = useEditorState();
  const info = Query.documentInfo(st.doc, st.selection);
  const ab = info.activeArtboard;
  const typeRows = Object.entries(info.byType).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div style={{ padding: "4px 8px 8px" }}>
      <div className="monet-section-label">Document</div>
      <Row label="Name" value={info.name} attr="name" />
      <Row label="Color Mode" value={info.colorMode} />
      <Row label="Units" value={info.units} />
      <Row label="Resolution" value={`${info.dpi} ppi`} />

      <div className="monet-section-label" style={{ marginTop: 8 }}>Artboards</div>
      <Row label="Count" value={info.artboards} attr="artboards" />
      {ab && <Row label={ab.name} value={`${Math.round(ab.width)} × ${Math.round(ab.height)}`} attr="artboard-size" />}

      <div className="monet-section-label" style={{ marginTop: 8 }}>Objects</div>
      <Row label="Total" value={info.objects} attr="objects" />
      <Row label="Selected" value={info.selected} attr="selected" />
      {typeRows.map(([t, n]) => (
        <Row key={t} label={typeLabel(t)} value={n} />
      ))}
      <Row label="Layers" value={info.layers} />
      <Row label="Swatches" value={info.swatches} />
      <Row label="Graphic Styles" value={info.graphicStyles} />

      <div className="monet-section-label" style={{ marginTop: 8 }}>Fonts</div>
      <div data-docinfo="fonts" style={{ fontSize: 11 }}>
        {info.fonts.length ? info.fonts.join(", ") : <span style={{ color: "var(--text-3)" }}>None</span>}
      </div>
    </div>
  );
}
