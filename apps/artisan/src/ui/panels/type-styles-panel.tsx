// ui/panels/type-styles-panel - document-backed type style presets

import { Ops, Query, type CharacterStyle, type ParagraphStyle, type TextItem } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";

const selectedTextItems = (doc: ReturnType<typeof useEditorState>["doc"], selection: string[]): TextItem[] =>
  Query.selectionLeaves(doc, selection).filter((item): item is TextItem => item.type === "text");

const characterSummary = (style: CharacterStyle): string =>
  `${style.attributes.fontFamily} / ${style.attributes.fontSize}px`;

const paragraphSummary = (style: ParagraphStyle): string =>
  `${style.attributes.align} / ${Math.round(style.attributes.lineHeight * 100)}%`;

export function TypeStylesPanel() {
  const store = useStore();
  const st = useEditorState();
  const { doc, selection } = st;
  const textItems = selectedTextItems(doc, selection);
  const hasTextSelection = textItems.length > 0;
  const characterStyles = doc.characterStyles ?? [];
  const paragraphStyles = doc.paragraphStyles ?? [];

  const createCharacterStyle = () => {
    if (!hasTextSelection) return;
    const name = window.prompt("Character style name", `Character Style ${characterStyles.length + 1}`);
    if (name == null) return;
    store.transact("New Character Style", (draft) => {
      Ops.TextStyles.createCharacterStyleFromSelection(draft, selection, name);
    });
  };

  const createParagraphStyle = () => {
    if (!hasTextSelection) return;
    const name = window.prompt("Paragraph style name", `Paragraph Style ${paragraphStyles.length + 1}`);
    if (name == null) return;
    store.transact("New Paragraph Style", (draft) => {
      Ops.TextStyles.createParagraphStyleFromSelection(draft, selection, name);
    });
  };

  const applyCharacterStyle = (style: CharacterStyle) => {
    if (!hasTextSelection) return;
    store.transact("Apply Character Style", (draft) => {
      Ops.TextStyles.applyCharacterStyle(draft, selection, style.id);
    });
  };

  const applyParagraphStyle = (style: ParagraphStyle) => {
    if (!hasTextSelection) return;
    store.transact("Apply Paragraph Style", (draft) => {
      Ops.TextStyles.applyParagraphStyle(draft, selection, style.id);
    });
  };

  const deleteCharacterStyle = (style: CharacterStyle) => {
    store.transact("Delete Character Style", (draft) => {
      Ops.TextStyles.deleteCharacterStyle(draft, style.id);
    });
  };

  const deleteParagraphStyle = (style: ParagraphStyle) => {
    store.transact("Delete Paragraph Style", (draft) => {
      Ops.TextStyles.deleteParagraphStyle(draft, style.id);
    });
  };

  return (
    <div data-panel="type-styles" style={{ padding: "4px 6px 8px" }}>
      <div className="monet-section-label">Type Styles</div>
      <div className="monet-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>{hasTextSelection ? `${textItems.length} text selected` : "No text selected"}</span>
        <span data-type-styles-count style={{ fontSize: 10, color: "var(--text-3)" }}>{characterStyles.length + paragraphStyles.length}</span>
      </div>

      <div className="monet-row">
        <button type="button" className="artisan-seg-btn" data-type-style-new-character disabled={!hasTextSelection} onClick={createCharacterStyle} style={{ flex: 1 }}>
          New Character
        </button>
        <button type="button" className="artisan-seg-btn" data-type-style-new-paragraph disabled={!hasTextSelection} onClick={createParagraphStyle} style={{ flex: 1 }}>
          New Paragraph
        </button>
      </div>

      <div className="monet-section-label" style={{ marginTop: 10 }}>Character Styles</div>
      <div data-type-style-character-list>
        {characterStyles.length === 0 ? (
          <div style={{ fontSize: 10, color: "var(--text-3)", padding: "5px 2px" }}>No character styles.</div>
        ) : (
          characterStyles.map((style) => (
            <div key={style.id} className="monet-row" data-type-style-character={style.id} style={{ alignItems: "center", gap: 5, marginTop: 4 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{style.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{characterSummary(style)}</div>
              </div>
              <button type="button" className="artisan-seg-btn" data-type-style-apply-character={style.id} disabled={!hasTextSelection} onClick={() => applyCharacterStyle(style)} style={{ width: 46 }}>
                Apply
              </button>
              <button type="button" className="artisan-seg-btn" data-type-style-delete-character={style.id} onClick={() => deleteCharacterStyle(style)} style={{ width: 28 }} title="Delete">
                X
              </button>
            </div>
          ))
        )}
      </div>

      <div className="monet-section-label" style={{ marginTop: 10 }}>Paragraph Styles</div>
      <div data-type-style-paragraph-list>
        {paragraphStyles.length === 0 ? (
          <div style={{ fontSize: 10, color: "var(--text-3)", padding: "5px 2px" }}>No paragraph styles.</div>
        ) : (
          paragraphStyles.map((style) => (
            <div key={style.id} className="monet-row" data-type-style-paragraph={style.id} style={{ alignItems: "center", gap: 5, marginTop: 4 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{style.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{paragraphSummary(style)}</div>
              </div>
              <button type="button" className="artisan-seg-btn" data-type-style-apply-paragraph={style.id} disabled={!hasTextSelection} onClick={() => applyParagraphStyle(style)} style={{ width: 46 }}>
                Apply
              </button>
              <button type="button" className="artisan-seg-btn" data-type-style-delete-paragraph={style.id} onClick={() => deleteParagraphStyle(style)} style={{ width: 28 }} title="Delete">
                X
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
