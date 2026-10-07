// ui/panels/variables-panel - baseline data-driven graphics workflows

import { Select } from "@monet-ui/monet-react";
import { Ops, Query, type DataVariable, type DataVariableKind, type DataVariableValue, fromHex, solid, type Paint, toHex } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";

const tbBtn = {
  background: "none",
  border: "none",
  color: "var(--text-2)",
  cursor: "pointer",
  fontSize: 11,
  padding: "2px 5px",
  lineHeight: 1.3,
} as const;

const fieldStyle = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-1)",
  fontSize: 11,
  minWidth: 0,
  padding: "2px 4px",
} as const;

const actionStyle = (enabled = true) => ({
  ...tbBtn,
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.35,
});

const kindLabel: Record<DataVariableKind, string> = {
  visibility: "Visibility",
  text: "Text",
  fill: "Fill",
};

const paintLabel = (paint?: Paint): string => {
  if (!paint) return "No value";
  if (paint.type === "none") return "None";
  if (paint.type === "solid") {
    const { r, g, b, a = 1 } = paint.color;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return paint.type === "gradient" ? "Gradient" : "Pattern";
};

const valueLabel = (value?: DataVariableValue): string => {
  if (!value) return "No value";
  if (typeof value.visible === "boolean") return value.visible ? "Visible" : "Hidden";
  if (value.text !== undefined) return value.text || "Empty text";
  return paintLabel(value.paint);
};

export function VariablesPanel() {
  const store = useStore();
  const { doc, selection } = useEditorState();
  const settings = doc.variables ?? { variables: [], dataSets: [] };
  const variables = settings.variables;
  const dataSets = settings.dataSets;
  const activeDataSet = dataSets.find((dataSet) => dataSet.id === settings.activeDataSetId) ?? dataSets[0] ?? null;
  const canBind = (kind: DataVariableKind): boolean => Ops.Variables.canCreateVariable(doc, selection, kind);

  const addVariable = (kind: DataVariableKind) => {
    if (!canBind(kind)) return;
    const fallback = `${kindLabel[kind]} ${variables.length + 1}`;
    const name = window.prompt("Variable name", fallback);
    if (!name) return;
    store.transact("New Variable", (draft) => {
      Ops.Variables.createVariableFromSelection(draft, selection, kind, name);
    });
  };

  const captureDataSet = () => {
    if (!variables.length) return;
    const name = window.prompt("Data set name", `Data Set ${dataSets.length + 1}`);
    if (!name) return;
    store.transact("Capture Data Set", (draft) => {
      Ops.Variables.captureDataSet(draft, name);
    });
  };

  const applyDataSet = () => {
    if (!activeDataSet) return;
    store.transact("Apply Data Set", (draft) => {
      Ops.Variables.applyDataSet(draft, activeDataSet.id);
    });
  };

  const setActive = (dataSetId: string) => {
    store.transact("Active Data Set", (draft) => {
      Ops.Variables.setActiveDataSet(draft, dataSetId || null);
    });
  };

  const deleteVariable = (variableId: string) => {
    store.transact("Delete Variable", (draft) => {
      Ops.Variables.deleteVariable(draft, variableId);
    });
  };

  const deleteDataSet = () => {
    if (!activeDataSet) return;
    store.transact("Delete Data Set", (draft) => {
      Ops.Variables.deleteDataSet(draft, activeDataSet.id);
    });
  };

  const updateValue = (variable: DataVariable, value: DataVariableValue) => {
    if (!activeDataSet) return;
    store.transact("Edit Data Set Value", (draft) => {
      Ops.Variables.setDataSetValue(draft, activeDataSet.id, variable.id, value);
    });
  };

  return (
    <div style={{ padding: "4px 6px 8px" }}>
      <div className="monet-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <div className="monet-section-label">Variables</div>
        <span style={{ display: "flex", gap: 1 }}>
          <button type="button" data-variable-action="new-text" disabled={!canBind("text")} style={actionStyle(canBind("text"))} onClick={() => addVariable("text")}>
            Text
          </button>
          <button type="button" data-variable-action="new-visibility" disabled={!canBind("visibility")} style={actionStyle(canBind("visibility"))} onClick={() => addVariable("visibility")}>
            Visible
          </button>
          <button type="button" data-variable-action="new-fill" disabled={!canBind("fill")} style={actionStyle(canBind("fill"))} onClick={() => addVariable("fill")}>
            Fill
          </button>
        </span>
      </div>

      <div className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
        <span style={{ color: "var(--text-3)" }}>Bound variables</span>
        <span data-variables-count>{variables.length}</span>
      </div>
      <div className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
        <span style={{ color: "var(--text-3)" }}>Data sets</span>
        <span data-datasets-count>{dataSets.length}</span>
      </div>

      <div className="monet-row" style={{ gap: 4, marginTop: 6 }}>
        <Select
          data-variable-dataset
          size="sm"
          aria-label="Active data set"
          value={activeDataSet?.id ?? ""}
          onChange={(v) => setActive(v)}
          style={{ flex: 1, minWidth: 0 }}
          options={[{ value: "", label: "No data set" }, ...dataSets.map((dataSet) => ({ value: dataSet.id, label: dataSet.name }))]}
        />
        <button type="button" data-variable-action="capture" disabled={!variables.length} style={actionStyle(variables.length > 0)} onClick={captureDataSet}>
          Capture
        </button>
        <button type="button" data-variable-action="apply" disabled={!activeDataSet} style={actionStyle(!!activeDataSet)} onClick={applyDataSet}>
          Apply
        </button>
      </div>

      {activeDataSet && (
        <div className="monet-row" style={{ justifyContent: "flex-end", marginTop: 2 }}>
          <button type="button" data-variable-action="delete-dataset" style={actionStyle()} onClick={deleteDataSet}>
            Delete Data Set
          </button>
        </div>
      )}

      <div className="monet-section-label" style={{ marginTop: 8 }}>Bindings</div>
      {variables.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "4px 2px" }}>No variables</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {variables.map((variable) => {
            const item = variable.binding ? Query.getItem(doc, variable.binding.itemId) : null;
            const value = activeDataSet?.values[variable.id];
            return (
              <div key={variable.id} className="monet-layer" data-variable-id={variable.id} style={{ alignItems: "center", minHeight: 30 }}>
                <span className="name" style={{ minWidth: 0 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{variable.name}</span>
                  <span style={{ display: "block", color: "var(--text-3)", fontSize: 10 }}>
                    {kindLabel[variable.kind]} · {item?.name || item?.type || "missing"} · {valueLabel(value)}
                  </span>
                </span>
                {activeDataSet && variable.kind === "visibility" ? (
                  <input
                    type="checkbox"
                    data-variable-value={variable.id}
                    aria-label={`${variable.name} visibility`}
                    checked={value?.visible ?? false}
                    onChange={(event) => updateValue(variable, { visible: event.currentTarget.checked })}
                  />
                ) : null}
                {activeDataSet && variable.kind === "text" ? (
                  <input
                    type="text"
                    data-variable-value={variable.id}
                    aria-label={`${variable.name} text`}
                    value={value?.text ?? ""}
                    style={{ ...fieldStyle, width: 72 }}
                    onChange={(event) => updateValue(variable, { text: event.currentTarget.value })}
                  />
                ) : null}
                {activeDataSet && variable.kind === "fill" ? (
                  <input
                    type="color"
                    data-variable-value={variable.id}
                    aria-label={`${variable.name} fill`}
                    value={value?.paint?.type === "solid" ? toHex(value.paint.color) : "#000000"}
                    onChange={(event) => updateValue(variable, { paint: solid(fromHex(event.currentTarget.value)) })}
                  />
                ) : null}
                <button type="button" data-variable-action="delete" aria-label={`Delete ${variable.name} variable`} style={{ ...tbBtn, marginLeft: "auto" }} onClick={() => deleteVariable(variable.id)}>
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
