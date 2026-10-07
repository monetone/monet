// ui/panels/attributes-panel - print attributes for selected artwork

import { useEffect, useMemo, useRef } from "react";
import { Ops, Query, type Item } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";

type OverprintTarget = "fill" | "stroke";

const checkboxStyle = { width: 12, height: 12, margin: 0 } as const;

const collectLeaves = (item: Item, out: Item[] = []): Item[] => {
  if (item.type === "group") {
    item.children.forEach((child) => collectLeaves(child, out));
  } else {
    out.push(item);
  }
  return out;
};

const stateFor = (items: Item[], target: OverprintTarget) => {
  const values = items.map((item) => (target === "fill" ? item.overprintFill : item.overprintStroke) === true);
  const checked = values.length > 0 && values.every(Boolean);
  const some = values.some(Boolean);
  return { checked, mixed: some && !checked };
};

function Row({ label, value, attr }: { label: string; value: string | number; attr?: string }) {
  return (
    <div className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span data-attributes={attr}>{value}</span>
    </div>
  );
}

function OverprintCheckbox({
  label,
  target,
  checked,
  mixed,
  disabled,
  onChange,
}: {
  label: string;
  target: OverprintTarget;
  checked: boolean;
  mixed: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);

  return (
    <label className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "2px 0", opacity: disabled ? 0.45 : 1 }}>
      <span>{label}</span>
      <input
        ref={ref}
        data-attributes-overprint={target}
        data-attributes-mixed={mixed ? "true" : undefined}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        style={checkboxStyle}
      />
    </label>
  );
}

export function AttributesPanel() {
  const store = useStore();
  const { doc, selection } = useEditorState();
  const selectedLeaves = useMemo(
    () => selection.flatMap((id) => {
      const item = Query.getItem(doc, id);
      return item ? collectLeaves(item) : [];
    }),
    [doc, selection],
  );
  const fill = stateFor(selectedLeaves, "fill");
  const stroke = stateFor(selectedLeaves, "stroke");
  const disabled = selectedLeaves.length === 0;

  const setOverprint = (target: OverprintTarget, value: boolean) => {
    if (disabled) return;
    store.transact(target === "fill" ? "Overprint Fill" : "Overprint Stroke", (d) => {
      Ops.Prepress.setOverprint(d, selection, target, value);
    });
  };

  return (
    <div style={{ padding: "4px 8px 8px" }}>
      <div className="monet-section-label">Attributes</div>
      <Row label="Selected" value={selection.length} attr="selected" />
      <Row label="Editable Objects" value={selectedLeaves.length} attr="editable" />

      <div className="monet-section-label" style={{ marginTop: 8 }}>Overprint</div>
      <OverprintCheckbox
        label="Fill"
        target="fill"
        checked={fill.checked}
        mixed={fill.mixed}
        disabled={disabled}
        onChange={(value) => setOverprint("fill", value)}
      />
      <OverprintCheckbox
        label="Stroke"
        target="stroke"
        checked={stroke.checked}
        mixed={stroke.mixed}
        disabled={disabled}
        onChange={(value) => setOverprint("stroke", value)}
      />
    </div>
  );
}
