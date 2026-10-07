// ui/panels/layers — the composition's layer stack (LayerList) + add buttons.

import { LayerList, type LayerData } from "@monet-ui/monet-react";
import { addLayer, reorderLayer, setLayerProps, setTransformValue } from "../../commands";
import { importImages } from "../../io/files";
import { activeComp } from "../../model/query";
import type { LayerKind } from "../../model/types";
import { store, useEditor } from "../../state/store";

const ADD: { kind: LayerKind; label: string }[] = [
  { kind: "solid", label: "Solid" },
  { kind: "text", label: "Text" },
  { kind: "shape", label: "Shape" },
  { kind: "null", label: "Null" },
];

export function LayersPanel() {
  const { project, selection } = useEditor();
  const comp = activeComp(project);
  const layers: LayerData[] = comp.layers.map((l) => ({
    id: l.id,
    name: l.name,
    visible: l.visible,
    locked: l.locked,
    opacity: l.transform.opacity,
    blendMode: l.blendMode,
    colorChip: l.color,
  }));

  return (
    <LayerList
      layers={layers}
      multiSelect
      selectedIds={selection}
      onSelectionChange={(ids) => store.setSelection(ids)}
      onVisibilityChange={(id, visible) => setLayerProps(id, { visible }, "Toggle visibility")}
      onLockChange={(id, locked) => setLayerProps(id, { locked }, "Toggle lock")}
      onOpacityChange={(id, opacity) => setTransformValue(id, "opacity", opacity)}
      header={
        <div style={{ display: "flex", gap: 4, padding: "6px 8px", flexWrap: "wrap" }}>
          {ADD.map((a) => (
            <button key={a.kind} className="monet-chip" onClick={() => addLayer(a.kind)}>
              + {a.label}
            </button>
          ))}
          {/* Image is import-first: an image layer with no source is useless. */}
          <button className="monet-chip" onClick={() => void importImages()} title="Import an image as a layer (or drop one on the window)">
            + Image…
          </button>
        </div>
      }
      footer={
        comp.layers.length > 1 && selection.length === 1 ? (
          <div style={{ display: "flex", gap: 4, padding: "6px 8px" }}>
            <button
              className="monet-chip"
              onClick={() => {
                const i = comp.layers.findIndex((l) => l.id === selection[0]);
                if (i > 0) reorderLayer(selection[0], i - 1);
              }}
            >
              Move up
            </button>
            <button
              className="monet-chip"
              onClick={() => {
                const i = comp.layers.findIndex((l) => l.id === selection[0]);
                if (i < comp.layers.length - 1) reorderLayer(selection[0], i + 1);
              }}
            >
              Move down
            </button>
          </div>
        ) : undefined
      }
    />
  );
}
