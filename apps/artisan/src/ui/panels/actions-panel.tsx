// ui/panels/actions-panel - document-backed action macros

import { useMemo, useState } from "react";
import { Icon, I, Select } from "@monet-ui/monet-react";
import { commands } from "../../commands";
import { Ops, type ActionStepCommand } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";

const iconBtn = {
  background: "none",
  border: "none",
  color: "var(--text-2)",
  cursor: "pointer",
  display: "grid",
  height: 22,
  placeItems: "center",
  width: 22,
} as const;

const actionStyle = (enabled = true) => ({
  ...iconBtn,
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.35,
});

export function ActionsPanel() {
  const store = useStore();
  const st = useEditorState();
  const actions = st.doc.actions ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nextCommand, setNextCommand] = useState<ActionStepCommand>("duplicate");

  const selected = useMemo(
    () => actions.find((action) => action.id === selectedId) ?? actions[0] ?? null,
    [actions, selectedId],
  );

  const createAction = () => {
    const name = window.prompt("Action name", `Action ${actions.length + 1}`);
    if (!name) return;
    const id = commands.newAction(store, name);
    if (id) setSelectedId(id);
  };

  const renameAction = () => {
    if (!selected) return;
    const name = window.prompt("Action name", selected.name);
    if (!name) return;
    commands.renameAction(store, selected.id, name);
  };

  const deleteAction = () => {
    if (!selected) return;
    commands.deleteAction(store, selected.id);
    setSelectedId(null);
  };

  return (
    <div style={{ padding: "4px 6px 8px" }}>
      <div className="monet-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <div className="monet-section-label">Actions</div>
        <span style={{ display: "flex", gap: 1 }}>
          <button type="button" data-action-panel="new" title="New Action" aria-label="New Action" style={actionStyle()} onClick={createAction}>
            <Icon d={I.plus} size={12} />
          </button>
          <button
            type="button"
            data-action-panel="play"
            title="Play Action"
            aria-label="Play Action"
            disabled={!selected || st.selection.length === 0}
            style={actionStyle(!!selected && st.selection.length > 0)}
            onClick={() => selected && commands.playAction(store, selected.id)}
          >
            <Icon d={I.play} size={12} fill />
          </button>
          <button
            type="button"
            data-action-panel="rename"
            title="Rename Action"
            aria-label="Rename Action"
            disabled={!selected}
            style={actionStyle(!!selected)}
            onClick={renameAction}
          >
            <Icon d="M4 12L5 9L11 3L13 5L7 11L4 12Z M10 4L12 6" size={12} />
          </button>
          <button
            type="button"
            data-action-panel="delete"
            title="Delete Action"
            aria-label="Delete Action"
            disabled={!selected}
            style={actionStyle(!!selected)}
            onClick={deleteAction}
          >
            <Icon d={I.close} size={12} />
          </button>
        </span>
      </div>

      {actions.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "4px 2px" }}>No actions</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`monet-layer ${selected?.id === action.id ? "is-selected" : ""}`}
              data-action-id={action.id}
              style={{ alignItems: "center", minHeight: 28, textAlign: "left", border: "none", width: "100%" }}
              onClick={() => setSelectedId(action.id)}
            >
              <span className="name" style={{ minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{action.name}</span>
                <span style={{ display: "block", color: "var(--text-3)", fontSize: 10 }}>
                  {action.steps.length} step{action.steps.length === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          <div className="monet-row" style={{ gap: 4, marginTop: 8 }}>
            <Select
              data-action-step-command
              size="sm"
              value={nextCommand}
              onChange={(v) => setNextCommand(v as ActionStepCommand)}
              style={{ flex: 1, minWidth: 0 }}
              options={Ops.Actions.ACTION_COMMANDS.map((command) => ({ value: command, label: Ops.Actions.ACTION_COMMAND_LABELS[command] }))}
            />
            <button
              type="button"
              data-action-step="add"
              title="Add Step"
              aria-label="Add Step"
              style={actionStyle()}
              onClick={() => commands.appendActionStep(store, selected.id, nextCommand)}
            >
              <Icon d={I.plus} size={12} />
            </button>
          </div>

          <div className="monet-section-label" style={{ marginTop: 8 }}>Steps</div>
          {selected.steps.length === 0 ? (
            <div style={{ fontSize: 10, color: "var(--text-3)", padding: "4px 2px" }}>No steps</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {selected.steps.map((step, index) => {
                const enabled = step.enabled !== false;
                return (
                  <div key={step.id} className="monet-layer" data-action-step-id={step.id} style={{ alignItems: "center", minHeight: 26 }}>
                    <input
                      type="checkbox"
                      aria-label={`Enable ${step.name}`}
                      checked={enabled}
                      onChange={(event) => commands.setActionStepEnabled(store, selected.id, step.id, event.currentTarget.checked)}
                    />
                    <span className="name" style={{ minWidth: 0 }}>
                      {index + 1}. {step.name}
                    </span>
                    <button
                      type="button"
                      data-action-step="delete"
                      title="Delete Step"
                      aria-label="Delete Step"
                      style={{ ...iconBtn, marginLeft: "auto" }}
                      onClick={() => commands.deleteActionStep(store, selected.id, step.id)}
                    >
                      <Icon d={I.close} size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
