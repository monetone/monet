// ui/panels/character-panel - dedicated type character controls

import { Select } from "@monet-ui/monet-react";
import { fontResolutionForText, Ops, Query, type Document, type OpenTypeFeatureSetting, type TextItem, type TextWritingMode } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";
import { fontOptions, isFamilyAvailable } from "../fonts";
import { NumberField } from "../number-field";
import { togglePressed } from "../type-controls";

const FONT_WEIGHTS: { label: string; value: number }[] = [
  { label: "Thin", value: 100 },
  { label: "Light", value: 300 },
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
  { label: "Heavy", value: 800 },
  { label: "Black", value: 900 },
];

const WRITING_MODES: { label: string; value: TextWritingMode }[] = [
  { label: "Horizontal", value: "horizontal-tb" },
  { label: "Vertical RL", value: "vertical-rl" },
  { label: "Vertical LR", value: "vertical-lr" },
];

const LANGUAGE_OPTIONS = [
  { label: "Default", value: "" },
  { label: "English", value: "en" },
  { label: "French", value: "fr" },
  { label: "German", value: "de" },
  { label: "Japanese", value: "ja" },
  { label: "Arabic", value: "ar" },
  { label: "Chinese Simplified", value: "zh-Hans" },
];

const weightOptions = (current: number) =>
  FONT_WEIGHTS.some((w) => w.value === current) ? FONT_WEIGHTS : [...FONT_WEIGHTS, { label: String(current), value: current }].sort((a, b) => a.value - b.value);

const languageOptions = (current: string | undefined) =>
  !current || LANGUAGE_OPTIONS.some((option) => option.value === current)
    ? LANGUAGE_OPTIONS
    : [{ label: current, value: current }, ...LANGUAGE_OPTIONS];

export function CharacterPanel() {
  const store = useStore();
  const st = useEditorState();
  const { doc, selection } = st;
  const textItems = Query.selectionLeaves(doc, selection).filter((item): item is TextItem => item.type === "text");
  const text = textItems[0] ?? null;
  const fontResolution = text ? fontResolutionForText(text) : null;
  const italic = togglePressed(textItems, (item) => item.fontStyle === "italic");
  const underline = togglePressed(textItems, (item) => !!item.underline);
  const strikethrough = togglePressed(textItems, (item) => !!item.strikethrough);
  const allCaps = togglePressed(textItems, (item) => item.caps === "all");
  const smallCaps = togglePressed(textItems, (item) => item.caps === "small");
  const fontMissing = !!text && !isFamilyAvailable(text.fontFamily);

  const editText = (changed: boolean, label: string, fn: (d: Document) => void) => {
    if (!text) return;
    if (textItems.length === 1 && !changed) return;
    const editingSelectedText = !!st.editingTextId && textItems.some((item) => item.id === st.editingTextId);
    if (editingSelectedText && store.transactionBase) store.mutate(fn);
    else store.transact(label, fn);
  };

  const setFontFamily = (v: string) => editText(v !== text?.fontFamily, "Font", (d) => Ops.Text.setFontFamily(d, selection, v));
  const setFontSize = (v: number) => editText(v !== text?.fontSize, "Font Size", (d) => Ops.Text.setFontSize(d, selection, v));
  const setFontWeight = (v: number) => editText(v !== text?.fontWeight, "Font Weight", (d) => Ops.Text.setFontWeight(d, selection, v));
  const setLeading = (pt: number) => editText(pt !== (text?.lineHeight ?? 0) * (text?.fontSize ?? 0), "Leading", (d) => Ops.Text.setLeading(d, selection, pt));
  const setTracking = (v: number) => editText(v !== text?.letterSpacing, "Tracking", (d) => Ops.Text.setLetterSpacing(d, selection, v));
  const setBaseline = (v: number) => editText(v !== (text?.baselineShift ?? 0), "Baseline Shift", (d) => Ops.Text.setBaselineShift(d, selection, v));
  const setHScale = (v: number) => editText(v !== (text?.horizontalScale ?? 100), "Horizontal Scale", (d) => Ops.Text.setHorizontalScale(d, selection, v));
  const setVScale = (v: number) => editText(v !== (text?.verticalScale ?? 100), "Vertical Scale", (d) => Ops.Text.setVerticalScale(d, selection, v));
  const setKerning = (v: "auto" | "none") => editText(v !== (text?.kerning ?? "auto"), "Kerning", (d) => Ops.Text.setKerning(d, selection, v));
  const setLanguage = (v: string) => editText(v !== (text?.language ?? ""), "Language", (d) => Ops.Text.setLanguage(d, selection, v || undefined));
  const setWritingMode = (v: TextWritingMode) => editText(v !== (text?.writingMode ?? "horizontal-tb"), "Writing Mode", (d) => Ops.Text.setWritingMode(d, selection, v));
  const setFeature = (tag: string, enabled: boolean) => {
    const features: OpenTypeFeatureSetting[] = [
      ...(text?.features ?? []).filter((feature) => feature.tag !== tag),
      { tag, value: enabled },
    ];
    editText(true, "OpenType Features", (d) => Ops.Text.setOpenTypeFeatures(d, selection, features));
  };
  const toggleItalic = () => editText(true, "Italic", (d) => Ops.Text.toggleItalic(d, selection));
  const toggleUnderline = () => editText(true, "Underline", (d) => Ops.Text.toggleUnderline(d, selection));
  const toggleStrikethrough = () => editText(true, "Strikethrough", (d) => Ops.Text.toggleStrikethrough(d, selection));
  const toggleAllCaps = () => editText(true, "All Caps", (d) => Ops.Text.toggleCaps(d, selection, "all"));
  const toggleSmallCaps = () => editText(true, "Small Caps", (d) => Ops.Text.toggleCaps(d, selection, "small"));

  return (
    <div data-panel="character" style={{ padding: "4px 6px 8px" }}>
      <div className="monet-section-label">Character</div>
      {!text ? (
        <div style={{ fontSize: 10, color: "var(--text-3)", padding: "6px 4px" }}>No text selected.</div>
      ) : (
        <>
          <div className="monet-row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>{textItems.length === 1 ? "1 text object" : `${textItems.length} text objects`}</span>
            {fontMissing ? <span data-character-font-missing title="Font not installed - shown in a fallback" style={{ fontSize: 10, color: "var(--accent-vector)" }}>Missing font</span> : null}
          </div>

          <Select
            className={fontMissing ? "is-missing-font" : undefined}
            data-character-font
            size="sm"
            block
            style={{ fontFamily: text.fontFamily }}
            value={text.fontFamily}
            onChange={(v) => setFontFamily(v)}
            aria-label="Font family"
            title={fontMissing ? "Font not installed - shown in a fallback" : undefined}
            options={fontOptions(text.fontFamily).map((font) => ({ value: font.value, label: font.label, style: { fontFamily: font.value } }))}
          />

          <div className="monet-row" style={{ marginTop: 6 }}>
            <Select
              data-character-weight
              size="sm"
              value={String(text.fontWeight)}
              onChange={(v) => setFontWeight(Number(v))}
              style={{ flex: 1 }}
              aria-label="Font weight"
              options={weightOptions(text.fontWeight).map((weight) => ({ value: String(weight.value), label: weight.label }))}
            />
            <button className={`artisan-seg-btn ${italic === true ? "is-active" : ""}`} data-character-italic aria-pressed={italic} title="Italic" onClick={toggleItalic} style={{ width: 28, fontStyle: "italic" }}>
              I
            </button>
            <button className={`artisan-seg-btn ${underline === true ? "is-active" : ""}`} data-character-underline aria-pressed={underline} title="Underline" onClick={toggleUnderline} style={{ width: 28, textDecoration: "underline" }}>
              U
            </button>
            <button className={`artisan-seg-btn ${strikethrough === true ? "is-active" : ""}`} data-character-strike aria-pressed={strikethrough} title="Strikethrough" onClick={toggleStrikethrough} style={{ width: 28, textDecoration: "line-through" }}>
              S
            </button>
          </div>

          <div className="monet-row" style={{ marginTop: 5 }}>
            <button className={`artisan-seg-btn ${allCaps === true ? "is-active" : ""}`} data-character-allcaps aria-pressed={allCaps} title="All Caps" onClick={toggleAllCaps} style={{ width: 36, fontSize: 11 }}>
              TT
            </button>
            <button className={`artisan-seg-btn ${smallCaps === true ? "is-active" : ""}`} data-character-smallcaps aria-pressed={smallCaps} title="Small Caps" onClick={toggleSmallCaps} style={{ width: 36, fontSize: 11 }}>
              Tt
            </button>
            <Select
              data-character-kerning
              size="sm"
              value={text.kerning ?? "auto"}
              onChange={(v) => setKerning(v as "auto" | "none")}
              aria-label="Kerning"
              style={{ flex: 1 }}
              options={[
                { value: "auto", label: "Kerning Auto" },
                { value: "none", label: "Kerning None" },
              ]}
            />
          </div>

          <div className="artisan-grid2" style={{ marginTop: 7 }}>
            <label className="artisan-field-row" data-character-prop="size"><span className="lbl" style={{ width: "auto" }}>Size</span><NumberField value={text.fontSize} onCommit={setFontSize} min={0.1} /></label>
            <label className="artisan-field-row" data-character-prop="leading"><span className="lbl" style={{ width: "auto" }}>Leading</span><NumberField value={text.lineHeight * text.fontSize} onCommit={setLeading} min={0} /></label>
          </div>
          <div className="artisan-grid2" style={{ marginTop: 4 }}>
            <label className="artisan-field-row" data-character-prop="tracking"><span className="lbl" style={{ width: "auto" }}>Tracking</span><NumberField value={text.letterSpacing} onCommit={setTracking} /></label>
            <label className="artisan-field-row" data-character-prop="baseline"><span className="lbl" style={{ width: "auto" }}>Baseline</span><NumberField value={text.baselineShift ?? 0} onCommit={setBaseline} /></label>
          </div>
          <div className="artisan-grid2" style={{ marginTop: 4 }}>
            <label className="artisan-field-row" data-character-prop="hscale"><span className="lbl" style={{ width: "auto" }}>H Scale</span><NumberField value={text.horizontalScale ?? 100} onCommit={setHScale} min={1} /></label>
            <label className="artisan-field-row" data-character-prop="vscale"><span className="lbl" style={{ width: "auto" }}>V Scale</span><NumberField value={text.verticalScale ?? 100} onCommit={setVScale} min={1} /></label>
          </div>

          <div className="monet-section-label" style={{ marginTop: 10 }}>Language & Direction</div>
          <div className="monet-row">
            <Select data-character-language size="sm" value={text.language ?? ""} onChange={(v) => setLanguage(v)} aria-label="Language" style={{ flex: 1 }} options={languageOptions(text.language)} />
            <Select data-character-writing-mode size="sm" value={text.writingMode ?? "horizontal-tb"} onChange={(v) => setWritingMode(v as TextWritingMode)} aria-label="Writing mode" style={{ flex: 1 }} options={WRITING_MODES} />
          </div>

          <div id="character-opentype-label" className="monet-section-label" style={{ marginTop: 10 }}>OpenType</div>
          <div className="monet-row" role="group" aria-labelledby="character-opentype-label" style={{ gap: 8 }}>
            {[{ tag: "liga", label: "Ligatures" }, { tag: "kern", label: "Kerning" }].map(({ tag, label }) => {
              const enabled = text.features?.find((feature) => feature.tag === tag)?.value !== false;
              return (
                <label key={tag} className="monet-row" style={{ gap: 4, fontSize: 10 }}>
                  <input
                    type="checkbox"
                    data-character-feature={tag}
                    checked={enabled}
                    onChange={(event) => setFeature(tag, event.currentTarget.checked)}
                  />
                  {label}
                </label>
              );
            })}
          </div>

          {fontResolution ? (
            <div data-character-font-resolution style={{ marginTop: 8, color: "var(--text-3)", fontSize: 10, lineHeight: 1.35 }}>
              {fontResolution.status}: {fontResolution.resolvedFamily ?? fontResolution.requestedFamily}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
