// QuickDevelopPanel — Library right-rail Quick Develop. LR semantics: buttons
// apply RELATIVE steps to every photo in the selection (each keeps its own
// baseline), unlike Develop's absolute sliders. Steps persist through the
// normal develop path, so they appear in each photo's History.

import { Button } from "@monet-ui/monet-react";

import { QUICK_SPECS, quickReset, quickStep, type QuickKey } from "../lib/quickDevelop";
import { store, useCatalog } from "../state/store";

export function QuickDevelopPanel() {
  const st = useCatalog();
  const targets = st.selection.length > 0
    ? st.selection
    : st.activeId != null
      ? [st.activeId]
      : [];
  const disabled = targets.length === 0;
  const step = (key: QuickKey, direction: 1 | -1, big: boolean) =>
    void store.applyQuickDevelop(targets, (r) => quickStep(r, key, direction, big));

  return (
    <div className="gal-dev-panel">
      <div className="gal-dev-head">
        <span className="gal-dev-title">Quick Develop</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void store.applyQuickDevelop(targets, quickReset)}
        >
          Reset All
        </Button>
      </div>
      {QUICK_SPECS.map((s) => (
        <div key={s.key} className="gal-qd-row" title={`${s.label} — relative to each photo`}>
          <span className="gal-dev-row-label">{s.label}</span>
          <span className="gal-qd-buttons">
            <button disabled={disabled} title={`−${s.big}`} onClick={() => step(s.key, -1, true)}>
              «
            </button>
            <button disabled={disabled} title={`−${s.small}`} onClick={() => step(s.key, -1, false)}>
              ‹
            </button>
            <button disabled={disabled} title={`+${s.small}`} onClick={() => step(s.key, 1, false)}>
              ›
            </button>
            <button disabled={disabled} title={`+${s.big}`} onClick={() => step(s.key, 1, true)}>
              »
            </button>
          </span>
        </div>
      ))}
      <div className="gal-qd-note">
        {disabled
          ? "Select photos to adjust"
          : `${targets.length} photo${targets.length === 1 ? "" : "s"}`}
      </div>
    </div>
  );
}
