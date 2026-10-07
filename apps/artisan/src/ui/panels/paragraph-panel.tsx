// ui/panels/paragraph-panel - dedicated paragraph controls

import { Ops, Query, type Document, type TextAlign, type TextItem } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";
import { NumberField } from "../number-field";
import { isAlignDisabled } from "../type-controls";

const TEXT_ALIGNS: { value: TextAlign; label: string; title: string }[] = [
  { value: "left", label: "L", title: "Align left" },
  { value: "center", label: "C", title: "Align center" },
  { value: "right", label: "R", title: "Align right" },
  { value: "justify", label: "J", title: "Justify" },
];

export function ParagraphPanel() {
  const store = useStore();
  const st = useEditorState();
  const { doc, selection } = st;
  const textItems = Query.selectionLeaves(doc, selection).filter((item): item is TextItem => item.type === "text");
  const text = textItems[0] ?? null;

  const editText = (changed: boolean, label: string, fn: (d: Document) => void) => {
    if (!text) return;
    if (textItems.length === 1 && !changed) return;
    const editingSelectedText = !!st.editingTextId && textItems.some((item) => item.id === st.editingTextId);
    if (editingSelectedText && store.transactionBase) store.mutate(fn);
    else store.transact(label, fn);
  };

  const setTextAlign = (align: TextAlign) => editText(align !== text?.align, "Align Text", (d) => Ops.Text.setAlign(d, selection, align));
  const setSpaceBefore = (v: number) => editText(v !== (text?.spaceBefore ?? 0), "Space Before", (d) => Ops.Text.setSpaceBefore(d, selection, v));
  const setSpaceAfter = (v: number) => editText(v !== (text?.spaceAfter ?? 0), "Space After", (d) => Ops.Text.setSpaceAfter(d, selection, v));
  const setIndentLeft = (v: number) => editText(v !== (text?.indentLeft ?? 0), "Left Indent", (d) => Ops.Text.setIndentLeft(d, selection, v));
  const setIndentRight = (v: number) => editText(v !== (text?.indentRight ?? 0), "Right Indent", (d) => Ops.Text.setIndentRight(d, selection, v));
  const setIndentFirst = (v: number) => editText(v !== (text?.indentFirst ?? 0), "First-Line Indent", (d) => Ops.Text.setIndentFirst(d, selection, v));
  const convertText = (target: "area" | "point") => {
    if (!textItems.length) return;
    store.transact(target === "area" ? "Convert to Area Type" : "Convert to Point Type", (d) => Ops.Text.convertText(d, selection, target));
  };
  const canConvert = textItems.some((item) => item.pathD == null);

  return (
    <div data-panel="paragraph" style={{ padding: "4px 6px 8px" }}>
      <div className="monet-section-label">Paragraph</div>
      {!text ? (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "6px 4px" }}>No text selected.</div>
      ) : (
        <>
          <div className="monet-row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>{textItems.length === 1 ? "1 text object" : `${textItems.length} text objects`}</span>
            <span data-paragraph-kind style={{ fontSize: 10, color: "var(--text-3)" }}>{text.boxWidth != null || text.boxHeight != null ? "Area type" : text.pathD ? "Path type" : "Point type"}</span>
          </div>

          <div className="artisan-seg" data-paragraph-align style={{ width: "100%" }}>
            {TEXT_ALIGNS.map((align) => {
              const disabled = isAlignDisabled(align.value, text);
              return (
                <button
                  key={align.value}
                  className={`artisan-seg-btn ${text.align === align.value ? "is-active" : ""}`}
                  data-paragraph-align-value={align.value}
                  title={disabled ? "Justify applies to area type only" : align.title}
                  aria-label={align.title}
                  aria-pressed={text.align === align.value}
                  disabled={disabled}
                  onClick={() => setTextAlign(align.value)}
                  style={{ flex: 1 }}
                >
                  {align.label}
                </button>
              );
            })}
          </div>

          <div className="monet-section-label" style={{ marginTop: 10 }}>Spacing</div>
          <div className="artisan-grid2">
            <label className="artisan-field-row" data-paragraph-prop="space-before"><span className="lbl" style={{ width: "auto" }}>Before</span><NumberField value={text.spaceBefore ?? 0} onCommit={setSpaceBefore} /></label>
            <label className="artisan-field-row" data-paragraph-prop="space-after"><span className="lbl" style={{ width: "auto" }}>After</span><NumberField value={text.spaceAfter ?? 0} onCommit={setSpaceAfter} /></label>
          </div>

          <div className="monet-section-label" style={{ marginTop: 10 }}>Indents</div>
          <div className="artisan-grid2">
            <label className="artisan-field-row" data-paragraph-prop="indent-left"><span className="lbl" style={{ width: "auto" }}>Left</span><NumberField value={text.indentLeft ?? 0} onCommit={setIndentLeft} /></label>
            <label className="artisan-field-row" data-paragraph-prop="indent-right"><span className="lbl" style={{ width: "auto" }}>Right</span><NumberField value={text.indentRight ?? 0} onCommit={setIndentRight} /></label>
          </div>
          <label className="artisan-field-row" data-paragraph-prop="indent-first" style={{ marginTop: 4 }}>
            <span className="lbl" style={{ width: "auto" }}>First Line</span>
            <NumberField value={text.indentFirst ?? 0} onCommit={setIndentFirst} />
          </label>

          <div className="monet-section-label" style={{ marginTop: 10 }}>Type Object</div>
          <div className="monet-row">
            <button type="button" className={`artisan-seg-btn ${text.boxWidth == null && text.boxHeight == null && !text.pathD ? "is-active" : ""}`} data-paragraph-convert="point" disabled={!canConvert} onClick={() => convertText("point")} style={{ flex: 1 }}>
              Point
            </button>
            <button type="button" className={`artisan-seg-btn ${text.boxWidth != null || text.boxHeight != null ? "is-active" : ""}`} data-paragraph-convert="area" disabled={!canConvert} onClick={() => convertText("area")} style={{ flex: 1 }}>
              Area
            </button>
          </div>
        </>
      )}
    </div>
  );
}
