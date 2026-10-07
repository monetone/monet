// ui/panels/graphs-panel — document-backed graph data and options

import { Select } from "@monet-ui/monet-react";
import {
  Ops,
  Query,
  formatGraphDataText,
  graphKindName,
  parseGraphDataText,
  type GraphKind,
} from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";

const graphKinds: GraphKind[] = ["column", "bar", "line", "area", "scatter", "pie", "radar"];

const tbBtn = {
  background: "none",
  border: "none",
  color: "var(--text-2)",
  cursor: "pointer",
  fontSize: 11,
  padding: "2px 5px",
  lineHeight: 1.3,
} as const;

const actionStyle = (enabled = true) => ({
  ...tbBtn,
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.35,
});

export function GraphsPanel() {
  const store = useStore();
  const { doc, selection } = useEditorState();
  const graphs = Query.graphEntries(doc);
  const selectedSet = new Set(selection);
  const selectedGraph = graphs.find((entry) => selectedSet.has(entry.itemId)) ?? graphs[0] ?? null;

  const selectGraph = (itemId: string) => {
    const ids = Query.selectableIds(store.doc, [itemId]);
    if (ids.length) store.setSelection(ids);
  };

  const setKind = (kind: GraphKind) => {
    if (!selectedGraph) return;
    store.transact("Graph Type", (draft) => {
      Ops.Graphs.setGraphOptions(draft, selectedGraph.itemId, { kind });
    });
  };

  const toggleAxes = () => {
    if (!selectedGraph) return;
    store.transact("Graph Axes", (draft) => {
      Ops.Graphs.setGraphOptions(draft, selectedGraph.itemId, { showAxes: selectedGraph.graph.showAxes === false });
    });
  };

  const regenerate = () => {
    if (!selectedGraph) return;
    store.transact("Regenerate Graph", (draft) => {
      Ops.Graphs.regenerateGraph(draft, selectedGraph.itemId);
    });
  };

  const editData = () => {
    if (!selectedGraph) return;
    const input = window.prompt("Graph data", formatGraphDataText(selectedGraph.graph.data));
    if (input == null) return;
    const parsed = parseGraphDataText(input);
    if (parsed.errors.length) {
      window.alert(parsed.errors.join("\n"));
      return;
    }
    if (!parsed.data.length) {
      window.alert("No graph data");
      return;
    }
    store.transact("Edit Graph Data", (draft) => {
      Ops.Graphs.updateGraphData(draft, selectedGraph.itemId, parsed.data, { now: new Date().toISOString() });
    });
  };

  const detach = () => {
    if (!selectedGraph) return;
    store.transact("Detach Graph", (draft) => {
      Ops.Graphs.detachGraph(draft, [selectedGraph.itemId]);
    });
  };

  return (
    <div data-panel="graphs" style={{ padding: "4px 6px 8px" }}>
      <div className="monet-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <div className="monet-section-label">Graphs</div>
        <span data-graph-count style={{ fontSize: 10, color: "var(--text-3)" }}>{graphs.length}</span>
      </div>

      {graphs.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "4px 2px" }}>No graphs</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {graphs.map((entry) => (
            <button
              key={entry.itemId}
              type="button"
              className={`monet-layer ${entry.itemId === selectedGraph?.itemId ? "is-selected" : ""}`}
              data-graph={entry.itemId}
              style={{ alignItems: "center", minHeight: 30, textAlign: "left", border: "none", width: "100%" }}
              onClick={() => selectGraph(entry.itemId)}
            >
              <span className="name" style={{ minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.itemName}</span>
                <span style={{ display: "block", color: "var(--text-3)", fontSize: 10 }}>
                  {graphKindName(entry.kind)} · {entry.datumCount} row{entry.datumCount === 1 ? "" : "s"} · {entry.layerName}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedGraph && (
        <>
          <div className="monet-section-label" style={{ marginTop: 8 }}>Options</div>
          <label className="monet-row" style={{ justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ color: "var(--text-3)" }}>Type</span>
            <Select
              size="sm"
              data-graph-kind
              value={selectedGraph.kind}
              onChange={(v) => setKind(v as GraphKind)}
              style={{ width: 124 }}
              options={graphKinds.map((kind) => ({ value: kind, label: graphKindName(kind) }))}
            />
          </label>

          <div className="monet-row" style={{ gap: 3, marginTop: 6 }}>
            <button
              type="button"
              className={`artisan-seg-btn ${selectedGraph.graph.showAxes !== false ? "is-active" : ""}`}
              data-graph-action="axes"
              style={{ flex: 1 }}
              onClick={toggleAxes}
            >
              Axes
            </button>
            <button type="button" className="artisan-seg-btn" data-graph-action="data" style={{ flex: 1 }} onClick={editData}>
              Data
            </button>
          </div>

          <div className="monet-row" style={{ gap: 3, marginTop: 4 }}>
            <button type="button" data-graph-action="regenerate" style={{ ...actionStyle(true), flex: 1 }} onClick={regenerate}>
              Regenerate
            </button>
            <button type="button" data-graph-action="detach" style={{ ...actionStyle(true), flex: 1 }} onClick={detach}>
              Detach
            </button>
          </div>

          <div className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, marginTop: 6 }}>
            <span style={{ color: "var(--text-3)" }}>Size</span>
            <span data-graph-size>
              {Math.round(selectedGraph.graph.width)} x {Math.round(selectedGraph.graph.height)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
