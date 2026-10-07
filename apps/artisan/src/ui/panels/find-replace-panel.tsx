// ─────────────────────────────────────────────────────────────
// ui/panels/find-replace-panel — Edit ▸ Find and Replace
// ─────────────────────────────────────────────────────────────
// Illustrator's Find and Replace dialog, as a panel: a needle, a replacement,
// Match Case / Whole Word, and a scope switch (whole document vs the selection).
// "Find" selects every type object that contains the needle so you can see them
// on the artboard; "Replace All" rewrites them in one undo step.

import { useState } from "react";
import { commands } from "../../commands";
import { Ops } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";

const inputStyle = {
  width: "100%",
  background: "var(--surface-2, rgba(255,255,255,.06))",
  border: "1px solid var(--border-1, rgba(255,255,255,.12))",
  borderRadius: 4,
  color: "var(--text-1)",
  fontSize: 11,
  padding: "3px 6px",
} as const;
const checkboxStyle = { width: 12, height: 12, margin: 0 } as const;
const btn = (enabled: boolean) =>
  ({
    background: "none",
    border: "1px solid var(--border-1, rgba(255,255,255,.12))",
    borderRadius: 4,
    color: "var(--text-2)",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.35,
    fontSize: 11,
    padding: "3px 8px",
    lineHeight: 1,
  }) as const;

export function FindReplacePanel() {
  const store = useStore();
  const st = useEditorState();
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scoped, setScoped] = useState(false);
  const [status, setStatus] = useState("");

  const opts = { find, replace, matchCase, wholeWord };
  const scopeIds = scoped ? st.selection : undefined;
  const matches = find ? Ops.FindReplace.findMatches(st.doc, { ...opts, ids: scopeIds }) : [];
  const total = matches.reduce((n, m) => n + m.count, 0);

  const onFind = () => {
    const ids = commands.findText(store, { ...opts, ids: scopeIds });
    setStatus(ids.length ? `${total} in ${ids.length} type object${ids.length === 1 ? "" : "s"}` : "Not found");
  };
  const onReplaceAll = () => {
    const n = commands.findAndReplace(store, { ...opts, scoped });
    setStatus(n ? `Replaced ${n}` : "Not found");
  };

  return (
    <div style={{ padding: "4px 8px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="monet-section-label">Find and Replace</div>
      <input
        style={inputStyle}
        data-find-replace="find"
        aria-label="Find"
        placeholder="Find"
        value={find}
        onChange={(e) => setFind(e.target.value)}
      />
      <input
        style={inputStyle}
        data-find-replace="replace"
        aria-label="Replace with"
        placeholder="Replace with"
        value={replace}
        onChange={(e) => setReplace(e.target.value)}
      />
      <label className="monet-row" style={{ gap: 6, fontSize: 11 }}>
        <input type="checkbox" style={checkboxStyle} data-find-replace="match-case" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
        Match Case
      </label>
      <label className="monet-row" style={{ gap: 6, fontSize: 11 }}>
        <input type="checkbox" style={checkboxStyle} data-find-replace="whole-word" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
        Whole Word
      </label>
      <label className="monet-row" style={{ gap: 6, fontSize: 11 }}>
        <input type="checkbox" style={checkboxStyle} data-find-replace="scoped" checked={scoped} onChange={(e) => setScoped(e.target.checked)} />
        Search selection only
      </label>
      <div className="monet-row" style={{ gap: 6 }}>
        <button type="button" style={btn(!!find)} data-find-replace="find-button" disabled={!find} onClick={onFind}>
          Find
        </button>
        <button type="button" style={btn(!!find)} data-find-replace="replace-button" disabled={!find} onClick={onReplaceAll}>
          Replace All
        </button>
      </div>
      <div data-find-replace="status" style={{ fontSize: 11, color: "var(--text-3)" }}>
        {status || (find ? `${total} match${total === 1 ? "" : "es"}` : "")}
      </div>
    </div>
  );
}
