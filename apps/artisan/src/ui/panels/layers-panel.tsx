// ─────────────────────────────────────────────────────────────
// ui/panels/layers-panel — layer + object tree (Monet layer rows)
// ─────────────────────────────────────────────────────────────

import { LayerTree, type LayerNode } from "@monet-ui/monet-react";
import { useRef } from "react";
import { Ops, type Item, Query } from "../../engine";
import { commands } from "../../commands";
import { useEditorState, useStore } from "../../state/store-context";

const itemLabel = (it: Item): string => it.name || it.type;

const itemNode = (item: Item): LayerNode => ({
  id: item.id,
  name: itemLabel(item),
  visible: item.visible,
  locked: item.locked,
  expanded: item.type === "group",
  ...(item.type === "group" ? { children: [...item.children].reverse().map(itemNode) } : {}),
});

export function LayersPanel() {
  const store = useStore();
  const { doc, selection, activeLayerId } = useEditorState();
  const additiveSelect = useRef(false);
  // Release to Layers is meaningful only when the active layer holds ≥2 items.
  const canRelease = (doc.layers.find((l) => l.id === activeLayerId)?.items.length ?? 0) >= 2;
  const activeIsTemplate = !!doc.layers.find((l) => l.id === activeLayerId)?.template;
  const nodes: LayerNode[] = [...doc.layers].reverse().map((layer) => ({
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity * 100,
    blendMode: layer.blendMode,
    colorChip: layer.color,
    expanded: true,
    children: [...layer.items].reverse().map(itemNode),
  }));

  // Hiding or locking deselects the affected objects (Illustrator parity).
  const pruneSelection = () => {
    const cur = store.getState().selection;
    const next = Query.selectableIds(store.getState().doc, cur);
    if (next.length !== cur.length) store.setSelection(next);
  };

  const setLayerVisible = (id: string, visible: boolean) => {
    store.transact("Toggle Layer", (d) => {
      const l = d.layers.find((x) => x.id === id);
      if (l) l.visible = visible;
    });
    pruneSelection();
  };
  const setLayerLocked = (id: string, locked: boolean) => {
    store.transact("Lock Layer", (d) => {
      const l = d.layers.find((x) => x.id === id);
      if (l) l.locked = locked;
    });
    pruneSelection();
  };
  const setItemVisible = (id: string, visible: boolean) => {
    store.transact("Toggle Visibility", (d) => {
      Ops.Items.setHidden(d, [id], !visible);
    });
    pruneSelection();
  };
  const setItemLocked = (id: string, locked: boolean) => {
    store.transact("Lock", (d) => {
      Ops.Items.setLocked(d, [id], locked);
    });
    pruneSelection();
  };

  const btn = { background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", fontSize: 14, padding: "2px 6px", lineHeight: 1 } as const;

  return (
    <div
      className="artisan-layers"
      style={{ padding: 6 }}
      onPointerDownCapture={(event) => {
        additiveSelect.current = event.shiftKey;
      }}
      onKeyDownCapture={() => {
        additiveSelect.current = false;
      }}
    >
      <div className="artisan-layers-toolbar" style={{ display: "flex", justifyContent: "flex-end", gap: 2, padding: "2px 2px 6px", borderBottom: "1px solid var(--border-1)", marginBottom: 4 }}>
        <button type="button" data-layer-action="new" title="New Layer" aria-label="New Layer" style={btn} onClick={() => commands.newLayer(store)}>＋</button>
        <button type="button" data-layer-action="duplicate" title="Duplicate Layer" aria-label="Duplicate Layer" style={btn} onClick={() => commands.duplicateLayer(store)}>⧉</button>
        <button type="button" data-layer-action="reverse" title="Reverse Layer Order" aria-label="Reverse Layer Order" disabled={doc.layers.length <= 1} style={{ ...btn, opacity: doc.layers.length <= 1 ? 0.4 : 1 }} onClick={() => commands.reverseLayerOrder(store)}>⇅</button>
        <button type="button" data-layer-action="release" title="Release to Layers" aria-label="Release to Layers" disabled={!canRelease} style={{ ...btn, opacity: canRelease ? 1 : 0.4 }} onClick={() => commands.releaseToLayers(store)}>⤓</button>
        <button type="button" data-layer-action="collect" title="Collect in New Layer" aria-label="Collect in New Layer" disabled={selection.length === 0} style={{ ...btn, opacity: selection.length ? 1 : 0.4 }} onClick={() => commands.collectInNewLayer(store)}>⊞</button>
        <button type="button" data-layer-action="template" title="Template Layer (non-printing)" aria-label="Template Layer" aria-pressed={activeIsTemplate} style={{ ...btn, color: activeIsTemplate ? "var(--accent-vector)" : btn.color }} onClick={() => commands.toggleLayerTemplate(store)}>◐</button>
        <button type="button" data-layer-action="flatten" title="Flatten Artwork" aria-label="Flatten Artwork" disabled={doc.layers.length <= 1} style={{ ...btn, opacity: doc.layers.length <= 1 ? 0.4 : 1 }} onClick={() => commands.flattenArtwork(store)}>▤</button>
        <button type="button" data-layer-action="delete" title="Delete Layer" aria-label="Delete Layer" disabled={doc.layers.length <= 1} style={{ ...btn, opacity: doc.layers.length <= 1 ? 0.4 : 1 }} onClick={() => commands.deleteLayer(store)}>🗑</button>
      </div>
      <LayerTree
        key={doc.id}
        nodes={nodes}
        selectedId={selection[0] ?? activeLayerId}
        aria-label="Artwork layers"
        onSelect={(id) => {
          if (doc.layers.some((layer) => layer.id === id)) store.setActiveLayer(id);
          else {
            const ids = Query.selectableIds(store.doc, [id]);
            if (ids.length) {
              if (additiveSelect.current) store.toggleSelection(ids[0]);
              else store.setSelection(ids);
            }
          }
          additiveSelect.current = false;
        }}
        onVisibilityChange={(id, visible) => {
          if (doc.layers.some((layer) => layer.id === id)) setLayerVisible(id, visible);
          else setItemVisible(id, visible);
        }}
        onLockChange={(id, locked) => {
          if (doc.layers.some((layer) => layer.id === id)) setLayerLocked(id, locked);
          else setItemLocked(id, locked);
        }}
      />
    </div>
  );
}
