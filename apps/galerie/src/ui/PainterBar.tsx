// PainterBar — the Library Painter (spray) tool, in the options bar. Arm it
// with a payload (rating / flag / label / keyword); grid clicks and drags then
// spray that payload instead of selecting. Re-painting the same value removes
// it (LR toggle semantics). Esc disarms.

import { Select } from "@monet-ui/monet-react";
import { useEffect, useState } from "react";

import { catalogAvailable, listMetadataPresets, listPresets } from "../catalog/catalog";
import { labelName } from "../lib/labelSet";
import type { MetadataPresetRow, PresetRow } from "../catalog/types";
import { store, useCatalogSelector, type PainterPayload } from "../state/store";

const LABELS: [string, string][] = [
  ["red", "#e5484d"],
  ["yellow", "#f5d90a"],
  ["green", "#46a758"],
  ["blue", "#3b82f6"],
  ["purple", "#8b5cf6"],
];

type Kind = PainterPayload["kind"];

export function PainterBar() {
  const painter = useCatalogSelector((s) => s.painter);
  const [kind, setKind] = useState<Kind>("rating");
  const [keyword, setKeyword] = useState("");
  // Preset sprays: the pickable lists (loaded once the bar mounts).
  const [metaPresets, setMetaPresets] = useState<MetadataPresetRow[]>([]);
  const [devPresets, setDevPresets] = useState<PresetRow[]>([]);
  const [metaSel, setMetaSel] = useState<number | "">("");
  const [devSel, setDevSel] = useState<number | "">("");
  useEffect(() => {
    if (!catalogAvailable()) return;
    void listMetadataPresets().then(setMetaPresets).catch(() => {});
    void listPresets().then(setDevPresets).catch(() => {});
  }, []);
  const metaPreset = metaPresets.find((m) => m.id === metaSel) ?? null;
  const devPreset = devPresets.find((d) => d.id === devSel) ?? null;

  useEffect(() => {
    if (!painter) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") store.setPainter(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [painter]);

  const armed = painter != null;
  const arm = (payload: PainterPayload) => store.setPainter(payload);

  return (
    <div className="gal-painter">
      <button
        className={"gal-filter-btn" + (armed ? " is-sel" : "")}
        title="Painter — spray an attribute onto grid photos (Esc to stop)"
        onClick={() => {
          if (armed) {
            store.setPainter(null);
            return;
          }
          const p = payloadFor(kind, keyword, metaPreset, devPreset);
          if (p) arm(p);
        }}
      >
        🖌 Paint
      </button>
      <Select
        className="gal-painter-kind"
        size="sm"
        value={kind}
        aria-label="Painter tool"
        options={[
          { value: "rating", label: "Rating" },
          { value: "flag", label: "Flag" },
          { value: "label", label: "Label" },
          { value: "keyword", label: "Keyword" },
          { value: "quick", label: "Target Collection" },
          { value: "metadataPreset", label: "Metadata Preset" },
          { value: "preset", label: "Develop Preset" },
        ]}
        onChange={(v) => {
          const next = v as Kind;
          setKind(next);
          if (armed) {
            const p = payloadFor(next, keyword, metaPreset, devPreset);
            if (p) arm(p);
            else store.setPainter(null); // preset kinds need a chosen preset
          }
        }}
      />

      {kind === "rating" &&
        [1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={
              "gal-filter-btn" +
              (painter?.kind === "rating" && painter.value === n ? " is-sel" : "")
            }
            onClick={() => arm({ kind: "rating", value: n })}
          >
            {"★".repeat(n)}
          </button>
        ))}

      {kind === "flag" && (
        <>
          <button
            className={
              "gal-filter-flag is-pick" +
              (painter?.kind === "flag" && painter.value === 1 ? " is-sel" : "")
            }
            title="Pick"
            onClick={() => arm({ kind: "flag", value: 1 })}
          >
            ⚑
          </button>
          <button
            className={
              "gal-filter-flag is-reject" +
              (painter?.kind === "flag" && painter.value === -1 ? " is-sel" : "")
            }
            title="Reject"
            onClick={() => arm({ kind: "flag", value: -1 })}
          >
            ⚑
          </button>
        </>
      )}

      {kind === "label" &&
        LABELS.map(([name, color]) => (
          <button
            key={name}
            title={labelName(name)}
            className={
              "gal-filter-swatch" +
              (painter?.kind === "label" && painter.value === name ? " is-sel" : "")
            }
            style={{ background: color }}
            onClick={() => arm({ kind: "label", value: name })}
          />
        ))}

      {kind === "metadataPreset" && (
        <Select
          className="gal-painter-kind"
          size="sm"
          value={String(metaSel)}
          aria-label="Metadata preset"
          options={[{ value: "", label: "Choose preset…" }, ...metaPresets.map((m) => ({ value: String(m.id), label: m.name }))]}
          onChange={(v) => {
            const id = v ? Number(v) : "";
            setMetaSel(id);
            const preset = metaPresets.find((m) => m.id === id);
            if (preset) arm({ kind: "metadataPreset", value: preset });
          }}
        />
      )}
      {kind === "preset" && (
        <Select
          className="gal-painter-kind"
          size="sm"
          value={String(devSel)}
          aria-label="Develop preset"
          options={[{ value: "", label: "Choose preset…" }, ...devPresets.map((d) => ({ value: String(d.id), label: d.name }))]}
          onChange={(v) => {
            const id = v ? Number(v) : "";
            setDevSel(id);
            const preset = devPresets.find((d) => d.id === id);
            if (preset) arm({ kind: "preset", value: preset });
          }}
        />
      )}
      {kind === "keyword" && (
        <input
          className="gal-painter-keyword"
          placeholder="keyword"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && keyword.trim()) {
              arm({ kind: "keyword", value: keyword.trim() });
            }
          }}
        />
      )}
    </div>
  );
}

function payloadFor(
  kind: Kind,
  keyword: string,
  metaPreset: MetadataPresetRow | null,
  devPreset: PresetRow | null,
): PainterPayload | null {
  switch (kind) {
    case "rating":
      return { kind: "rating", value: 1 };
    case "flag":
      return { kind: "flag", value: 1 };
    case "label":
      return { kind: "label", value: LABELS[0][0] };
    case "keyword":
      return { kind: "keyword", value: keyword.trim() || "keyword" };
    case "quick":
      return { kind: "quick" };
    case "metadataPreset":
      return metaPreset ? { kind: "metadataPreset", value: metaPreset } : null;
    case "preset":
      return devPreset ? { kind: "preset", value: devPreset } : null;
  }
}
