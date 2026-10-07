// ui/panels/shortcuts-panel - keyboard shortcut editor baseline

import { Select } from "@monet-ui/monet-react";
import { Ops, shortcutBindingId } from "../../engine";
import {
  SHORTCUT_ACTIONS,
  resolvedShortcutBinding,
  shortcutChoiceBindings,
  shortcutChoiceLabel,
  shortcutChoiceValue,
} from "../shortcut-registry";
import { useEditorState, useStore } from "../../state/store-context";

const groupedActions = () => {
  const groups = new Map<string, typeof SHORTCUT_ACTIONS>();
  for (const action of SHORTCUT_ACTIONS) {
    groups.set(action.section, [...(groups.get(action.section) ?? []), action]);
  }
  return [...groups.entries()];
};

export function ShortcutsPanel() {
  const store = useStore();
  const { doc } = useEditorState();
  const overrides = doc.shortcuts?.overrides ?? [];
  const changed = overrides.length;

  const applyChoice = (actionId: string, value: string) => {
    store.transact("Keyboard Shortcut", (d) => {
      const action = SHORTCUT_ACTIONS.find((entry) => entry.id === actionId);
      if (!action) return;
      if (value === "default") {
        Ops.Shortcuts.resetShortcutOverride(d, actionId);
        return;
      }
      if (value === "disabled") {
        Ops.Shortcuts.setShortcutOverride(d, actionId, { enabled: false });
        return;
      }
      const bindingId = value.replace(/^binding:/, "");
      const binding = shortcutChoiceBindings(action).find((entry) => shortcutBindingId(entry) === bindingId);
      if (binding) Ops.Shortcuts.setShortcutOverride(d, actionId, { binding, enabled: true });
    });
  };

  return (
    <div style={{ padding: "4px 8px 8px" }}>
      <div className="monet-section-label">Keyboard Shortcuts</div>
      <div className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
        <span style={{ color: "var(--text-3)" }}>Set</span>
        <span data-shortcuts="set-name">{doc.shortcuts?.setName ?? "Artisan Default"}</span>
      </div>
      <div className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
        <span style={{ color: "var(--text-3)" }}>Overrides</span>
        <span data-shortcuts="overrides">{changed}</span>
      </div>

      {groupedActions().map(([section, actions]) => (
        <div key={section}>
          <div className="monet-section-label" style={{ marginTop: 8 }}>{section}</div>
          {actions.map((action) => {
            const override = overrides.find((entry) => entry.actionId === action.id);
            const current = resolvedShortcutBinding(doc, action);
            const value = !override
              ? "default"
              : current
              ? shortcutChoiceValue(current)
              : "disabled";
            return (
              <label key={action.id} className="monet-row" style={{ alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, padding: "2px 0" }}>
                <span>{action.label}</span>
                <Select
                  size="sm"
                  data-shortcut-action={action.id}
                  value={value}
                  onChange={(v) => applyChoice(action.id, v)}
                  style={{ width: 112 }}
                  options={[
                    { value: "default", label: `Default (${shortcutChoiceLabel(action.defaultBinding)})` },
                    ...shortcutChoiceBindings(action).map((binding) => ({
                      value: shortcutChoiceValue(binding),
                      label: shortcutChoiceLabel(binding),
                    })),
                    { value: "disabled", label: "Disabled" },
                  ]}
                />
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}
