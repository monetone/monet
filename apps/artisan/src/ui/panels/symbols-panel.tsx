// ─────────────────────────────────────────────────────────────
// ui/panels/symbols-panel — document symbol library baseline
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { Ops, Query } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";

const tbBtn = {
  background: "none",
  border: "none",
  color: "var(--text-2)",
  cursor: "pointer",
  fontSize: 13,
  padding: "2px 5px",
  lineHeight: 1,
} as const;

const actionStyle = (enabled = true) => ({ ...tbBtn, opacity: enabled ? 1 : 0.35, cursor: enabled ? "pointer" : "default" });

export function SymbolsPanel() {
  const store = useStore();
  const st = useEditorState();
  const symbols = Query.symbolDefinitionEntries(st.doc);
  const instances = Query.symbolInstanceEntries(st.doc);
  const selected = new Set(st.selection);
  const selectedInstances = instances.filter((entry) => selected.has(entry.itemId));
  const [activeRaw, setActive] = useState<string | null>(null);
  const active = symbols.find((entry) => entry.symbol.id === activeRaw) ?? symbols[0] ?? null;
  const selfReference = !!active && instances.some((entry) => {
    if (entry.symbolId !== active.symbol.id) return false;
    const loc = Query.findItem(st.doc, entry.itemId);
    return selected.has(entry.itemId) || !!loc?.ancestors.some((ancestor) => selected.has(ancestor.id));
  });
  const canRedefine = !!active && st.selection.length > 0 && !selfReference;
  const canSwap = !!active && selectedInstances.some((entry) => entry.symbolId !== active.symbol.id);
  const selectItem = (itemId: string) => {
    const ids = Query.selectableIds(store.doc, [itemId]);
    if (ids.length) store.setSelection(ids);
  };

  const createSymbol = () => {
    const name = window.prompt("Symbol name", `Symbol ${(st.doc.symbols?.length ?? 0) + 1}`);
    if (!name) return;
    let id: string | null = null;
    store.transact("New Symbol", (doc) => {
      id = Ops.Symbols.createSymbolFromSelection(doc, st.selection, name, { replaceSelection: true })?.definition.id ?? null;
    });
    if (id) setActive(id);
  };

  const placeSymbol = (symbolId: string) => {
    store.transact("Place Symbol", (doc) => {
      Ops.Symbols.placeSymbolInstance(doc, symbolId, { layerId: st.activeLayerId });
    });
  };

  const breakLinks = () => {
    store.transact("Break Symbol Link", (doc) => {
      Ops.Symbols.breakLink(doc, st.selection);
    });
  };

  const duplicateSymbol = () => {
    if (!active) return;
    let id: string | null = null;
    store.transact("Duplicate Symbol", (doc) => {
      id = Ops.Symbols.cloneDefinition(doc, active.symbol.id)?.id ?? null;
    });
    if (id) setActive(id);
  };

  const redefineSymbol = () => {
    if (!active || !canRedefine) return;
    store.transact("Redefine Symbol", (doc) => {
      Ops.Symbols.redefineSymbolFromSelection(doc, active.symbol.id, st.selection);
    });
  };

  const swapSymbols = () => {
    if (!active || !canSwap) return;
    store.transact("Replace Symbol", (doc) => {
      Ops.Symbols.swapSymbol(doc, st.selection, active.symbol.id);
    });
  };

  const deleteSymbol = () => {
    if (!active) return;
    const next = symbols.find((entry) => entry.symbol.id !== active.symbol.id)?.symbol.id ?? null;
    store.transact("Delete Symbol", (doc) => {
      Ops.Symbols.deleteSymbolDefinition(doc, active.symbol.id, { detachInstances: true });
    });
    setActive(next);
  };

  return (
    <div style={{ padding: "4px 6px 8px" }}>
      <div className="monet-row" style={{ alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="monet-section-label">Symbols</div>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 1, justifyContent: "flex-end" }}>
          <button
            type="button"
            data-symbol-action="new"
            title="New Symbol"
            aria-label="New Symbol"
            disabled={st.selection.length === 0}
            style={actionStyle(st.selection.length > 0)}
            onClick={createSymbol}
          >
            +
          </button>
          <button
            type="button"
            data-symbol-action="duplicate"
            title="Duplicate selected symbol"
            aria-label="Duplicate selected symbol"
            disabled={!active}
            style={actionStyle(!!active)}
            onClick={duplicateSymbol}
          >
            Duplicate
          </button>
          <button
            type="button"
            data-symbol-action="redefine"
            title={selfReference ? "A symbol cannot be redefined from one of its own instances" : "Redefine selected symbol from the artwork selection"}
            aria-label="Redefine selected symbol"
            disabled={!canRedefine}
            style={actionStyle(canRedefine)}
            onClick={redefineSymbol}
          >
            Redefine
          </button>
          <button
            type="button"
            data-symbol-action="swap"
            title="Replace selected instances with the selected symbol"
            aria-label="Replace selected symbol instances"
            disabled={!canSwap}
            style={actionStyle(canSwap)}
            onClick={swapSymbols}
          >
            Replace
          </button>
          <button
            type="button"
            data-symbol-action="break"
            title="Break Link"
            aria-label="Break Link"
            disabled={selectedInstances.length === 0}
            style={actionStyle(selectedInstances.length > 0)}
            onClick={breakLinks}
          >
            Break
          </button>
          <button
            type="button"
            data-symbol-action="delete"
            title="Delete selected symbol and keep its instances as artwork"
            aria-label="Delete selected symbol"
            disabled={!active}
            style={actionStyle(!!active)}
            onClick={deleteSymbol}
          >
            Delete
          </button>
        </span>
      </div>

      {symbols.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "4px 2px" }}>No symbols</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {symbols.map(({ symbol, instanceCount }) => (
            <div key={symbol.id} className={`monet-layer ${symbol.id === active?.symbol.id ? "is-selected" : ""}`} data-symbol={symbol.id} style={{ alignItems: "center", minHeight: 28 }}>
              <button
                type="button"
                data-symbol-select={symbol.id}
                aria-pressed={symbol.id === active?.symbol.id}
                style={{ ...tbBtn, flex: 1, minWidth: 0, textAlign: "left" }}
                onClick={() => setActive(symbol.id)}
              >
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{symbol.name}</span>
                <span style={{ display: "block", color: "var(--text-3)", fontSize: 10 }}>
                  {symbol.items.length} item{symbol.items.length === 1 ? "" : "s"} · {instanceCount} instance{instanceCount === 1 ? "" : "s"}
                </span>
              </button>
              <button
                type="button"
                data-symbol-action="place"
                title="Place Symbol"
                aria-label="Place Symbol"
                style={{ ...tbBtn, marginLeft: "auto" }}
                onClick={() => placeSymbol(symbol.id)}
              >
                Place
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="monet-section-label" style={{ marginTop: 8 }}>Instances</div>
      {instances.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "4px 2px" }}>No instances</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {instances.map((entry) => (
            <button
              key={entry.itemId}
              type="button"
              className={`monet-layer ${selected.has(entry.itemId) ? "is-selected" : ""}`}
              data-symbol-instance={entry.itemId}
              style={{ alignItems: "center", minHeight: 28, textAlign: "left", border: "none", width: "100%" }}
              onClick={() => selectItem(entry.itemId)}
            >
              <span className="name" style={{ minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.itemName}</span>
                <span style={{ display: "block", color: "var(--text-3)", fontSize: 10 }}>
                  {entry.symbolName} · {entry.layerName}{entry.missingDefinition ? " · missing" : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
